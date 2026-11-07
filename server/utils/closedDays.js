// "No game" days: dates the admin closes on the capacity calendar (holiday, field maintenance,
// private event, ...). Nobody can book, hold, or reschedule onto a closed day. One record per
// date in `closed_days`; reopening a day only marks it inactive, so the history stays on file.

export const CLOSED_DAYS = 'closed_days'

export function cleanClosedDay(body = {}) {
  const reason = String(body.reason || '').replace(/\s+/g, ' ').trim().slice(0, 200)
  return { value: { reason } }
}

export function closedDayView(doc) {
  return { dateISO: doc.dateISO, reason: doc.reason || '' }
}

export async function listClosedDays(db, { from, to } = {}) {
  const filter = { active: { $ne: false } }
  if (from || to) filter.dateISO = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) }
  const docs = await db.collection(CLOSED_DAYS).find(filter).sort({ dateISO: 1 }).limit(400).toArray()
  return docs.map(closedDayView)
}

// The active closed-day record for a date, or null.
export async function findClosedDay(db, dateISO) {
  const doc = await db.collection(CLOSED_DAYS).findOne({ dateISO: String(dateISO || ''), active: { $ne: false } })
  return doc ? closedDayView(doc) : null
}

export function closedDayError(closed) {
  return `There are no games on ${closed.dateISO}${closed.reason ? ` (${closed.reason})` : ''}. Please pick another day.`
}
