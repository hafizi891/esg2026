export default function FacilityHeader({ occupiedCount, roomCount, acRunningCount, attentionCount, rulesCount }) {
  return (
    <div className="flex items-center justify-between mb-8">
      <h1 className="text-3xl font-bold">Dashboard</h1>
      <div className="flex items-center gap-6 text-sm">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-accent" />
          <span className="font-semibold">{occupiedCount}</span>
          <span className="text-text-secondary">of {roomCount} occupied</span>
        </span>
        <span className="text-info font-medium">{acRunningCount} AC running</span>
        <span className={attentionCount > 0 ? 'text-warning font-medium' : 'text-text-secondary'}>
          {attentionCount} need attention
        </span>
        <span className="px-3 py-1.5 rounded-lg border border-border text-text-primary font-medium">
          Rules · {rulesCount}
        </span>
      </div>
    </div>
  )
}
