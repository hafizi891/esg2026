import { createContext, useCallback, useContext, useState } from 'react'
import { CheckCircle2, XCircle, Info, X } from 'lucide-react'

const ToastContext = createContext(null)

const ICONS = { success: CheckCircle2, error: XCircle, info: Info }
const COLORS = {
  success: 'border-success/40 text-success',
  error: 'border-danger/40 text-danger',
  info: 'border-accent/40 text-accent',
}

let nextId = 1

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const dismiss = useCallback((id) => {
    setToasts((t) => t.filter((toast) => toast.id !== id))
  }, [])

  const showToast = useCallback(
    (message, type = 'info') => {
      const id = nextId++
      // Newest first, so it appears at the top of the top-anchored stack
      setToasts((t) => [{ id, message, type }, ...t])
      setTimeout(() => dismiss(id), 4500)
    },
    [dismiss]
  )

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div className="fixed top-6 right-6 z-100 flex flex-col gap-2 w-full max-w-sm">
        {toasts.map((toast) => {
          const Icon = ICONS[toast.type] || Info
          return (
            <div
              key={toast.id}
              className={`flex items-start gap-3 bg-surface border shadow-lg rounded-lg px-4 py-3 text-sm ${COLORS[toast.type] || COLORS.info}`}
            >
              <Icon size={18} className="shrink-0 mt-0.5" />
              <span className="flex-1 text-text-primary">{toast.message}</span>
              <button onClick={() => dismiss(toast.id)} className="text-text-secondary hover:text-text-primary shrink-0">
                <X size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}
