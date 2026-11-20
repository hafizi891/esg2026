import { useEffect, useMemo, useState } from 'react'
import { Activity, ArrowDownToLine, Gauge, Leaf, Snowflake, Volume2, Zap } from 'lucide-react'
import { getEsgAnalytics } from '../api/client'

const duration = (seconds = 0) => {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`
}

const number = (value) => new Intl.NumberFormat('en-MY').format(value ?? 0)

function Metric({ icon: Icon, eyebrow, value, note, tone = 'emerald' }) {
  const tones = {
    emerald: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/20',
    cyan: 'bg-cyan-400/10 text-cyan-300 border-cyan-400/20',
    amber: 'bg-amber-400/10 text-amber-300 border-amber-400/20',
    violet: 'bg-violet-400/10 text-violet-300 border-violet-400/20',
  }
  return (
    <article className="rounded-2xl border border-white/10 bg-panel p-5 shadow-[0_20px_70px_rgba(0,0,0,.16)]">
      <div className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border ${tones[tone]}`}><Icon size={17} /></div>
      <p className="mt-5 text-[10px] font-semibold uppercase tracking-[.2em] text-text-secondary">{eyebrow}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-text-primary">{value}</p>
      <p className="mt-2 min-h-10 text-xs leading-5 text-text-secondary">{note}</p>
    </article>
  )
}

function TrendBars({ daily }) {
  const max = Math.max(1, ...daily.map((row) => Math.max(row.ac_runtime_seconds / 60, row.motion_active_seconds / 60, row.sound_events)))
  return (
    <div className="mt-6 grid min-w-[620px] grid-cols-[repeat(var(--days),minmax(44px,1fr))] items-end gap-3" style={{ '--days': daily.length }}>
      {daily.map((row) => (
        <div key={row.date} className="group flex flex-col items-center gap-2">
          <div className="flex h-40 w-full items-end justify-center gap-1 rounded-xl border border-white/5 bg-black/15 px-2 py-3">
            <div title={`AC ${duration(row.ac_runtime_seconds)}`} className="w-2.5 rounded-t bg-emerald-400" style={{ height: `${Math.max(3, (row.ac_runtime_seconds / 60 / max) * 100)}%` }} />
            <div title={`PIR ${duration(row.motion_active_seconds)}`} className="w-2.5 rounded-t bg-cyan-400" style={{ height: `${Math.max(3, (row.motion_active_seconds / 60 / max) * 100)}%` }} />
            <div title={`${row.sound_events} sound events`} className="w-2.5 rounded-t bg-amber-400" style={{ height: `${Math.max(3, (row.sound_events / max) * 100)}%` }} />
          </div>
          <span className="text-[10px] text-text-secondary">{row.date.slice(5)}</span>
        </div>
      ))}
    </div>
  )
}

