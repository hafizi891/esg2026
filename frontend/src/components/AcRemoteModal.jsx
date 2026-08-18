import { useEffect, useState } from 'react'
import { X, Power, Minus, Plus, RefreshCw } from 'lucide-react'
import { sendAcCommand, getAcStatus, resyncAcState } from '../api/client'
import { useToast } from '../context/ToastContext.jsx'

// Confirmed from Tuya's official docs (infrared_ac category standard
// instruction set) — not guessed. Not every AC unit supports every value.
const MODES = [
  { value: 0, label: 'Cool' },
  { value: 1, label: 'Heat' },
  { value: 2, label: 'Auto' },
  { value: 3, label: 'Fan' },
  { value: 4, label: 'Dry' },
]

const FAN_SPEEDS = [
  { value: 0, label: 'Auto' },
  { value: 1, label: 'Low' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'High' },
]

export default function AcRemoteModal({ onClose }) {
  const [status, setStatus] = useState(null) // real state from the dedicated AC status endpoint
  const [temperature, setTemperature] = useState(24)
  const [sending, setSending] = useState(false)
  const [resyncOpen, setResyncOpen] = useState(false)
  const [resyncing, setResyncing] = useState(false)
  const [resyncPower, setResyncPower] = useState('on')
  const [resyncTemp, setResyncTemp] = useState(24)
  const [resyncMode, setResyncMode] = useState(0)
  const [resyncFan, setResyncFan] = useState(0)
  const showToast = useToast()

  const refreshStatus = () => {
    getAcStatus()
      .then((s) => {
        setStatus(s)
        if (s.temp != null) setTemperature(Number(s.temp))
      })
      .catch(() => {}) // status is a nice-to-have; don't block the remote on it failing
  }

  useEffect(() => {
    refreshStatus()
  }, [])

  const openResync = () => {
    // Prefill from the last-known status as a starting point — still fully
    // editable, since the whole point is that this may not match reality.
    setResyncPower(status?.power === '1' ? 'on' : 'off')
    if (status?.temp != null) setResyncTemp(Number(status.temp))
    if (status?.mode != null) setResyncMode(Number(status.mode))
    if (status?.wind != null) setResyncFan(Number(status.wind))
    setResyncOpen(true)
  }

  const submitResync = async () => {
    setResyncing(true)
    try {
      await resyncAcState({
        power: resyncPower === 'on',
        temp: resyncTemp,
        mode: resyncMode,
        fan: resyncFan,
      })
      showToast('Synced to match what you see on the AC — no command sent', 'success')
      setResyncOpen(false)
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      setResyncing(false)
    }
  }

  const send = async (code, value, label) => {
    setSending(true)
    try {
      await sendAcCommand(code, value)
      showToast(label, 'success')
      refreshStatus()
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      setSending(false)
    }
  }

  const adjustTemp = (delta) => {
    const next = Math.min(30, Math.max(16, temperature + delta))
    setTemperature(next)
    send('T', next, `Temperature set to ${next}°C`)
  }

  const isOn = status?.power === '1'
  const currentMode = status ? Number(status.mode) : null
  const currentWind = status ? Number(status.wind) : null

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-surface border border-border shadow-xl rounded-xl w-full max-w-md p-6">
        <div className="flex justify-between items-center mb-1">
          <h2 className="text-lg font-semibold">Air Conditioner Remote</h2>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>
        {status && (
          <p className="text-xs text-text-secondary mb-5">
            Currently {isOn ? <span className="text-success font-medium">ON</span> : <span className="text-danger font-medium">OFF</span>} · real
            status from the AC's last confirmed command
          </p>
        )}
        {!status && <p className="text-xs text-text-secondary mb-5">Loading current status…</p>}

        {!resyncOpen ? (
          <button
            onClick={openResync}
            className="flex items-center gap-1.5 text-xs font-medium text-accent hover:text-accent-hover mb-5"
          >
            <RefreshCw size={13} /> Physical remote was used? Resync to what you see
          </button>
        ) : (
          <div className="mb-6 p-3 rounded-lg border border-border space-y-3">
            <p className="text-xs text-text-secondary">
              Set these to match what's actually showing on the AC right now — this only corrects our
              bookkeeping, it won't send any command to the AC.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs text-text-secondary mb-1">Power</span>
                <select
                  className="w-full bg-black/3 border border-black/15 rounded-lg px-3 py-2 text-sm"
                  value={resyncPower}
                  onChange={(e) => setResyncPower(e.target.value)}
                >
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </select>
              </label>
              <label className="block">
                <span className="block text-xs text-text-secondary mb-1">Temperature (°C)</span>
                <input
                  type="number"
                  min="16"
                  max="30"
                  className="w-full bg-black/3 border border-black/15 rounded-lg px-3 py-2 text-sm"
                  value={resyncTemp}
                  onChange={(e) => setResyncTemp(Number(e.target.value))}
                />
              </label>
              <label className="block">
                <span className="block text-xs text-text-secondary mb-1">Mode</span>
                <select
                  className="w-full bg-black/3 border border-black/15 rounded-lg px-3 py-2 text-sm"
                  value={resyncMode}
                  onChange={(e) => setResyncMode(Number(e.target.value))}
                >
                  {MODES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block text-xs text-text-secondary mb-1">Fan speed</span>
                <select
                  className="w-full bg-black/3 border border-black/15 rounded-lg px-3 py-2 text-sm"
                  value={resyncFan}
                  onChange={(e) => setResyncFan(Number(e.target.value))}
                >
                  {FAN_SPEEDS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setResyncOpen(false)}
                className="px-3 py-1.5 rounded-lg text-xs text-text-secondary hover:text-text-primary"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={resyncing}
                onClick={submitResync}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent hover:bg-accent-hover disabled:opacity-50"
              >
                Sync now
              </button>
            </div>
          </div>
        )}

        <div className="flex gap-3 mb-6">
          <button
            disabled={sending}
            onClick={() => send('PowerOn', 'PowerOn', 'AC turned on')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg border font-medium disabled:opacity-50 ${
              isOn ? 'bg-success/20 text-success border-success' : 'bg-success/10 text-success border-success/30 hover:bg-success/20'
            }`}
          >
            <Power size={16} /> Power On
          </button>
          <button
            disabled={sending}
            onClick={() => send('PowerOff', 'PowerOff', 'AC turned off')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg border font-medium disabled:opacity-50 ${
              status && !isOn ? 'bg-danger/20 text-danger border-danger' : 'bg-danger/10 text-danger border-danger/30 hover:bg-danger/20'
            }`}
          >
            <Power size={16} /> Power Off
          </button>
        </div>

        <div className="mb-6">
          <span className="block text-xs text-text-secondary mb-2">Temperature</span>
          <div className="flex items-center justify-center gap-6">
            <button
              disabled={sending}
              onClick={() => adjustTemp(-1)}
              className="w-10 h-10 rounded-full bg-black/5 hover:bg-black/10 flex items-center justify-center disabled:opacity-50"
            >
              <Minus size={16} />
            </button>
            <span className="text-3xl font-bold w-20 text-center">{temperature}°C</span>
            <button
              disabled={sending}
              onClick={() => adjustTemp(1)}
              className="w-10 h-10 rounded-full bg-black/5 hover:bg-black/10 flex items-center justify-center disabled:opacity-50"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        <div className="mb-6">
          <span className="block text-xs text-text-secondary mb-2">Mode</span>
          <div className="grid grid-cols-5 gap-2">
            {MODES.map((m) => (
              <button
                key={m.value}
                disabled={sending}
                onClick={() => send('M', m.value, `Mode: ${m.label}`)}
                className={`py-2 rounded-lg border text-xs font-medium disabled:opacity-50 ${
                  currentMode === m.value
                    ? 'border-accent text-accent bg-accent/10'
                    : 'bg-black/3 border-black/10 hover:border-accent hover:text-accent'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-2">
          <span className="block text-xs text-text-secondary mb-2">Fan Speed</span>
          <div className="grid grid-cols-4 gap-2">
            {FAN_SPEEDS.map((f) => (
              <button
                key={f.value}
                disabled={sending}
                onClick={() => send('F', f.value, `Fan: ${f.label}`)}
                className={`py-2 rounded-lg border text-xs font-medium disabled:opacity-50 ${
                  currentWind === f.value
                    ? 'border-accent text-accent bg-accent/10'
                    : 'bg-black/3 border-black/10 hover:border-accent hover:text-accent'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <p className="text-xs text-text-secondary mt-4">
          Not all air conditioners support every mode or fan speed — some buttons may have no visible effect on your unit.
        </p>
      </div>
    </div>
  )
}
