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

export const getAcStatus = () => request('/ac_status')

export const getMqttConfig = () => request('/mqtt')

export const getEsgAnalytics = (days = 7) => request(`/esg_analytics?days=${encodeURIComponent(days)}`)
