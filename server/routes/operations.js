import express from 'express'
import { ObjectId } from 'mongodb'
import { getDb, startDbSession } from '../db/mongo.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { nextShortId } from '../utils/shortIds.js'
import { emailDamageCharge } from '../services/notificationEmails.js'
import { listDiscountInstitutions } from '../utils/bookingPricing.js'
import { PENALTY_RULES_ID, computePenalty, getPenaltyRules, resolvePenaltyCharge } from '../utils/penaltyRules.js'
import { computeNetRevenue, computePartnerIncome } from '../utils/reachNetRevenue.js'

// Field-operations records that don't fit the generic CRUD routes: chronograph
// (FPS) safety logs, damage reports and penalty billing, the REACH outreach fund
// ledger, and partner-equipment income sharing.
const router = express.Router()

const STAFF = ['admin', 'registrar', 'marshal']
// Status each inventory page treats as its maintenance queue.
const MAINTENANCE_STATUS = { weapons: 'needs-check', equipments: 'maintenance' }

function money(value) {
  const amount = Math.round(Number(value) * 100) / 100
  return Number.isFinite(amount) ? amount : NaN
}

async function findById(db, collection, rawId) {
  const id = String(rawId || '').trim()
  if (!id) return null
  const byId = await db.collection(collection).findOne({ id })
  if (byId) return byId
  return ObjectId.isValid(id) ? db.collection(collection).findOne({ _id: new ObjectId(id) }) : null
}

function actorOf(req) {
  return { actorId: String(req.user?.id || ''), actorEmail: req.user?.email || '', actorRole: req.user?.role || '' }
}

function listLimit(req) {
  return Math.min(Math.max(Number(req.query.limit) || 200, 1), 500)
}

// ---------------------------------------------------------------------------
// FPS safety logs
// ---------------------------------------------------------------------------

export function getFpsLimits(env = process.env) {
  const aeg = Number(env.FPS_LIMIT_AEG || 450)
  const sniper = Number(env.FPS_LIMIT_SNIPER || 550)
  return { aeg: Number.isFinite(aeg) && aeg > 0 ? aeg : 450, sniper: Number.isFinite(sniper) && sniper > 0 ? sniper : 550 }
}

// A weapon's own fpsLimit, when set on its record, overrides its class limit.
export function evaluateFpsReading(weaponClass, fps, limits = getFpsLimits(), weaponLimit = 0) {
  const limit = Number(weaponLimit) > 0 ? Number(weaponLimit) : weaponClass === 'sniper' ? limits.sniper : limits.aeg
  return { limit, result: fps <= limit ? 'pass' : 'fail' }
}

export function weaponFpsClass(weapon) {
  const recorded = String(weapon?.fpsClass || '').toLowerCase()
  if (['aeg', 'sniper'].includes(recorded)) return recorded
  return String(weapon?.category || '').toLowerCase().startsWith('sniper') ? 'sniper' : 'aeg'
}

