import threading
import time

import analytics_store

# In-memory runtime state — intentionally not persisted (acceptable: worst case
# after a restart is one redundant, idempotent re-fire; see plan for reasoning).
last_active_at = {}    # sensor_id -> timestamp last seen "active"
timeout_fired = {}     # rule_id -> bool, prevents re-firing every poll cycle

# sensor_id -> whether that sensor's most recent reading counts as "active"
# right now (see _is_active) — unlike last_active_at (a timestamp that only
# ever moves forward), this flips back to False the moment an inactive
# reading arrives. That's what makes it usable as a live guard condition
# (see _guard_passes): "is the mic hearing talking RIGHT NOW", not "when did
# it last hear talking".
current_active_state = {}

# Assumed current value for each AC "aspect" (power/temp/mode/fan), regardless
# of who last set it — an automation firing or a manual dashboard click. This
# is what actually stops a bundled rule (e.g. power + temp + fan together)
# from resending identical settings every time motion is redetected: each
# command in the bundle is only sent if it differs from what's tracked here,
# so the rule can fire continuously without repeatedly hitting the cloud for
# nothing to change. Not time-based at all — a setting only gets resent once
# something (this rule, another rule, or a manual click) actually changes it.
last_ac_state = {}

# Same idea as last_ac_state, but for the (single) switch device — True/False,
# or None if never observed. There's no cooldown anymore, so this is what
# stops a toggle_switch rule from re-sending the same on/off command on every
# single motion detection.
last_switch_state = None

# Aspects with a dispatch thread currently in flight for them (see _fire()'s
# threaded ac_command dispatch below). Needed because a bundle's dispatch can
# now take a while (delay_seconds) without blocking the caller — without this,
# every motion pulse that arrives before a pending change actually lands would
# see last_ac_state still showing the old value and spawn its own duplicate
# dispatch thread for the same change.
pending_ac_aspects = set()

# (automation_id, aspect) pairs whose staged sequence (e.g. temp 30 now, temp
# 24 two minutes later — see _should_send_ac_command()) has already run to
# completion. Without this, a staged sequence would replay in full on every
# single motion pulse for as long as the room stays occupied — motion_detected
# fires on every pulse, not just the first one after the room was empty, and
# staged aspects deliberately bypass the "already matches" guard that would
# otherwise stop that. Cleared for temp/mode/fan whenever the AC powers off
# (see _apply_ac_state), so the next occupancy session runs the sequence
# again from the start.
completed_staged_sequences = set()

_ASPECT_FOR_CODE = {"PowerOn": "power", "PowerOff": "power", "T": "temp", "M": "mode", "F": "fan"}


def _normalize_command_value(code, value):
    if code == "PowerOn":
        return True
    if code == "PowerOff":
        return False
    return value


def _apply_ac_state(code, value):
    """Records a command's effect on the assumed AC state. Turning the AC off
    also clears the assumed temp/mode/fan — once power is off, whatever those
    were previously set to no longer reflects anything real, so the next
    power-on should be free to reassert them. Without this, a rule that
    bundles PowerOn + a Temperature command would only ever send the
    Temperature once, ever — every later power-on would see "temp already
    matches" from before the AC was last turned off and silently skip it."""
    aspect = _ASPECT_FOR_CODE.get(code)
    if aspect is None:
        return
    last_ac_state[aspect] = _normalize_command_value(code, value)
    if code == "PowerOff":
        last_ac_state.pop("temp", None)
        last_ac_state.pop("mode", None)
        last_ac_state.pop("fan", None)
        completed_staged_sequences.difference_update(
            [entry for entry in completed_staged_sequences if entry[1] in ("temp", "mode", "fan")]
        )


def set_known_ac_state(code, value):
    """Sync the assumed AC state from OUTSIDE the automation engine — e.g. a
    manual click in the dashboard's AC remote (power, temperature, mode, or
    fan). Without this, a manual override would leave the tracked state
    stale, and the next automation fire would wrongly skip re-sending a
    setting because it still believes the AC is in its old state."""
    _apply_ac_state(code, value)


def _is_active(sensor_type, value):
    if sensor_type == "pir":
        return value == "pir"
    if sensor_type == "mic":
        return value == "talking"
    if sensor_type == "switch":
        return bool(value)
    return False


def _label_for_command(code, value):
    if code == "PowerOn":
        return "power_on"
    if code == "PowerOff":
        return "power_off"
    if code == "T":
        return f"temp_{value}"
    if code == "M":
        return f"mode_{value}"
    if code == "F":
        return f"fan_{value}"
    return f"ac_{code}"


