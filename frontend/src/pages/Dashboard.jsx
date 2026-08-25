import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import RoomCard from '../components/RoomCard'
import RoomStatusPanel from '../components/RoomStatusPanel'
import IrSendModal from '../components/IrSendModal'
import {
  getFloors,
  getDashboard,
  getAutomations,
  getAcStatus,
  getSwitchStatus,
  getAnalytics,
  sendIr,
} from '../api/client'
import { roomState } from '../lib/roomStatus'

export default function Dashboard() {
  const [dashboard, setDashboard] = useState(null)
  const [automations, setAutomations] = useState([])
  const [acStatus, setAcStatus] = useState(null)
  const [switchStatus, setSwitchStatus] = useState(null)
  const [lastMotionAt, setLastMotionAt] = useState(null)
  const [now, setNow] = useState(() => Date.now() / 1000)
  const [error, setError] = useState(null)
  const [irModalOpen, setIrModalOpen] = useState(false)

  const loadDashboard = useCallback(() => {
    getFloors()
      .then((floors) => (floors[0] ? getDashboard(floors[0].id) : null))
      .then((data) => data && setDashboard(data))
      .catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    loadDashboard()
    getAutomations().then(setAutomations).catch(() => {})
  }, [loadDashboard])

  const refreshDeviceStatus = useCallback(() => {
    getAcStatus().then(setAcStatus).catch(() => setAcStatus(null))
    getSwitchStatus().then(setSwitchStatus).catch(() => setSwitchStatus(null))
  }, [])

  useEffect(() => {
    refreshDeviceStatus()
  }, [refreshDeviceStatus])

  const room = dashboard?.rooms.find((r) => r.sensors.length > 0) ?? null

  useEffect(() => {
    const pir = room?.sensors.find((s) => s.type === 'pir')
    if (!pir) return
    getAnalytics(pir.id)
      .then((rows) => {
        if (rows.length) setLastMotionAt(rows[rows.length - 1].timestamp)
      })
      .catch(() => {})
  }, [room])

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const source = new EventSource('/api/stream')
    source.addEventListener('sensor_update', (e) => {
      const data = JSON.parse(e.data)
      loadDashboard()
      if (data.value === 'pir') setLastMotionAt(Date.now() / 1000)
    })
    source.addEventListener('automation_triggered', () => refreshDeviceStatus())
    source.onerror = () => {}
    return () => source.close()
  }, [loadDashboard, refreshDeviceStatus])

  const handleSensorClick = (sensor) => {
    if (sensor.type === 'ir') setIrModalOpen(true)
  }

  const handleSendIr = async (code) => {
    await sendIr(code)
  }

  if (error) {
    return <div className="max-w-5xl mx-auto px-8 py-10 text-danger">Error loading dashboard: {error}</div>
  }
  if (!dashboard) {
    return <div className="max-w-5xl mx-auto px-8 py-10 text-text-secondary">Loading…</div>
  }

  const lastMotionSeconds = lastMotionAt != null ? now - lastMotionAt : null
  const state = room ? roomState(room, acStatus) : 'empty'
  const hasAc = room?.sensors.some((s) => s.type === 'aircon')
  const acRunningCount = hasAc && acStatus?.power === '1' ? 1 : 0
  const attentionCount = room?.sensors.some((s) => s.alert) ? 1 : 0

  return (
    <div className="max-w-5xl mx-auto px-8 py-10">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5 text-text-secondary">
            <span className="w-1.5 h-1.5 rounded-full bg-accent" />
            {state === 'motion' ? 'Occupied' : 'Not occupied'}
          </span>
          <span className="text-success font-medium">{acRunningCount} AC running</span>
          <span className="text-text-secondary">{attentionCount} need attention</span>
          <Link
            to="/automations"
            className="px-3 py-1.5 rounded-lg border border-border text-text-secondary hover:text-text-primary font-medium"
          >
            Rules · {automations.length}
          </Link>
        </div>
      </div>

      <div className="flex gap-6 items-start">
        <div className="flex-1 min-w-0">
          {room ? (
            <RoomCard room={room} onSensorClick={handleSensorClick} big />
          ) : (
            <p className="text-text-secondary">No rooms configured yet — add one via Settings.</p>
          )}
        </div>

        <RoomStatusPanel
          room={room}
          acStatus={acStatus}
          switchStatus={switchStatus}
          automations={automations}
          onCommandSent={refreshDeviceStatus}
        />
      </div>

      {irModalOpen && <IrSendModal onClose={() => setIrModalOpen(false)} onSend={handleSendIr} />}
    </div>
  )
}
