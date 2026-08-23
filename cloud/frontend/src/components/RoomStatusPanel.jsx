import { Minus, Plus } from 'lucide-react'
import { roomHeadline, roomDescription, roomState } from '../lib/roomStatus'

const MODES = [
  { value: 0, label: 'Cool' },
  { value: 1, label: 'Heat' },
  { value: 2, label: 'Auto' },
  { value: 3, label: 'Fan' },
  { value: 4, label: 'Dry' },
]

function deviceStatusLabel(sensor, { acStatus, switchStatus }) {
  if (sensor.type === 'pir') return sensor.online ? (sensor.value === 'pir' ? 'Motion' : 'No motion') : 'Offline'
  if (sensor.type === 'aircon') {
    if (!acStatus) return sensor.online ? 'Online' : 'Offline'
    return acStatus.power === '1' ? `On · ${acStatus.temp}°C` : 'Off'
  }
  if (sensor.type === 'ir') return sensor.online ? 'Online' : 'Offline'
  if (sensor.type === 'switch') {
    if (!switchStatus) return sensor.online ? 'Online' : 'Offline'
    return switchStatus.online ? (switchStatus.value ? 'On' : 'Off') : 'Offline'
  }
  if (sensor.value != null) return `${sensor.value}${sensor.unit || ''}`
  return sensor.online ? 'Online' : 'Offline'
}

function statusColor(sensor, { acStatus, switchStatus }) {
  if (sensor.alert) return 'text-danger'
  if (sensor.type === 'pir') return sensor.value === 'pir' ? 'text-accent' : 'text-text-secondary'
  if (sensor.type === 'aircon' && acStatus?.power === '1') return 'text-info'
  if (sensor.type === 'switch' && switchStatus?.value) return 'text-info'
  return 'text-text-secondary'
}

export default function RoomStatusPanel({
  room,
  acStatus,
  switchStatus,
  lastMotionSeconds,
  sending,
  onSendAcCommand,
  onToggleSwitch,
  onOpenIr,
  recentEvents,
}) {
  if (!room) {
    return (
      <aside className="w-80 shrink-0 flex items-center justify-center text-text-secondary text-sm p-6">
        Select a room to see its detail.
      </aside>
    )
  }

  const hasAc = room.sensors.find((s) => s.type === 'aircon')
  const hasSwitch = room.sensors.find((s) => s.type === 'switch')
  const state = roomState(room, acStatus)
  const isOn = acStatus?.power === '1'
  const temp = acStatus?.temp != null ? Number(acStatus.temp) : 22
  const currentMode = acStatus?.mode != null ? Number(acStatus.mode) : null

  const adjustTemp = (delta) => {
    const next = Math.min(30, Math.max(16, temp + delta))
    onSendAcCommand('T', next)
  }

  return (
    <aside className="w-80 shrink-0 flex flex-col gap-4">
      <div className="rounded-xl bg-surface-2 border border-border p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-bold tracking-widest text-accent uppercase">{room.name}</p>
          <span
            className={`text-[10px] font-bold tracking-widest uppercase px-2 py-1 rounded-full ${
              state === 'empty' ? 'bg-white/10 text-text-secondary' : 'bg-accent/15 text-accent'
            }`}
          >
            {state === 'empty' ? 'No devices' : state === 'motion' ? 'Occupied' : 'Monitored'}
          </span>
        </div>
        <h2 className="text-xl font-bold leading-tight mb-2">{roomHeadline(room)}</h2>
        <p className="text-sm text-text-secondary">{roomDescription(room, { acStatus, lastMotionSeconds })}</p>
      </div>

      {hasAc && (
        <div className="rounded-xl bg-surface-2 border border-border p-5">
          <div className="flex items-center justify-center gap-6 mb-5">
            <button
              disabled={sending}
              onClick={() => adjustTemp(-1)}
              className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center disabled:opacity-50"
            >
              <Minus size={15} />
            </button>
            <span className="text-4xl font-bold w-24 text-center">
              {temp}
              <span className="text-lg align-top">°C</span>
            </span>
            <button
              disabled={sending}
              onClick={() => adjustTemp(1)}
              className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center disabled:opacity-50"
            >
              <Plus size={15} />
            </button>
          </div>

          <div className="grid grid-cols-5 gap-1.5 mb-4">
            {MODES.map((m) => (
              <button
                key={m.value}
                disabled={sending}
                onClick={() => onSendAcCommand('M', m.value)}
                className={`py-2 rounded-lg border text-xs font-medium disabled:opacity-50 ${
                  currentMode === m.value
                    ? 'border-accent text-accent bg-accent/10'
                    : 'bg-white/3 border-white/10 hover:border-accent hover:text-accent'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <button
            disabled={sending}
            onClick={() => onSendAcCommand(isOn ? 'PowerOff' : 'PowerOn', isOn ? 'PowerOff' : 'PowerOn')}
            className={`w-full py-3 rounded-lg font-semibold disabled:opacity-50 ${
              isOn ? 'bg-warning/20 text-warning hover:bg-warning/30' : 'bg-accent hover:bg-accent-hover text-white'
            }`}
          >
            {isOn ? 'Turn off' : 'Turn on'}
          </button>
        </div>
      )}

      <div className="rounded-xl border border-border bg-surface divide-y divide-border">
        <p className="px-4 pt-3 pb-1 text-[10px] font-bold tracking-widest text-text-secondary uppercase">Devices</p>
        {room.sensors.map((sensor) => (
          <button
            key={sensor.id}
            onClick={() => {
              if (sensor.type === 'ir') onOpenIr()
              else if (sensor.type === 'switch') onToggleSwitch(!(switchStatus?.value))
            }}
            disabled={sensor.type !== 'ir' && sensor.type !== 'switch'}
            className="w-full flex items-center justify-between px-4 py-3 text-sm text-left disabled:cursor-default"
          >
            <span className="text-text-primary font-medium">{sensor.name}</span>
            <span className={statusColor(sensor, { acStatus, switchStatus })}>
              {deviceStatusLabel(sensor, { acStatus, switchStatus })}
            </span>
          </button>
        ))}
        {room.sensors.length === 0 && <p className="px-4 py-3 text-sm text-text-secondary">No devices in this room.</p>}
      </div>

      {recentEvents && recentEvents.length > 0 && (
        <div className="rounded-xl border border-border bg-surface divide-y divide-border">
          <p className="px-4 pt-3 pb-1 text-[10px] font-bold tracking-widest text-text-secondary uppercase">
            Recent in this room
          </p>
          {recentEvents.slice(0, 5).map((e, i) => (
            <div key={i} className="px-4 py-2.5 text-sm">
              <span className="text-text-secondary text-xs">{new Date(e.timestamp * 1000).toLocaleTimeString()}</span>
              <p className="text-text-primary">{e.label}</p>
            </div>
          ))}
        </div>
      )}

      {hasSwitch && !hasAc && (
        <button
          onClick={() => onToggleSwitch(!(switchStatus?.value))}
          className="w-full py-3 rounded-lg font-semibold bg-accent hover:bg-accent-hover text-white"
        >
          {switchStatus?.value ? 'Turn off switch' : 'Turn on switch'}
        </button>
      )}
    </aside>
  )
}
