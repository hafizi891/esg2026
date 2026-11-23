import { relativeTime, roomHeadline, roomDescription, roomState } from '../lib/roomStatus'

function deviceStatusLabel(sensor, { acStatus, now }) {
  if (sensor.type === 'pir') return sensor.online ? (sensor.value === 'pir' ? 'Motion' : 'No motion') : 'Offline'
  if (sensor.type === 'aircon') {
    if (!acStatus?.online) return 'No state yet'
    return acStatus.power === '1' ? `On · ${acStatus.temp}°C` : 'Off'
  }
  if (sensor.type === 'ir') return sensor.online ? 'Online' : 'Offline'
  if (sensor.type === 'mic') {
    if (!sensor.online) return 'Offline'
    if (sensor.value == null) return 'Waiting for sound'
    const when = sensor.changed_at != null ? relativeTime(now - sensor.changed_at) : null
    return `Level ${sensor.value}${when ? ` · ${when}` : ''}`
  }
  if (sensor.id === 'sensor-device') return sensor.value === 'online' ? 'Online' : 'Offline'
  if (sensor.value != null) return `${sensor.value}${sensor.unit || ''}`
  return sensor.online ? 'Online' : 'Offline'
}

function statusColor(sensor, { acStatus }) {
  if (sensor.alert) return 'text-danger'
  if (sensor.type === 'pir') return sensor.value === 'pir' ? 'text-accent' : 'text-text-secondary'
  if (sensor.type === 'aircon' && acStatus?.power === '1') return 'text-info'
  return 'text-text-secondary'
}

export default function RoomStatusPanel({
  room,
  acStatus,
  lastMotionSeconds,
  recentEvents,
  now,
}) {
  if (!room) {
    return (
      <aside className="w-full lg:w-80 shrink-0 flex items-center justify-center text-text-secondary text-sm p-6">
        Select a room to see its detail.
      </aside>
    )
  }

  const hasAc = room.sensors.find((s) => s.type === 'aircon')
  const state = roomState(room, acStatus)
  const isOn = acStatus?.power === '1'
  const temp = acStatus?.temp != null ? Number(acStatus.temp) : null

  return (
    <aside className="w-full lg:w-80 shrink-0 flex flex-col gap-4">
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
          <div className="text-center mb-5">
            <p className="text-xs font-bold tracking-widest text-text-secondary uppercase mb-2">Air conditioner</p>
            <span className="text-4xl font-bold">
              {isOn && temp != null ? `${temp}°C` : 'Off'}
            </span>
          </div>
          <p className="text-xs text-text-secondary text-center">Live status reported by the ESP8266.</p>
        </div>
      )}

      <div className="rounded-xl border border-border bg-surface divide-y divide-border">
        <p className="px-4 pt-3 pb-1 text-[10px] font-bold tracking-widest text-text-secondary uppercase">Devices</p>
        {room.sensors.map((sensor) => (
          <div
            key={sensor.id}
            className="w-full flex items-center justify-between px-4 py-3 text-sm"
          >
            <span className="text-text-primary font-medium">{sensor.name}</span>
            <span className={statusColor(sensor, { acStatus })}>
              {deviceStatusLabel(sensor, { acStatus, now })}
            </span>
          </div>
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
              <p className="text-text-primary">
                {e.label}
                {e.count > 1 && <span className="text-text-secondary"> ×{e.count}</span>}
              </p>
            </div>
          ))}
        </div>
      )}

    </aside>
  )
}
