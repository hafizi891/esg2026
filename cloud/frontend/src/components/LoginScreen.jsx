import { useState } from 'react'
import { Radar, Lock } from 'lucide-react'
import { login } from '../api/client'

export default function LoginScreen({ onSuccess }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await login(password)
      onSuccess()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-surface border border-border rounded-xl p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center shrink-0">
            <Radar size={20} className="text-white" />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight">Smart Motion Sensor</h1>
            <p className="text-xs text-text-secondary">Cloud dashboard</p>
          </div>
        </div>

        <label className="block mb-4">
          <span className="block text-sm font-medium text-text-primary mb-1.5">Password</span>
          <div className="relative">
            <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-border bg-bg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              placeholder="Enter dashboard password"
            />
          </div>
        </label>

        {error && <p className="text-sm text-danger mb-4">{error}</p>}

        <button
          type="submit"
          disabled={submitting || !password}
          className="w-full py-2.5 rounded-lg font-semibold bg-accent hover:bg-accent-hover text-white disabled:opacity-50"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
