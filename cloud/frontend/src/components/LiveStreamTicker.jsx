export default function LiveStreamTicker({ events }) {
  return (
    <div className="mt-10">
      <p className="text-xs font-bold tracking-widest text-text-secondary uppercase mb-3">Live stream · whole facility</p>
      {events.length === 0 ? (
        <p className="text-sm text-text-secondary">No activity yet.</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {events.map((e, i) => (
            <div
              key={i}
              className="shrink-0 w-56 rounded-lg border border-border bg-surface-2 p-3"
            >
              <div className="flex items-center justify-between mb-1.5 text-xs text-text-secondary">
                <span>{new Date(e.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span className="truncate ml-2">{e.where}</span>
              </div>
              <p className="text-sm font-semibold text-text-primary leading-snug">{e.label}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
