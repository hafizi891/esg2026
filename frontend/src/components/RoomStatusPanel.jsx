import { useEffect, useState } from 'react'
import { Clock, Minus, Plus } from 'lucide-react'
import { sendAcCommand, toggleSwitch, getAutomationEvents, getAutomationHolds } from '../api/client'
import { useToast } from '../context/ToastContext.jsx'
import { roomHeadline, roomDescription } from '../lib/roomStatus'

const MODES = [
  { value: 0, label: 'Cool' },
  { value: 1, label: 'Heat' },
  { value: 2, label: 'Auto' },
  { value: 3, label: 'Fan' },
  { value: 4, label: 'Dry' },
]

function deviceStatusLabel(sensor, { acStatus, switchStatus }) {
  if (sensor.type === 'pir') return sensor.online ? (sensor.value === 'pir' ? 'Motion' : 'No motion') : 'Offline'
  if (sensor.type === 'mic') return sensor.online ? (sensor.value === 'talking' ? 'Talking' : 'Quiet') : 'Offline'
  if (sensor.type === 'aircon') {
    if (!acStatus) return sensor.online ? 'Online' : 'Offline'
    return acStatus.power === '1' ? `On · ${acStatus.temp}°C` : 'Off'
  }
  if (sensor.type === 'switch') {
    if (!switchStatus) return sensor.online ? 'Online' : 'Offline'
    return switchStatus.online ? (switchStatus.value ? 'On' : 'Off') : 'Offline'
  }
  if (sensor.value != null) return `${sensor.value}${sensor.unit || ''}`
  return sensor.online ? 'Online' : 'Offline'
}

function eventLabel(eventType) {
  if (eventType === 'detected') return 'Motion detected'
  return eventType
    .split('+')
    .map((part) => {
      if (part === 'power_on') return 'Turned AC on'
      if (part === 'power_off') return 'Turned AC off'
      if (part.startsWith('temp_')) return `Set temperature to ${part.slice(5)}°C`
      if (part === 'toggle_switch') return 'Toggled switch'
      if (part === 'send_ir') return 'Sent IR code'
      return part
    })
    .join(', then ')
}

