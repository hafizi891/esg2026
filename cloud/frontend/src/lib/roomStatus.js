export function relativeTime(seconds) {
  if (seconds == null) return null
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  return `${Math.round(s / 3600)}h ago`
}

// Which state a room is in — drives the border/dot color in both the floor
// plan (RoomGrid) and the levels sidebar list. Checked in priority order: an
// alert always wins, then whichever of motion/AC-running is actually true.
export function roomState(room, acStatus) {
  if (room.sensors.some((s) => s.alert)) return 'alert'
  if (room.sensors.length === 0) return 'empty'
  const pir = room.sensors.find((s) => s.type === 'pir')
  if (pir?.online && pir.value === 'pir') return 'motion'
  const hasAc = room.sensors.some((s) => s.type === 'aircon')
  if (hasAc && acStatus?.power === '1') return 'ac-running'
  return 'idle'
}

// One-line summary shown on the room card / sidebar row, e.g.
// "Motion 4s ago · AC on, holding 20°C".
export function roomStatusLine(room, { acStatus, lastMotionSeconds } = {}) {
  const parts = []
  const pir = room.sensors.find((s) => s.type === 'pir')
  if (pir) {
    if (!pir.online) {
      parts.push('Motion sensor offline')
    } else if (pir.value === 'pir') {
      const rel = relativeTime(lastMotionSeconds)
      parts.push(rel ? `Motion ${rel}` : 'Motion detected')
    } else {
      const rel = relativeTime(lastMotionSeconds)
      parts.push(rel ? `No motion ${rel}` : 'No motion')
    }
  }

  const ac = room.sensors.find((s) => s.type === 'aircon')
  if (ac && acStatus) {
    const isOn = acStatus.power === '1'
    parts.push(isOn ? `AC on, holding ${acStatus.temp}°C` : 'AC off')
  }

  return parts.join(' · ')
}

// Larger headline shown in the room panel, e.g. "Someone is in the room".
export function roomHeadline(room) {
  const pir = room.sensors.find((s) => s.type === 'pir')
  if (!pir) return room.name
  if (!pir.online) return 'Motion sensor offline'
  return pir.value === 'pir' ? 'Someone is in the room' : 'Room is quiet'
}

export function roomDescription(room, { acStatus, lastMotionSeconds } = {}) {
  const pir = room.sensors.find((s) => s.type === 'pir')
  const rel = relativeTime(lastMotionSeconds)
  const motionPart = pir
    ? pir.value === 'pir'
      ? `Motion ${rel || 'just now'}.`
      : rel
      ? `No motion for ${rel.replace(' ago', '')}.`
      : null
    : null

  const ac = room.sensors.find((s) => s.type === 'aircon')
  let acPart = null
  if (ac && acStatus) {
    acPart = acStatus.power === '1' ? `AC is on, holding ${acStatus.temp}°C.` : `AC is off.`
  }

  return [motionPart, acPart].filter(Boolean).join(' ')
}
