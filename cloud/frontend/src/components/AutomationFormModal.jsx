import { useEffect, useState } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'

const inputClass =
  'w-full bg-white/5 border border-white/15 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent'

// Same values as the Pi dashboard's AC controls — confirmed from Tuya's
// official infrared_ac instruction set, not guessed.
const MODES = [
  { value: 0, label: 'Cool' },
  { value: 1, label: 'Heat' },
  { value: 2, label: 'Auto' },
  { value: 3, label: 'Fan' },
  { value: 4, label: 'Dry' },
]

const FAN_SPEEDS = [
  { value: 0, label: 'Auto' },
  { value: 1, label: 'Low' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'High' },
]

// action_ac_commands stores the real code sent to Tuya (PowerOn/PowerOff/T/M/F)
// per row — this just groups PowerOn+PowerOff under one "Power" choice in the
// UI, since they're really one setting (on vs off) rather than two options.
function acAspectFor(code) {
  if (code === 'PowerOn' || code === 'PowerOff') return 'power'
  return code || 'power'
}

function defaultCommandFor(aspect) {
  if (aspect === 'T') return { code: 'T', value: 24, delay_seconds: 0 }
  if (aspect === 'M') return { code: 'M', value: 0, delay_seconds: 0 }
  if (aspect === 'F') return { code: 'F', value: 0, delay_seconds: 0 }
  return { code: 'PowerOn', value: 'PowerOn', delay_seconds: 0 }
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs text-text-secondary mb-1">{label}</span>
      {children}
    </label>
  )
}

