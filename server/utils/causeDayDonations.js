// The donation fund is filled by games for a cause: on a cause day, a share of each booking's
// money goes to the donation. The share is taken from what was actually collected for those
// bookings (any payment date), the same way Reports counts it, and each booking keeps the share
// it was made under. Staff move a finished cause day's share into the fund; payments collected
// later can be added the same way, so nothing is counted twice or missed.
import { CAUSE_DAYS } from './causeDays.js'

const COLLECTED_STATUSES = ['paid', 'confirmed', 'verified', 'approved', 'succeeded']
const CANCELLED_STATUSES = ['cancelled', 'canceled', 'rejected']
export const CAUSE_DAY_ENTRY = 'cause_day'

const round2 = (value) => Math.round(Number(value || 0) * 100) / 100
const lower = (value) => String(value || '').trim().toLowerCase()

// Pure: one cause day's figures from its bookings and their payments.
export function causeDayFigures(cause, reservations, payments) {
  const percentDefault = Number(cause.donationPercent ?? 100) || 0
  const bookings = reservations.filter((r) => !CANCELLED_STATUSES.includes(lower(r.reservationStatus)))
  const byKey = new Map()
  for (const r of bookings) {
    if (r.id) byKey.set(String(r.id), r)
    if (r._id) byKey.set(String(r._id), r)
  }
  const percentOf = (r) => Number(r?.causeDay?.donationPercent ?? percentDefault) || 0
  let collected = 0
  let donation = 0
  for (const p of payments) {
    const booking = byKey.get(String(p.reservationId || ''))
    if (!booking || !COLLECTED_STATUSES.includes(lower(p.paymentStatus || p.status))) continue
    const amount = Number(p.amount ?? p.totalPHP ?? 0) || 0
    collected += amount
    donation += (amount * percentOf(booking)) / 100
  }
  const expected = bookings.reduce((sum, r) => sum + ((Number(r.totalAmount) || 0) * percentOf(r)) / 100, 0)
  return {
    bookings: bookings.length,
    players: bookings.reduce((sum, r) => sum + (Number(r.numberOfPlayers) || 0), 0),
    collected: round2(collected),
    donation: round2(donation),
    expected: round2(expected),
  }
}

// Every cause day up to `todayISO` (newest first), with what it raised and what's already in the fund.
export async function listCauseDayDonations(db, todayISO) {
  const days = await db.collection(CAUSE_DAYS).find({ active: { $ne: false }, dateISO: { $lte: todayISO } }).sort({ dateISO: -1 }).limit(200).toArray()
  if (!days.length) return []
  const dates = days.map((day) => day.dateISO)
  const reservations = await db.collection('reservations').find({ reservationDate: { $in: dates } }).toArray()
  const keys = reservations.flatMap((r) => [r.id, r._id && String(r._id)].filter(Boolean).map(String))
  const payments = keys.length ? await db.collection('payments').find({ reservationId: { $in: keys } }).toArray() : []
  const added = await db.collection('reach_fund_ledger').aggregate([
    { $match: { type: CAUSE_DAY_ENTRY, periodKey: { $in: dates } } },
    { $group: { _id: '$periodKey', amount: { $sum: '$amount' } } },
  ]).toArray()
  const addedOn = new Map(added.map((row) => [row._id, round2(row.amount)]))
  return days.map((day) => {
    const figures = causeDayFigures(day, reservations.filter((r) => r.reservationDate === day.dateISO), payments)
    const inFund = addedOn.get(day.dateISO) || 0
    return {
      dateISO: day.dateISO,
      title: day.title || 'Game for a cause',
      beneficiary: day.beneficiary || '',
      donationPercent: Number(day.donationPercent ?? 100),
      ...figures,
      added: inFund,
      toAdd: Math.max(0, round2(figures.donation - inFund)),
      // The day must be over before its money goes in, so the games are finished.
      finished: day.dateISO < todayISO,
    }
  })
}
