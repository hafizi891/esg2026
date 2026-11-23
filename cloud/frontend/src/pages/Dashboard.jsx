import { useCallback, useEffect, useMemo, useState } from 'react'
import FacilityHeader from '../components/FacilityHeader'
import LevelsSidebar from '../components/LevelsSidebar'
import RoomGrid from '../components/RoomGrid'
import RoomStatusPanel from '../components/RoomStatusPanel'
import Legend from '../components/Legend'
import LiveStreamTicker from '../components/LiveStreamTicker'

import { getFloors, getDashboard, getRooms, getSensors, getAcStatus } from '../api/client'

// Apply one live sensor reading to a floor's dashboard without refetching it.
function applyReading(floorDashboard, reading) {
  return {
    ...floorDashboard,
    rooms: floorDashboard.rooms.map((room) => ({
      ...room,
      sensors: room.sensors.map((s) =>
        s.id !== reading.id
          ? s
          : {
              ...s,
              online: reading.online,
              value: 'value' in reading ? reading.value : s.value,
              changed_at: reading.changed_at ?? s.changed_at,
              // Mirrors the server's _is_sensor_alert for the sensor types this layout has.
              alert: s.type === 'pir' ? !reading.online : s.alert,
            }
      ),
    })),
  }
}

// Merge a repeat of the newest ticker item (PIR flicker, sound bursts) instead of flooding the list.
function pushEvent(prev, event) {
  const top = prev[0]
  if (top && top.label === event.label && top.where === event.where) {
    const peak = event.peak != null ? Math.max(top.peak ?? 0, event.peak) : top.peak
    return [{ ...top, timestamp: event.timestamp, count: top.count + 1, peak }, ...prev.slice(1)]
  }
  return [{ ...event, count: 1 }, ...prev].slice(0, 20)
}

export default function Dashboard() {
  const [floors, setFloors] = useState([])
  const [activeFloorId, setActiveFloorId] = useState(null)
  const [allRooms, setAllRooms] = useState([])
  const [allSensors, setAllSensors] = useState([])
  const [selectedRoomId, setSelectedRoomId] = useState(null)
  const [acStatus, setAcStatus] = useState(null)
  const [floorDashboards, setFloorDashboards] = useState({}) // floor_id -> {rooms}, facility-wide, sensor-joined
  const [now, setNow] = useState(() => Date.now() / 1000)
  const [recentEvents, setRecentEvents] = useState([]) // newest first, whole-facility ticker
  const [error, setError] = useState(null)

  useEffect(() => {
    getFloors()
      .then((data) => {
        setFloors(data)
        if (data.length) setActiveFloorId(data[0].id)
      })
      .catch((e) => setError(e.message))
    getRooms().then(setAllRooms).catch(() => {})
    getSensors().then(setAllSensors).catch(() => {})
    getAcStatus().then(setAcStatus).catch(() => setAcStatus(null))
  }, [])

  // Full load once per floor; live updates are applied in place afterwards.
  const loadAllFloors = useCallback(() => {
    floors.forEach((f) => {
      getDashboard(f.id)
        .then((data) => setFloorDashboards((prev) => ({ ...prev, [f.id]: data })))
        .catch((e) => setError(e.message))
    })
  }, [floors])

  useEffect(() => {
    loadAllFloors()
  }, [loadAllFloors])

  const dashboard = floorDashboards[activeFloorId] ?? null

  useEffect(() => {
    if (!dashboard) return
    setSelectedRoomId((prev) => {
      if (prev && dashboard.rooms.some((r) => r.id === prev && r.sensors.length > 0)) return prev
      return dashboard.rooms.find((r) => r.sensors.length > 0)?.id ?? null
    })
  }, [dashboard])

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const whereFor = (sensorId) => {
      const sensor = allSensors.find((s) => s.id === sensorId)
      const room = allRooms.find((r) => r.id === sensor?.room_id)
      const floor = floors.find((f) => f.id === room?.floor_id)
      return room ? `${floor?.name ?? ''} · ${room.name}`.replace(/^ · /, '') : 'All rooms'
    }

    const source = new EventSource('/api/stream')
    source.addEventListener('sensor_update', (e) => {
      const data = JSON.parse(e.data)
      setFloorDashboards((prev) =>
        Object.fromEntries(Object.entries(prev).map(([id, fd]) => [id, applyReading(fd, data)]))
      )
      if (data.id === 'sensor-ac') setAcStatus(data)

      // A status message refreshes every sensor's timestamp but not changed_at; only real readings go in the ticker.
      const isRealChange = data.changed_at != null && data.changed_at === data.timestamp
      if (!isRealChange) return
      const timestamp = data.timestamp ?? Date.now() / 1000
      if (data.id === 'sensor-pir' && data.value === 'pir') {
        setRecentEvents((prev) => pushEvent(prev, { timestamp, label: 'Motion detected', where: whereFor(data.id) }))
      } else if (data.id === 'sensor-mic' && data.event === 'sound_detected') {
        setRecentEvents((prev) =>
          pushEvent(prev, { timestamp, label: 'Sound detected', where: whereFor(data.id), peak: data.value })
        )
      } else if (data.id === 'sensor-ac') {
        const label = data.power === '1' ? `AC set to ${data.temp}°C` : 'AC turned off'
        setRecentEvents((prev) => pushEvent(prev, { timestamp, label, where: whereFor(data.id) }))
      }
    })
    source.onerror = () => {}
    return () => source.close()
  }, [allSensors, allRooms, floors])

  // Per-floor "instrumented / total" counts for the levels sidebar.
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
    }),
    [floors, allRooms, allSensors]
  )

  if (error) {
    return <div className="max-w-7xl mx-auto px-8 py-10 text-danger">Error loading dashboard: {error}</div>
  }
  if (!dashboard) {
    return <div className="max-w-7xl mx-auto px-8 py-10 text-text-secondary">Loading…</div>
  }

  const selectedRoom = dashboard.rooms.find((r) => r.id === selectedRoomId) ?? null
  // Time since the PIR last changed state, from the server — survives a page reload.
  const pirChangedAt = dashboard.rooms.flatMap((r) => r.sensors).find((s) => s.type === 'pir')?.changed_at
  const lastMotionSeconds = pirChangedAt != null ? now - pirChangedAt : null
  const recentInRoom = selectedRoom ? recentEvents.filter((e) => e.where?.includes(selectedRoom.name)) : []

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-6 md:py-10">
      <FacilityHeader
        occupiedCount={facilityStats.occupied}
        roomCount={allRooms.length}
        acRunningCount={facilityStats.acRunning}
        attentionCount={facilityStats.attention}
      />

      <div className="flex flex-col lg:flex-row gap-6 lg:items-start">
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
        <div className="flex-1 min-w-0 w-full">
          <RoomGrid
            rooms={dashboard.rooms}
            selectedRoomId={selectedRoomId}
            onSelectRoom={setSelectedRoomId}
            acStatus={acStatus}
          />
          <Legend />
        </div>
        <RoomStatusPanel
          room={selectedRoom}
          acStatus={acStatus}
          lastMotionSeconds={lastMotionSeconds}
          recentEvents={recentInRoom}
          now={now}
        />
      </div>

      <LiveStreamTicker events={recentEvents} />
    </div>
  )
}