router.get('/fps-logs', requireAuth, requireRole(...STAFF), async (req, res) => {
  try {
    const db = await getDb()
    const data = await db.collection('fps_logs').find({}).sort({ testedAtISO: -1 }).limit(listLimit(req)).toArray()
    return res.json({ ok: true, data, limits: getFpsLimits() })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

router.post('/fps-logs', requireAuth, requireRole('admin', 'marshal'), async (req, res) => {
  const body = req.body || {}
  let weaponClass = String(body.weaponClass || '').toLowerCase()
  const fps = Number(body.fps)
  if (!['aeg', 'sniper'].includes(weaponClass) && !body.weaponId) {
    return res.status(400).json({ ok: false, error: 'weaponClass must be aeg or sniper' })
  }
  if (!Number.isFinite(fps) || fps <= 0 || fps > 1500) {
    return res.status(400).json({ ok: false, error: 'Enter the chronograph reading in FPS (1–1500).' })
  }

  try {
    const db = await getDb()
    const weapon = body.weaponId ? await findById(db, 'weapons', body.weaponId) : null
    if (body.weaponId && !weapon) return res.status(404).json({ ok: false, error: 'Weapon not found' })
    const weaponName = String(weapon?.name || body.weaponName || '').trim().slice(0, 120)
    if (!weaponName) return res.status(400).json({ ok: false, error: 'Choose a weapon or enter its name.' })

    // Center weapons are tested against their recorded classification and limit.
    if (weapon) weaponClass = weaponFpsClass(weapon)
    const { limit, result } = evaluateFpsReading(weaponClass, fps, getFpsLimits(), weapon?.fpsLimit)
    const nowISO = new Date().toISOString()
    const doc = {
      id: await nextShortId(db, 'fps_logs', 'FPS'),
      weaponId: weapon ? String(weapon.id || weapon._id) : '',
      weaponName,
      weaponClass,
      fps,
      limit,
      result,
      playerName: String(body.playerName || '').trim().slice(0, 120),
      gameplayId: String(body.gameplayId || '').trim(),
      notes: String(body.notes || '').trim().slice(0, 500),
      testedAtISO: nowISO,
      testedBy: actorOf(req),
    }
    await db.collection('fps_logs').insertOne(doc)

    // A center weapon that shoots over the limit is pulled from rental until fixed.
    let weaponPulled = false
    if (result === 'fail' && weapon) {
      await db.collection('weapons').updateOne(
        { _id: weapon._id },
        { $set: { status: MAINTENANCE_STATUS.weapons, maintenanceReason: `Failed chronograph: ${fps} FPS (limit ${limit})`, updatedAtISO: nowISO } },
      )
      weaponPulled = true
    }

    return res.status(201).json({ ok: true, data: doc, weaponPulled })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// ---------------------------------------------------------------------------
// Damage reports and penalty billing
// ---------------------------------------------------------------------------

router.get('/damage-reports', requireAuth, requireRole(...STAFF), async (req, res) => {
  try {
    const db = await getDb()
    const data = await db.collection('damage_reports').find({}).sort({ reportedAtISO: -1 }).limit(listLimit(req)).toArray()
    return res.json({ ok: true, data })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// GET/PUT /api/penalty-rules — the handling fee added to repair costs for damage penalties.
router.get('/penalty-rules', requireAuth, requireRole(...STAFF), async (_req, res) => {
  try {
    const db = await getDb()
    return res.json({ ok: true, data: await getPenaltyRules(db) })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

router.put('/penalty-rules', requireAuth, requireRole('admin'), async (req, res) => {
  const handlingFeePercent = Number(req.body?.handlingFeePercent)
  if (!Number.isFinite(handlingFeePercent) || handlingFeePercent < 0 || handlingFeePercent > 100) {
    return res.status(400).json({ ok: false, error: 'handlingFeePercent must be between 0 and 100' })
  }
  try {
    const db = await getDb()
    const nowISO = new Date().toISOString()
    const previous = await getPenaltyRules(db)
    await db.collection('settings').updateOne(
      { _id: PENALTY_RULES_ID },
      {
        $set: { handlingFeePercent, updatedAtISO: nowISO, updatedBy: actorOf(req) },
        $push: { history: { from: previous.handlingFeePercent, to: handlingFeePercent, atISO: nowISO, ...actorOf(req) } },
      },
      { upsert: true },
    )
    return res.json({ ok: true, data: await getPenaltyRules(db) })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// The penalty the rules give for a report: replacement value for a loss, or the completed
// linked repair's cost plus the handling fee for damage.
async function quoteReportPenalty(db, report, session) {
  const collection = report.itemType === 'weapon' ? 'weapons' : 'equipments'
  const item = report.itemId ? await findById(db, collection, report.itemId) : null
  const repair = await db.collection('repairs').findOne(
    { damageReportId: report.id, status: 'completed' },
    session ? { session, sort: { completedAtISO: -1 } } : { sort: { completedAtISO: -1 } },
  )
  const rules = await getPenaltyRules(db)
  const computed = computePenalty({
    kind: report.kind === 'loss' ? 'loss' : 'damage',
    item,
    repairCost: repair ? repair.totalCost : undefined,
    rules,
  })
  return { ...computed, repairId: repair?.id || '', handlingFeePercent: rules.handlingFeePercent }
}

router.get('/damage-reports/:id/penalty-quote', requireAuth, requireRole(...STAFF), async (req, res) => {
  try {
    const db = await getDb()
    const report = await db.collection('damage_reports').findOne({ id: String(req.params.id) })
    if (!report) return res.status(404).json({ ok: false, error: 'Damage report not found' })
    return res.json({ ok: true, data: await quoteReportPenalty(db, report) })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

router.post('/damage-reports', requireAuth, requireRole('admin', 'marshal'), async (req, res) => {
  const body = req.body || {}
  const itemType = String(body.itemType || '').toLowerCase()
  if (!['weapon', 'equipment'].includes(itemType)) {
    return res.status(400).json({ ok: false, error: 'itemType must be weapon or equipment' })
  }
  const kind = String(body.kind || 'damage').toLowerCase()
  if (!['damage', 'loss'].includes(kind)) return res.status(400).json({ ok: false, error: 'kind must be damage or loss' })
  const description = String(body.description || '').trim().slice(0, 1000)
  if (!description) return res.status(400).json({ ok: false, error: kind === 'loss' ? 'Describe how the item was lost.' : 'Describe the damage.' })

  try {
    const db = await getDb()
    const collection = itemType === 'weapon' ? 'weapons' : 'equipments'
    const item = body.itemId ? await findById(db, collection, body.itemId) : null
    if (body.itemId && !item) return res.status(404).json({ ok: false, error: 'Item not found' })
    const itemName = String(item?.name || body.itemName || '').trim().slice(0, 120)
    if (!itemName) return res.status(400).json({ ok: false, error: 'Choose the damaged item or enter its name.' })

    const reservation = body.reservationId ? await findById(db, 'reservations', body.reservationId) : null
    if (body.reservationId && !reservation) return res.status(404).json({ ok: false, error: 'Reservation not found' })

    const nowISO = new Date().toISOString()
    const doc = {
      id: await nextShortId(db, 'damage_reports', 'DMG'),
      itemType,
      kind,
      itemId: item ? String(item.id || item._id) : '',
      itemName,
      reservationId: reservation ? String(reservation.id || reservation._id) : '',
      playerId: reservation ? String(reservation.userId || '') : '',
      playerName: String(body.playerName || '').trim().slice(0, 120),
      description,
      evidenceUrl: String(body.evidenceUrl || '').trim().slice(0, 500),
      status: 'reported',
      chargeAmount: 0,
      reportedAtISO: nowISO,
      reportedBy: actorOf(req),
    }
    await db.collection('damage_reports').insertOne(doc)

    if (item && body.sendToMaintenance !== false) {
      await db.collection(collection).updateOne(
        { _id: item._id },
        { $set: { status: MAINTENANCE_STATUS[collection], maintenanceReason: kind === 'loss' ? `Reported lost (${doc.id})` : `Damage report ${doc.id}`, updatedAtISO: nowISO } },
      )
    }

    return res.status(201).json({ ok: true, data: doc })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// PUT /api/damage-reports/:id/review { decision: 'bill' | 'waive', chargeAmount?, overrideReason?, note }
// Only an admin can attach a charge; it is added to the linked reservation's balance. The amount
// comes from the penalty rules; billing a different amount needs an override reason.
router.put('/damage-reports/:id/review', requireAuth, requireRole('admin'), async (req, res) => {
  const body = req.body || {}
  const decision = String(body.decision || '').toLowerCase()
  if (!['bill', 'waive'].includes(decision)) {
    return res.status(400).json({ ok: false, error: 'decision must be bill or waive' })
  }
  const note = String(body.note || '').trim().slice(0, 500)
  const overrideReason = String(body.overrideReason || '').trim().slice(0, 500)

  const db = await getDb()
  const session = startDbSession()
  try {
    let updated
    await session.withTransaction(async () => {
      const report = await db.collection('damage_reports').findOne({ id: String(req.params.id) }, { session })
      if (!report) throw Object.assign(new Error('Damage report not found'), { statusCode: 404 })
      if (report.status !== 'reported') {
        throw Object.assign(new Error(`This report was already ${report.status}.`), { statusCode: 409 })
      }
      if (decision === 'bill' && !report.reservationId) {
        throw Object.assign(new Error('Link the report to a reservation before billing a charge.'), { statusCode: 400 })
      }

      const nowISO = new Date().toISOString()
      let chargeAmount = 0
      let penalty = null
      if (decision === 'bill') {
        const computed = await quoteReportPenalty(db, report, session)
        const resolved = resolvePenaltyCharge(computed, { requestedAmount: body.chargeAmount, overrideReason })
        if (resolved.error) throw Object.assign(new Error(resolved.error), { statusCode: 400 })
        chargeAmount = resolved.amount
        penalty = {
          basis: computed.basis,
          computedAmount: computed.amount,
          lines: computed.lines || [],
          repairId: computed.repairId,
          overridden: resolved.overridden,
          overrideReason: resolved.overridden ? resolved.overrideReason : '',
        }
        const label = report.kind === 'loss' ? `Loss penalty: ${report.itemName}` : `Damage penalty: ${report.itemName}`
        const result = await db.collection('reservations').updateOne(
          { $or: [{ id: report.reservationId }, ...(ObjectId.isValid(report.reservationId) ? [{ _id: new ObjectId(report.reservationId) }] : [])] },
          {
            $inc: { totalAmount: chargeAmount, balanceAmount: chargeAmount, damageChargesTotal: chargeAmount },
            $push: {
              pricingBreakdown: { label, amount: chargeAmount },
              damageCharges: { reportId: report.id, kind: report.kind || 'damage', itemName: report.itemName, amount: chargeAmount, penalty, approvedBy: actorOf(req), atISO: nowISO },
            },
            $set: { updatedAtISO: nowISO },
          },
          { session },
        )
        if (result.matchedCount === 0) throw Object.assign(new Error('Linked reservation not found'), { statusCode: 404 })
      }

      updated = await db.collection('damage_reports').findOneAndUpdate(
        { _id: report._id, status: 'reported' },
        {
          $set: {
            status: decision === 'bill' ? 'billed' : 'waived',
            chargeAmount,
            ...(penalty ? { penalty } : {}),
            reviewNote: note,
            reviewedAtISO: nowISO,
            reviewedBy: actorOf(req),
          },
        },
        { session, returnDocument: 'after' },
      )
    })
    if (updated?.status === 'billed') {
      const reservation = await findById(db, 'reservations', updated.reservationId)
      void emailDamageCharge(db, reservation, updated)
    }
    return res.json({ ok: true, data: updated })
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ ok: false, error: err.message })
    return res.status(500).json({ ok: false, error: String(err) })
  } finally {
    await session.endSession()
  }
})

// ---------------------------------------------------------------------------
// REACH community outreach fund
// Kept in its own ledger so outreach money is never mixed into operating
// revenue: allocations from collected payments, outside donations, and
// spending are separate auditable entries.
// ---------------------------------------------------------------------------

const REACH_SETTINGS_ID = 'reach_fund'

async function reachSummary(db) {
  const settings = await db.collection('settings').findOne({ _id: REACH_SETTINGS_ID })
  const totals = await db.collection('reach_fund_ledger').aggregate([
    { $group: { _id: '$type', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
  ]).toArray()
  const sum = (type) => Number(totals.find((t) => t._id === type)?.amount || 0)
  const allocated = sum('allocation')
  const donations = sum('donation')
  const spent = sum('expenditure')
  return {
    ratePercent: settings?.ratePercent ?? null,
    rateUpdatedAtISO: settings?.updatedAtISO || null,
    allocated,
    donations,
    spent,
    balance: Math.round((allocated + donations - spent) * 100) / 100,
  }
}

router.get('/reach-fund', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const db = await getDb()
    const entries = await db.collection('reach_fund_ledger').find({}).sort({ atISO: -1 }).limit(listLimit(req)).toArray()
    return res.json({ ok: true, summary: await reachSummary(db), data: entries })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

router.put('/reach-fund/settings', requireAuth, requireRole('admin'), async (req, res) => {
  const ratePercent = Number(req.body?.ratePercent)
  if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) {
    return res.status(400).json({ ok: false, error: 'ratePercent must be between 0 and 100' })
  }
  try {
    const db = await getDb()
    const nowISO = new Date().toISOString()
    await db.collection('settings').updateOne(
      { _id: REACH_SETTINGS_ID },
      { $set: { ratePercent, updatedAtISO: nowISO, updatedBy: actorOf(req) } },
      { upsert: true },
    )
    return res.json({ ok: true, summary: await reachSummary(db) })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

function manilaMonth(offset = 0) {
  const now = new Date(Date.now() + 8 * 3600_000)
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1))
  return date.toISOString().slice(0, 7)
}

// GET /api/reach-fund/net-revenue?month=YYYY-MM — the month's net revenue breakdown and the
// allocation the configured rate gives.
router.get('/reach-fund/net-revenue', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const db = await getDb()
    const settings = await db.collection('settings').findOne({ _id: REACH_SETTINGS_ID })
    const month = String(req.query.month || manilaMonth(-1))
    const data = await computeNetRevenue(db, month, settings?.ratePercent)
    const existing = await db.collection('reach_fund_ledger').findOne({ type: 'allocation', periodKey: month })
    return res.json({ ok: true, data: { ...data, allocatedEntry: existing || null, canAllocate: month < manilaMonth(0) && !existing } })
  } catch (err) {
    return res.status(err?.statusCode || 500).json({ ok: false, error: err?.statusCode ? err.message : String(err) })
  }
})

// POST /api/reach-fund/allocate { month: 'YYYY-MM' } — allocates the configured share of a
// finished month's net revenue. One allocation per month (unique periodKey).
router.post('/reach-fund/allocate', requireAuth, requireRole('admin'), async (req, res) => {
  const month = String(req.body?.month || '')
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ ok: false, error: 'Choose a month (YYYY-MM).' })
  if (month >= manilaMonth(0)) return res.status(400).json({ ok: false, error: 'Only a finished month can be allocated, so its revenue and expenses are final.' })
  try {
    const db = await getDb()
    const settings = await db.collection('settings').findOne({ _id: REACH_SETTINGS_ID })
    const ratePercent = Number(settings?.ratePercent)
    if (!Number.isFinite(ratePercent) || ratePercent <= 0) {
      return res.status(400).json({ ok: false, error: 'Set the REACH allocation rate before allocating.' })
    }

    const ledger = db.collection('reach_fund_ledger')
    // The old per-payment index would reject every allocation without a sourcePaymentId.
    await ledger.dropIndex('sourcePaymentId_1').catch(() => null)
    await ledger.createIndex(
      { periodKey: 1 },
      { unique: true, partialFilterExpression: { type: 'allocation', periodKey: { $exists: true } } },
    )
    if (await ledger.findOne({ type: 'allocation', periodKey: month })) {
      return res.status(409).json({ ok: false, error: `${month} was already allocated.` })
    }

    const breakdown = await computeNetRevenue(db, month, ratePercent)
    if (!(breakdown.allocation > 0)) {
      return res.status(400).json({ ok: false, error: `${month} has no positive net revenue to allocate (net ₱${breakdown.netRevenue.toLocaleString()}).` })
    }
    const entry = {
      type: 'allocation',
      periodKey: month,
      amount: breakdown.allocation,
      ratePercent,
      netRevenue: breakdown,
      description: `${ratePercent}% of ${month} net revenue (₱${breakdown.netRevenue.toLocaleString()})`,
      dateISO: breakdown.range.end,
      atISO: new Date().toISOString(),
      recordedBy: actorOf(req),
    }
    try {
      await ledger.insertOne(entry)
    } catch (err) {
      if (err?.code === 11000) return res.status(409).json({ ok: false, error: `${month} was already allocated.` })
      throw err
    }
    return res.json({ ok: true, data: entry, summary: await reachSummary(db) })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// ---------------------------------------------------------------------------
// Operating expenses — subtracted from revenue for the REACH net revenue.
// A month's expenses lock once that month is allocated.
// ---------------------------------------------------------------------------

export const EXPENSE_CATEGORIES = ['repairs_parts', 'supplies', 'utilities', 'rent', 'salaries', 'marketing', 'other']

async function isMonthAllocated(db, dateISO) {
  return Boolean(await db.collection('reach_fund_ledger').findOne({ type: 'allocation', periodKey: String(dateISO).slice(0, 7) }))
}

router.get('/operating-expenses', requireAuth, requireRole('admin'), async (req, res) => {
  const month = String(req.query.month || '')
  try {
    const db = await getDb()
    const filter = /^\d{4}-\d{2}$/.test(month) ? { dateISO: { $regex: `^${month}-` } } : {}
    const data = await db.collection('operating_expenses').find(filter).sort({ dateISO: -1, atISO: -1 }).limit(listLimit(req)).toArray()
    return res.json({ ok: true, data, categories: EXPENSE_CATEGORIES })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

router.post('/operating-expenses', requireAuth, requireRole('admin'), async (req, res) => {
  const body = req.body || {}
  const amount = money(body.amount)
  const dateISO = String(body.dateISO || '')
  const category = String(body.category || '')
  const description = String(body.description || '').trim().slice(0, 500)
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ ok: false, error: 'Enter a positive amount.' })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return res.status(400).json({ ok: false, error: 'Enter the expense date.' })
  if (!EXPENSE_CATEGORIES.includes(category)) return res.status(400).json({ ok: false, error: 'Choose a category.' })
  if (!description) return res.status(400).json({ ok: false, error: 'Describe the expense.' })
  try {
    const db = await getDb()
    if (await isMonthAllocated(db, dateISO)) {
      return res.status(409).json({ ok: false, error: `${dateISO.slice(0, 7)} was already allocated to REACH, so its expenses are locked.` })
    }
    const doc = {
      id: await nextShortId(db, 'operating_expenses', 'EXP'),
      dateISO,
      category,
      amount,
      description,
      vendor: String(body.vendor || '').trim().slice(0, 120),
      receiptUrl: /^https:\/\//.test(String(body.receiptUrl || '')) ? String(body.receiptUrl).slice(0, 500) : '',
      atISO: new Date().toISOString(),
      recordedBy: actorOf(req),
    }
    await db.collection('operating_expenses').insertOne(doc)
    return res.status(201).json({ ok: true, data: doc })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

router.delete('/operating-expenses/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const db = await getDb()
    const expense = await db.collection('operating_expenses').findOne({ id: String(req.params.id) })
    if (!expense) return res.status(404).json({ ok: false, error: 'Expense not found' })
    if (await isMonthAllocated(db, expense.dateISO)) {
      return res.status(409).json({ ok: false, error: `${expense.dateISO.slice(0, 7)} was already allocated to REACH, so its expenses are locked.` })
    }
    await db.collection('operating_expenses').deleteOne({ _id: expense._id })
    return res.json({ ok: true })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// ---------------------------------------------------------------------------
// REACH outreach programs — the community activities the fund pays for:
// when and where, who benefited, and the expenditures linked to each.
// ---------------------------------------------------------------------------

const PROGRAM_STATUSES = ['planned', 'completed', 'cancelled']

function readProgram(body) {
  const title = String(body.title || '').trim().slice(0, 160)
  const dateISO = String(body.dateISO || '')
  const status = String(body.status || 'planned').toLowerCase()
  if (!title) return { error: 'Enter the program name.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return { error: 'Enter the program date.' }
  if (!PROGRAM_STATUSES.includes(status)) return { error: 'status must be planned, completed, or cancelled' }
  const participants = Math.max(0, Math.round(Number(body.participants) || 0))
  return {
    fields: {
      title,
      dateISO,
      status,
      venue: String(body.venue || '').trim().slice(0, 200),
      beneficiaries: String(body.beneficiaries || '').trim().slice(0, 300),
      participants,
      partnerOrganization: String(body.partnerOrganization || '').trim().slice(0, 160),
      description: String(body.description || '').trim().slice(0, 2000),
      photoUrls: (Array.isArray(body.photoUrls) ? body.photoUrls : [])
        .map(String).filter((url) => /^https:\/\//.test(url)).slice(0, 10),
    },
  }
}

router.get('/reach-programs', requireAuth, requireRole('admin'), async (_req, res) => {
  try {
    const db = await getDb()
    const [programs, spending] = await Promise.all([
      db.collection('reach_programs').find({}).sort({ dateISO: -1 }).limit(200).toArray(),
      db.collection('reach_fund_ledger').aggregate([
        { $match: { type: 'expenditure', programId: { $nin: [null, ''] } } },
        { $group: { _id: '$programId', amount: { $sum: '$amount' } } },
      ]).toArray(),
    ])
    const spentBy = new Map(spending.map((row) => [row._id, Math.round(row.amount * 100) / 100]))
    return res.json({ ok: true, data: programs.map((p) => ({ ...p, spent: spentBy.get(p.id) || 0 })) })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

router.post('/reach-programs', requireAuth, requireRole('admin'), async (req, res) => {
  const parsed = readProgram(req.body || {})
  if (parsed.error) return res.status(400).json({ ok: false, error: parsed.error })
  try {
    const db = await getDb()
    const nowISO = new Date().toISOString()
    const doc = { id: await nextShortId(db, 'reach_programs', 'RCH'), ...parsed.fields, createdAtISO: nowISO, updatedAtISO: nowISO, createdBy: actorOf(req) }
    await db.collection('reach_programs').insertOne(doc)
    return res.status(201).json({ ok: true, data: { ...doc, spent: 0 } })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

router.put('/reach-programs/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const parsed = readProgram(req.body || {})
  if (parsed.error) return res.status(400).json({ ok: false, error: parsed.error })
  try {
    const db = await getDb()
    const nowISO = new Date().toISOString()
    const updated = await db.collection('reach_programs').findOneAndUpdate(
      { id: String(req.params.id) },
      { $set: { ...parsed.fields, updatedAtISO: nowISO, updatedBy: actorOf(req) } },
      { returnDocument: 'after' },
    )
    if (!updated) return res.status(404).json({ ok: false, error: 'Program not found' })
    return res.json({ ok: true, data: updated })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// POST /api/reach-fund/entries { type: 'donation' | 'expenditure', amount, description, dateISO? }
router.post('/reach-fund/entries', requireAuth, requireRole('admin'), async (req, res) => {
  const body = req.body || {}
  const type = String(body.type || '').toLowerCase()
  if (!['donation', 'expenditure'].includes(type)) {
    return res.status(400).json({ ok: false, error: 'type must be donation or expenditure' })
  }
  const amount = money(body.amount)
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ ok: false, error: 'Enter a positive amount.' })
  const description = String(body.description || '').trim().slice(0, 500)
  if (!description) return res.status(400).json({ ok: false, error: 'Add a description.' })
  const programId = type === 'expenditure' ? String(body.programId || '').trim() : ''

  const db = await getDb()
  if (programId && !(await db.collection('reach_programs').findOne({ id: programId }))) {
    return res.status(404).json({ ok: false, error: 'Outreach program not found' })
  }
  const session = startDbSession()
  try {
    let entry
    await session.withTransaction(async () => {
      // Serialize spending so two expenditures can't overdraw the fund together.
      await db.collection('settings').updateOne(
        { _id: `${REACH_SETTINGS_ID}_lock` },
        { $inc: { version: 1 } },
        { upsert: true, session },
      )
      if (type === 'expenditure') {
        const totals = await db.collection('reach_fund_ledger').aggregate([
          { $group: { _id: '$type', amount: { $sum: '$amount' } } },
        ], { session }).toArray()
        const sum = (t) => Number(totals.find((x) => x._id === t)?.amount || 0)
        const balance = sum('allocation') + sum('donation') - sum('expenditure')
        if (amount > balance + 0.001) {
          throw Object.assign(new Error(`The REACH fund only has ₱${balance.toLocaleString()} available.`), { statusCode: 409 })
        }
      }
      entry = {
        type,
        amount,
        description,
        donorName: type === 'donation' ? String(body.donorName || '').trim().slice(0, 120) : undefined,
        programId: programId || undefined,
        dateISO: /^\d{4}-\d{2}-\d{2}$/.test(String(body.dateISO || '')) ? body.dateISO : new Date().toISOString().slice(0, 10),
        atISO: new Date().toISOString(),
        recordedBy: actorOf(req),
      }
      await db.collection('reach_fund_ledger').insertOne(entry, { session })
    })
    return res.status(201).json({ ok: true, data: entry, summary: await reachSummary(db) })
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ ok: false, error: err.message })
    return res.status(500).json({ ok: false, error: String(err) })
  } finally {
    await session.endSession()
  }
})

// ---------------------------------------------------------------------------
// Partnership discount eligibility
// Each active partner organization can carry a discountPercent. Players request
// it with proof; staff verify. bookingPricing applies the partner's rate only
// when partnershipEligibilityStatus is 'verified'.
// ---------------------------------------------------------------------------

// GET /api/partnership-discount/institutions — organizations a player can claim a discount from.
router.get('/partnership-discount/institutions', requireAuth, async (_req, res) => {
  try {
    const db = await getDb()
    return res.json({ ok: true, data: await listDiscountInstitutions(db) })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

router.post('/partnership-discount/request', requireAuth, requireRole('user'), async (req, res) => {
  const requested = String(req.body?.institution || '').trim()
  const proofUrl = String(req.body?.proofUrl || '').trim()
  if (!/^https:\/\//.test(proofUrl)) {
    return res.status(400).json({ ok: false, error: 'Upload a photo of your school or membership ID as proof.' })
  }
  try {
    const db = await getDb()
    const match = (await listDiscountInstitutions(db)).find((entry) => entry.name.toLowerCase() === requested.toLowerCase())
    if (!match) return res.status(400).json({ ok: false, error: 'Choose a supported partner organization.' })
    const institution = match.name
    const account = await findById(db, 'user_accounts', req.user.id)
    if (!account) return res.status(404).json({ ok: false, error: 'Account not found' })
    if (String(account.partnershipEligibilityStatus || '').toLowerCase() === 'verified') {
      return res.status(409).json({ ok: false, error: 'Your partnership discount is already verified.' })
    }
    const nowISO = new Date().toISOString()
    await db.collection('user_accounts').updateOne(
      { _id: account._id },
      {
        $set: {
          partnershipInstitution: institution,
          partnershipProofUrl: proofUrl,
          partnershipEligibilityStatus: 'pending',
          partnershipRequestedAtISO: nowISO,
        },
        $push: { partnershipHistory: { status: 'pending', institution, atISO: nowISO, actorId: String(req.user.id), actorRole: 'user' } },
      },
    )
    return res.json({ ok: true, data: { partnershipInstitution: institution, partnershipEligibilityStatus: 'pending' } })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// PUT /api/partnership-discount/:userId/review { decision: 'verified' | 'rejected', reason }
router.put('/partnership-discount/:userId/review', requireAuth, requireRole('admin', 'registrar'), async (req, res) => {
  const decision = String(req.body?.decision || '').toLowerCase()
  if (!['verified', 'rejected'].includes(decision)) {
    return res.status(400).json({ ok: false, error: 'decision must be verified or rejected' })
  }
  const reason = String(req.body?.reason || '').trim().slice(0, 500)
  if (decision === 'rejected' && !reason) return res.status(400).json({ ok: false, error: 'Give a reason for rejecting.' })
  try {
    const db = await getDb()
    const account = await findById(db, 'user_accounts', req.params.userId)
    if (!account || String(account.role || 'user') !== 'user') return res.status(404).json({ ok: false, error: 'Player not found' })
    if (!account.partnershipInstitution) return res.status(409).json({ ok: false, error: 'This player has not requested a partnership discount.' })
    const nowISO = new Date().toISOString()
    await db.collection('user_accounts').updateOne(
      { _id: account._id },
      {
        $set: {
          partnershipEligibilityStatus: decision,
          partnershipReviewReason: reason,
          partnershipReviewedAtISO: nowISO,
          partnershipReviewedBy: actorOf(req),
        },
        $push: { partnershipHistory: { status: decision, reason, atISO: nowISO, ...actorOf(req) } },
      },
    )
    return res.json({ ok: true, data: { partnershipEligibilityStatus: decision } })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// ---------------------------------------------------------------------------
// Partner equipment income sharing
// ---------------------------------------------------------------------------

// GET /api/partner-income?start=YYYY-MM-DD&end=YYYY-MM-DD
// Rental income from partner-owned items on confirmed/completed reservations,
// and each partner's share at their configured revenueSharePercent.
router.get('/partner-income', requireAuth, requireRole('admin'), async (req, res) => {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.start || '')) ? String(req.query.start) : '0000-01-01'
  const end = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.end || '')) ? String(req.query.end) : '9999-12-31'
  try {
    const db = await getDb()
    return res.json({ ok: true, range: { start, end }, data: await computePartnerIncome(db, start, end) })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// ---------------------------------------------------------------------------
// Partner equipment borrowing
// A loan records equipment borrowed from a partner organization (or lent to
// one): the items and their condition going out and coming back, the dates,
// and the signed paperwork. Center pieces lent out are marked rented so they
// can't be booked until they come back.
// ---------------------------------------------------------------------------

const LOAN_DIRECTIONS = ['borrowed_from_partner', 'lent_to_partner']
const LOAN_COLLECTIONS = ['weapons', 'equipments']

function readDocuments(list) {
  return (Array.isArray(list) ? list : [])
    .map((doc) => ({ label: String(doc?.label || 'Document').trim().slice(0, 120), url: String(doc?.url || '').trim() }))
    .filter((doc) => /^https?:\/\//.test(doc.url))
    .slice(0, 10)
}

router.get('/partner-loans', requireAuth, requireRole('admin', 'registrar'), async (req, res) => {
  const partnerId = String(req.query.partnerId || '').trim()
  try {
    const db = await getDb()
    const data = await db.collection('partner_loans')
      .find(partnerId ? { partnerId } : {})
      .sort({ borrowedOn: -1, createdAtISO: -1 })
      .limit(listLimit(req))
      .toArray()
    return res.json({ ok: true, data })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// POST /api/partner-loans { partnerId, direction, borrowedOn, dueOn?, items: [{ description, quantity,
// collection?, itemId?, condition? }], documents: [{ label, url }], notes }
router.post('/partner-loans', requireAuth, requireRole('admin'), async (req, res) => {
  const body = req.body || {}
  const direction = String(body.direction || '')
  const borrowedOn = String(body.borrowedOn || '')
  const dueOn = String(body.dueOn || '')
  if (!LOAN_DIRECTIONS.includes(direction)) return res.status(400).json({ ok: false, error: 'Choose borrowed from or lent to the partner.' })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(borrowedOn)) return res.status(400).json({ ok: false, error: 'Enter the date the equipment changed hands.' })
  if (dueOn && (!/^\d{4}-\d{2}-\d{2}$/.test(dueOn) || dueOn < borrowedOn)) return res.status(400).json({ ok: false, error: 'The return date must be on or after the borrow date.' })

  try {
    const db = await getDb()
    const partner = await findById(db, 'partnerships', body.partnerId)
    if (!partner) return res.status(404).json({ ok: false, error: 'Partner not found' })

    const items = []
    for (const raw of Array.isArray(body.items) ? body.items.slice(0, 100) : []) {
      const quantity = Math.round(Number(raw?.quantity) || 0)
      const collection = LOAN_COLLECTIONS.includes(raw?.collection) ? raw.collection : ''
      const linked = collection && raw?.itemId ? await findById(db, collection, raw.itemId) : null
      if (collection && raw?.itemId && !linked) return res.status(404).json({ ok: false, error: 'A linked inventory item was not found.' })
      const description = String(linked?.name || raw?.description || '').trim().slice(0, 160)
      if (!description || quantity < 1) return res.status(400).json({ ok: false, error: 'Each item needs a description and a quantity of at least 1.' })
      if (linked && direction === 'lent_to_partner' && String(linked.status || 'available') !== 'available') {
        return res.status(409).json({ ok: false, error: `${description} is not available to lend right now.` })
      }
      items.push({
        description,
        quantity: linked ? 1 : quantity,
        collection: linked ? collection : '',
        itemId: linked ? String(linked.id || linked._id) : '',
        conditionOut: String(raw?.condition || '').trim().slice(0, 200),
      })
    }
    if (!items.length) return res.status(400).json({ ok: false, error: 'List at least one item.' })

    const nowISO = new Date().toISOString()
    const doc = {
      id: await nextShortId(db, 'partner_loans', 'LOAN'),
      partnerId: String(partner.id || partner._id),
      partnerName: partner.name,
      direction,
      borrowedOn,
      dueOn: dueOn || '',
      items,
      documents: readDocuments(body.documents),
      notes: String(body.notes || '').trim().slice(0, 1000),
      status: 'out',
      createdAtISO: nowISO,
      createdBy: actorOf(req),
    }
    await db.collection('partner_loans').insertOne(doc)
    if (direction === 'lent_to_partner') {
      for (const item of items.filter((entry) => entry.itemId)) {
        await db.collection(item.collection).updateOne(
          { $or: [{ id: item.itemId }, ...(ObjectId.isValid(item.itemId) ? [{ _id: new ObjectId(item.itemId) }] : [])] },
          { $set: { status: 'rented', maintenanceReason: `Lent to ${partner.name} (${doc.id})`, updatedAtISO: nowISO } },
        )
      }
    }
    return res.status(201).json({ ok: true, data: doc })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// PUT /api/partner-loans/:id/return { returnedOn, conditionIn, documents: [{ label, url }], notes }
router.put('/partner-loans/:id/return', requireAuth, requireRole('admin'), async (req, res) => {
  const body = req.body || {}
  const returnedOn = String(body.returnedOn || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(returnedOn)) return res.status(400).json({ ok: false, error: 'Enter the return date.' })
  try {
    const db = await getDb()
    const loan = await db.collection('partner_loans').findOne({ id: String(req.params.id) })
    if (!loan) return res.status(404).json({ ok: false, error: 'Loan not found' })
    if (loan.status !== 'out') return res.status(409).json({ ok: false, error: 'This loan was already returned.' })
    if (returnedOn < loan.borrowedOn) return res.status(400).json({ ok: false, error: 'The return date is before the borrow date.' })

    const nowISO = new Date().toISOString()
    const updated = await db.collection('partner_loans').findOneAndUpdate(
      { _id: loan._id, status: 'out' },
      {
        $set: {
          status: 'returned',
          returnedOn,
          conditionIn: String(body.conditionIn || '').trim().slice(0, 1000),
          returnNotes: String(body.notes || '').trim().slice(0, 1000),
          returnedAtISO: nowISO,
          returnedBy: actorOf(req),
        },
        $push: { documents: { $each: readDocuments(body.documents) } },
      },
      { returnDocument: 'after' },
    )
    if (!updated) return res.status(409).json({ ok: false, error: 'This loan was already returned.' })
    if (loan.direction === 'lent_to_partner') {
      for (const item of loan.items.filter((entry) => entry.itemId)) {
        await db.collection(item.collection).updateOne(
          { $or: [{ id: item.itemId }, ...(ObjectId.isValid(item.itemId) ? [{ _id: new ObjectId(item.itemId) }] : [])], status: 'rented' },
          { $set: { status: 'available', updatedAtISO: nowISO }, $unset: { maintenanceReason: '' } },
        )
      }
    }
    return res.json({ ok: true, data: updated })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

export default router
