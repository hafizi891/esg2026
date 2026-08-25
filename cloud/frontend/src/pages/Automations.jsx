import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import DataTable from '../components/DataTable'
import AutomationFormModal from '../components/AutomationFormModal'
import { getAutomations, getSensors, createAutomation, updateAutomation, deleteAutomation } from '../api/client'
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
  const [editing, setEditing] = useState(null) // null = closed, {} = new, automation = edit existing
  const [loadError, setLoadError] = useState(null)
  const showToast = useToast()

  useEffect(() => {
    getSensors().then(setSensors).catch((e) => setLoadError(e.message))
    getAutomations().then(setAutomations).catch((e) => setLoadError(e.message))
  }, [])

  // Every create/update/delete here is fire-and-forget over MQTT — the Pi
  // is the source of truth and mirrors its resulting full list back on
  // "state/automations" (retained), which the cloud backend re-broadcasts
  // to every open dashboard as this SSE event. That's what actually
  // updates the table below, not the initial POST/PUT/DELETE response.
  useEffect(() => {
    const source = new EventSource('/api/stream')
    source.addEventListener('automations', (e) => setAutomations(JSON.parse(e.data)))
    source.onerror = () => {}
    return () => source.close()
  }, [])

  // Cloud has no linked-Tuya-device concept of its own (it never talks to
  // Tuya) — every sensor in facility_layout.json is already real, so the
  // only filter that matters here is excluding write-only/on-demand types
  // that can never generate a trigger-worthy reading.
  const triggerSensors = sensors.filter((s) => s.type !== 'ir' && s.type !== 'aircon' && s.type !== 'switch')
  const sensorName = (id) => sensors.find((s) => s.id === id)?.name || id

  const handleSave = async (form) => {
    try {
      if (form.id) {
        await updateAutomation(form.id, form)
        showToast(`${form.name} — update sent to Pi`, 'success')
      } else {
        await createAutomation(form)
        showToast(`${form.name} — create sent to Pi`, 'success')
      }
      setEditing(null)
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  const handleDelete = async (id, name) => {
    if (!window.confirm('Delete this automation?')) return
    try {
      await deleteAutomation(id)
      showToast(`${name} — delete sent to Pi`, 'success')
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  const handleToggleEnabled = async (automation) => {
    try {
      await updateAutomation(automation.id, { enabled: !automation.enabled })
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  const columns = [
    { key: 'name', label: 'Name' },
    {
      key: 'trigger_sensor_id',
      label: 'Trigger',
      render: (row) =>
        row.trigger_condition === 'no_motion_timeout'
          ? `${sensorName(row.trigger_sensor_id)} → no motion for ${formatNoMotionDuration(row.no_motion_minutes)}`
          : `${sensorName(row.trigger_sensor_id)} → motion detected`,
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
      key: 'enabled',
      label: 'Enabled',
      render: (row) => (
        <button
          onClick={() => handleToggleEnabled(row)}
          className={`px-2 py-1 rounded text-xs font-medium ${
            row.enabled ? 'bg-success/20 text-success' : 'bg-white/10 text-text-secondary'
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

      <p className="mb-4 text-text-secondary text-sm">
        Changes here are sent to the Pi over MQTT and take effect there — this table updates once the Pi confirms.
      </p>
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
