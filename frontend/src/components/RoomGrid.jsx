import ResidentAvatar from './ResidentAvatar'
import SensorIcon from './SensorIcon'
import { StairsIllustration, RoundTableIllustration } from './RoomFurniture'
import { roomState } from '../lib/roomStatus'

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
          <button
            key={item.key}
            onClick={(e) => {
              e.stopPropagation()
              onSensorClick?.(item.data)
            }}
            className="cursor-pointer"
          >
            <SensorIcon sensor={item.data} />
          </button>
        ) : (
          <ResidentAvatar key={item.key} resident={item.data} />
        )
      )}
    </div>
  )
}

const STATE_CLASSES = {
  alert: 'border-2 border-warning bg-warning/10',
  motion: 'border-2 border-accent bg-accent/10',
  'ac-running': 'border-2 border-success bg-success/10',
  idle: 'border border-black/15 bg-surface',
  empty: 'border border-dashed border-black/10 bg-black/2',
}

function RoomBlock({ room, isSelected, onSelect, onSensorClick, acStatus }) {
  const state = roomState(room, acStatus)
  const Furniture = furnitureFor(room.name)

  return (
    <div
      onClick={() => state !== 'empty' && onSelect?.(room.id)}
      className={`absolute rounded-lg shadow-sm flex flex-col justify-between p-2 overflow-hidden ${STATE_CLASSES[state]} ${
        state !== 'empty' ? 'cursor-pointer' : ''
      } ${isSelected ? 'ring-2 ring-offset-1 ring-accent' : ''}`}
      style={{
        left: `${room.x}%`,
        top: `${room.y}%`,
        width: `${room.width}%`,
        height: `${room.height}%`,
      }}
    >
      {Furniture && <Furniture className="absolute inset-0 w-full h-full p-3 text-text-secondary/20" />}
      {state === 'alert' && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-warning animate-pulse" />}
      <span
        className={`relative text-xs font-medium truncate ${
          state === 'alert'
            ? 'text-warning'
            : state === 'motion'
            ? 'text-accent'
            : state === 'empty'
            ? 'text-text-secondary/50'
            : 'text-text-secondary'
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

export default function RoomGrid({ rooms, selectedRoomId, onSelectRoom, onSensorClick, acStatus }) {
  return (
    <div className="relative border-2 border-border rounded-2xl bg-black/3 w-full" style={{ aspectRatio: '1113 / 633' }}>
      {rooms.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center text-text-secondary text-sm">
          No floor plan configured for this floor yet
        </div>
      ) : (
        rooms.map((room) => (
          <RoomBlock
            key={room.id}
            room={room}
            isSelected={room.id === selectedRoomId}
            onSelect={onSelectRoom}
            onSensorClick={onSensorClick}
            acStatus={acStatus}
          />
        ))
      )}
    </div>
  )
}