function AcCommandRow({ command, onChange, onRemove, canRemove }) {
  const aspect = acAspectFor(command.code)

  return (
    <div className="rounded-lg border border-white/10 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <select
          className={inputClass}
          value={aspect}
          onChange={(e) => onChange({ ...defaultCommandFor(e.target.value), delay_seconds: command.delay_seconds })}
        >
          <option value="power">Power</option>
          <option value="T">Temperature</option>
          <option value="M">Mode</option>
          <option value="F">Fan speed</option>
        </select>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-text-secondary hover:text-danger shrink-0"
            aria-label="Remove this setting"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      {aspect === 'power' && (
        <select
          className={inputClass}
          value={command.code}
          onChange={(e) => onChange({ code: e.target.value, value: e.target.value })}
        >
          <option value="PowerOn">Turn On</option>
          <option value="PowerOff">Turn Off</option>
        </select>
      )}

      {aspect === 'T' && (
        <input
          type="number"
          min="16"
          max="30"
          className={inputClass}
          value={command.value ?? 24}
          onChange={(e) => onChange({ ...command, value: Number(e.target.value) })}
          placeholder="Temperature (°C)"
        />
      )}

      {aspect === 'M' && (
        <select
          className={inputClass}
          value={command.value ?? 0}
          onChange={(e) => onChange({ ...command, value: Number(e.target.value) })}
        >
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      )}

      {aspect === 'F' && (
        <select
          className={inputClass}
          value={command.value ?? 0}
          onChange={(e) => onChange({ ...command, value: Number(e.target.value) })}
        >
          {FAN_SPEEDS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      )}

      <label className="block">
        <span className="block text-xs text-text-secondary mb-1">
          Wait this long before sending this setting (seconds)
        </span>
        <input
          type="number"
          min="0"
          step="0.5"
          className={inputClass}
          value={command.delay_seconds ?? 0}
          onChange={(e) => onChange({ ...command, delay_seconds: Number(e.target.value) })}
        />
      </label>
    </div>
  )
}

export default function AutomationFormModal({ automation, triggerSensors, onClose, onSave }) {
  // Defaults are spread first, then `automation` on top — so editing an
  // automation saved before a field like guard_state existed still gets a
  // real value for it (instead of silently staying undefined, which
  // JSON.stringify then drops from the save payload entirely — the exact
  // bug that let a guard get saved with no guard_state at all).
  const [form, setForm] = useState(() => ({
    name: '',
    enabled: true,
    trigger_sensor_id: triggerSensors[0]?.id || '',
    trigger_condition: 'motion_detected',
    no_motion_minutes: 5,
    action_type: 'ac_command',
    action_ir_code: '',
    action_switch_state: 'on',
    guard_sensor_id: null,
    guard_state: 'inactive',
    ...automation,
  }))

  // no_motion_minutes is always stored in minutes (can be fractional, e.g. 0.5
  // = 30s) — these two just control what unit the number field is showing/
  // editing in, so short thresholds don't have to be typed as awkward decimals.
  const initialMinutes = form.no_motion_minutes ?? 5
  const [noMotionUnit, setNoMotionUnit] = useState(initialMinutes < 1 ? 'seconds' : 'minutes')
  const [noMotionValue, setNoMotionValue] = useState(
    initialMinutes < 1 ? Math.round(initialMinutes * 60) : initialMinutes
  )

  // One rule can bundle multiple AC settings together (e.g. power on + set
  // temperature to 24, fired as one action) instead of needing a separate
  // rule per setting.
  const [acCommands, setAcCommands] = useState(() =>
    form.action_ac_commands?.length ? form.action_ac_commands : [defaultCommandFor('power')]
  )

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))

  const updateCommand = (index, next) =>
    setAcCommands((cmds) => cmds.map((c, i) => (i === index ? next : c)))
  const addCommand = () => setAcCommands((cmds) => [...cmds, defaultCommandFor('power')])
  const removeCommand = (index) => setAcCommands((cmds) => cmds.filter((_, i) => i !== index))

  // "motion_detected"/"no_motion_timeout" are generic in the Pi's automation
  // engine (any sensor with an active/inactive value works) — only the
  // wording here needs to change per sensor type.
  const isAudio = triggerSensors.find((s) => s.id === form.trigger_sensor_id)?.type === 'mic'

  // Guard sensors are restricted to pir/mic — the only types whose readings
  // flow through the Pi's automation_engine.on_sensor_reading() and so have
  // a live active/inactive state to guard against.
  const guardSensors = triggerSensors.filter((s) => (s.type === 'pir' || s.type === 'mic') && s.id !== form.trigger_sensor_id)

  // Clears a stale guard selection if the trigger sensor is changed to be
  // the same sensor — a rule can't meaningfully guard against its own trigger.
  useEffect(() => {
    if (form.guard_sensor_id === form.trigger_sensor_id) set('guard_sensor_id', null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.trigger_sensor_id])

  const handleSubmit = (e) => {
    e.preventDefault()
    const no_motion_minutes = noMotionUnit === 'seconds' ? noMotionValue / 60 : noMotionValue
    onSave({ ...form, no_motion_minutes, action_ac_commands: acCommands })
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-surface border border-border shadow-xl rounded-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">{automation ? 'Edit Automation' : 'Add Automation'}</h2>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Name">
            <input className={inputClass} value={form.name} onChange={(e) => set('name', e.target.value)} required />
          </Field>
          <Field label="Trigger sensor">
            <select
              className={inputClass}
              value={form.trigger_sensor_id}
              onChange={(e) => set('trigger_sensor_id', e.target.value)}
            >
              {triggerSensors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="When">
            <select
              className={inputClass}
              value={form.trigger_condition}
              onChange={(e) => set('trigger_condition', e.target.value)}
            >
              <option value="motion_detected">{isAudio ? 'Talking is detected' : 'Motion is detected'}</option>
              <option value="no_motion_timeout">
                {isAudio ? 'No talking for a while (auto turn-off)' : 'No motion for a while (auto turn-off)'}
              </option>
            </select>
          </Field>
          {form.trigger_condition === 'no_motion_timeout' && (
            <Field label={isAudio ? 'No talking for this long before triggering' : 'No motion for this long before triggering'}>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="1"
                  className={inputClass}
                  value={noMotionValue}
                  onChange={(e) => setNoMotionValue(Number(e.target.value))}
                />
                <select
                  className={inputClass}
                  style={{ maxWidth: '8rem' }}
                  value={noMotionUnit}
                  onChange={(e) => setNoMotionUnit(e.target.value)}
                >
                  <option value="seconds">Seconds</option>
                  <option value="minutes">Minutes</option>
                </select>
              </div>
            </Field>
          )}

          {guardSensors.length > 0 && (
            <Field label="Also require (optional)">
              <select
                className={inputClass}
                value={form.guard_sensor_id || ''}
                onChange={(e) => set('guard_sensor_id', e.target.value || null)}
              >
                <option value="">No extra condition</option>
                {guardSensors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {form.guard_sensor_id && (
            <Field label="Only allow this rule to fire when that sensor is">
              <select
                className={inputClass}
                value={form.guard_state || 'inactive'}
                onChange={(e) => set('guard_state', e.target.value)}
              >
                <option value="inactive">Inactive (e.g. quiet / no motion) — the usual case</option>
                <option value="active">Active (e.g. talking / motion)</option>
              </select>
              <p className="text-xs text-text-secondary mt-1">
                e.g. pick the mic sensor + "Inactive" so a no-motion timeout won't turn off the AC or Switch Robot
                while people are still talking, even though the PIR shows no motion.
              </p>
            </Field>
          )}

          <Field label="Action">
            <select className={inputClass} value={form.action_type} onChange={(e) => set('action_type', e.target.value)}>
              <option value="ac_command">Air conditioner control (real AC control)</option>
              <option value="toggle_switch">Switch Robot control (real device)</option>
              <option value="send_ir">Send raw IR code</option>
            </select>
          </Field>

          {form.action_type === 'ac_command' && (
            <div className="space-y-2">
              <span className="block text-xs text-text-secondary">
                AC settings to apply together when this rule fires
              </span>
              {acCommands.map((cmd, i) => (
                <AcCommandRow
                  key={i}
                  command={cmd}
                  onChange={(next) => updateCommand(i, next)}
                  onRemove={() => removeCommand(i)}
                  canRemove={acCommands.length > 1}
                />
              ))}
              <button
                type="button"
                onClick={addCommand}
                className="flex items-center gap-1.5 text-xs font-medium text-accent hover:text-accent-hover"
              >
                <Plus size={14} /> Add another setting
              </button>
            </div>
          )}

          {form.action_type === 'toggle_switch' && (
            <Field label="Set Switch Robot to">
              <select
                className={inputClass}
                value={form.action_switch_state || 'on'}
                onChange={(e) => set('action_switch_state', e.target.value)}
              >
                <option value="on">Turn On</option>
                <option value="off">Turn Off</option>
              </select>
            </Field>
          )}

          {form.action_type === 'send_ir' && (
            <Field label="Send this Base64 IR code">
              <input
                className={inputClass}
                value={form.action_ir_code || ''}
                onChange={(e) => set('action_ir_code', e.target.value)}
                placeholder="Paste the code learned via the Tuya app..."
                required
              />
            </Field>
          )}

          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />
            Enabled
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-text-secondary hover:text-text-primary">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover font-medium">
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
