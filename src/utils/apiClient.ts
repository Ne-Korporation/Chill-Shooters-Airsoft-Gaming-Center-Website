import { clearStoredSession, readStoredSessionRaw } from './authStorage'

function normalizeApiBase(value?: string) {
  return value?.trim().replace(/\/+$/, '') || ''
}

export function getApiBase() {
  const configured = normalizeApiBase((import.meta as any).env?.VITE_API_URL)
  if (configured) return configured
  if (import.meta.env.DEV) return 'http://localhost:3001'
  return ''
}

export const apiBase = getApiBase()

function readAuthToken() {
  try {
    const raw = readStoredSessionRaw()
    if (!raw) return ''
    const parsed = JSON.parse(raw)
    return typeof parsed?.token === 'string' ? parsed.token : ''
  } catch {
    return ''
  }
}

function buildHeaders(includeJsonBody = false) {
  const headers: Record<string, string> = {}
  const token = readAuthToken()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  if (includeJsonBody) {
    headers['Content-Type'] = 'application/json'
  }
  return headers
}

// The API answers 403 { suspended: true } once an admin suspends a signed-in player: end the
// session and send them to the login page, which then shows why they can't sign in.
function endSuspendedSession(status: number, json: any) {
  if (status !== 403 || json?.suspended !== true) return
  clearStoredSession()
  if (!window.location.pathname.startsWith('/login')) window.location.assign('/login')
}

export function getApiAuthHeaders() {
  return buildHeaders()
}

export async function apiGet<T>(path: string) {
  const res = await fetch(`${apiBase}${path}`, { headers: buildHeaders() })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    endSuspendedSession(res.status, json)
    throw new Error(json?.error || json?.message || `GET ${path} failed`)
  }
  return json as T
}

export async function apiPost<T>(path: string, body: unknown) {
  const res = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: buildHeaders(true),
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    endSuspendedSession(res.status, json)
    throw new Error(json?.error || json?.message || `POST ${path} failed`)
  }
  return json as T
}

export async function apiPut<T>(path: string, body: unknown) {
  const res = await fetch(`${apiBase}${path}`, {
    method: 'PUT',
    headers: buildHeaders(true),
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    endSuspendedSession(res.status, json)
    throw new Error(json?.error || json?.message || `PUT ${path} failed`)
  }
  return json as T
}

export async function apiDelete<T>(path: string) {
  const res = await fetch(`${apiBase}${path}`, {
    method: 'DELETE',
    headers: buildHeaders(),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    endSuspendedSession(res.status, json)
    throw new Error(json?.error || json?.message || `DELETE ${path} failed`)
  }
  return json as T
}
