import { roomState, roomStatusLine } from '../lib/roomStatus'

const DOT_CLASSES = {
  alert: 'bg-warning',
  motion: 'bg-accent',
  'ac-running': 'bg-info',
  idle: 'bg-text-secondary/40',
  empty: 'bg-text-secondary/20',
}

function RoomRow({ room, isSelected, onSelect, acStatus, lastMotionSeconds }) {
  const state = roomState(room, acStatus)
  const line = room.sensors.length === 0 ? 'No devices' : roomStatusLine(room, { acStatus, lastMotionSeconds }) || 'Idle'
  const isLive = room.sensors.length > 0

  return (
    <button
      onClick={() => onSelect(room.id)}
      className={`w-full flex items-start justify-between gap-2 pl-7 pr-3 py-1.5 rounded-lg text-left transition-colors ${
        isSelected ? 'bg-accent/15' : 'hover:bg-white/5'
      }`}
    >
      <span className="flex items-start gap-2 min-w-0">
        <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${DOT_CLASSES[state]}`} />
        <span className="min-w-0">
          <span className={`block text-sm font-medium truncate ${isSelected ? 'text-accent' : 'text-text-primary'}`}>
            {room.name}
          </span>
          <span className="block text-xs text-text-secondary truncate">{line}</span>
        </span>
      </span>
      {isLive && isSelected && (
        <span className="shrink-0 mt-0.5 text-[10px] font-bold tracking-widest text-accent uppercase">live</span>
      )}
    </button>
  )
}

export default function LevelsSidebar({
  floors,
  activeFloorId,
  onSelectFloor,
  activeFloorRooms,
  roomCounts,
  selectedRoomId,
  onSelectRoom,
  acStatus,
  lastMotionSeconds,
  facilitySummary,
}) {
  return (
    <aside className="w-64 shrink-0 flex flex-col gap-1">
      <p className="px-3 pb-2 text-xs font-bold tracking-widest text-text-secondary uppercase">Levels</p>
      {floors.map((floor) => {
        const isActive = floor.id === activeFloorId
        const counts = roomCounts[floor.id]
        return (
          <div key={floor.id}>
            <button
              onClick={() => onSelectFloor(floor.id)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors ${
                isActive ? 'bg-text-primary/10 text-text-primary' : 'hover:bg-white/5 text-text-primary'
              }`}
            >
              <span className="text-sm font-semibold">{floor.name}</span>
              {counts && <span className="text-xs text-text-secondary">{counts.instrumented} / {counts.total}</span>}
            </button>
            {isActive && (
              <div className="flex flex-col gap-0.5 mt-1 mb-2">
                {activeFloorRooms.map((room) => (
                  <RoomRow
                    key={room.id}
                    room={room}
                    isSelected={room.id === selectedRoomId}
                    onSelect={onSelectRoom}
                    acStatus={acStatus}
                    lastMotionSeconds={lastMotionSeconds}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}

      {facilitySummary && (
        <div className="mt-4 p-4 rounded-xl bg-surface border border-border">
          <p className="text-[10px] font-bold tracking-widest text-text-secondary uppercase mb-2">Facility</p>
          <p className="text-sm text-text-primary">
            {facilitySummary.levels} level{facilitySummary.levels === 1 ? '' : 's'} · {facilitySummary.rooms} room
            {facilitySummary.rooms === 1 ? '' : 's'}
          </p>
          <p className="text-sm text-text-secondary">
            {facilitySummary.instrumented} instrumented · {facilitySummary.rules} rule{facilitySummary.rules === 1 ? '' : 's'}
          </p>
        </div>
      )}
    </aside>
  )
}
