import ResidentAvatar from './ResidentAvatar'
import SensorIcon from './SensorIcon'

function statusLine(room) {
  const pir = room.sensors.find((s) => s.type === 'pir')
  if (!pir) return null
  if (!pir.online) return 'Motion sensor offline'
  return pir.value === 'pir' ? 'Motion detected' : 'No motion'
}

export default function RoomCard({ room, onSensorClick, big = false }) {
  const hasAlert = room.sensors.some((s) => s.alert)
  const items = [
    // The IR blaster has no direct control of its own worth surfacing here —
    // it's a means to an end (AC commands, and capture_ir_codes.py), not
    // something you'd click on its own from the dashboard.
    ...room.sensors.filter((s) => s.type !== 'ir').map((s) => ({ kind: 'sensor', key: s.id, data: s })),
    ...room.residents.map((r) => ({ kind: 'resident', key: r.id, data: r })),
  ]

  return (
    <div
      className={`rounded-2xl border flex flex-col items-center justify-center text-center ${
        big ? 'p-12 min-h-105' : 'p-6'
      } ${hasAlert ? 'border-2 border-danger bg-danger/5' : 'border-border bg-surface'}`}
    >
      <div className="flex items-center justify-center gap-2 mb-1">
        <h2 className={big ? 'text-3xl font-bold' : 'text-xl font-bold'}>{room.name}</h2>
        {hasAlert && <span className="w-2.5 h-2.5 rounded-full bg-danger animate-pulse" />}
      </div>
      {statusLine(room) && (
        <p className={`text-text-secondary ${big ? 'text-base mb-8' : 'text-sm mb-5'}`}>{statusLine(room)}</p>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-text-secondary">No devices in this room yet — add one via Settings.</p>
      ) : (
        <div className={`flex flex-wrap justify-center ${big ? 'gap-6' : 'gap-3'}`}>
          {items.map((item) =>
            item.kind === 'sensor' ? (
              <button
                key={item.key}
                onClick={() => onSensorClick?.(item.data)}
                className="flex flex-col items-center gap-1.5 cursor-pointer"
              >
                <SensorIcon sensor={item.data} large={big} />
                <span className={`text-text-secondary truncate ${big ? 'text-sm max-w-24' : 'text-xs max-w-18'}`}>
                  {item.data.name}
                </span>
              </button>
            ) : (
              <ResidentAvatar key={item.key} resident={item.data} />
            )
          )}
        </div>
      )}
    </div>
  )
}
