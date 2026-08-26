import { useEffect, useState } from 'react'
import { RefreshCw, Power, Thermometer, Wind, Gauge, ToggleLeft } from 'lucide-react'
import DataTable from '../components/DataTable'
import { getAutomationEvents, getAutomations, getSensors, getAcStatus, getSwitchStatus } from '../api/client'

const AC_MODE_LABELS = { 0: 'Cool', 1: 'Heat', 2: 'Auto', 3: 'Fan', 4: 'Dry' }
const AC_FAN_LABELS = { 0: 'Auto', 1: 'Low', 2: 'Medium', 3: 'High' }

// Which sensor "type" actually carries out each action_type — lets the log
// name the physical device a firing targeted (e.g. "on Air Conditioner"),
// not just what was sent to it.
const ACTION_TYPE_TO_SENSOR_TYPE = { ac_command: 'aircon', send_ir: 'ir', toggle_switch: 'switch' }

function formatSingleEventType(eventType) {
  if (eventType === 'detected') return 'Motion detected (trigger checked)'
  if (eventType === 'power_on') return 'Turned AC on'
  if (eventType === 'power_off') return 'Turned AC off'
  if (eventType.startsWith('temp_')) return `Set temperature to ${eventType.slice(5)}°C`
  if (eventType.startsWith('mode_')) {
    const value = eventType.slice(5)
    return `Set mode to ${AC_MODE_LABELS[value] ?? value}`
  }
  if (eventType.startsWith('fan_')) {
    const value = eventType.slice(4)
    return `Set fan speed to ${AC_FAN_LABELS[value] ?? value}`
  }
  if (eventType === 'send_ir') return 'Sent IR code'
  if (eventType === 'toggle_switch') return 'Toggled switch'
  return eventType
}

// A single firing can bundle several settings together — e.g.
// "power_on+temp_30+temp_24" for a staged temperature change — so each part
// gets its own formatting pass rather than treating the whole joined string
// as one label (which just mangled everything after the first "+"). Returns
// each formatted part separately (not joined) so the caller can tell which
// one was the LAST stage actually reached — useful for a staged sequence,
// where "what it ended on" is the part that matters most at a glance.
function formatEventParts(eventType) {
  return eventType.split('+').map(formatSingleEventType)
}

