const ITEMS = [
  { swatch: 'bg-accent', label: 'Occupied' },
  { swatch: 'bg-success', label: 'AC running' },
  { swatch: 'bg-warning', label: 'Attention' },
  { swatch: 'border border-dashed border-black/20', label: 'No devices' },
]

export default function Legend() {
  return (
    <div className="mt-6 flex flex-wrap gap-x-8 gap-y-3">
      {ITEMS.map(({ swatch, label }) => (
        <div key={label} className="flex items-center gap-2 text-sm text-text-secondary">
          <span className={`w-3 h-3 rounded-full shrink-0 ${swatch}`} />
          <span>{label}</span>
        </div>
      ))}
    </div>
  )
}
