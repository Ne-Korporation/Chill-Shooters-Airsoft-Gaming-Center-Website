import { clearStoredSession, readStoredSessionRaw } from './authStorage'

function normalizeApiBase(value?: string) {
  return value?.trim().replace(/\/+$/, '') || ''
}

export function getApiBase() {
  const configured = normalizeApiBase((import.meta as any).env?.VITE_API_URL)
  // Without VITE_API_URL, calls go to /api on the site's own address (in dev, the Vite proxy
  // forwards them to the API server on port 3001; see vite.config.ts).
  if (configured) return configured
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
    throw new ApiError(json?.error || json?.message || `GET ${path} failed`, res.status, json)
  }
  return json as T
}

// Reads every document of a collection, 200 at a time, so lists are filtered over all records
// rather than only the first page the API returns. `query` is extra query-string, e.g. "q=...".
export async function apiGetAll<T>(collection: string, query = ''): Promise<T[]> {
  const PAGE = 200
  const all: T[] = []
  for (let skip = 0; ; skip += PAGE) {
    const res = await apiGet<{ ok: boolean; data: T[] }>(`/api/${collection}?limit=${PAGE}&skip=${skip}${query ? `&${query}` : ''}`)
    const page = Array.isArray(res?.data) ? res.data : []
    all.push(...page)
    if (page.length < PAGE) return all
  }
}

// A failed request, keeping the status and the response body so callers can react to flags
// the API sends with an error (e.g. { emailExists: true }).
export class ApiError extends Error {
  status: number
  body: any
  constructor(message: string, status: number, body: any) {
    super(message)
    this.status = status
    this.body = body
  }
}

// `signal` lets the caller cancel the request (e.g. a Stop button); fetch then rejects with an AbortError.
export async function apiPost<T>(path: string, body: unknown, options: { signal?: AbortSignal } = {}) {
  const res = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: buildHeaders(true),
    body: JSON.stringify(body),
    signal: options.signal,
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    endSuspendedSession(res.status, json)
    throw new ApiError(json?.error || json?.message || `POST ${path} failed`, res.status, json)
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
