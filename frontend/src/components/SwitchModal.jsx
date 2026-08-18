import { useEffect, useState } from 'react'
import { X, Power } from 'lucide-react'
import { toggleSwitch, getSwitchStatus } from '../api/client'
import { useToast } from '../context/ToastContext.jsx'

export default function SwitchModal({ onClose }) {
  const [status, setStatus] = useState(null) // real state from the dedicated switch status endpoint
  const [sending, setSending] = useState(false)
  const showToast = useToast()

  const refreshStatus = () => {
    getSwitchStatus()
      .then(setStatus)
      .catch(() => {}) // status is a nice-to-have; don't block the control on it failing
  }

  useEffect(() => {
    refreshStatus()
  }, [])

  const send = async (value) => {
    setSending(true)
    try {
      await toggleSwitch(value)
      showToast(value ? 'Switch turned on' : 'Switch turned off', 'success')
      refreshStatus()
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      setSending(false)
    }
  }

  const isOn = status?.online && status.value === true

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-surface border border-border shadow-xl rounded-xl w-full max-w-sm p-6">
        <div className="flex justify-between items-center mb-1">
          <h2 className="text-lg font-semibold">Switch Robot</h2>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>
        {status ? (
          <p className="text-xs text-text-secondary mb-5">
            Currently {isOn ? <span className="text-success font-medium">ON</span> : <span className="text-danger font-medium">OFF</span>} · real
            status from the device (checked on demand, not continuously polled)
          </p>
        ) : (
          <p className="text-xs text-text-secondary mb-5">Loading current status…</p>
        )}

        <div className="flex gap-3">
          <button
            disabled={sending}
            onClick={() => send(true)}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg border font-medium disabled:opacity-50 ${
              isOn ? 'bg-success/20 text-success border-success' : 'bg-success/10 text-success border-success/30 hover:bg-success/20'
            }`}
          >
            <Power size={16} /> Turn On
          </button>
          <button
            disabled={sending}
            onClick={() => send(false)}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg border font-medium disabled:opacity-50 ${
              status && !isOn ? 'bg-danger/20 text-danger border-danger' : 'bg-danger/10 text-danger border-danger/30 hover:bg-danger/20'
            }`}
          >
            <Power size={16} /> Turn Off
          </button>
        </div>
      </div>
    </div>
  )
}
