import { Heart, AlertCircle } from 'lucide-react'

export default function ResidentAvatar({ resident }) {
  const ringColor = resident.alert ? 'border-danger' : 'border-success'
  const BadgeIcon = resident.alert ? AlertCircle : Heart
  const badgeColor = resident.alert ? 'bg-danger' : 'bg-success'

  return (
    <div className="relative w-14 h-14" title={resident.name}>
      <div
        className={`w-14 h-14 rounded-full border-2 ${ringColor} flex items-center justify-center font-bold text-sm`}
        style={{ backgroundColor: resident.avatar_color }}
      >
        {resident.avatar_initials}
      </div>
      <div className={`absolute -top-1 -right-1 w-5 h-5 rounded-full ${badgeColor} flex items-center justify-center border-2 border-bg`}>
        <BadgeIcon size={11} className="text-white" fill={resident.alert ? 'none' : 'white'} />
      </div>
    </div>
  )
}
