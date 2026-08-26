import { useCallback, useEffect, useMemo, useState } from 'react'
import FacilityHeader from '../components/FacilityHeader'
import LevelsSidebar from '../components/LevelsSidebar'
import RoomGrid from '../components/RoomGrid'
import RoomStatusPanel from '../components/RoomStatusPanel'
import Legend from '../components/Legend'
import LiveStreamTicker from '../components/LiveStreamTicker'
import IrSendModal from '../components/IrSendModal'
import {
  getFloors,
  getDashboard,
  getRooms,
  getSensors,
  getAutomations,
  getAcStatus,
  getSwitchStatus,
  getAutomationEvents,
  sendIr,
  sendAcCommand,
  toggleSwitch,
} from '../api/client'

const AC_MODE_LABELS = { 0: 'Cool', 1: 'Heat', 2: 'Auto', 3: 'Fan', 4: 'Dry' }

function labelForAcCommand(code, value) {
  if (code === 'PowerOn') return 'Turned AC on'
  if (code === 'PowerOff') return 'Turned AC off'
  if (code === 'T') return `Set temperature to ${value}°C`
  if (code === 'M') return `Set mode to ${AC_MODE_LABELS[value] ?? value}`
  return 'Adjusted AC'
}

export default function Dashboard() {
  const [floors, setFloors] = useState([])
  const [activeFloorId, setActiveFloorId] = useState(null)
  const [dashboard, setDashboard] = useState(null)
  const [allRooms, setAllRooms] = useState([])
  const [allSensors, setAllSensors] = useState([])
  const [allAutomations, setAllAutomations] = useState([])
  const [selectedRoomId, setSelectedRoomId] = useState(null)
  const [acStatus, setAcStatus] = useState(null)
  const [switchStatus, setSwitchStatus] = useState(null)
  const [floorDashboards, setFloorDashboards] = useState({}) // floor_id -> {rooms}, facility-wide, sensor-joined
  const [lastMotionAt, setLastMotionAt] = useState(null)
  const [now, setNow] = useState(() => Date.now() / 1000)
  const [recentEvents, setRecentEvents] = useState([]) // newest first, whole-facility ticker
  const [error, setError] = useState(null)
  const [irModalOpen, setIrModalOpen] = useState(false)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    getFloors()
      .then((data) => {
        setFloors(data)
        if (data.length) setActiveFloorId(data[0].id)
      })
      .catch((e) => setError(e.message))
    getRooms().then(setAllRooms).catch(() => {})
    getSensors().then(setAllSensors).catch(() => {})
    getAutomations().then(setAllAutomations).catch(() => {})
  }, [])

  const loadDashboard = useCallback((floorId) => {
    if (!floorId) return
    getDashboard(floorId)
      .then((data) => {
        setDashboard(data)
        setFloorDashboards((prev) => ({ ...prev, [floorId]: data }))
        setSelectedRoomId((prev) => {
          if (prev && data.rooms.some((r) => r.id === prev && r.sensors.length > 0)) return prev
          return data.rooms.find((r) => r.sensors.length > 0)?.id ?? null
        })
      })
      .catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    loadDashboard(activeFloorId)
  }, [activeFloorId, loadDashboard])

  // Facility-wide stats (header counts, sidebar dots for the inactive
  // floors) need every floor's live sensor data, not just the active one —
  // fetch them all up front, then again whenever a sensor changes anywhere.
  const refreshAllFloorDashboards = useCallback(() => {
    floors.forEach((f) => {
      getDashboard(f.id)
        .then((data) => setFloorDashboards((prev) => ({ ...prev, [f.id]: data })))
        .catch(() => {})
    })
  }, [floors])

  useEffect(() => {
    if (floors.length) refreshAllFloorDashboards()
  }, [floors, refreshAllFloorDashboards])

  const refreshDeviceStatus = useCallback(() => {
    getAcStatus().then(setAcStatus).catch(() => setAcStatus(null))
    getSwitchStatus().then(setSwitchStatus).catch(() => setSwitchStatus(null))
  }, [])

  useEffect(() => {
    refreshDeviceStatus()
  }, [refreshDeviceStatus])

  // Seed the ticker from history, then keep it current from live SSE pushes.
  useEffect(() => {
    getAutomationEvents(null, 20)
      .then((rows) => {
        const seeded = rows.map((row) => {
          const automation = allAutomations.find((a) => a.id === row.automation_id)
          const sensor = allSensors.find((s) => s.id === automation?.trigger_sensor_id)
          const room = allRooms.find((r) => r.id === sensor?.room_id)
          const floor = floors.find((f) => f.id === room?.floor_id)
          return {
            timestamp: row.timestamp,
            label: automation ? `${automation.name} ${row.success ? 'fired' : 'failed'}` : 'Automation fired',
            where: room ? `${floor?.name ?? ''} · ${room.name}`.replace(/^ · /, '') : 'Facility',
          }
        })
        setRecentEvents(seeded)
      })
      .catch(() => {})
    // Only re-seed once the reference data needed to label rows has arrived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allAutomations.length, allSensors.length, allRooms.length, floors.length])

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const source = new EventSource('/api/stream')
    source.addEventListener('sensor_update', (e) => {
      const data = JSON.parse(e.data)
      loadDashboard(activeFloorId)
      refreshAllFloorDashboards()
      if (data.value === 'pir') {
        setLastMotionAt(Date.now() / 1000)
        const sensor = allSensors.find((s) => s.id === data.id)
        const room = allRooms.find((r) => r.id === sensor?.room_id)
        const floor = floors.find((f) => f.id === room?.floor_id)
        setRecentEvents((prev) => [
          {
            timestamp: Date.now() / 1000,
            label: 'Motion detected',
            where: room ? `${floor?.name ?? ''} · ${room.name}`.replace(/^ · /, '') : 'Facility',
          },
          ...prev,
        ].slice(0, 20))
      }
    })
    source.addEventListener('automation_triggered', () => {
      refreshDeviceStatus()
      refreshAllFloorDashboards()
    })
    // Fired when the Pi's real AC/switch command result actually arrives
    // back over MQTT — a manual click already calls refreshDeviceStatus()
    // right after sending the command, but that happens before the Pi has
    // executed anything, so it just re-reads stale cached status. This is
    // what catches the real update once it lands (from your own click, or
    // anyone else's, or an automation).
    source.addEventListener('device_status_update', () => refreshDeviceStatus())
    // The Pi republishes every sensor's current reading (retained) every
    // ~20s — this is what corrects a sensor wrongly showing offline/stale
    // right after this dashboard's own MQTT subscriber (re)connects, since
    // sensor_update alone (on-change only) can't tell it anything about a
    // sensor that hasn't happened to change since then.
    source.addEventListener('sensor_snapshot', () => {
      loadDashboard(activeFloorId)
      refreshAllFloorDashboards()
    })
    source.onerror = () => {}
    return () => source.close()
  }, [activeFloorId, loadDashboard, refreshDeviceStatus, refreshAllFloorDashboards, allSensors, allRooms, floors])

  // Per-floor "instrumented / total" counts for the levels sidebar, and
  // facility-wide occupied/AC-running/attention counts for the header —
  // computed from the flat allRooms/allSensors + the live SSE mirror above,
  // so they cover every floor, not just the one currently open.
  const roomCounts = useMemo(() => {
    const instrumentedRoomIds = new Set(allSensors.map((s) => s.room_id))
    const counts = {}
    for (const room of allRooms) {
      const c = counts[room.floor_id] ?? (counts[room.floor_id] = { total: 0, instrumented: 0 })
      c.total += 1
      if (instrumentedRoomIds.has(room.id)) c.instrumented += 1
    }
    return counts
  }, [allRooms, allSensors])

  const facilityStats = useMemo(() => {
    let occupied = 0
    let acRunning = 0
    let attention = 0
    for (const floorDashboard of Object.values(floorDashboards)) {
      for (const room of floorDashboard.rooms) {
        const pir = room.sensors.find((s) => s.type === 'pir')
        if (pir?.online && pir.value === 'pir') occupied += 1
        if (room.sensors.some((s) => s.alert)) attention += 1
        if (room.sensors.some((s) => s.type === 'aircon') && acStatus?.power === '1') acRunning += 1
      }
    }
    return { occupied, acRunning, attention }
  }, [floorDashboards, acStatus])

  const facilitySummary = useMemo(
    () => ({
      levels: floors.length,
      rooms: allRooms.length,
      instrumented: new Set(allSensors.map((s) => s.room_id)).size,
      rules: allAutomations.length,
    }),
    [floors, allRooms, allSensors, allAutomations]
  )

  const handleSensorClick = (sensor) => {
    if (sensor.type === 'ir') setIrModalOpen(true)
  }

  const handleSendIr = async (code) => {
    await sendIr(code)
  }

  const handleSendAcCommand = async (code, value) => {
    setSending(true)
    try {
      await sendAcCommand(code, value)
      setRecentEvents((prev) => [{ timestamp: Date.now() / 1000, label: labelForAcCommand(code, value), where: 'You' }, ...prev].slice(0, 20))
      refreshDeviceStatus()
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  const handleToggleSwitch = async (value) => {
    setSending(true)
    try {
      await toggleSwitch(value)
      refreshDeviceStatus()
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  if (error) {
    return <div className="max-w-7xl mx-auto px-8 py-10 text-danger">Error loading dashboard: {error}</div>
  }
  if (!dashboard) {
    return <div className="max-w-7xl mx-auto px-8 py-10 text-text-secondary">Loading…</div>
  }

  const selectedRoom = dashboard.rooms.find((r) => r.id === selectedRoomId) ?? null
  const lastMotionSeconds = lastMotionAt != null ? now - lastMotionAt : null
  const recentInRoom = selectedRoom
    ? recentEvents.filter((e) => e.where?.includes(selectedRoom.name))
    : []

  return (
    <div className="max-w-7xl mx-auto px-8 py-10">
      <FacilityHeader
        occupiedCount={facilityStats.occupied}
        roomCount={allRooms.length}
        acRunningCount={facilityStats.acRunning}
        attentionCount={facilityStats.attention}
        rulesCount={allAutomations.length}
      />

      <div className="flex gap-6 items-start">
        <LevelsSidebar
          floors={floors}
          activeFloorId={activeFloorId}
          onSelectFloor={setActiveFloorId}
          activeFloorRooms={dashboard.rooms}
          roomCounts={roomCounts}
          selectedRoomId={selectedRoomId}
          onSelectRoom={setSelectedRoomId}
          acStatus={acStatus}
          lastMotionSeconds={lastMotionSeconds}
          facilitySummary={facilitySummary}
        />
        <div className="flex-1 min-w-0">
          <RoomGrid
            rooms={dashboard.rooms}
            selectedRoomId={selectedRoomId}
            onSelectRoom={setSelectedRoomId}
            onSensorClick={handleSensorClick}
            acStatus={acStatus}
          />
          <Legend />
        </div>
        <RoomStatusPanel
          room={selectedRoom}
          acStatus={acStatus}
          switchStatus={switchStatus}
          lastMotionSeconds={lastMotionSeconds}
          sending={sending}
          onSendAcCommand={handleSendAcCommand}
          onToggleSwitch={handleToggleSwitch}
          onOpenIr={() => setIrModalOpen(true)}
          recentEvents={recentInRoom}
        />
      </div>

      <LiveStreamTicker events={recentEvents} />

      {irModalOpen && <IrSendModal onClose={() => setIrModalOpen(false)} onSend={handleSendIr} />}
    </div>
  )
}