export default function RoomStatusPanel({ room, acStatus, switchStatus, automations, onCommandSent }) {
  const [sending, setSending] = useState(false)
  const [events, setEvents] = useState([])
  const [holds, setHolds] = useState({})
  const showToast = useToast()

  const roomAutomationIds = new Set(
    room ? automations.filter((a) => room.sensors.some((s) => s.id === a.trigger_sensor_id)).map((a) => a.id) : []
  )

  useEffect(() => {
    if (!room) return
    getAutomationEvents(undefined, 300)
      .then((rows) => {
        const relevant = rows.filter((r) => roomAutomationIds.has(r.automation_id))
        setEvents(relevant.slice(-10).reverse())
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, automations])

  // Live "waiting for quiet" status — polled rather than pushed over SSE
  // since it's cheap, low-stakes UI, and a missed poll just means a few
  // extra seconds of staleness rather than a wrong dashboard state.
  useEffect(() => {
    if (!room) return
    const poll = () => getAutomationHolds().then(setHolds).catch(() => {})
    poll()
    const interval = setInterval(poll, 5000)
    return () => clearInterval(interval)
  }, [room])

  if (!room) {
    return <aside className="w-80 shrink-0 text-text-secondary text-sm p-6">Select a room to see its detail.</aside>
  }

  const ac = room.sensors.find((s) => s.type === 'aircon')
  const pir = room.sensors.find((s) => s.type === 'pir')
  const isAcOn = acStatus?.power === '1'
  const currentMode = acStatus ? Number(acStatus.mode) : null
  const currentTemp = acStatus?.temp != null ? Number(acStatus.temp) : 24

  const sendAc = async (code, value) => {
    setSending(true)
    try {
      await sendAcCommand(code, value)
      onCommandSent?.()
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      setSending(false)
    }
  }

  const adjustTemp = (delta) => sendAc('T', Math.min(30, Math.max(16, currentTemp + delta)))

  const sw = room.sensors.find((s) => s.type === 'switch')
  const toggleTheSwitch = async (value) => {
    setSending(true)
    try {
      await toggleSwitch(value)
      onCommandSent?.()
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <aside className="w-80 shrink-0">
      <div className="border border-border rounded-xl p-5 mb-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-bold tracking-widest text-accent uppercase">{room.name}</p>
          {pir && (
            <span className="text-[10px] font-bold tracking-widest text-text-secondary bg-black/5 px-2 py-0.5 rounded-full">
              MONITORED
            </span>
          )}
        </div>
        <h2 className="text-lg font-bold leading-tight mb-1">{roomHeadline(room)}</h2>
        <p className="text-sm text-text-secondary">{roomDescription(room, { acStatus })}</p>
        {Object.entries(holds)
          .filter(([id]) => roomAutomationIds.has(id))
          .map(([id, hold]) => {
            const automationName = automations.find((a) => a.id === id)?.name || 'A rule'
            const guardName = room.sensors.find((s) => s.id === hold.guard_sensor_id)?.name || 'a sensor'
            return (
              <p key={id} className="flex items-start gap-1.5 mt-2 text-xs text-warning">
                <Clock size={13} className="shrink-0 mt-0.5" />
                Waiting for quiet before "{automationName}" fires — {guardName} is still active.
              </p>
            )
          })}
      </div>

      {ac && (
        <div className="mb-4">
          <div className="flex items-center justify-between border border-border rounded-xl px-5 py-4 mb-3">
            <button
              disabled={sending}
              onClick={() => adjustTemp(-1)}
              className="w-9 h-9 rounded-full bg-black/5 hover:bg-black/10 flex items-center justify-center disabled:opacity-50"
            >
              <Minus size={16} />
            </button>
            <span className="text-3xl font-bold">
              {currentTemp}
              <span className="text-base align-top">°C</span>
            </span>
            <button
              disabled={sending}
              onClick={() => adjustTemp(1)}
              className="w-9 h-9 rounded-full bg-black/5 hover:bg-black/10 flex items-center justify-center disabled:opacity-50"
            >
              <Plus size={16} />
            </button>
          </div>

          <div className="grid grid-cols-5 gap-1.5 mb-3">
            {MODES.map((m) => (
              <button
                key={m.value}
                disabled={sending}
                onClick={() => sendAc('M', m.value)}
                className={`py-2 rounded-lg text-xs font-medium border disabled:opacity-50 ${
                  currentMode === m.value
                    ? 'border-accent text-accent bg-accent/10'
                    : 'border-black/10 text-text-secondary hover:border-accent hover:text-accent'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <button
            disabled={sending}
            onClick={() => sendAc(isAcOn ? 'PowerOff' : 'PowerOn', isAcOn ? 'PowerOff' : 'PowerOn')}
            className={`w-full py-3 rounded-lg font-semibold disabled:opacity-50 ${
              isAcOn ? 'bg-warning/10 text-warning border border-warning/30' : 'bg-success/10 text-success border border-success/30'
            }`}
          >
            {isAcOn ? 'Turn off' : 'Turn on'}
          </button>
        </div>
      )}

      {sw && (
        <div className="flex items-center justify-between border border-border rounded-xl px-4 py-3 mb-4">
          <span className="text-sm font-medium">Switch Robot</span>
          <div className="flex gap-2">
            <button
              disabled={sending}
              onClick={() => toggleTheSwitch(true)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-black/10 hover:border-accent hover:text-accent disabled:opacity-50"
            >
              On
            </button>
            <button
              disabled={sending}
              onClick={() => toggleTheSwitch(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-black/10 hover:border-accent hover:text-accent disabled:opacity-50"
            >
              Off
            </button>
          </div>
        </div>
      )}

      <p className="text-xs font-bold tracking-widest text-text-secondary mb-2">DEVICES</p>
      <div className="space-y-2.5 mb-6">
        {room.sensors.map((sensor) => (
          <div key={sensor.id} className="flex items-center justify-between text-sm">
            <span>{sensor.name}</span>
            <span
              className={
                sensor.alert
                  ? 'text-danger'
                  : sensor.value === 'pir' || sensor.value === 'talking'
                  ? 'text-accent'
                  : 'text-text-secondary'
              }
            >
              {deviceStatusLabel(sensor, { acStatus, switchStatus })}
            </span>
          </div>
        ))}
      </div>

      <p className="text-xs font-bold tracking-widest text-text-secondary mb-2">RECENT IN THIS ROOM</p>
      {events.length === 0 ? (
        <p className="text-sm text-text-secondary">No activity recorded yet.</p>
      ) : (
        <div className="space-y-3">
          {events.map((e, i) => (
            <div key={i}>
              <p className="text-xs text-text-secondary">{new Date(e.timestamp * 1000).toLocaleTimeString()}</p>
              <p className="text-sm font-medium">{eventLabel(e.event_type)}</p>
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}
