import ResidentAvatar from './ResidentAvatar'
import SensorIcon from './SensorIcon'
import { StairsIllustration, RoundTableIllustration } from './RoomFurniture'

function furnitureFor(roomName) {
  const name = roomName.trim().toLowerCase()
  if (name === 'stairs') return StairsIllustration
  if (name === 'common area') return RoundTableIllustration
  return null
}

function BadgeCluster({ room, onSensorClick }) {
  const items = [
    ...room.sensors.map((s) => ({ kind: 'sensor', key: s.id, data: s })),
    ...room.residents.map((r) => ({ kind: 'resident', key: r.id, data: r })),
  ]
  if (items.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1 justify-center">
      {items.map((item) =>
        item.kind === 'sensor' ? (
          <button key={item.key} onClick={() => onSensorClick?.(item.data)} className="cursor-pointer">
            <SensorIcon sensor={item.data} />
          </button>
        ) : (
          <ResidentAvatar key={item.key} resident={item.data} />
        )
      )}
    </div>
  )
}

function RoomBlock({ room, onSensorClick }) {
  const hasAlert = room.sensors.some((s) => s.alert)
  const isLive = room.sensors.length > 0
  const Furniture = furnitureFor(room.name)

  return (
    <div
      className={`absolute rounded-lg shadow-sm flex flex-col justify-between p-2 overflow-hidden ${
        hasAlert
          ? 'border-2 border-danger bg-danger/10'
          : isLive
          ? 'border border-black/15 bg-surface'
          : 'border border-dashed border-black/10 bg-black/2'
      }`}
      style={{
        left: `${room.x}%`,
        top: `${room.y}%`,
        width: `${room.width}%`,
        height: `${room.height}%`,
      }}
    >
      {Furniture && <Furniture className="absolute inset-0 w-full h-full p-3 text-text-secondary/20" />}
      {hasAlert && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-danger animate-pulse" />}
      <span
        className={`relative text-xs font-medium truncate ${
          hasAlert ? 'text-danger' : isLive ? 'text-text-secondary' : 'text-text-secondary/50'
        }`}
      >
        {room.name}
      </span>
      <div className="relative">
        <BadgeCluster room={room} onSensorClick={onSensorClick} />
      </div>
    </div>
  )
}

export default function RoomGrid({ rooms, onSensorClick }) {
  return (
    <div
      className="relative border-2 border-border rounded-2xl bg-black/3 w-full"
      style={{ aspectRatio: '1113 / 633' }}
    >
      {rooms.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center text-text-secondary text-sm">
          No floor plan configured for this floor yet
        </div>
      ) : (
        rooms.map((room) => <RoomBlock key={room.id} room={room} onSensorClick={onSensorClick} />)
      )}
    </div>
  )
}
