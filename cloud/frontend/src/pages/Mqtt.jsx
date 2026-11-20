import { useEffect, useState } from 'react'
import { Wifi, WifiOff, RefreshCw } from 'lucide-react'
import { getMqttConfig, updateMqttConfig } from '../api/client'

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

export default function Mqtt() {
  const [config, setConfig] = useState(null)
  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null) // {type: 'success'|'error', text}

  const refresh = () => {
    setLoading(true)
    getMqttConfig()
      .then((data) => {
        setConfig(data)
        // Only seed the form once — otherwise a background status poll
        // would stomp on whatever the user is mid-typing in the fields.
        setForm((prev) =>
          prev ?? {
            broker_host: data.broker_host,
            broker_port: data.broker_port,
            username: data.username,
            password: '',
            topic_prefix: data.topic_prefix,
          }
        )
      })
      .catch((e) => setMessage({ type: 'error', text: e.message }))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 5000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      await updateMqttConfig(form)
      setMessage({ type: 'success', text: 'Saved — reconnecting with the new settings now.' })
      setForm((prev) => ({ ...prev, password: '' }))
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  if (!form) {
    return <div className="max-w-3xl mx-auto px-8 py-10 text-text-secondary">Loading…</div>
  }

  return (
    <div className="max-w-3xl mx-auto px-8 py-10">
      <h1 className="text-3xl font-bold mb-8">MQTT</h1>

      <StatusCard config={config} loading={loading} onRefresh={refresh} />

      <form onSubmit={handleSave} className="rounded-xl border border-border bg-surface-2 p-5 space-y-4">
        <p className="text-xs font-bold tracking-widest text-text-secondary uppercase">Broker settings</p>
        <p className="text-sm text-text-secondary -mt-2">
          Saving updates the broker settings and reconnects immediately — no restart needed.
        </p>

        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-sm font-medium text-text-primary mb-1.5">Broker host</span>
            <input
              className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              value={form.broker_host}
              onChange={(e) => setForm({ ...form, broker_host: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-text-primary mb-1.5">Broker port</span>
            <input
              type="number"
              className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              value={form.broker_port}
              onChange={(e) => setForm({ ...form, broker_port: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-text-primary mb-1.5">Username</span>
            <input
              className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-text-primary mb-1.5">Password</span>
            <input
              type="password"
              className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder={config?.password_set ? '•••••••• (unchanged)' : 'Not set'}
            />
          </label>
          <label className="block col-span-2">
            <span className="block text-sm font-medium text-text-primary mb-1.5">ESP topic base</span>
            <input
              className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              value={form.topic_prefix}
              onChange={(e) => setForm({ ...form, topic_prefix: e.target.value })}
            />
          </label>
        </div>

        <div className="rounded-lg border border-border bg-bg p-4 text-sm">
          <p className="font-semibold text-text-primary mb-2">ESP8266 topic contract</p>
          <div className="space-y-1 font-mono text-xs text-text-secondary">
            <p>Publish: {form.topic_prefix}/status</p>
            <p>Publish: {form.topic_prefix}/motion</p>
            <p>Publish: {form.topic_prefix}/sound</p>
            <p>Publish: {form.topic_prefix}/ir</p>
            <p>Subscribe: {form.topic_prefix}/command</p>
          </div>
        </div>

        {message && (
          <p className={`text-sm ${message.type === 'error' ? 'text-danger' : 'text-success'}`}>{message.text}</p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="px-5 py-2.5 rounded-lg font-semibold bg-accent hover:bg-accent-hover text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save & reconnect'}
        </button>
      </form>
    </div>
  )
}