def _event_type_for(action_type, commands):
    """Human-readable event label for the automation history log — named for
    the actual thing(s) that happened (power_on, temp_24, mode_1+fan_2, ...)
    rather than the raw code(s), and reflecting only what was ACTUALLY sent
    (see the unchanged-setting filter in _fire()) — not the rule's full
    configured bundle, which would be misleading if part of it was skipped."""
    if action_type == "ac_command":
        labels = [_label_for_command(c.get("code"), c.get("value")) for c in commands]
        return "+".join(labels) if labels else "ac_command"
    return action_type


def _guard_passes(automation):
    """An optional secondary condition, independent of the automation's own
    trigger sensor — e.g. "don't turn off the AC / switch robot via the
    no-motion timeout while the mic hears someone talking", since a PIR's
    motion pulses alone can't distinguish a video call from an empty room.
    Passes automatically (True) if no guard sensor is configured on this
    automation — every pre-existing automation is completely unaffected."""
    guard_sensor_id = automation.get("guard_sensor_id")
    if not guard_sensor_id:
        return True
    is_active = current_active_state.get(guard_sensor_id, False)
    required_state = automation.get("guard_state", "inactive")
    return is_active if required_state == "active" else not is_active


def _trigger_still_valid(automation, automations):
    """Re-checks whether the condition that made this rule fire is still true
    right now. Only matters after a deliberate delay_seconds wait — a long
    delay means real time has passed, and whatever was true when the rule
    started (motion present, or motion absent) might not be true anymore by
    the time a later command in the bundle is about to go out. Without this,
    a delayed command executes based on stale context — e.g. setting a
    temperature 60s after motion, even though the room emptied 55s ago.

    Deliberately NOT an instantaneous raw-value check ("is the sensor
    reporting 'pir' this exact millisecond?") — PIR sensors are pulse-based,
    reporting brief 'pir' blips separated by 'none' gaps even while someone
    is standing right there (see the flicker-gap analysis in the automation
    form). Checking the instant value would almost always see 'none' and
    wrongly abort. Instead this reuses the engine's own presence-tracking
    state, which already accounts for that pulsing behavior."""
    if not _guard_passes(automation):
        return False  # e.g. talking started mid-delay — abort the rest of the bundle

    sensor_id = automation["trigger_sensor_id"]

    if automation["trigger_condition"] == "no_motion_timeout":
        # If a fresh motion pulse arrived during the wait, on_sensor_reading()
        # would have reset this automation's own timeout_fired flag back to
        # False — that's the same signal check_timeouts() uses to decide
        # "no motion" is still in effect, so re-checking it here keeps both
        # sides of the logic consistent by construction.
        return timeout_fired.get(automation["id"], False)

    if automation["trigger_condition"] == "motion_detected":
        # Stale if, by *this* sensor's own no-motion threshold, the room
        # would now count as empty — checked directly against last_active_at
        # rather than waiting for a paired no_motion_timeout rule's own poll
        # cycle to have already flipped its timeout_fired flag. That flag is
        # only updated once every few seconds on an independent thread, so
        # relying on it here would race whenever a delay_seconds value lines
        # up close to (or exactly at) the no-motion threshold — right when it
        # matters most. Computing straight from last_active_at is immediate
        # and deterministic instead.
        now = time.time()
        for other in automations:
            if not (
                other.get("enabled")
                and other["trigger_condition"] == "no_motion_timeout"
                and other["trigger_sensor_id"] == sensor_id
            ):
                continue
            if sensor_id not in last_active_at:
                continue
            minutes = other.get("no_motion_minutes") or 0
            if now - last_active_at[sensor_id] >= minutes * 60:
                return False
        return True

    return True


