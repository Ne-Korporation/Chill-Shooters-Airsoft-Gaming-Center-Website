// How far ahead players can book, and the reschedule rules: once per booking, to a date up to
// RESCHEDULE_WINDOW_DAYS after the original date. The server enforces the same limits
// (server/routes/crud.js).
export const BOOKING_WINDOW_DAYS = 365
export const RESCHEDULE_WINDOW_DAYS = 60
export const PLAYER_RESCHEDULES_ALLOWED = 1

type RescheduleEvent = { actorRole?: string; sentBack?: boolean; reason?: string }

// Reschedules the player chose themselves. Staff moves, and the new date picked after staff sent a
// booking back, don't count against the one allowed. Matches playerRescheduleCount on the server.
export function playerRescheduleCount(history: RescheduleEvent[] | undefined) {
  return (history || []).filter((event) =>
    event?.actorRole === 'user'
    && !event.sentBack
    && !String(event.reason || '').startsWith('New date chosen after staff sent it back')).length
}

// The last date a booking on `originalDateISO` can move to: 60 days after it, within the booking window.
export function lastRescheduleDateISO(originalDateISO: string, todayISO: string) {
  const byOriginal = addDaysISO(originalDateISO, RESCHEDULE_WINDOW_DAYS)
  const byWindow = addDaysISO(todayISO, BOOKING_WINDOW_DAYS)
  return byOriginal < byWindow ? byOriginal : byWindow
}

// "2026-11-20" + 60 days → "2027-01-19" (calendar dates, no time zone shifts).
export function addDaysISO(dateISO: string, days: number) {
  const date = new Date(`${dateISO}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

// Whole months from one "YYYY-MM-DD" date's month to another's (Nov → Dec = 1).
export function monthsBetween(fromISO: string, toISO: string) {
  return (Number(toISO.slice(0, 4)) - Number(fromISO.slice(0, 4))) * 12 + Number(toISO.slice(5, 7)) - Number(fromISO.slice(5, 7))
}
