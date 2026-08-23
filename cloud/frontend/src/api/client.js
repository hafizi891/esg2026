const BASE = '/api'

async function request(path, options) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Request failed: ${res.status}`)
  }
  if (res.status === 204) return null
  return res.json()
}

export const getSession = () => request('/session')
export const login = (password) => request('/login', { method: 'POST', body: JSON.stringify({ password }) })
export const logout = () => request('/logout', { method: 'POST' })

export const getFloors = () => request('/floors')
export const getDashboard = (floorId) => request(`/dashboard?floor_id=${encodeURIComponent(floorId)}`)

export const getSensors = () => request('/sensors')
export const getRooms = () => request('/rooms')

export const sendIr = (code) => request('/send_ir', { method: 'POST', body: JSON.stringify({ code }) })
export const sendAcCommand = (code, value) => request('/send_ac_command', { method: 'POST', body: JSON.stringify({ code, value }) })
export const getAcStatus = () => request('/ac_status')
export const resyncAcState = (state) => request('/resync_ac_state', { method: 'POST', body: JSON.stringify(state) })

export const toggleSwitch = (value) => request('/toggle_switch', { method: 'POST', body: JSON.stringify({ value }) })
export const getSwitchStatus = () => request('/switch_status')

export const getAutomations = () => request('/automations')

export const getAutomationEvents = (since, limit) => {
  const params = new URLSearchParams()
  if (since) params.set('since', since)
  if (limit) params.set('limit', limit)
  const qs = params.toString()
  return request(`/automation_events${qs ? `?${qs}` : ''}`)
}

export const getMqttConfig = () => request('/mqtt')
export const updateMqttConfig = (config) => request('/mqtt', { method: 'PUT', body: JSON.stringify(config) })

export const getPiStatus = () => request('/pi_status')