def _dispatch_ac_bundle(automation, automations, commands, send_ac_command, notify_clients):
    """Sends a filtered AC command bundle, honoring each command's own
    delay_seconds and re-validating via _trigger_still_valid() after each
    wait. Runs on its own thread (see _fire()) rather than inline, so a long
    delay never blocks whatever called _fire() in the first place."""
    sent = []
    event_type = _event_type_for(automation["action_type"], commands)  # preliminary; covers the except branch below
    # How many not-yet-sent commands remain per aspect in this bundle — an
    # aspect is only freed from pending_ac_aspects once ALL of its stages
    # have gone out, not after its first one. Otherwise a multi-stage
    # sequence (e.g. temp 30 now, temp 24 two minutes later) would free
    # "temp" the instant the first stage lands, letting a fresh pulse spawn
    # a second, overlapping dispatch for the same aspect while this one is
    # still waiting to send its later stage.
    aspect_remaining = {}
    for cmd in commands:
        aspect = _ASPECT_FOR_CODE.get(cmd.get("code"))
        aspect_remaining[aspect] = aspect_remaining.get(aspect, 0) + 1
    try:
        for cmd in commands:
            delay = cmd.get("delay_seconds") or 0
            if delay:
                # Gives the IR blaster/AC a moment to process the previous
                # command — sending two commands back-to-back too fast can
                # cause the AC to drop the second one.
                time.sleep(delay)
                if not _trigger_still_valid(automation, automations):
                    break  # situation changed during the wait — stop here, don't send stale commands
            send_ac_command(cmd.get("code"), cmd.get("value"))
            _apply_ac_state(cmd.get("code"), cmd.get("value"))
            sent.append(cmd)
            aspect = _ASPECT_FOR_CODE.get(cmd.get("code"))
            aspect_remaining[aspect] -= 1
            if aspect_remaining[aspect] == 0:
                # Free this aspect up as soon as ALL its stages are actually
                # applied — not at the end of the whole bundle. Otherwise an
                # aspect that's already fully done (e.g. power, sent
                # instantly) would stay marked "pending" for as long as some
                # other aspect in the same bundle (e.g. temp) is still
                # waiting out its own delay, wrongly blocking an unrelated
                # rule from acting on that already-settled aspect.
                pending_ac_aspects.discard(aspect)
                # Marks a staged sequence (see _should_send_ac_command) as
                # done for this occupancy session — harmless to also mark for
                # ordinary single-entry aspects, since only the staged code
                # path ever consults this set.
                completed_staged_sequences.add((automation["id"], aspect))
        if not sent:
            return  # became invalid before even the first command went out — nothing happened, nothing to log
        event_type = _event_type_for(automation["action_type"], sent)  # reflect only what actually went out
        analytics_store.log_automation_event(automation["id"], event_type, True)
        notify_clients("automation_triggered", {"id": automation["id"], "success": True})
    except Exception as e:
        analytics_store.log_automation_event(automation["id"], event_type, False)
        notify_clients("automation_triggered", {"id": automation["id"], "success": False, "error": str(e)})
    finally:
        # Whether it fully sent, aborted partway, or errored — this attempt is
        # over, so a future pulse is free to try these aspects again.
        for cmd in commands:
            pending_ac_aspects.discard(_ASPECT_FOR_CODE.get(cmd.get("code")))


def _fire(automation, automations, send_ir_command, set_switch, send_ac_command, notify_clients):
    global last_switch_state

    commands = automation.get("action_ac_commands") or []
    wants_switch_on = None

    if automation["action_type"] == "ac_command":
        # How many commands in this bundle target each aspect. More than one
        # for the same aspect (e.g. two Temperature rows: 30 now, 24 two
        # minutes later) is a deliberate multi-stage sequence, not two
        # conflicting settings — see _should_send_ac_command() below.
        aspect_counts = {}
        for cmd in commands:
            aspect = _ASPECT_FOR_CODE.get(cmd.get("code"))
            aspect_counts[aspect] = aspect_counts.get(aspect, 0) + 1

        def _should_send_ac_command(cmd):
            aspect = _ASPECT_FOR_CODE.get(cmd.get("code"))
            # Not already being applied by a dispatch thread that's mid-delay
            # from an earlier pulse — otherwise every pulse that arrives
            # before a pending change actually lands would re-queue it.
            if aspect in pending_ac_aspects:
                return False
            if aspect != "power" and aspect_counts.get(aspect, 0) > 1:
                # A multi-stage sequence for this aspect — run the whole
                # sequence once per occupancy session rather than filtering
                # each stage independently against a single remembered value
                # (which would make the two stages perpetually flip-flop
                # instead of running in order), but also not on every single
                # motion pulse — motion_detected fires on every pulse, not
                # just the first one after the room was empty, and without
                # this check the whole sequence would replay every few
                # seconds for as long as the room stays occupied. Power is
                # deliberately excluded from this — a rule that bundles both
                # "on" and "off" together is the flicker bug fixed earlier
                # this session, not a legitimate staged sequence.
                return (automation["id"], aspect) not in completed_staged_sequences
            # Only send settings that actually differ from the last known
            # state — this is what stops a bundled rule (power + temp + fan
            # together) from resending identical settings every time it
            # fires. A setting only gets resent once it actually needs to
            # change — there's no cooldown at all, this is what prevents spam
            # for ordinary (non-staged) aspects.
            return last_ac_state.get(aspect) != _normalize_command_value(cmd.get("code"), cmd.get("value"))

        commands = [cmd for cmd in commands if _should_send_ac_command(cmd)]
        if not commands:
            return  # every setting in this rule is already applied, or already pending — nothing to do
        for cmd in commands:
            pending_ac_aspects.add(_ASPECT_FOR_CODE.get(cmd.get("code")))
        # Dispatched on its own thread, not inline: this function is often
        # called directly from the PIR listener's read loop (see listen_pir()
        # in app.py), which must keep reading pushed updates in real time.
        # Blocking it for a command's delay_seconds would stop it from
        # reading any further motion pulses for the whole wait, freezing
        # last_active_at and making _trigger_still_valid() see a false
        # "no motion" purely because nothing was being listened to — not
        # because motion actually stopped.
        threading.Thread(
            target=_dispatch_ac_bundle,
            args=(automation, automations, commands, send_ac_command, notify_clients),
            daemon=True,
        ).start()
        return
    elif automation["action_type"] == "toggle_switch":
        # Same idea as the AC guard above — skip if the switch is already
        # believed to be in the requested state.
        wants_switch_on = automation["action_switch_state"] == "on"
        if last_switch_state == wants_switch_on:
            return
    # NOTE: "send_ir" has no equivalent guard — a raw IR code has no state to
    # compare against, so a send_ir automation will fire on every single
    # trigger with nothing to stop it now that cooldown is gone.

    event_type = _event_type_for(automation["action_type"], commands)  # preliminary; covers the except branch below
    try:
        if automation["action_type"] == "send_ir":
            send_ir_command(automation["action_ir_code"])
        elif automation["action_type"] == "toggle_switch":
            set_switch(wants_switch_on)
            last_switch_state = wants_switch_on
        analytics_store.log_automation_event(automation["id"], event_type, True)
        notify_clients("automation_triggered", {"id": automation["id"], "success": True})
    except Exception as e:
        analytics_store.log_automation_event(automation["id"], event_type, False)
        notify_clients("automation_triggered", {"id": automation["id"], "success": False, "error": str(e)})


