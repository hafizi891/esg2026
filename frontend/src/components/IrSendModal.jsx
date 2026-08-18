import { useState } from 'react'
import { X, Send } from 'lucide-react'

export default function IrSendModal({ onClose, onSend }) {
  const [code, setCode] = useState('')
  const [status, setStatus] = useState(null) // null | 'sending' | 'success' | 'error'
  const [errorMsg, setErrorMsg] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!code.trim()) return
    setStatus('sending')
    try {
      await onSend(code.trim())
      setStatus('success')
      setCode('')
    } catch (err) {
      setStatus('error')
      setErrorMsg(err.message)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-surface border border-border shadow-xl rounded-xl w-full max-w-md p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Send IR Command</h2>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            className="w-full bg-black/3 border border-black/15 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
            placeholder="Paste Base64 IR code here..."
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          {status === 'success' && <p className="text-success text-sm">Command sent successfully!</p>}
          {status === 'error' && <p className="text-danger text-sm">Failed: {errorMsg}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-text-secondary hover:text-text-primary">
              Close
            </button>
            <button
              type="submit"
              disabled={status === 'sending'}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover font-medium disabled:opacity-50"
            >
              <Send size={14} /> Send
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
