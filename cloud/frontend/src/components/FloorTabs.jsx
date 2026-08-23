export default function FloorTabs({ floors, activeFloorId, onSelect }) {
  return (
    <div className="flex gap-8 border-b border-border mb-8">
      {floors.map((floor) => {
        const active = floor.id === activeFloorId
        return (
          <button
            key={floor.id}
            onClick={() => onSelect(floor.id)}
            className={`pb-3 text-lg font-semibold transition-colors border-b-2 -mb-px ${
              active
                ? 'text-accent border-accent'
                : 'text-text-secondary border-transparent hover:text-text-primary'
            }`}
          >
            {floor.name}
          </button>
        )
      })}
    </div>
  )
}