def on_sensor_reading(sensor, reading, automations, send_ir_command, set_switch, send_ac_command, notify_clients):
    """Call once per detected value-change for a sensor. Fires matching
    motion_detected rules and resets the timeout-fired flag for any paired
    no_motion_timeout rules on the same sensor."""
    active = _is_active(sensor["type"], reading.get("value"))
    sensor_id = sensor["id"]
    current_active_state[sensor_id] = active

    if active:
        last_active_at[sensor_id] = time.time()

        for automation in automations:
            if not automation.get("enabled") or automation["trigger_sensor_id"] != sensor_id:
                continue
            if automation["trigger_condition"] == "motion_detected":
                # Logged unconditionally — separate from whether _fire() below
                # actually sends a command (it may skip via the "already in
                # this state" guard, or an unmet guard_sensor_id condition).
                # This is the count of "how often was motion actually
                # detected", not "how often did we act on it".
                analytics_store.log_automation_event(automation["id"], "detected", True)
                if _guard_passes(automation):
                    _fire(automation, automations, send_ir_command, set_switch, send_ac_command, notify_clients)
            elif automation["trigger_condition"] == "no_motion_timeout":
                timeout_fired[automation["id"]] = False


def check_timeouts(automations, send_ir_command, set_switch, send_ac_command, notify_clients):
    """Call every poll cycle regardless of change — fires no_motion_timeout
    rules once their configured idle window has elapsed."""
    now = time.time()
    for automation in automations:
        if not automation.get("enabled") or automation["trigger_condition"] != "no_motion_timeout":
            continue
        if timeout_fired.get(automation["id"]):
            continue

        sensor_id = automation["trigger_sensor_id"]
        if sensor_id not in last_active_at:
            # Not observed yet this process lifetime — skip rather than treating
            # as epoch 0, which would fire immediately on every app restart.
            continue

        minutes = automation.get("no_motion_minutes") or 0
        if now - last_active_at[sensor_id] >= minutes * 60:
            if not _guard_passes(automation):
                # e.g. mic still hearing talking — don't mark timeout_fired:
                # leaving it False means this same check re-runs next poll
                # cycle (3s), so the rule fires the moment the guard clears
                # instead of being stuck until the next fresh motion pulse.
                # Printed so a blocked fire is directly visible in the
                # console at the moment it's blocked, not just inferred.
                print(
                    f"Automation '{automation.get('name', automation['id'])}': no-motion timeout reached but guard "
                    f"sensor {automation['guard_sensor_id']!r} is currently "
                    f"{'active' if current_active_state.get(automation['guard_sensor_id']) else 'inactive'} "
                    f"(needs {automation.get('guard_state', 'inactive')}) — holding off"
                )
                continue
            # Set BEFORE firing, not after: _fire() may block for a while on a
            # delayed command, and _trigger_still_valid() reads this same flag
            # during that wait to detect whether motion resumed in the
            # meantime. Setting it after firing would mean the flag is still
            # (wrongly) False for the whole duration of the wait.
            timeout_fired[automation["id"]] = True
            _fire(automation, automations, send_ir_command, set_switch, send_ac_command, notify_clients)