export default function Logs() {
  const [events, setEvents] = useState([])
  const [automations, setAutomations] = useState([])
  const [sensors, setSensors] = useState([])
  const [acStatus, setAcStatus] = useState(null)
  const [switchStatus, setSwitchStatus] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = () => {
    setLoading(true)
    Promise.all([
      getAutomationEvents(),
      getAutomations(),
      getSensors(),
      // Live device state is a nice-to-have next to the history below — a
      // device being briefly unreachable shouldn't take down the whole page.
      getAcStatus().catch(() => null),
      getSwitchStatus().catch(() => null),
    ])
      .then(([e, a, s, ac, sw]) => {
        // "detected" events are logged on every single motion detection
        // (regardless of whether the automation actually fires), so they'd
        // quickly drown out the meaningful action rows here — they have
        // their own counter on the Automations page instead.
        const actionsOnly = e.filter((row) => row.event_type !== 'detected')
        // DataTable keys rows by `id` — synthesize one since events don't have
        // their own row identifier.
        setEvents(actionsOnly.map((row, i) => ({ ...row, id: `${row.automation_id}-${row.timestamp}-${i}` })))
        setAutomations(a)
        setSensors(s)
        setAcStatus(ac && !ac.error ? ac : null)
        setSwitchStatus(sw && !sw.error ? sw : null)
        setError(null)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 15000)
    return () => clearInterval(interval)
  }, [])

  // Manual (dashboard-click) rows have source: 'manual' and no real
  // automation_id — automation_id is just the reserved sentinel "manual" to
  // satisfy the DB's NOT NULL constraint (see analytics_store.log_manual_command).
  const automationName = (row) => (row.source === 'manual' ? 'Manual control' : automations.find((a) => a.id === row.automation_id)?.name || row.automation_id)

  const deviceNameFor = (row) => {
    if (row.source === 'manual') return sensors.find((s) => s.type === row.device)?.name
    const actionType = automations.find((a) => a.id === row.automation_id)?.action_type
    const sensorType = ACTION_TYPE_TO_SENSOR_TYPE[actionType]
    return sensors.find((s) => s.type === sensorType)?.name
  }

  const columns = [
    {
      key: 'timestamp',
      label: 'Time',
      render: (row) => new Date(row.timestamp * 1000).toLocaleString(),
    },
    {
      key: 'automation_id',
      label: 'Automation',
      render: (row) => automationName(row),
    },
    {
      key: 'event_type',
      label: 'What happened',
      render: (row) => {
        const parts = formatEventParts(row.event_type)
        const device = deviceNameFor(row)
        const lastIndex = parts.length - 1
        return (
          <span>
            {parts.map((part, i) => (
              <span key={i}>
                {i > 0 && ', then '}
                <span className={i === lastIndex ? 'font-semibold text-text-primary' : 'text-text-secondary'}>
                  {part}
                </span>
              </span>
            ))}
            {device && <span className="text-text-secondary"> on {device}</span>}
          </span>
        )
      },
    },
    {
      key: 'success',
      label: 'Result',
      render: (row) => (
        <span
          className={`px-2 py-1 rounded text-xs font-medium ${
            row.success ? 'bg-success/20 text-success' : 'bg-danger/20 text-danger'
          }`}
        >
          {row.success ? 'Success' : 'Failed'}
        </span>
      ),
    },
  ]

  return (
    <div className="max-w-6xl mx-auto px-8 py-10">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Logs</h1>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-2 text-text-secondary hover:text-text-primary text-sm font-medium disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <p className="mb-6 text-text-secondary text-sm">
        Every time an automation fires, successfully or not — refreshes automatically every 15s.
      </p>

      {(acStatus || switchStatus) && (
        <div className="mb-6 flex flex-wrap gap-3">
          {acStatus && (
            <div className="flex items-center gap-4 bg-surface border border-border rounded-lg px-4 py-3 text-sm">
              <span className="font-medium text-text-primary">Air Conditioner</span>
              <span className="flex items-center gap-1.5 text-text-secondary">
                <Power size={14} className={acStatus.power === '1' ? 'text-success' : 'text-text-secondary'} />
                {acStatus.power === '1' ? 'On' : 'Off'}
              </span>
              {acStatus.power === '1' && (
                <>
                  <span className="flex items-center gap-1.5 text-text-secondary">
                    <Thermometer size={14} />
                    {acStatus.temp}°C
                  </span>
                  <span className="flex items-center gap-1.5 text-text-secondary">
                    <Gauge size={14} />
                    {AC_MODE_LABELS[Number(acStatus.mode)] ?? acStatus.mode}
                  </span>
                  <span className="flex items-center gap-1.5 text-text-secondary">
                    <Wind size={14} />
                    {AC_FAN_LABELS[Number(acStatus.wind)] ?? acStatus.wind}
                  </span>
                </>
              )}
            </div>
          )}
          {switchStatus && (
            <div className="flex items-center gap-4 bg-surface border border-border rounded-lg px-4 py-3 text-sm">
              <span className="font-medium text-text-primary">Switch Robot</span>
              <span className="flex items-center gap-1.5 text-text-secondary">
                <ToggleLeft size={14} className={switchStatus.value ? 'text-success' : 'text-text-secondary'} />
                {switchStatus.online ? (switchStatus.value ? 'On' : 'Off') : 'Offline'}
              </span>
            </div>
          )}
        </div>
      )}

      {error && <div className="mb-4 text-danger text-sm">{error}</div>}

      {!error && events.length === 0 && !loading ? (
        <p className="text-text-secondary text-sm">No automation activity yet.</p>
      ) : (
        <DataTable columns={columns} rows={events} />
      )}
    </div>
  )
}
