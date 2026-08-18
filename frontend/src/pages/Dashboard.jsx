import { useCallback, useEffect, useState } from 'react'
import FloorTabs from '../components/FloorTabs'
import RoomGrid from '../components/RoomGrid'
import Legend from '../components/Legend'
import IrSendModal from '../components/IrSendModal'
import AcRemoteModal from '../components/AcRemoteModal'
import SwitchModal from '../components/SwitchModal'
import { getFloors, getDashboard, sendIr } from '../api/client'

export default function Dashboard() {
  const [floors, setFloors] = useState([])
  const [activeFloorId, setActiveFloorId] = useState(null)
  const [dashboard, setDashboard] = useState(null)
  const [error, setError] = useState(null)
  const [irModalOpen, setIrModalOpen] = useState(false)
  const [acModalOpen, setAcModalOpen] = useState(false)
  const [switchModalOpen, setSwitchModalOpen] = useState(false)

  useEffect(() => {
    getFloors()
      .then((data) => {
        setFloors(data)
        if (data.length) setActiveFloorId(data[0].id)
      })
      .catch((e) => setError(e.message))
  }, [])

  const loadDashboard = useCallback((floorId) => {
    if (!floorId) return
    getDashboard(floorId).then(setDashboard).catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    loadDashboard(activeFloorId)
  }, [activeFloorId, loadDashboard])

  // Live sensor changes trigger a fresh dashboard fetch for the active floor
  useEffect(() => {
    const source = new EventSource('/api/stream')
    source.addEventListener('sensor_update', () => loadDashboard(activeFloorId))
    source.onerror = () => {} // EventSource auto-reconnects; nothing to do here
    return () => source.close()
  }, [activeFloorId, loadDashboard])

  const handleSensorClick = async (sensor) => {
    if (sensor.type === 'ir') {
      setIrModalOpen(true)
    } else if (sensor.type === 'aircon') {
      setAcModalOpen(true)
    } else if (sensor.type === 'switch') {
      setSwitchModalOpen(true)
    }
  }

  const handleSendIr = async (code) => {
    await sendIr(code)
  }

  if (error) {
    return <div className="max-w-6xl mx-auto px-8 py-10 text-danger">Error loading dashboard: {error}</div>
  }
  if (!dashboard) {
    return <div className="max-w-6xl mx-auto px-8 py-10 text-text-secondary">Loading…</div>
  }

  return (
    <div className="max-w-6xl mx-auto px-8 py-10">
      <h1 className="text-3xl font-bold mb-8">Smart Motion Sensor</h1>
      <FloorTabs floors={floors} activeFloorId={activeFloorId} onSelect={setActiveFloorId} />
      <RoomGrid rooms={dashboard.rooms} onSensorClick={handleSensorClick} />
      <Legend />
      {irModalOpen && <IrSendModal onClose={() => setIrModalOpen(false)} onSend={handleSendIr} />}
      {acModalOpen && <AcRemoteModal onClose={() => setAcModalOpen(false)} />}
      {switchModalOpen && <SwitchModal onClose={() => setSwitchModalOpen(false)} />}
    </div>
  )
}