export default function Analytics() {
  const [days, setDays] = useState(7)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    setError(null)
    getEsgAnalytics(days).then(setData).catch((e) => setError(e.message))
  }, [days])

  const downloadCsv = () => {
    if (!data) return
    const rows = [['Date', 'Sound events', 'Peak sound level', 'Motion events', 'PIR active seconds', 'AC runtime seconds']]
    data.daily.forEach((row) => rows.push([row.date, row.sound_events, row.peak_sound_level ?? '', row.motion_events, row.motion_active_seconds, row.ac_runtime_seconds]))
    const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `esg-operational-report-${days}d.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const current = useMemo(() => data?.daily?.[data.daily.length - 1], [data])

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_80%_0%,rgba(16,185,129,.09),transparent_35%)] px-5 py-7 md:px-8 md:py-10">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-end justify-between gap-5 border-b border-white/10 pb-7">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[10px] font-bold tracking-[.2em] text-emerald-300"><Leaf size={13} /> ESG INTELLIGENCE</div>
            <h1 className="text-3xl font-semibold tracking-tight text-text-primary md:text-5xl">Executive overview</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-text-secondary">Operational evidence for occupancy-responsive cooling, environmental activity and automated resource controls.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select aria-label="Reporting period" value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-xl border border-white/10 bg-panel px-4 py-2.5 text-sm">
              <option value={1}>Last 24 hours</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
            </select>
            <button onClick={downloadCsv} disabled={!data} className="inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-40"><ArrowDownToLine size={16} /> Download CSV</button>
          </div>
        </header>

        {error && <div className="mt-8 rounded-xl border border-danger/30 bg-danger/10 p-4 text-danger">{error}</div>}
        {!data && !error && <div className="mt-8 text-text-secondary">Loading executive indicators…</div>}

        {data && <>
          <section className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric icon={Snowflake} eyebrow="AC runtime proxy" value={duration(data.ac.runtime_seconds)} note="Confirmed cooling-state duration. Operational proxy; not kWh or CO₂e." />
            <Metric icon={Gauge} eyebrow="Efficient setpoint share" value={`${data.ac.efficient_setpoint_share_percent}%`} note="Share of inferred AC runtime at 24°C or warmer." tone="cyan" />
            <Metric icon={Zap} eyebrow="Automation interventions" value={number(data.automation.interventions)} note={`${data.automation.automatic_shutdowns} auto shutdowns · ${data.automation.temperature_transitions} temperature transitions`} tone="violet" />
            <Metric icon={Activity} eyebrow="Occupancy demand" value={number(data.motion.events)} note={`${duration(data.motion.active_seconds)} PIR-active time in the selected period.`} tone="amber" />
          </section>

          <section className="mt-7 grid gap-5 xl:grid-cols-[1.7fr_1fr]">
            <article className="overflow-hidden rounded-2xl border border-white/10 bg-panel p-5 md:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-text-secondary">Operational trend</p><h2 className="mt-2 text-xl font-semibold">Demand and control activity</h2></div>
                <div className="flex flex-wrap gap-3 text-[10px] text-text-secondary"><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-400" />AC minutes</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-cyan-400" />PIR minutes</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-400" />Sound events</span></div>
              </div>
              <div className="overflow-x-auto"><TrendBars daily={data.daily} /></div>
            </article>

            <article className="rounded-2xl border border-white/10 bg-panel p-5 md:p-6">
              <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-text-secondary">Today at a glance</p>
              <div className="mt-5 divide-y divide-white/10">
                <div className="flex items-center justify-between py-4"><span className="flex items-center gap-2 text-sm text-text-secondary"><Volume2 size={16} />Sound detections</span><b>{current?.sound_events ?? 0}</b></div>
                <div className="flex items-center justify-between py-4"><span className="text-sm text-text-secondary">Peak sound amplitude</span><b>{current?.peak_sound_level ?? '—'}</b></div>
                <div className="flex items-center justify-between py-4"><span className="text-sm text-text-secondary">Motion starts</span><b>{current?.motion_events ?? 0}</b></div>
                <div className="flex items-center justify-between py-4"><span className="text-sm text-text-secondary">AC runtime</span><b>{duration(current?.ac_runtime_seconds)}</b></div>
              </div>
            </article>
          </section>

          <section className="mt-7 overflow-hidden rounded-2xl border border-white/10 bg-panel">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-5 md:px-6"><div><h2 className="font-semibold">Reporting table</h2><p className="mt-1 text-xs text-text-secondary">Auditable daily operational indicators for the selected reporting period.</p></div><span className="rounded-full border border-white/10 px-3 py-1 text-[10px] uppercase tracking-widest text-text-secondary">Persistent SQLite history</span></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="bg-black/10 text-left text-[10px] uppercase tracking-wider text-text-secondary"><tr><th className="p-4 md:px-6">Date</th><th className="p-4">Sound events</th><th className="p-4">Peak amplitude</th><th className="p-4">Motion starts</th><th className="p-4">PIR active</th><th className="p-4">AC runtime</th></tr></thead><tbody>{[...data.daily].reverse().map((row) => <tr key={row.date} className="border-t border-white/5"><td className="p-4 font-medium md:px-6">{row.date}</td><td className="p-4">{row.sound_events}</td><td className="p-4">{row.peak_sound_level ?? '—'}</td><td className="p-4">{row.motion_events}</td><td className="p-4">{duration(row.motion_active_seconds)}</td><td className="p-4">{duration(row.ac_runtime_seconds)}</td></tr>)}</tbody></table></div>
          </section>

          <section className="mt-7 grid gap-4 md:grid-cols-3">
            <article className="rounded-2xl border border-white/10 bg-panel p-5"><p className="text-xs font-semibold text-text-primary">Environmental activity</p><p className="mt-2 text-xs leading-5 text-text-secondary">Sound values are 50 ms A0 peak-to-peak amplitudes, not calibrated decibels. Use event counts and relative trends.</p></article>
            <article className="rounded-2xl border border-white/10 bg-panel p-5"><p className="text-xs font-semibold text-text-primary">Operational efficiency</p><p className="mt-2 text-xs leading-5 text-text-secondary">Efficient-setpoint share tracks inferred runtime at 24°C or warmer. It is a controls indicator, not verified energy savings.</p></article>
            <article className="rounded-2xl border border-white/10 bg-panel p-5"><p className="text-xs font-semibold text-text-primary">Disclosure boundary</p><p className="mt-2 text-xs leading-5 text-text-secondary">Runtime is not kWh or CO₂e. Add a power meter and documented grid-emission factor before reporting energy or carbon reductions.</p></article>
          </section>
        </>}
      </div>
    </div>
  )
}
