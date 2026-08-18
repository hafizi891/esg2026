import { useEffect, useRef, useState } from 'react'
import { X, Wifi, CheckCircle2, RefreshCw } from 'lucide-react'
import { updateSensor } from '../api/client'
import { useToast } from '../context/ToastContext.jsx'

export default function ScanModal({ onClose, onSensorUpdated }) {
  const [status, setStatus] = useState('running') // running | complete | error
  const [log, setLog] = useState([])
  const [devices, setDevices] = useState([]) // in discovery order
  const [elapsed, setElapsed] = useState(0)
  const [applyingId, setApplyingId] = useState(null)
  const logRef = useRef(null)
  const showToast = useToast()

  useEffect(() => {
    const source = new EventSource('/api/stream')

    source.addEventListener('scan_progress', (e) => {
      const data = JSON.parse(e.data)
      if (data.status === 'log' || data.status === 'device_found') {
        setLog((prev) => [...prev, data.line])
      }
      if (data.status === 'device_found') {
        setDevices((prev) => [...prev, data.device])
      }
      if (data.status === 'complete') {
        setLog((prev) => [...prev, data.line])
        setStatus('complete')
      }
    })

    source.onerror = () => {
      // SSE auto-reconnects on transient network hiccups; only surface a
      // hard failure if we never got anywhere.
    }

    return () => source.close()
  }, [])

  useEffect(() => {
    if (status !== 'running') return
    const start = Date.now()
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(interval)
  }, [status])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [log])

  const applyFix = async (device) => {
    setApplyingId(device.tuya_device_id)
    try {
      await updateSensor(device.matched_sensor_id, { local_ip: device.ip, local_key: device.cloud_key })
      showToast(`${device.matched_sensor_name} updated to ${device.ip}`, 'success')
      setDevices((prev) =>
        prev.map((d) => (d.tuya_device_id === device.tuya_device_id ? { ...d, ip_changed: false } : d))
      )
      onSensorUpdated()
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      setApplyingId(null)
    }
  }

  const needsAttention = devices.filter((d) => d.ip_changed).length

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-surface border border-border shadow-xl rounded-xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex justify-between items-center px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            {status === 'running' ? (
              <Wifi size={18} className="text-accent animate-pulse" />
            ) : (
              <CheckCircle2 size={18} className="text-success" />
            )}
            <div>
              <h2 className="text-base font-semibold leading-tight">
                {status === 'running' ? 'Scanning Wi-Fi for devices…' : 'Scan complete'}
              </h2>
              <p className="text-xs text-text-secondary leading-tight">
                {status === 'running'
                  ? `${elapsed}s elapsed — you can close this, the scan keeps running`
                  : `${devices.length} device(s) found${needsAttention ? ` · ${needsAttention} need attention` : ''}`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          <div
            ref={logRef}
            className="rounded-lg border border-border bg-black/90 text-slate-200 font-mono text-xs p-3 h-32 overflow-y-auto"
          >
            {log.map((line, i) => (
              <div key={i} className={line.startsWith('  ') ? 'pl-4 text-slate-400' : ''}>
                {line}
              </div>
            ))}
            {status === 'running' && <div className="text-accent animate-pulse">▍</div>}
          </div>

          <div className="space-y-2">
            {devices.length === 0 && status === 'running' && (
              <p className="text-sm text-text-secondary text-center py-4">Waiting for devices to respond…</p>
            )}
            {devices.length === 0 && status === 'complete' && (
              <p className="text-sm text-text-secondary text-center py-4">No devices responded to the scan.</p>
            )}
            {devices.map((d) => (
              <div
                key={d.tuya_device_id}
                className="rounded-lg border border-border p-3 flex items-center justify-between gap-4 animate-fade-in"
              >
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{d.name || d.tuya_device_id}</div>
                  <div className="text-xs text-text-secondary truncate">
                    {d.ip} · v{d.version}
                    {d.matched_sensor_name && ` · matches "${d.matched_sensor_name}"`}
                  </div>
                </div>
                {!d.matched_sensor_id ? (
                  <span className="text-xs text-text-secondary italic shrink-0">not configured</span>
                ) : d.ip_changed ? (
                  d.cloud_key ? (
                    <button
                      onClick={() => applyFix(d)}
                      disabled={applyingId === d.tuya_device_id}
                      className="flex items-center gap-1.5 bg-accent hover:bg-accent-hover px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 shrink-0"
                    >
                      {applyingId === d.tuya_device_id ? (
                        <RefreshCw size={13} className="animate-spin" />
                      ) : (
                        <Wifi size={13} />
                      )}
                      Apply new IP
                    </button>
                  ) : (
                    <span className="text-xs text-danger shrink-0">no verified key</span>
                  )
                ) : (
                  <span className="flex items-center gap-1 text-xs text-success shrink-0">
                    <CheckCircle2 size={14} /> Up to date
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border shrink-0 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-accent hover:bg-accent-hover"
          >
            {status === 'running' ? 'Run in background' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  )
}
