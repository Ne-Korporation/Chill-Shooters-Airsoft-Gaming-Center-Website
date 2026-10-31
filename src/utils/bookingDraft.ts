import { apiBase, getApiAuthHeaders } from './apiClient'

// An unfinished booking, kept in the browser so a player who leaves mid-booking can come back
// to it. Once they leave, they have DRAFT_GRACE_MS to return (directly, or with "Continue
// booking" on My Reservations); after that the draft is dropped and the server releases the slot.
export const DRAFT_GRACE_MS = 60_000

export type BookingDraft = {
  userId: string
  // Where to send the player back to: the booking steps or the payment page.
  path: '/app/reservations' | '/app/payment'
  savedAtISO: string
  // Set when the player leaves the page; null while they're still on it.
  leftAtISO: string | null
  label: string
  state: Record<string, unknown>
}

const keyFor = (userId: string) => `booking_draft:${userId}`

function read(userId: string): BookingDraft | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(keyFor(userId)) || 'null')
    return parsed && parsed.userId === userId ? (parsed as BookingDraft) : null
  } catch {
    return null
  }
}

// Milliseconds left to come back, or 0 once the draft has expired.
export function draftTimeLeft(draft: BookingDraft, now = Date.now()) {
  const since = Date.parse(draft.leftAtISO || draft.savedAtISO)
  return Number.isFinite(since) ? Math.max(0, since + DRAFT_GRACE_MS - now) : 0
}

// True when a draft is stored, even an expired one (used to tell "expired" from "never left").
export function hasBookingDraft(userId?: string | null) {
  return Boolean(userId && read(userId))
}

// The player's draft if it can still be continued; an expired draft is removed.
export function readBookingDraft(userId?: string | null) {
  if (!userId) return null
  const draft = read(userId)
  if (draft && draftTimeLeft(draft) <= 0) {
    clearBookingDraft(userId)
    return null
  }
  return draft
}

export function saveBookingDraft(userId: string | undefined, draft: Omit<BookingDraft, 'userId' | 'savedAtISO' | 'leftAtISO'>) {
  if (!userId) return
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify({ ...draft, userId, savedAtISO: new Date().toISOString(), leftAtISO: null }))
  } catch {
    // storage full or blocked: the booking still works, it just can't be resumed
  }
}

export function clearBookingDraft(userId?: string | null) {
  if (!userId) return
  try {
    localStorage.removeItem(keyFor(userId))
  } catch {
    // ignore
  }
}

// Pages call scheduleBookingDraftLeft when they unmount and cancelBookingDraftLeft when they
// mount. React's development mode unmounts and remounts every page once on load; the short delay
// lets that remount cancel the "left" before it happens, while a real navigation still counts.
let leaveTimer: number | undefined
export function scheduleBookingDraftLeft(userId?: string | null) {
  window.clearTimeout(leaveTimer)
  leaveTimer = window.setTimeout(() => markBookingDraftLeft(userId), 300)
}
export function cancelBookingDraftLeft() {
  window.clearTimeout(leaveTimer)
}

// Called when the player leaves the booking or payment page: starts the one-minute countdown
// here and on the server's slot hold. keepalive lets the request finish while the tab closes.
export function markBookingDraftLeft(userId?: string | null) {
  if (!userId) return
  const draft = read(userId)
  if (!draft || draft.leftAtISO) return
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify({ ...draft, leftAtISO: new Date().toISOString() }))
  } catch {
    // ignore
  }
  fetch(`${apiBase}/api/slot-holds/mine/leave`, { method: 'POST', headers: getApiAuthHeaders(), keepalive: true }).catch(() => null)
}
