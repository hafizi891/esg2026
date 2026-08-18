import { useEffect, useMemo, useState } from 'react'
import { getSensors, getRooms, getAnalytics, getAutomationEvents } from '../api/client'

const RANGES = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 24 * 7 },
]

function isActive(sensorType, value) {
  if (sensorType === 'pir') return value === 'pir'
  if (sensorType === 'switch') return Boolean(value)
  return false
}

function buildSegments(rows, rangeStart, rangeEnd) {
  if (rows.length === 0) return []
  return rows.map((row, i) => ({
    start: Math.max(row.timestamp, rangeStart),
    end: i + 1 < rows.length ? rows[i + 1].timestamp : rangeEnd,
    value: row.value,
    online: row.online,
  }))
}

// Evenly-spaced tick marks under a timeline bar, formatted to fit the
// selected range — clock times for short ranges, day+date once the range
// spans multiple days (24h could still be same-day, so only 7d gets dates).
function buildTimeTicks(rangeStart, rangeEnd, rangeHours, tickCount = 6) {
  const span = rangeEnd - rangeStart
  return Array.from({ length: tickCount + 1 }, (_, i) => {
    const timestamp = rangeStart + (span * i) / tickCount
    const date = new Date(timestamp * 1000)
    const label =
      rangeHours >= 24 * 7
        ? date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
        : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return { pct: (i / tickCount) * 100, label }
  })
}

function TimeAxis({ rangeStart, rangeEnd, rangeHours }) {
  const ticks = buildTimeTicks(rangeStart, rangeEnd, rangeHours)
  return (
    <div className="relative h-4 mt-1 text-[10px] text-text-secondary">
      {ticks.map((tick, i) => (
        <span
          key={i}
          className={`absolute whitespace-nowrap ${
            i === 0 ? '' : i === ticks.length - 1 ? '-translate-x-full' : '-translate-x-1/2'
          }`}
          style={{ left: `${tick.pct}%` }}
        >
          {tick.label}
        </span>
      ))}
    </div>
  )
}

function segmentClass(sensorType, seg) {
  if (!seg.online) return 'bg-danger/70'
  return isActive(sensorType, seg.value) ? 'bg-success' : 'bg-black/15'
}

function formatValue(sensorType, value, online) {
  if (!online) return 'Offline'
  if (sensorType === 'pir') return value === 'pir' ? 'Motion detected' : 'No motion'
  if (sensorType === 'switch') return value ? 'On' : 'Off'
  return String(value)
}

// Each logged row marks the start of a new state (event-log semantics) — a
// row landing on an "active" value is one activation event, bucketed by the
// hour of day it happened in (summed across every day in the selected range).
function buildHourlyActivity(rows, sensorType) {
  const counts = new Array(24).fill(0)
  rows.forEach((row) => {
    if (isActive(sensorType, row.value)) {
      counts[new Date(row.timestamp * 1000).getHours()] += 1
    }
  })
  return counts
}

