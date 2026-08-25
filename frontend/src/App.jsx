import { useEffect, useRef } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import { LayoutDashboard, Settings as SettingsIcon, LineChart, Zap, Radar, ScrollText, Radio } from 'lucide-react'
import Dashboard from './pages/Dashboard'
import Settings from './pages/Settings'
import Analytics from './pages/Analytics'
import Automations from './pages/Automations'
import Logs from './pages/Logs'
import MqttActivity from './pages/MqttActivity'
import { useToast } from './context/ToastContext.jsx'
import { getAutomations, getSensors, getRooms } from './api/client'

const APP_NAME = 'Smart Motion Sensor'

function Sidebar() {
  const linkClass = ({ isActive }) =>
    `flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
      isActive ? 'bg-accent text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
    }`

  return (
    <aside className="w-60 shrink-0 min-h-screen bg-slate-900 flex flex-col py-4">
      <div className="flex items-center gap-3 px-4 pb-4 mb-3 border-b border-slate-800">
        <div className="w-9 h-9 rounded-full bg-accent flex items-center justify-center shrink-0">
          <Radar size={18} className="text-white" />
        </div>
        <span className="text-white font-bold text-base leading-tight">{APP_NAME}</span>
      </div>
      <nav className="flex flex-col gap-1 px-3">
        <NavLink to="/" end className={linkClass}>
          <LayoutDashboard size={18} /> Dashboard
        </NavLink>
        <NavLink to="/analytics" className={linkClass}>
          <LineChart size={18} /> Analytics
        </NavLink>
        <NavLink to="/automations" className={linkClass}>
          <Zap size={18} /> Automations
        </NavLink>
        <NavLink to="/logs" className={linkClass}>
          <ScrollText size={18} /> Logs
        </NavLink>
        <NavLink to="/mqtt" className={linkClass}>
          <Radio size={18} /> MQTT
        </NavLink>
        <NavLink to="/settings" className={linkClass}>
          <SettingsIcon size={18} /> Settings
        </NavLink>
      </nav>
    </aside>
  )
}

// Mounted once regardless of route, so these events surface no matter which
// page you're on. One shared SSE connection drives both notification types.
function useGlobalNotifications() {
  const showToast = useToast()
  const automationsRef = useRef([])
  const sensorsRef = useRef([])
  const roomsRef = useRef([])

  useEffect(() => {
    getAutomations()
      .then((list) => (automationsRef.current = list))
      .catch(() => {})
    getSensors()
      .then((list) => (sensorsRef.current = list))
      .catch(() => {})
    getRooms()
      .then((list) => (roomsRef.current = list))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const source = new EventSource('/api/stream')

    source.addEventListener('automation_triggered', (e) => {
      const data = JSON.parse(e.data)
      const automation = automationsRef.current.find((a) => a.id === data.id)
      const name = automation?.name || 'Automation'
      if (data.success) {
        showToast(`${name} triggered`, 'success')
      } else {
        showToast(`${name} failed: ${data.error}`, 'error')
      }
    })

    // Motion-detected is the one sensor transition worth surfacing as a toast
    // on its own (not every value change — that would be noisy for a switch
    // flipping on/off, which already gets its own toast from the action itself).
    source.addEventListener('sensor_update', (e) => {
      const data = JSON.parse(e.data)
      const sensor = sensorsRef.current.find((s) => s.id === data.id)
      if (sensor?.type === 'pir' && data.value === 'pir') {
        const room = roomsRef.current.find((r) => r.id === sensor.room_id)
        const where = room ? `${room.name} (${sensor.name})` : sensor.name
        showToast(`Motion detected — ${where}`, 'info')
      }
    })

    return () => source.close()
  }, [showToast])
}

export default function App() {
  useGlobalNotifications()

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 min-w-0">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/automations" element={<Automations />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/mqtt" element={<MqttActivity />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  )
}
