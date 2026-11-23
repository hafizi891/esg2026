import { useEffect, useRef, useState } from 'react'
import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { LayoutDashboard, LineChart, Radar, LogOut, Wifi } from 'lucide-react'
import Dashboard from './pages/Dashboard'
import Analytics from './pages/Analytics'
import Mqtt from './pages/Mqtt'
import LoginScreen from './components/LoginScreen'

import { useToast } from './context/ToastContext.jsx'
import { getSensors, getRooms, getSession, logout } from './api/client'

const APP_NAME = 'ESG Intelligence'

function Sidebar({ onLogout }) {
  const linkClass = ({ isActive }) =>
    `flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
      isActive ? 'bg-accent text-white' : 'text-text-secondary hover:bg-white/5 hover:text-text-primary'
    }`

  return (
    <aside className="w-full md:w-60 shrink-0 md:min-h-screen bg-black flex flex-col py-4">
      <div className="flex items-center gap-3 px-4 pb-4 mb-3 border-b border-white/10">
        <div className="w-9 h-9 rounded-full bg-accent flex items-center justify-center shrink-0">
          <Radar size={18} className="text-white" />
        </div>
        <div className="min-w-0">
          <span className="block text-text-primary font-bold text-base leading-tight">{APP_NAME}</span>

        </div>
      </div>
      <nav className="flex flex-row md:flex-col gap-1 px-3 overflow-x-auto">
        <NavLink to="/" end className={linkClass}>
          <LineChart size={18} /> ESG Overview
        </NavLink>
        <NavLink to="/monitoring" className={linkClass}>
          <LayoutDashboard size={18} /> Live Monitoring
        </NavLink>

        <NavLink to="/mqtt" className={linkClass}>
          <Wifi size={18} /> MQTT
        </NavLink>


      </nav>
      <button
        onClick={onLogout}
        className="flex items-center gap-3 px-4 py-2.5 mt-2 md:mt-auto mx-3 rounded-lg text-sm font-medium text-text-secondary hover:bg-white/5 hover:text-text-primary"
      >
        <LogOut size={18} /> Sign out
      </button>
    </aside>
  )
}

// Mounted once regardless of route, so these events surface no matter which
// page you're on. One shared SSE connection drives both notification types.
function useGlobalNotifications() {
  const showToast = useToast()
  const sensorsRef = useRef([])
  const roomsRef = useRef([])

  useEffect(() => {
    getSensors()
      .then((list) => (sensorsRef.current = list))
      .catch(() => {})
    getRooms()
      .then((list) => (roomsRef.current = list))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const source = new EventSource('/api/stream')

    // Toast only when someone arrives: the first motion after a quiet spell,
    // not every PIR flicker. Status messages (changed_at unchanged) are ignored.
    const QUIET_SECONDS = 300
    let lastMotionAt = 0
    source.addEventListener('sensor_update', (e) => {
      const data = JSON.parse(e.data)
      const sensor = sensorsRef.current.find((s) => s.id === data.id)
      if (sensor?.type !== 'pir' || data.value !== 'pir' || data.changed_at !== data.timestamp) return
      const arrived = data.timestamp - lastMotionAt >= QUIET_SECONDS
      lastMotionAt = data.timestamp
      if (arrived) {
        const room = roomsRef.current.find((r) => r.id === sensor.room_id)
        const where = room ? `${room.name} (${sensor.name})` : sensor.name
        showToast(`Motion detected — ${where}`, 'info')
      }
    })

    return () => source.close()
  }, [showToast])
}

// null = still checking, so we don't flash the login screen for a moment
// before the session cookie check comes back.
function useAuth() {
  const [authenticated, setAuthenticated] = useState(null)

  useEffect(() => {
    getSession()
      .then((s) => setAuthenticated(s.authenticated))
      .catch(() => setAuthenticated(false))
  }, [])

  return [authenticated, setAuthenticated]
}

function AuthenticatedApp({ onLogout }) {
  useGlobalNotifications()

  return (
    <div className="flex flex-col md:flex-row min-h-screen">
      <Sidebar onLogout={onLogout} />
      <main className="flex-1 min-w-0">
        <Routes>
          <Route path="/" element={<Analytics />} />
          <Route path="/analytics" element={<Navigate to="/" replace />} />
          <Route path="/monitoring" element={<Dashboard />} />

          <Route path="/mqtt" element={<Mqtt />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  const [authenticated, setAuthenticated] = useAuth()

  if (authenticated === null) return null // brief flash while /api/session resolves
  if (!authenticated) return <LoginScreen onSuccess={() => setAuthenticated(true)} />

  const handleLogout = () => {
    logout().finally(() => setAuthenticated(false))
  }

  return <AuthenticatedApp onLogout={handleLogout} />
}