function SensorPanel({ sensor, rows, rangeHours, rangeStart, rangeEnd }) {
  const segments = buildSegments(rows, rangeStart, rangeEnd)
  const activeSeconds = segments
    .filter((s) => s.online && isActive(sensor.type, s.value))
    .reduce((sum, s) => sum + (s.end - s.start), 0)
  const activePct = rangeEnd > rangeStart ? Math.round((activeSeconds / (rangeEnd - rangeStart)) * 100) : 0
  const hourlyCounts = buildHourlyActivity(rows, sensor.type)
  const maxHourlyCount = Math.max(1, ...hourlyCounts)
  const rangeLabel = RANGES.find((r) => r.hours === rangeHours)?.label

  return (
    <div className="mb-14">
      <h2 className="text-lg font-semibold mb-1">{sensor.name}</h2>
      <div className="mb-2 text-sm text-text-secondary">
        {rows.length} transition{rows.length === 1 ? '' : 's'} · active {activePct}% of the last {rangeLabel}
      </div>

      <div className="relative h-12 rounded-lg overflow-hidden border border-border bg-black/3">
        {segments.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-text-secondary text-sm">
            No data in this range yet
          </div>
        ) : (
          segments.map((seg, i) => (
            <div
              key={i}
              title={`${new Date(seg.start * 1000).toLocaleString()} — ${formatValue(sensor.type, seg.value, seg.online)}`}
              className={`absolute top-0 bottom-0 ${segmentClass(sensor.type, seg)}`}
              style={{
                left: `${((seg.start - rangeStart) / (rangeEnd - rangeStart)) * 100}%`,
                width: `${Math.max(((seg.end - seg.start) / (rangeEnd - rangeStart)) * 100, 0.2)}%`,
              }}
            />
          ))
        )}
      </div>
      <TimeAxis rangeStart={rangeStart} rangeEnd={rangeEnd} rangeHours={rangeHours} />

      <div className="flex gap-6 mt-4 text-sm text-text-secondary">
        <span className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm bg-success inline-block" /> Active
        </span>
        <span className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm bg-black/15 inline-block" /> Inactive
        </span>
        <span className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm bg-danger/70 inline-block" /> Offline
        </span>
      </div>

      <h3 className="text-sm font-semibold mt-8 mb-1">Activity by hour of day</h3>
      <p className="text-xs text-text-secondary mb-3">
        {sensor.type === 'pir' ? 'Motion events' : 'Times switched on'}, summed across every day in the selected range
      </p>

      <div className="flex items-end gap-1 h-32 border-b border-border pb-1">
        {hourlyCounts.map((count, hour) => (
          <div key={hour} className="flex-1 flex flex-col items-center justify-end h-full" title={`${hour}:00 — ${count} event${count === 1 ? '' : 's'}`}>
            <div
              className={`w-full rounded-t ${count > 0 ? 'bg-accent' : 'bg-black/5'}`}
              style={{ height: `${Math.max((count / maxHourlyCount) * 100, count > 0 ? 4 : 2)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1 mt-1 text-[10px] text-text-secondary">
        {hourlyCounts.map((_, hour) => (
          <div key={hour} className="flex-1 text-center">
            {hour % 3 === 0 ? hour : ''}
          </div>
        ))}
      </div>
    </div>
  )
}

// Turns the power_on/power_off automation events into on/off segments over
// the selected range — same idea as buildSegments() above, but derived from
// automation fire history instead of raw sensor readings, since the AC is
// write-only and never has its own reading history.
function buildAcSegments(events, rangeStart, rangeEnd) {
  const relevant = events
    .filter((e) => e.success && (e.event_type === 'power_on' || e.event_type === 'power_off'))
    .sort((a, b) => a.timestamp - b.timestamp)
  if (relevant.length === 0) return []

  const before = relevant.filter((e) => e.timestamp <= rangeStart)
  let state = before.length ? (before[before.length - 1].event_type === 'power_on' ? 'on' : 'off') : null
  let segStart = rangeStart
  const segments = []

  relevant
    .filter((e) => e.timestamp > rangeStart && e.timestamp < rangeEnd)
    .forEach((e) => {
      if (state !== null) segments.push({ start: segStart, end: e.timestamp, state })
      state = e.event_type === 'power_on' ? 'on' : 'off'
      segStart = e.timestamp
    })
  if (state !== null) segments.push({ start: segStart, end: rangeEnd, state })

  return segments
}

function AcTimelinePanel({ acSensor, events, rangeHours, rangeStart, rangeEnd }) {
  const segments = useMemo(() => buildAcSegments(events, rangeStart, rangeEnd), [events, rangeStart, rangeEnd])
  const onSeconds = segments.filter((s) => s.state === 'on').reduce((sum, s) => sum + (s.end - s.start), 0)
  const onHours = (onSeconds / 3600).toFixed(1)
  const onPct = rangeEnd > rangeStart ? Math.round((onSeconds / (rangeEnd - rangeStart)) * 100) : 0
  const rangeLabel = RANGES.find((r) => r.hours === rangeHours)?.label

  return (
    <div className="mb-14">
      <h2 className="text-lg font-semibold mb-1">{acSensor.name}</h2>
      <div className="mb-2 text-sm text-text-secondary">
        On {onHours}h ({onPct}%) of the last {rangeLabel}
      </div>

      <div className="relative h-12 rounded-lg overflow-hidden border border-border bg-black/3">
        {segments.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-text-secondary text-sm">
            No automation activity in this range yet
          </div>
        ) : (
          segments.map((seg, i) => (
            <div
              key={i}
              title={`${new Date(seg.start * 1000).toLocaleString()} — ${seg.state === 'on' ? 'On' : 'Off'}`}
              className={`absolute top-0 bottom-0 ${seg.state === 'on' ? 'bg-accent' : 'bg-black/15'}`}
              style={{
                left: `${((seg.start - rangeStart) / (rangeEnd - rangeStart)) * 100}%`,
                width: `${Math.max(((seg.end - seg.start) / (rangeEnd - rangeStart)) * 100, 0.2)}%`,
              }}
            />
          ))
        )}
      </div>
      <TimeAxis rangeStart={rangeStart} rangeEnd={rangeEnd} rangeHours={rangeHours} />

      <div className="flex gap-6 mt-4 text-sm text-text-secondary">
        <span className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm bg-accent inline-block" /> On
        </span>
        <span className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm bg-black/15 inline-block" /> Off
        </span>
      </div>
      <p className="text-xs text-text-secondary mt-2">
        Derived from automation fire history (successful power_on/power_off events) — not a live power reading.
      </p>
    </div>
  )
}

export default function Analytics() {
  const [sensors, setSensors] = useState([])
  const [rooms, setRooms] = useState([])
  const [roomId, setRoomId] = useState(null)
  const [rangeHours, setRangeHours] = useState(24)
  const [rowsBySensor, setRowsBySensor] = useState({})
  const [acEvents, setAcEvents] = useState([])
  const [error, setError] = useState(null)

  // Only rooms with a sensor that's both real hardware AND actually polled
  // continuously have any history — IR blasters/AC remotes are write-only,
  // and the switch is checked on-demand only (see app.py's
  // SKIP_CONTINUOUS_POLL_TYPES), so none of them are ever logged and would
  // only ever show "no data".
  const roomsWithSensors = useMemo(() => {
    const byRoom = new Map()
    sensors
      .filter((s) => s.tuya_device_id && s.type !== 'ir' && s.type !== 'aircon' && s.type !== 'switch')
      .forEach((s) => {
        const room = rooms.find((r) => r.id === s.room_id)
        const key = s.room_id
        if (!byRoom.has(key)) byRoom.set(key, { id: key, name: room?.name || 'Unknown room', sensors: [] })
        byRoom.get(key).sensors.push(s)
      })
    return [...byRoom.values()]
  }, [sensors, rooms])

  useEffect(() => {
    Promise.all([getSensors(), getRooms()])
      .then(([s, r]) => {
        setSensors(s)
        setRooms(r)
      })
      .catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    if (!roomId && roomsWithSensors.length) setRoomId(roomsWithSensors[0].id)
  }, [roomId, roomsWithSensors])

  const rangeEnd = useMemo(() => Date.now() / 1000, [rangeHours, roomId])
  const rangeStart = rangeEnd - rangeHours * 3600

  const currentRoom = roomsWithSensors.find((r) => r.id === roomId)
  // The AC is write-only (excluded from roomsWithSensors above), but if it's
  // in the currently selected room, its on/off timeline is worth showing
  // alongside the room's other sensors — derived from automation history
  // rather than a reading, since it has no polled status of its own.
  const currentRoomAcSensor = sensors.find((s) => s.type === 'aircon' && s.room_id === roomId)

  useEffect(() => {
    if (!currentRoom) return
    Promise.all(currentRoom.sensors.map((s) => getAnalytics(s.id, rangeStart).then((rows) => [s.id, rows])))
      .then((pairs) => setRowsBySensor(Object.fromEntries(pairs)))
      .catch((e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, rangeHours])

  useEffect(() => {
    if (!currentRoomAcSensor) return
    getAutomationEvents(rangeStart, 2000).then(setAcEvents).catch((e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, rangeHours, currentRoomAcSensor?.id])

  return (
    <div className="max-w-6xl mx-auto px-8 py-10">
      <h1 className="text-3xl font-bold mb-8">Analytics</h1>

      {error && <div className="mb-4 text-danger text-sm">{error}</div>}

      {roomsWithSensors.length === 0 ? (
        <p className="text-text-secondary text-sm">
          No sensors with a linked Tuya device yet — analytics needs real hardware to have any history.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-4 items-center mb-8">
            <select
              className="bg-black/3 border border-black/15 rounded-lg px-3 py-2 text-sm"
              value={roomId || ''}
              onChange={(e) => setRoomId(e.target.value)}
            >
              {roomsWithSensors.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>

            <div className="flex gap-1">
              {RANGES.map((r) => (
                <button
                  key={r.label}
                  onClick={() => setRangeHours(r.hours)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium ${
                    rangeHours === r.hours ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {currentRoom?.sensors.map((sensor) => (
            <SensorPanel
              key={sensor.id}
              sensor={sensor}
              rows={rowsBySensor[sensor.id] || []}
              rangeHours={rangeHours}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
            />
          ))}

          {currentRoomAcSensor && (
            <AcTimelinePanel
              acSensor={currentRoomAcSensor}
              events={acEvents}
              rangeHours={rangeHours}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
            />
          )}
        </>
      )}
    </div>
  )
}
