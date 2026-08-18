import { useEffect, useState } from 'react'
import { getMqttConfig, updateMqttConfig } from '../api/client'
import { useToast } from '../context/ToastContext.jsx'

const inputClass =
  'w-full bg-black/3 border border-black/15 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent'

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs text-text-secondary mb-1">{label}</span>
      {children}
    </label>
  )
}

export default function MqttSettings() {
  const [config, setConfig] = useState(null)
  const showToast = useToast()

  useEffect(() => {
    getMqttConfig().then(setConfig).catch((e) => showToast(e.message, 'error'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!config) return null

  const set = (key, value) => setConfig((c) => ({ ...c, [key]: value }))

  const handleSave = async (e) => {
    e.preventDefault()
    try {
      const saved = await updateMqttConfig(config)
      setConfig(saved)
      showToast(`MQTT ${saved.enabled ? 'enabled' : 'disabled'}`, 'success')
    } catch (err) {
      showToast(err.message, 'error')
    }
  }

  return (
    <form onSubmit={handleSave} className="bg-surface border border-border rounded-xl p-6 max-w-lg space-y-4">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={config.enabled} onChange={(e) => set('enabled', e.target.checked)} />
        Enabled — mirror every device command to this broker
      </label>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Broker host">
          <input className={inputClass} value={config.broker_host || ''} onChange={(e) => set('broker_host', e.target.value)} />
        </Field>
        <Field label="Broker port">
          <input
            type="number"
            className={inputClass}
            value={config.broker_port ?? ''}
            onChange={(e) => set('broker_port', Number(e.target.value))}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Username (optional)">
          <input className={inputClass} value={config.username || ''} onChange={(e) => set('username', e.target.value || null)} />
        </Field>
        <Field label="Password (optional)">
          <input
            type="password"
            className={inputClass}
            value={config.password || ''}
            onChange={(e) => set('password', e.target.value || null)}
          />
        </Field>
      </div>

      <Field label="Topic prefix">
        <input className={inputClass} value={config.topic_prefix || ''} onChange={(e) => set('topic_prefix', e.target.value)} />
      </Field>

      <button type="submit" className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover font-medium text-sm">
        Save
      </button>
    </form>
  )
}
