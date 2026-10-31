// REACH net revenue for a month:
//   collected payments (verified, by the day they were verified/paid)
//   − damage and loss penalties billed that month (they reimburse repairs, not revenue)
//   − partner equipment revenue share for games that month
//   − operating expenses recorded for that month
// There are no refunds to subtract: bookings are rescheduled, never refunded.

export const COLLECTED_STATUSES = ['paid', 'confirmed', 'verified', 'approved', 'succeeded']
export const BILLABLE_RESERVATION_STATUSES = ['confirmed', 'completed', 'approved']

const round2 = (value) => Math.round(Number(value || 0) * 100) / 100

export function monthRange(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) return null
  const [year, mon] = month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate()
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, '0')}` }
}

// Manila calendar day of an ISO timestamp.
export function manilaDay(iso) {
  const time = Date.parse(iso || '')
  if (!Number.isFinite(time)) return ''
  return new Date(time + 8 * 3600_000).toISOString().slice(0, 10)
}

export function paymentDay(payment) {
  return manilaDay(payment.verifiedAtISO || payment.paidAtISO || payment.createdAtISO || payment.createdAt)
}

export function isCollected(payment) {
  return COLLECTED_STATUSES.includes(String(payment.paymentStatus || payment.status || '').toLowerCase())
}

// Rental income from partner-owned items on billable reservations dated within [start, end],
// and each partner's share at their revenueSharePercent.
export async function computePartnerIncome(db, start, end) {
  const partners = await db.collection('partnerships').find({}).toArray()
  const partnerKey = (p) => String(p.id || p._id)
  const [weapons, equipment] = await Promise.all([
    db.collection('weapons').find({ partnerId: { $nin: [null, ''] } }).toArray(),
    db.collection('equipments').find({ partnerId: { $nin: [null, ''] } }).toArray(),
  ])
  const partnerItems = new Map()
  for (const item of weapons) partnerItems.set(`weapons:${item.id || item._id}`, item)
  for (const item of equipment) partnerItems.set(`equipments:${item.id || item._id}`, item)

  const reservations = await db.collection('reservations').find({
    reservationStatus: { $in: BILLABLE_RESERVATION_STATUSES },
    reservationDate: { $gte: start, $lte: end },
  }).toArray()

  const byPartner = new Map(partners.map((p) => [partnerKey(p), {
    partnerId: partnerKey(p),
    name: p.name,
    revenueSharePercent: Number(p.revenueSharePercent ?? 0),
    rentalIncome: 0,
    partnerShare: 0,
    rentals: [],
  }]))

  for (const reservation of reservations) {
    for (const requirement of reservation.inventoryRequirements || []) {
      const item = partnerItems.get(`${requirement.collection}:${requirement.itemId}`)
      if (!item) continue
      const entry = byPartner.get(String(item.partnerId))
      if (!entry) continue
      const income = Number(item.price || 0) * Number(requirement.quantity || 0)
      entry.rentalIncome += income
      entry.rentals.push({
        reservationId: String(reservation.id || reservation._id),
        reservationDate: reservation.reservationDate,
        itemName: item.name || requirement.name,
        quantity: Number(requirement.quantity || 0),
        unitPrice: Number(item.price || 0),
        income,
      })
    }
  }

  return Array.from(byPartner.values()).map((entry) => ({
    ...entry,
    rentalIncome: round2(entry.rentalIncome),
    partnerShare: Math.round(entry.rentalIncome * entry.revenueSharePercent) / 100,
    itemCount: [...partnerItems.values()].filter((item) => String(item.partnerId) === entry.partnerId).length,
  }))
}

// Pure calculation, so it can be tested without a database.
export function summarizeNetRevenue({ month, payments, reservations, partnerIncome, expenses, ratePercent, legacyAllocations = [] }) {
  const range = monthRange(month)
  const inMonth = (day) => Boolean(day) && day >= range.start && day <= range.end

  const collectedPayments = payments.filter((p) => isCollected(p) && inMonth(paymentDay(p)))
  const collected = round2(collectedPayments.reduce((sum, p) => sum + Number(p.amount ?? p.totalPHP ?? 0), 0))

  const penalties = round2(reservations.reduce((sum, reservation) =>
    sum + (reservation.damageCharges || [])
      .filter((charge) => inMonth(manilaDay(charge.atISO)))
      .reduce((s, charge) => s + Number(charge.amount || 0), 0), 0))

  const partnerShare = round2(partnerIncome.reduce((sum, entry) => sum + Number(entry.partnerShare || 0), 0))
  const expenseTotal = round2(expenses.filter((e) => inMonth(e.dateISO)).reduce((sum, e) => sum + Number(e.amount || 0), 0))
  const netRevenue = round2(collected - penalties - partnerShare - expenseTotal)

  // Older per-payment allocations for this month's payments are counted against the month.
  const collectedIds = new Set(collectedPayments.map((p) => String(p.id || p._id)))
  const alreadyAllocated = round2(legacyAllocations
    .filter((entry) => collectedIds.has(String(entry.sourcePaymentId)))
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0))

  const rate = Number(ratePercent)
  const fullAllocation = Number.isFinite(rate) && rate > 0 ? Math.round(Math.max(0, netRevenue) * rate) / 100 : 0
  return {
    month,
    range,
    collected,
    paymentCount: collectedPayments.length,
    penalties,
    partnerShare,
    expenses: expenseTotal,
    netRevenue,
    ratePercent: Number.isFinite(rate) ? rate : null,
    alreadyAllocated,
    allocation: round2(Math.max(0, fullAllocation - alreadyAllocated)),
  }
}

export async function computeNetRevenue(db, month, ratePercent) {
  const range = monthRange(month)
  if (!range) throw Object.assign(new Error('month must be YYYY-MM'), { statusCode: 400 })
  const [payments, reservations, partnerIncome, expenses, legacyAllocations] = await Promise.all([
    db.collection('payments').find({}).toArray(),
    db.collection('reservations').find({ 'damageCharges.0': { $exists: true } }, { projection: { damageCharges: 1 } }).toArray(),
    computePartnerIncome(db, range.start, range.end),
    db.collection('operating_expenses').find({ dateISO: { $gte: range.start, $lte: range.end } }).toArray(),
    db.collection('reach_fund_ledger').find({ type: 'allocation', sourcePaymentId: { $exists: true } }).toArray(),
  ])
  return summarizeNetRevenue({ month, payments, reservations, partnerIncome, expenses, ratePercent, legacyAllocations })
}
