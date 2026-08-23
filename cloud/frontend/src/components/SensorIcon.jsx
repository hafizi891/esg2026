import { Thermometer, Footprints, ToggleRight, Radio, Snowflake, CircleDashed } from 'lucide-react'

const ICONS = {
  temperature: Thermometer,
  pir: Footprints,
  switch: ToggleRight,
  ir: Radio,
  aircon: Snowflake,
}

function statusColor(sensor) {
  if (!sensor.online) return 'bg-white/5 text-text-secondary border-white/10'
  if (sensor.alert) return 'bg-danger/20 text-danger border-danger'
  if (sensor.type === 'pir' && sensor.value === 'pir') return 'bg-accent/20 text-accent border-accent'
  return 'bg-success/10 text-success border-success/40'
}

export default function SensorIcon({ sensor }) {
  const Icon = ICONS[sensor.type] || CircleDashed
  const label =
    sensor.type === 'temperature'
      ? `${sensor.name}: ${sensor.value ?? '--'}${sensor.unit || ''}`
      : sensor.type === 'pir'
      ? `${sensor.name}: ${sensor.value === 'pir' ? 'Motion detected' : 'No motion'}`
      : `${sensor.name}: ${sensor.online ? 'Online' : 'Offline'}`

  return (
    <div
      className={`w-6 h-6 rounded-full border flex items-center justify-center ${statusColor(sensor)}`}
      title={label}
    >
      <Icon size={12} />
    </div>
  )
}
