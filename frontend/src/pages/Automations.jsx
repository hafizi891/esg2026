import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import DataTable from '../components/DataTable'
import AutomationFormModal from '../components/AutomationFormModal'
import {
  getAutomations,
  getSensors,
  createAutomation,
  updateAutomation,
  deleteAutomation,
  getAutomationEvents,
} from '../api/client'
import { useToast } from '../context/ToastContext.jsx'

// no_motion_minutes is always stored in minutes (can be fractional, e.g. 0.5
// = 30s) — display it in whichever unit reads more naturally.
function formatNoMotionDuration(minutes) {
  const totalSeconds = Math.round(minutes * 60)
  if (totalSeconds < 60) return `${totalSeconds}s`
  if (totalSeconds % 60 === 0) return `${totalSeconds / 60}min`
  return `${(totalSeconds / 60).toFixed(1)}min`
}

const AC_MODE_LABELS = { 0: 'Cool', 1: 'Heat', 2: 'Auto', 3: 'Fan', 4: 'Dry' }
const AC_FAN_LABELS = { 0: 'Auto', 1: 'Low', 2: 'Medium', 3: 'High' }

function formatAcCommand({ code, value, delay_seconds: delay }) {
  const label = (() => {
    if (code === 'PowerOn') return 'Turn On'
    if (code === 'PowerOff') return 'Turn Off'
    if (code === 'T') return `Set temp to ${value}°C`
    if (code === 'M') return `Mode → ${AC_MODE_LABELS[value] ?? value}`
    if (code === 'F') return `Fan → ${AC_FAN_LABELS[value] ?? value}`
    return String(code)
  })()
  return delay ? `${label} (after ${delay}s)` : label
}

function formatAcAction(row) {
  const commands = row.action_ac_commands || []
  if (commands.length === 0) return 'AC: (no settings configured)'
  return `AC: ${commands.map(formatAcCommand).join(' + ')}`
}

