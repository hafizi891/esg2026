// Small decorative SVG illustrations for specific real rooms on the floor
// plan — purely visual, keyed off the room's name, no data behind them.

export function StairsIllustration({ className }) {
  return (
    <svg viewBox="0 0 100 60" className={className} fill="none">
      <path
        d="M8 52 H26 V38 H44 V24 H62 V10 H92"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function RoundTableIllustration({ className }) {
  const cx = 50
  const cy = 50
  const tableRadius = 20
  const chairRadius = 7
  const chairDistance = 32
  // Three chairs spaced 120° apart around the table (one up top, two below).
  const chairAngles = [270, 30, 150]

  return (
    <svg viewBox="0 0 100 100" className={className}>
      <circle cx={cx} cy={cy} r={tableRadius} fill="none" stroke="currentColor" strokeWidth="3" />
      {chairAngles.map((deg) => {
        const rad = (deg * Math.PI) / 180
        const x = cx + chairDistance * Math.cos(rad)
        const y = cy + chairDistance * Math.sin(rad)
        return <circle key={deg} cx={x} cy={y} r={chairRadius} fill="currentColor" />
      })}
    </svg>
  )
}
