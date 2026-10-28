// Remembered sessions live in localStorage (survive browser restarts); regular sessions live in
// sessionStorage so they end when the browser is closed.
export const AUTH_STORAGE_KEY = 'aim-book-play.auth'

export function readStoredSessionRaw() {
  try {
    return localStorage.getItem(AUTH_STORAGE_KEY) || sessionStorage.getItem(AUTH_STORAGE_KEY)
  } catch {
    return null
  }
}

export function writeStoredSession(value: unknown, remember: boolean) {
  try {
    const raw = JSON.stringify(value)
    if (remember) {
      localStorage.setItem(AUTH_STORAGE_KEY, raw)
      sessionStorage.removeItem(AUTH_STORAGE_KEY)
    } else {
      sessionStorage.setItem(AUTH_STORAGE_KEY, raw)
      localStorage.removeItem(AUTH_STORAGE_KEY)
    }
  } catch {
    // Storage can be unavailable (private mode); the in-memory session still works.
  }
}

export function clearStoredSession() {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY)
    sessionStorage.removeItem(AUTH_STORAGE_KEY)
  } catch {
    // ignore
  }
}

// Reads the exp claim from our HMAC token (base64url JSON payload before the dot).
export function getTokenExpiry(token: string) {
  try {
    const body = token.split('.')[0]
    const json = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')))
    const exp = Number(json?.exp)
    return Number.isFinite(exp) ? exp : null
  } catch {
    return null
  }
}
