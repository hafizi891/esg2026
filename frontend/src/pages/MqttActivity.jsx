import { useEffect, useState } from 'react'
import { RefreshCw, ArrowUpRight, ArrowDownLeft } from 'lucide-react'
import { getMqttStatus, getMqttActivity } from '../api/client'

function relativeTime(ts) {
  if (ts == null) return 'never'
  const s = Math.max(0, Math.round(Date.now() / 1000 - ts))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  return `${Math.round(s / 3600)}h ago`
}

export default function MqttActivity() {
  const [status, setStatus] = useState(null)
  const [activity, setActivity] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = () => {
    setLoading(true)
    Promise.all([getMqttStatus(), getMqttActivity(200)])
      .then(([s, a]) => {
        setStatus(s)
        setActivity(a.slice().reverse()) // newest first
        setError(null)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 5000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="max-w-6xl mx-auto px-8 py-10">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">MQTT</h1>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-2 text-text-secondary hover:text-text-primary text-sm font-medium disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <p className="mb-6 text-text-secondary text-sm">
        What this app is actually publishing to and receiving from your MQTT broker — refreshes every 5s.
      </p>

      {error && <div className="mb-4 text-danger text-sm">{error}</div>}

      {status && (
        <div className="mb-8 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="border border-border rounded-lg p-4">
            <div className="text-xs text-text-secondary mb-1">Enabled</div>
            <div className={`font-semibold ${status.enabled ? 'text-success' : 'text-text-secondary'}`}>
              {status.enabled ? 'Yes' : 'No'}
            </div>
          </div>
          <div className="border border-border rounded-lg p-4">
            <div className="text-xs text-text-secondary mb-1">Broker</div>
            <div className="font-semibold truncate" title={`${status.broker_host}:${status.broker_port}`}>
              {status.broker_host}:{status.broker_port}
            </div>
          </div>
          <div className="border border-border rounded-lg p-4">
            <div className="text-xs text-text-secondary mb-1">Remote-command listener</div>
            <div className={`font-semibold ${status.listener.connected ? 'text-success' : 'text-danger'}`}>
              {status.listener.connected ? 'Connected' : 'Not connected'}
            </div>
            {status.listener.last_error && (
              <div className="text-xs text-danger mt-1 truncate" title={status.listener.last_error}>
                {status.listener.last_error}
              </div>
            )}
          </div>
          <div className="border border-border rounded-lg p-4">
            <div className="text-xs text-text-secondary mb-1">Last message received</div>
            <div className="font-semibold">{relativeTime(status.listener.last_message_at)}</div>
          </div>
        </div>
      )}

      {status && !status.enabled && (
        <p className="text-text-secondary text-sm mb-6">
          MQTT is disabled — enable it and set a broker in Settings to see activity here.
        </p>
      )}

      {activity.length === 0 && !loading ? (
        <p className="text-text-secondary text-sm">No MQTT activity recorded yet this session.</p>
      ) : (
        <div className="border border-border rounded-lg divide-y divide-border">
          {activity.map((entry, i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-3 text-sm">
              {entry.direction === 'out' ? (
                <ArrowUpRight size={16} className="text-accent shrink-0 mt-0.5" />
              ) : (
                <ArrowDownLeft size={16} className="text-success shrink-0 mt-0.5" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-text-primary truncate">{entry.topic}</span>
                  <span className="text-xs text-text-secondary shrink-0">
                    {new Date(entry.ts * 1000).toLocaleTimeString()}
                  </span>
                </div>
                <div className="text-xs text-text-secondary font-mono truncate">
                  {entry.payload != null ? JSON.stringify(entry.payload) : '—'}
                </div>
                {entry.error && <div className="text-xs text-danger mt-0.5">{entry.error}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
