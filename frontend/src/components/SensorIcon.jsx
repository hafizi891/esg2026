import { Thermometer, Footprints, ToggleRight, Radio, Snowflake, Mic, CircleDashed } from 'lucide-react'

const ICONS = {
  temperature: Thermometer,
  pir: Footprints,
  switch: ToggleRight,
  ir: Radio,
  aircon: Snowflake,
  mic: Mic,
}

function statusColor(sensor) {
  if (!sensor.online) return 'bg-black/5 text-text-secondary border-black/10'
  if (sensor.alert) return 'bg-danger/20 text-danger border-danger'
  if (sensor.type === 'pir' && sensor.value === 'pir') return 'bg-accent/20 text-accent border-accent'
  if (sensor.type === 'mic' && sensor.value === 'talking') return 'bg-accent/20 text-accent border-accent'
  return 'bg-success/10 text-success border-success/40'
}

export default function SensorIcon({ sensor, large = false }) {
  const Icon = ICONS[sensor.type] || CircleDashed
  const label =
    sensor.type === 'temperature'
      ? `${sensor.name}: ${sensor.value ?? '--'}${sensor.unit || ''}`
      : sensor.type === 'pir'
      ? `${sensor.name}: ${sensor.value === 'pir' ? 'Motion detected' : 'No motion'}`
      : sensor.type === 'mic'
      ? `${sensor.name}: ${sensor.value === 'talking' ? 'Talking detected' : 'Quiet'}`
      : `${sensor.name}: ${sensor.online ? 'Online' : 'Offline'}`

  return (
    <div
      className={`rounded-full border-2 flex items-center justify-center ${
        large ? 'w-16 h-16' : 'w-11 h-11'
      } ${statusColor(sensor)}`}
      title={label}
    >
      <Icon size={large ? 26 : 18} />
    </div>
  )
}
