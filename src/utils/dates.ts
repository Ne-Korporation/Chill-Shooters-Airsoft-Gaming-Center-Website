// One date-and-time format for the whole app, always in Manila time ("Nov 24, 2026, 6:32 PM"),
// so staff and players read the same thing whatever their device's language or time zone.
const DATE_TIME = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })

export function formatDateTime(iso?: string | null, fallback = '—') {
  if (!iso) return fallback
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? String(iso) : DATE_TIME.format(date)
}
