export const apiBase = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001'

export async function apiGet<T>(path: string) {
  const res = await fetch(`${apiBase}${path}`)
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(json?.error || json?.message || `GET ${path} failed`)
  }
  return json as T
}

export async function apiPost<T>(path: string, body: unknown) {
  const res = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(json?.error || json?.message || `POST ${path} failed`)
  }
  return json as T
}

export async function apiPut<T>(path: string, body: unknown) {
  const res = await fetch(`${apiBase}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(json?.error || json?.message || `PUT ${path} failed`)
  }
  return json as T
}

export async function apiDelete<T>(path: string) {
  const res = await fetch(`${apiBase}${path}`, {
    method: 'DELETE',
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(json?.error || json?.message || `DELETE ${path} failed`)
  }
  return json as T
}

