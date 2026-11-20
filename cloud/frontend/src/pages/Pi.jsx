import { useEffect, useState } from 'react'
import { Cpu, Wifi, WifiOff, RefreshCw } from 'lucide-react'
import { getPiStatus } from '../api/client'

function relativeTime(epochSeconds) {
  if (epochSeconds == null) return null
  const s = Math.max(0, Math.round(Date.now() / 1000 - epochSeconds))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  return `${Math.round(s / 3600)}h ago`
}

export default function Pi() {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const refresh = () => {
    setLoading(true)
    getPiStatus()
      .then(setStatus)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 5000)
    return () => clearInterval(interval)
  }, [])

  const online = status?.online

  return (
    <div className="max-w-3xl mx-auto px-8 py-10">
      <h1 className="text-3xl font-bold mb-8">Pi</h1>

      <div className="rounded-xl border border-border bg-surface-2 p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-bold tracking-widest text-text-secondary uppercase">Status</p>
          <button onClick={refresh} className="text-text-secondary hover:text-text-primary">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {error && <p className="text-sm text-danger mb-3">{error}</p>}

        {status && (
          <>
            <div className="flex items-center gap-3 mb-3">
              <Cpu size={20} className="text-text-secondary" />
              {online ? <Wifi size={20} className="text-success" /> : <WifiOff size={20} className="text-danger" />}
              <span className={`text-lg font-bold ${online ? 'text-success' : 'text-danger'}`}>
                {online ? 'Online' : 'Offline'}
              </span>
            </div>
            <p className="text-sm text-text-secondary">
              {status.last_seen_at
                ? `Last heard from ${relativeTime(status.last_seen_at)}`
                : "Haven't heard from it yet since this dashboard started."}
            </p>
            {!online && status.last_seen_at && (
              <p className="text-sm text-warning mt-2">
                No heartbeat or activity in over a minute — the Pi's app.py may be stopped, or it's lost its MQTT
                connection.
              </p>
            )}
          </>
        )}
      </div>

      <p className="mt-4 text-xs text-text-secondary">
        Detected from a heartbeat the Pi publishes over MQTT every 20s — this reflects the Pi's own app.py process
        and its connection to the broker, not whether Tuya or the local devices themselves are reachable.
      </p>
    </div>
  )
}
