import express from 'express'
import { ObjectId } from 'mongodb'
import { getDb, startDbSession } from '../db/mongo.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { nextShortId } from '../utils/shortIds.js'
import { emailDamageCharge } from '../services/notificationEmails.js'

// Field-operations records that don't fit the generic CRUD routes: chronograph
// (FPS) safety logs, damage reports and penalty billing, the REACH outreach fund
// ledger, and partner-equipment income sharing.
const router = express.Router()

const STAFF = ['admin', 'registrar', 'marshal']
const COLLECTED_STATUSES = ['paid', 'confirmed', 'verified', 'approved', 'succeeded']
const BILLABLE_RESERVATION_STATUSES = ['confirmed', 'completed', 'approved']
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

export function evaluateFpsReading(weaponClass, fps, limits = getFpsLimits()) {
  const limit = weaponClass === 'sniper' ? limits.sniper : limits.aeg
  return { limit, result: fps <= limit ? 'pass' : 'fail' }
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
  const weaponClass = String(body.weaponClass || '').toLowerCase()
  const fps = Number(body.fps)
  if (!['aeg', 'sniper'].includes(weaponClass)) {
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

    const { limit, result } = evaluateFpsReading(weaponClass, fps)
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

router.post('/damage-reports', requireAuth, requireRole('admin', 'marshal'), async (req, res) => {
  const body = req.body || {}
  const itemType = String(body.itemType || '').toLowerCase()
  if (!['weapon', 'equipment'].includes(itemType)) {
    return res.status(400).json({ ok: false, error: 'itemType must be weapon or equipment' })
  }
  const description = String(body.description || '').trim().slice(0, 1000)
  if (!description) return res.status(400).json({ ok: false, error: 'Describe the damage.' })

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
        { $set: { status: MAINTENANCE_STATUS[collection], maintenanceReason: `Damage report ${doc.id}`, updatedAtISO: nowISO } },
      )
    }

    return res.status(201).json({ ok: true, data: doc })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// PUT /api/damage-reports/:id/review { decision: 'bill' | 'waive', chargeAmount, note }
// Only an admin can attach a charge; it is added to the linked reservation's balance.
router.put('/damage-reports/:id/review', requireAuth, requireRole('admin'), async (req, res) => {
  const body = req.body || {}
  const decision = String(body.decision || '').toLowerCase()
  if (!['bill', 'waive'].includes(decision)) {
    return res.status(400).json({ ok: false, error: 'decision must be bill or waive' })
  }
  const chargeAmount = decision === 'bill' ? money(body.chargeAmount) : 0
  if (decision === 'bill' && (!Number.isFinite(chargeAmount) || chargeAmount <= 0)) {
    return res.status(400).json({ ok: false, error: 'Enter the approved charge amount.' })
  }
  const note = String(body.note || '').trim().slice(0, 500)

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
      if (decision === 'bill') {
        const result = await db.collection('reservations').updateOne(
          { $or: [{ id: report.reservationId }, ...(ObjectId.isValid(report.reservationId) ? [{ _id: new ObjectId(report.reservationId) }] : [])] },
          {
            $inc: { totalAmount: chargeAmount, balanceAmount: chargeAmount, damageChargesTotal: chargeAmount },
            $push: {
              pricingBreakdown: { label: `Damage penalty: ${report.itemName}`, amount: chargeAmount },
              damageCharges: { reportId: report.id, itemName: report.itemName, amount: chargeAmount, approvedBy: actorOf(req), atISO: nowISO },
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

// Allocates the configured share of every collected payment not yet allocated.
// The unique index on sourcePaymentId makes repeated runs safe.
router.post('/reach-fund/allocate', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const db = await getDb()
    const settings = await db.collection('settings').findOne({ _id: REACH_SETTINGS_ID })
    const ratePercent = Number(settings?.ratePercent)
    if (!Number.isFinite(ratePercent) || ratePercent <= 0) {
      return res.status(400).json({ ok: false, error: 'Set the REACH allocation rate before allocating.' })
    }

    const ledger = db.collection('reach_fund_ledger')
    await ledger.createIndex(
      { sourcePaymentId: 1 },
      { unique: true, partialFilterExpression: { type: 'allocation' } },
    )
    const alreadyAllocated = new Set(
      (await ledger.find({ type: 'allocation' }, { projection: { sourcePaymentId: 1 } }).toArray())
        .map((entry) => entry.sourcePaymentId),
    )
    const payments = await db.collection('payments').find({}).toArray()
    const nowISO = new Date().toISOString()
    let created = 0
    let amountAllocated = 0
    for (const payment of payments) {
      const status = String(payment.paymentStatus || payment.status || '').toLowerCase()
      const paymentId = String(payment.id || payment._id)
      if (!COLLECTED_STATUSES.includes(status) || alreadyAllocated.has(paymentId)) continue
      const paid = Number(payment.amount ?? payment.totalPHP ?? 0)
      const amount = Math.round(paid * ratePercent) / 100
      if (!(amount > 0)) continue
      try {
        await ledger.insertOne({
          type: 'allocation',
          amount,
          ratePercent,
          sourcePaymentId: paymentId,
          sourceReservationId: String(payment.reservationId || ''),
          sourceAmount: paid,
          description: `${ratePercent}% of payment ${paymentId}`,
          atISO: nowISO,
          recordedBy: actorOf(req),
        })
        created += 1
        amountAllocated += amount
      } catch (err) {
        if (err?.code !== 11000) throw err
      }
    }
    return res.json({ ok: true, created, amountAllocated: Math.round(amountAllocated * 100) / 100, summary: await reachSummary(db) })
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

  const db = await getDb()
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
// Partnership (CvSU) discount eligibility
// Players request it with proof; staff verify. bookingPricing applies the
// discount only when partnershipEligibilityStatus is 'verified'.
// ---------------------------------------------------------------------------

export const DISCOUNT_INSTITUTIONS = ['Cavite State University']

router.post('/partnership-discount/request', requireAuth, requireRole('user'), async (req, res) => {
  const institution = String(req.body?.institution || '').trim()
  const proofUrl = String(req.body?.proofUrl || '').trim()
  if (!DISCOUNT_INSTITUTIONS.includes(institution)) {
    return res.status(400).json({ ok: false, error: 'Choose a supported partner institution.' })
  }
  if (!/^https:\/\//.test(proofUrl)) {
    return res.status(400).json({ ok: false, error: 'Upload a photo of your school ID as proof.' })
  }
  try {
    const db = await getDb()
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

    const data = Array.from(byPartner.values()).map((entry) => ({
      ...entry,
      rentalIncome: Math.round(entry.rentalIncome * 100) / 100,
      partnerShare: Math.round(entry.rentalIncome * entry.revenueSharePercent) / 100,
      itemCount: [...partnerItems.values()].filter((item) => String(item.partnerId) === entry.partnerId).length,
    }))
    return res.json({ ok: true, range: { start, end }, data })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

export default router
