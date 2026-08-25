import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Wifi, Radio } from 'lucide-react'
import DataTable from '../components/DataTable'
import SensorFormModal from '../components/SensorFormModal'
import MqttSettings from '../components/MqttSettings'
import ScanModal from '../components/ScanModal'
import { getSensors, getRooms, createSensor, updateSensor, deleteSensor, scanDevices, getIrStatus } from '../api/client'
import { useToast } from '../context/ToastContext.jsx'

function LocalIrReplay() {
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    getIrStatus().then(setStatus).catch((e) => setError(e.message))
  }, [])

  return (
    <div className="mb-12">
      <h2 className="text-xl font-bold mb-3">Local IR Replay</h2>
      {error && <div className="mb-3 text-danger text-sm">{error}</div>}
      {status && (
        <div className="flex items-center gap-3 mb-3">
          <Radio size={18} className={status.captured > 0 ? 'text-success' : 'text-text-secondary'} />
          <span className="font-medium">
            {status.captured} of {status.needed} AC setting{status.needed === 1 ? '' : 's'} captured
          </span>
        </div>
      )}
      <p className="text-sm text-text-secondary">
        Every AC command your automations send starts out going through Tuya's cloud endpoint (costs an API
        call each time). Run <code className="font-mono bg-black/5 px-1 rounded">python capture_ir_codes.py</code> on
        the Pi to capture the exact settings you use, point-by-point from the real remote — captured settings
        are then sent locally for free; anything not yet captured keeps using the cloud automatically.
      </p>
    </div>
  )
}

function NetworkScan({ onSensorUpdated }) {
  const [modalOpen, setModalOpen] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState(null)

  const startScan = async () => {
    setStarting(true)
    setError(null)
    try {
      await scanDevices()
    } catch (e) {
      // A scan already running server-side isn't a failure worth blocking on —
      // just reopen the modal to show its live progress.
      if (!e.message.includes('already running')) {
        setError(e.message)
        return
      }
    } finally {
      setStarting(false)
    }
    setModalOpen(true)
  }

  return (
    <div className="mb-12">
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-xl font-bold">Network Scan</h2>
        <button
          onClick={startScan}
          disabled={starting}
          className="flex items-center gap-2 bg-accent hover:bg-accent-hover px-4 py-2 rounded-lg font-medium text-sm disabled:opacity-50"
        >
          <Wifi size={16} />
          {starting ? 'Starting…' : 'Scan Wi-Fi for devices'}
        </button>
      </div>
      <p className="text-sm text-text-secondary mb-4">
        Finds Tuya devices broadcasting on this network right now and checks whether any configured
        sensor's saved IP has drifted (common after a device reconnects to Wi-Fi) — results appear live
        as devices respond.
      </p>

      {error && <div className="mb-4 text-danger text-sm">{error}</div>}

      {modalOpen && (
        <ScanModal onClose={() => setModalOpen(false)} onSensorUpdated={onSensorUpdated} />
      )}
    </div>
  )
}

export default function Settings() {
  const [sensors, setSensors] = useState([])
  const [rooms, setRooms] = useState([])
  const [editing, setEditing] = useState(null) // null = closed, {} = new, sensor = edit existing
  const [loadError, setLoadError] = useState(null)
  const showToast = useToast()

  const refreshSensors = () => {
    getSensors().then(setSensors).catch((e) => setLoadError(e.message))
  }

  useEffect(() => {
    getRooms().then(setRooms).catch((e) => setLoadError(e.message))
    refreshSensors()
  }, [])

  const roomName = (id) => rooms.find((r) => r.id === id)?.name || id

  const handleSave = async (form) => {
    try {
      if (form.id) {
        await updateSensor(form.id, form)
        showToast(`${form.name} updated`, 'success')
      } else {
        await createSensor(form)
        showToast(`${form.name} added`, 'success')
      }
      setEditing(null)
      refreshSensors()
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  const handleDelete = async (id, name) => {
    if (!window.confirm('Delete this sensor?')) return
    try {
      await deleteSensor(id)
      showToast(`${name} deleted`, 'success')
      refreshSensors()
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'type', label: 'Type' },
    { key: 'room_id', label: 'Room', render: (row) => roomName(row.room_id) },
    {
      key: 'tuya_device_id',
      label: 'Tuya Device',
      render: (row) => row.tuya_device_id || <span className="text-text-secondary italic">not linked</span>,
    },
  ]

  return (
    <div className="max-w-6xl mx-auto px-8 py-10">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Settings — Sensors</h1>
        <button
          onClick={() => setEditing({})}
          className="flex items-center gap-2 bg-accent hover:bg-accent-hover px-4 py-2 rounded-lg font-medium text-sm"
        >
          <Plus size={16} /> Add Sensor
        </button>
      </div>

      {loadError && <div className="mb-4 text-danger text-sm">{loadError}</div>}

      <NetworkScan onSensorUpdated={refreshSensors} />
      <LocalIrReplay />

      <DataTable
        columns={columns}
        rows={sensors}
        actions={(row) => (
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(row)} className="text-text-secondary hover:text-accent">
              <Pencil size={16} />
            </button>
            <button onClick={() => handleDelete(row.id, row.name)} className="text-text-secondary hover:text-danger">
              <Trash2 size={16} />
            </button>
          </div>
        )}
      />

      {editing !== null && (
        <SensorFormModal
          sensor={editing.id ? editing : null}
          rooms={rooms}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}

      <h2 className="text-xl font-bold mt-12 mb-4">MQTT</h2>
      <MqttSettings />
    </div>
  )
}
