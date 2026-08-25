export function relativeTime(seconds) {
  if (seconds == null) return null
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  return `${Math.round(s / 3600)}h ago`
}

// Which state a room is in — drives border/dot color in the floor plan, the
// Levels list, and the top stats bar. Checked in priority order: an alert
// always wins, then whichever of motion/AC-running is actually true.
export function roomState(room, acStatus) {
  if (room.sensors.some((s) => s.alert)) return 'alert'
  if (room.sensors.length === 0) return 'empty'
  const pir = room.sensors.find((s) => s.type === 'pir')
  if (pir?.online && pir.value === 'pir') return 'motion'
  const mic = room.sensors.find((s) => s.type === 'mic')
  if (mic?.online && mic.value === 'talking') return 'motion'
  const hasAc = room.sensors.some((s) => s.type === 'aircon')
  if (hasAc && acStatus?.power === '1') return 'ac-running'
  return 'idle'
}

// One-line summary shown in the Levels list, e.g. "No motion 44s ago · AC on, holding 20°C".
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
  const mic = room.sensors.find((s) => s.type === 'mic')
  if (mic) {
    if (!mic.online) {
      parts.push('Mic offline')
    } else {
      parts.push(mic.value === 'talking' ? 'Talking' : 'Quiet')
    }
  }
  const ac = room.sensors.find((s) => s.type === 'aircon')
  if (ac && acStatus) {
    parts.push(acStatus.power === '1' ? `AC on, holding ${acStatus.temp}°C` : 'AC off')
  }
  return parts.join(' · ')
}

// Larger headline shown in the room status panel, e.g. "Room is quiet". PIR
// takes priority when both exist (motion is a stronger occupancy signal than
// audio alone); mic fills in on its own for rooms with no PIR sensor.
export function roomHeadline(room) {
  const pir = room.sensors.find((s) => s.type === 'pir')
  if (pir) {
    if (!pir.online) return 'Motion sensor offline'
    return pir.value === 'pir' ? 'Someone is in the room' : 'Room is quiet'
  }
  const mic = room.sensors.find((s) => s.type === 'mic')
  if (mic) {
    if (!mic.online) return 'Mic offline'
    return mic.value === 'talking' ? 'People are talking' : 'Room is quiet'
  }
  return room.name
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
  const mic = room.sensors.find((s) => s.type === 'mic')
  const talkingPart = mic ? (mic.value === 'talking' ? 'Talking detected.' : null) : null
  const ac = room.sensors.find((s) => s.type === 'aircon')
  const acPart = ac && acStatus ? (acStatus.power === '1' ? `AC is on, holding ${acStatus.temp}°C.` : 'AC is off.') : null
  return [motionPart, talkingPart, acPart].filter(Boolean).join(' ')
}
