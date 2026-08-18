import { Heart, AlertCircle, Thermometer, Footprints, ToggleRight, Radio, Snowflake } from 'lucide-react'

const ITEMS = [
  { icon: Heart, color: 'text-success', label: 'Resident OK' },
  { icon: AlertCircle, color: 'text-danger', label: 'Alert — needs attention' },
  { icon: Thermometer, color: 'text-text-secondary', label: 'Temperature sensor' },
  { icon: Footprints, color: 'text-text-secondary', label: 'Motion sensor' },
  { icon: ToggleRight, color: 'text-text-secondary', label: 'Switch' },
  { icon: Radio, color: 'text-text-secondary', label: 'IR blaster' },
  { icon: Snowflake, color: 'text-text-secondary', label: 'Air conditioner' },
]

export default function Legend() {
  return (
    <div className="mt-20">
      <h3 className="text-text-secondary font-semibold mb-3">Legend</h3>
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        {ITEMS.map(({ icon: Icon, color, label }) => (
          <div key={label} className="flex items-center gap-2 text-sm text-text-secondary">
            <Icon size={16} className={color} />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
