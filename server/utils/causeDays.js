// "Game for a cause" days: dates the admin marks on the capacity calendar where a share of the
// booking money for games that day is reserved for a donation. One record per date in
// `cause_days`; removing one only marks it inactive, so past donation records stay on file.

export const CAUSE_DAYS = 'cause_days'
export const DEFAULT_DONATION_PERCENT = 100

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isDateISO(value) {
  return DATE_RE.test(String(value || '')) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

// Validates and cleans what the admin sent. Returns { error } or { value }.
export function cleanCauseDay(body = {}) {
  const title = String(body.title || '').replace(/\s+/g, ' ').trim().slice(0, 80)
  const description = String(body.description || '').trim().slice(0, 500)
  const beneficiary = String(body.beneficiary || '').replace(/\s+/g, ' ').trim().slice(0, 120)
  const percent = body.donationPercent === undefined || body.donationPercent === '' ? DEFAULT_DONATION_PERCENT : Number(body.donationPercent)
  if (!title) return { error: 'Give the cause a name.' }
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return { error: 'The donation share must be between 1% and 100%.' }
  return { value: { title, description, beneficiary, donationPercent: Math.round(percent * 100) / 100 } }
}

// The public view of a cause day.
export function causeDayView(doc) {
  return {
    dateISO: doc.dateISO,
    title: doc.title || 'Game for a cause',
    description: doc.description || '',
    beneficiary: doc.beneficiary || '',
    donationPercent: Number(doc.donationPercent ?? DEFAULT_DONATION_PERCENT),
  }
}

export async function listActiveCauseDays(db, { from, to } = {}) {
  const filter = { active: { $ne: false } }
  if (from || to) filter.dateISO = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) }
  const docs = await db.collection(CAUSE_DAYS).find(filter).sort({ dateISO: 1 }).limit(400).toArray()
  return docs.map(causeDayView)
}

// Every Saturday and Sunday (public game days) in a YYYY-MM month.
export function weekendDatesInMonth(month) {
  const [year, mon] = String(month).split('-').map(Number)
  const days = new Date(Date.UTC(year, mon, 0)).getUTCDate()
  const dates = []
  for (let day = 1; day <= days; day += 1) {
    const date = new Date(Date.UTC(year, mon - 1, day))
    if ([0, 6].includes(date.getUTCDay())) dates.push(date.toISOString().slice(0, 10))
  }
  return dates
}
