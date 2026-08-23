import { MonitorOff } from 'lucide-react'

export default function CloudUnavailableNotice({ page }) {
  return (
    <div className="max-w-6xl mx-auto px-8 py-10">
      <div className="flex flex-col items-center text-center gap-3 py-24 text-text-secondary">
        <MonitorOff size={32} className="text-text-secondary/60" />
        <p className="text-lg font-semibold text-text-primary">{page} isn't available here</p>
        <p className="text-sm max-w-sm">
          This cloud dashboard only mirrors live state over MQTT — it never touches Tuya or facility.json
          directly. Open the dashboard on the Pi's local network to manage {page.toLowerCase()}.
        </p>
      </div>
    </div>
  )
}