export default function Automations() {
  const [automations, setAutomations] = useState([])
  const [sensors, setSensors] = useState([])
  const [activityByAutomation, setActivityByAutomation] = useState({})
  const [editing, setEditing] = useState(null) // null = closed, {} = new, automation = edit existing
  const [loadError, setLoadError] = useState(null)
  const showToast = useToast()

  const refresh = () => {
    getAutomations().then(setAutomations).catch((e) => setLoadError(e.message))
  }

  // Detected = trigger condition was met, regardless of whether the action
  // actually fired (see automation_engine.py's unconditional "detected" log).
  // Fired = the action itself actually ran successfully. Showing both makes
  // it obvious when a cooldown/guard is quietly absorbing most detections
  // instead of spamming the real device.
  const refreshActivity = () => {
    getAutomationEvents(undefined, 5000)
      .then((events) => {
        const counts = {}
        events.forEach((e) => {
          const bucket = counts[e.automation_id] || { detected: 0, fired: 0 }
          if (e.event_type === 'detected') bucket.detected += 1
          else if (e.success) bucket.fired += 1
          counts[e.automation_id] = bucket
        })
        setActivityByAutomation(counts)
      })
      .catch(() => {}) // activity counts are a nice-to-have, don't block the page on it failing
  }

  useEffect(() => {
    getSensors().then(setSensors).catch((e) => setLoadError(e.message))
    refresh()
    refreshActivity()
    const interval = setInterval(refreshActivity, 15000)
    return () => clearInterval(interval)
  }, [])

  // Only sensors that actually generate a reading event can meaningfully
  // trigger a rule. Most types need a real linked Tuya device that's also
  // polled continuously — "ir"/"aircon" are write-only, and "switch" is
  // checked on-demand only (see app.py's SKIP_CONTINUOUS_POLL_TYPES). "mic"
  // is the one exception: it's not a Tuya device at all, driven instead by
  // its own dedicated thread (see mic_listener.py), so it has no
  // tuya_device_id but still generates continuous readings.
  const triggerSensors = sensors.filter(
    (s) => (s.tuya_device_id || s.type === 'mic') && s.type !== 'ir' && s.type !== 'aircon' && s.type !== 'switch'
  )
  const sensorName = (id) => sensors.find((s) => s.id === id)?.name || id

  const handleSave = async (form) => {
    try {
      if (form.id) {
        await updateAutomation(form.id, form)
        showToast(`${form.name} updated`, 'success')
      } else {
        await createAutomation(form)
        showToast(`${form.name} added`, 'success')
      }
      setEditing(null)
      refresh()
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  const handleDelete = async (id, name) => {
    if (!window.confirm('Delete this automation?')) return
    try {
      await deleteAutomation(id)
      showToast(`${name} deleted`, 'success')
      refresh()
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  const handleToggleEnabled = async (automation) => {
    try {
      await updateAutomation(automation.id, { enabled: !automation.enabled })
      refresh()
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  const columns = [
    { key: 'name', label: 'Name' },
    {
      key: 'trigger_sensor_id',
      label: 'Trigger',
      render: (row) => {
        const isAudio = sensors.find((s) => s.id === row.trigger_sensor_id)?.type === 'mic'
        const activeWord = isAudio ? 'talking' : 'motion'
        return row.trigger_condition === 'no_motion_timeout'
          ? `${sensorName(row.trigger_sensor_id)} → no ${activeWord} for ${formatNoMotionDuration(row.no_motion_minutes)}`
          : `${sensorName(row.trigger_sensor_id)} → ${activeWord} detected`
      },
    },
    {
      key: 'action_type',
      label: 'Action',
      render: (row) => {
        if (row.action_type === 'ac_command') return formatAcAction(row)
        if (row.action_type === 'toggle_switch') return `Switch Robot: ${row.action_switch_state === 'on' ? 'Turn On' : 'Turn Off'}`
        return 'Send IR code'
      },
    },
    {
      key: 'activity',
      label: 'Activity (24h)',
      render: (row) => {
        const a = activityByAutomation[row.id]
        if (row.trigger_condition !== 'motion_detected') return '—'
        if (!a || a.detected === 0) return '0 detected'
        return `${a.detected} detected · ${a.fired} fired`
      },
    },
    {
      key: 'enabled',
      label: 'Enabled',
      render: (row) => (
        <button
          onClick={() => handleToggleEnabled(row)}
          className={`px-2 py-1 rounded text-xs font-medium ${
            row.enabled ? 'bg-success/20 text-success' : 'bg-black/5 text-text-secondary'
          }`}
        >
          {row.enabled ? 'On' : 'Off'}
        </button>
      ),
    },
  ]

  return (
    <div className="max-w-6xl mx-auto px-8 py-10">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Automations</h1>
        <button
          onClick={() => setEditing({})}
          disabled={triggerSensors.length === 0}
          className="flex items-center gap-2 bg-accent hover:bg-accent-hover px-4 py-2 rounded-lg font-medium text-sm disabled:opacity-50"
        >
          <Plus size={16} /> Add Automation
        </button>
      </div>

      {triggerSensors.length === 0 && (
        <p className="mb-4 text-text-secondary text-sm">
          No sensors with a linked Tuya device yet — add one in Settings first.
        </p>
      )}
      {loadError && <div className="mb-4 text-danger text-sm">{loadError}</div>}

      <DataTable
        columns={columns}
        rows={automations}
        actions={(row) => (
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(row)} className="text-text-secondary hover:text-accent">
              <Pencil size={16} />
            </button>
            <button onClick={() => handleDelete(row.id, row.name)} className="text-text-secondary hover:text-danger">
              <Trash2 size={16} />
            </button>
          </div>
        )}
      />

      {editing !== null && (
        <AutomationFormModal
          automation={editing.id ? editing : null}
          triggerSensors={triggerSensors}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </div>
  )
}
