import { useState } from 'react'
import { X } from 'lucide-react'

const TYPES = ['temperature', 'pir', 'switch', 'ir', 'mic', 'other']
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

export default function SensorFormModal({ sensor, rooms, onClose, onSave }) {
  const [form, setForm] = useState(
    () =>
      sensor || {
        name: '',
        type: 'temperature',
        room_id: rooms[0]?.id || '',
        tuya_device_id: '',
        position: 'inside',
        unit: '°C',
        thresholds: { min: 18, max: 30 },
      }
  )

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))

  const handleSubmit = (e) => {
    e.preventDefault()
    onSave(form)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-surface border border-border shadow-xl rounded-xl w-full max-w-md p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">{sensor ? 'Edit Sensor' : 'Add Sensor'}</h2>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Name">
            <input className={inputClass} value={form.name} onChange={(e) => set('name', e.target.value)} required />
          </Field>
          <Field label="Type">
            <select className={inputClass} value={form.type} onChange={(e) => set('type', e.target.value)}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Room">
            <select className={inputClass} value={form.room_id} onChange={(e) => set('room_id', e.target.value)}>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          {form.type !== 'mic' && (
            <Field label="Tuya Device ID">
              <input
                className={inputClass}
                value={form.tuya_device_id || ''}
                onChange={(e) => set('tuya_device_id', e.target.value)}
                required
              />
            </Field>
          )}
          {form.type === 'mic' && (
            <p className="text-xs text-text-secondary">
              No Tuya device needed — this is the mic wired directly to the Pi's sound card (see mic_listener.py).
            </p>
          )}
          {form.type === 'temperature' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Min threshold">
                  <input
                    type="number"
                    className={inputClass}
                    value={form.thresholds?.min ?? ''}
                    onChange={(e) => set('thresholds', { ...form.thresholds, min: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Max threshold">
                  <input
                    type="number"
                    className={inputClass}
                    value={form.thresholds?.max ?? ''}
                    onChange={(e) => set('thresholds', { ...form.thresholds, max: Number(e.target.value) })}
                  />
                </Field>
              </div>
              <Field label="Unit">
                <input className={inputClass} value={form.unit || ''} onChange={(e) => set('unit', e.target.value)} />
              </Field>
            </>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-text-secondary hover:text-text-primary">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover font-medium">
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
