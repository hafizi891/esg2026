import { Heart, AlertCircle } from 'lucide-react'

export default function ResidentAvatar({ resident }) {
  const ringColor = resident.alert ? 'border-danger' : 'border-success'
  const BadgeIcon = resident.alert ? AlertCircle : Heart
  const badgeColor = resident.alert ? 'bg-danger' : 'bg-success'

  return (
    <div className="relative w-6 h-6" title={resident.name}>
      <div
        className={`w-6 h-6 rounded-full border ${ringColor} flex items-center justify-center font-bold text-[9px]`}
        style={{ backgroundColor: resident.avatar_color }}
      >
        {resident.avatar_initials}
      </div>
      <div className={`absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full ${badgeColor} flex items-center justify-center border border-bg`}>
        <BadgeIcon size={7} className="text-white" fill={resident.alert ? 'none' : 'white'} />
      </div>
    </div>
  )
}
