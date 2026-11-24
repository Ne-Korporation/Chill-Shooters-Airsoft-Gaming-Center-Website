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

// The API answers 403 { suspended: true } once an admin suspends a signed-in player, and
// 401 { sessionEnded: true } when the session was revoked (password reset, role change, deleted
// account, tampered or expired token): end the session and send them to the login page.
function endSuspendedSession(status: number, json: any) {
  const suspended = status === 403 && json?.suspended === true
  const ended = status === 401 && json?.sessionEnded === true
  if (!suspended && !ended) return
  clearStoredSession()
  if (!window.location.pathname.startsWith('/login')) window.location.assign('/login')
}

// What people see when a request fails: the server's own message when it wrote one for people,
// otherwise a plain sentence. Server crashes (a stack or "SomethingError: ...") and missing
// messages never reach the screen as code; they stay in the browser console for debugging.
function friendlyError(json: any, status: number, path: string) {
  const message = String(json?.error || json?.message || '').trim()
  const technical = !message || /^\w*(Error|Exception)\b|^\[object |\bat \S+ \(|Mongo|ECONN|ETIMEDOUT/.test(message)
  if (!technical) return message
  if (message) console.warn(`API ${status} on ${path}: ${message}`)
  if (status === 401) return 'Your session has ended. Please sign in again.'
  if (status === 403) return "You don't have access to this."
  if (status === 404) return "That item couldn't be found. It may have been removed."
  if (status === 413) return 'That file is too large. Choose a smaller one.'
  if (status === 429) return 'Too many tries. Wait a moment and try again.'
  if (status >= 500) return 'Something went wrong on our side. Please try again in a moment.'
  return 'That didn\'t work. Please check what you entered and try again.'
}

// fetch that turns "no connection" into a sentence people understand (fetch itself only says
// "Failed to fetch"). A cancelled request (AbortError) is passed on unchanged.
async function request(path: string, init?: RequestInit) {
  try {
    return await fetch(`${apiBase}${path}`, init)
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err
    console.warn(`Network error on ${path}`, err)
    throw new ApiError("Can't reach the server. Check your internet connection and try again.", 0, null)
  }
}

export function getApiAuthHeaders() {
  return buildHeaders()
}

export async function apiGet<T>(path: string) {
  const res = await request(path, { headers: buildHeaders() })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    endSuspendedSession(res.status, json)
    throw new ApiError(friendlyError(json, res.status, `GET ${path}`), res.status, json)
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
    // The browser logs only "400 (Bad Request)"; this puts the server's reason next to it.
    if (status >= 400) console.warn(`API ${status}: ${message}`)
  }
}

// `signal` lets the caller cancel the request (e.g. a Stop button); fetch then rejects with an AbortError.
export async function apiPost<T>(path: string, body: unknown, options: { signal?: AbortSignal } = {}) {
  const res = await request(path, {
    method: 'POST',
    headers: buildHeaders(true),
    body: JSON.stringify(body),
    signal: options.signal,
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    endSuspendedSession(res.status, json)
    throw new ApiError(friendlyError(json, res.status, `POST ${path}`), res.status, json)
  }
  return json as T
}

export async function apiPut<T>(path: string, body: unknown) {
  const res = await request(path, {
    method: 'PUT',
    headers: buildHeaders(true),
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    endSuspendedSession(res.status, json)
    throw new Error(friendlyError(json, res.status, `PUT ${path}`))
  }
  return json as T
}

export async function apiDelete<T>(path: string) {
  const res = await request(path, {
    method: 'DELETE',
    headers: buildHeaders(),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    endSuspendedSession(res.status, json)
    throw new Error(friendlyError(json, res.status, `DELETE ${path}`))
  }
  return json as T
}
