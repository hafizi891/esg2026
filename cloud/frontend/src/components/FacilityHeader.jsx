export default function FacilityHeader({ occupiedCount, roomCount, acRunningCount, attentionCount }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
      <h1 className="text-3xl font-bold">Dashboard</h1>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-accent" />
          <span className="font-semibold">{occupiedCount}</span>
          <span className="text-text-secondary">of {roomCount} occupied</span>
        </span>
        <span className="text-info font-medium">{acRunningCount} AC running</span>
        <span className={attentionCount > 0 ? 'text-warning font-medium' : 'text-text-secondary'}>
          {attentionCount} need attention
        </span>
      </div>
    </div>
  )
}
