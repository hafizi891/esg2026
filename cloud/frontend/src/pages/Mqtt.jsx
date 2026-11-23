import { useEffect, useState } from 'react'
import { Wifi, WifiOff, RefreshCw } from 'lucide-react'
import { getMqttConfig } from '../api/client'

function relativeTime(epochSeconds) {
  if (epochSeconds == null) return null
  const s = Math.max(0, Math.round(Date.now() / 1000 - epochSeconds))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  return `${Math.round(s / 3600)}h ago`
}

function StatusCard({ config, loading, onRefresh }) {
  const status = config?.status
  const connected = status?.connected

  return (
    <div className="rounded-xl border border-border bg-surface-2 p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-bold tracking-widest text-text-secondary uppercase">Broker status</p>
        <button onClick={onRefresh} className="text-text-secondary hover:text-text-primary">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      <div className="flex items-center gap-3 mb-3">
        {connected ? <Wifi size={20} className="text-success" /> : <WifiOff size={20} className="text-danger" />}
        <span className={`text-lg font-bold ${connected ? 'text-success' : 'text-danger'}`}>
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-text-secondary">Last message</p>
          <p className="text-text-primary font-medium">{relativeTime(status?.last_message_at) ?? 'None yet'}</p>
        </div>
        <div>
          <p className="text-text-secondary">Connected since</p>
          <p className="text-text-primary font-medium">
            {connected ? relativeTime(status?.connected_at) ?? '—' : '—'}
          </p>
        </div>
      </div>
      {status?.last_error && (
        <p className="mt-3 text-sm text-danger">Last error: {status.last_error}</p>
      )}
    </div>
  )
}

function Setting({ label, value }) {
  return (
    <div>
      <p className="text-text-secondary">{label}</p>
      <p className="text-text-primary font-medium break-all">{value}</p>
    </div>
  )
}

export default function Mqtt() {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const refresh = () => {
    setLoading(true)
    getMqttConfig()
      .then((data) => {
        setConfig(data)
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

  if (!config) {
    return <div className="max-w-3xl mx-auto px-4 md:px-8 py-10 text-text-secondary">{error ?? 'Loading…'}</div>
  }

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-8 py-10">
      <h1 className="text-3xl font-bold mb-8">MQTT</h1>

      <StatusCard config={config} loading={loading} onRefresh={refresh} />

      <div className="rounded-xl border border-border bg-surface-2 p-5 space-y-4">
        <p className="text-xs font-bold tracking-widest text-text-secondary uppercase">Broker settings</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <Setting label="Broker host" value={config.broker_host} />
          <Setting label="Port" value={config.broker_port} />
          <Setting label="Username" value={config.username} />
          <Setting label="Password" value={config.password_set ? 'Set' : 'Not set'} />
          <Setting label="ESP topic base" value={config.topic_prefix} />
        </div>
        <p className="text-sm text-text-secondary">To change these, edit cloud/.env on the server and restart the app.</p>

        <div className="rounded-lg border border-border bg-bg p-4 text-sm">
          <p className="font-semibold text-text-primary mb-2">Topics read from the ESP8266</p>
          <div className="space-y-1 font-mono text-xs text-text-secondary">
            <p>{config.topic_prefix}/status</p>
            <p>{config.topic_prefix}/motion</p>
            <p>{config.topic_prefix}/sound</p>
            <p>{config.topic_prefix}/ir</p>
          </div>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </div>
  )
}
