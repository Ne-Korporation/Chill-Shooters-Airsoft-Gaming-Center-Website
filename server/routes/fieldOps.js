import express from 'express'
import { randomUUID } from 'crypto'
import { ObjectId } from 'mongodb'
import { getDb, startDbSession } from '../db/mongo.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { nextShortId } from '../utils/shortIds.js'
import { getReservationPayments, syncReservationPaymentState } from '../utils/paymentProgress.js'
import { emailDamageCharge } from '../services/notificationEmails.js'
import { getExperienceLevel, getAgeGroup, suggestBalancedTeams } from '../utils/teamBalancing.js'
import { createPieces, modelFilter } from '../utils/inventoryPieces.js'

// Field-side operations from the manuscript scope that sit outside the booking flow:
// player experience and balanced team grouping, onsite/balance payments and extra
// charges, per-player rental check-out/return, and the gunsmith repair log.
const router = express.Router()

const STAFF = ['admin', 'registrar', 'marshal']
const ACTIVE_RESERVATION_STATUSES = ['pending', 'needs review', 'confirmed', 'approved']
const COMPLETED_GAME_STATUSES = ['completed', 'archived']
// Status each inventory page treats as its maintenance queue.
const MAINTENANCE_STATUS = { weapons: 'needs-check', equipments: 'maintenance' }

function money(value) {
  const amount = Math.round(Number(value) * 100) / 100
  return Number.isFinite(amount) ? amount : NaN
}

function actorOf(req) {
  return { actorId: String(req.user?.id || ''), actorEmail: req.user?.email || '', actorRole: req.user?.role || '' }
}

function idFilter(rawId) {
  const id = String(rawId || '').trim()
  return { $or: [{ id }, ...(ObjectId.isValid(id) ? [{ _id: new ObjectId(id) }] : [])] }
}

async function findById(db, collection, rawId) {
  if (!String(rawId || '').trim()) return null
  return db.collection(collection).findOne(idFilter(rawId))
}

function keyOf(doc) {
  return String(doc?.id || doc?._id || '')
}

function sendError(res, err) {
  if (err?.statusCode) return res.status(err.statusCode).json({ ok: false, error: err.message })
  return res.status(500).json({ ok: false, error: String(err) })
}

// ---------------------------------------------------------------------------
// Player experience: games played at the field, plus an admin adjustment
// ---------------------------------------------------------------------------

// Counts completed games per player: the captain and every registered teammate of each
// reservation whose game was completed or archived.
async function getGamesPlayed(db, userIds) {
  const games = await db.collection('gameplay').find(
    { $or: [{ Status: { $in: ['Completed', 'Archived'] } }, { status: { $in: COMPLETED_GAME_STATUSES } }] },
    { projection: { reservationId: 1 } },
  ).toArray()
  const reservationIds = [...new Set(games.map((game) => String(game.reservationId || '')).filter(Boolean))]
  const objectIds = reservationIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id))
  const reservations = reservationIds.length
    ? await db.collection('reservations').find(
      { $or: [{ id: { $in: reservationIds } }, ...(objectIds.length ? [{ _id: { $in: objectIds } }] : [])] },
      { projection: { userId: 1, teamMembers: 1 } },
    ).toArray()
    : []

  const wanted = userIds ? new Set(userIds.map(String)) : null
  const counts = new Map()
  for (const reservation of reservations) {
    const players = new Set([reservation.userId, ...(reservation.teamMembers || []).map((member) => member.id)].map(String))
    for (const id of players) {
      if (!id || (wanted && !wanted.has(id))) continue
      counts.set(id, (counts.get(id) || 0) + 1)
    }
  }
  return counts
}

// Latest age on file per player: from their waiver, falling back to the account.
async function getAges(db, accounts) {
  const ids = accounts.map(keyOf)
  const waivers = await db.collection('waivers').find(
    { userId: { $in: ids } },
    { projection: { userId: 1, age: 1, createdAtISO: 1 } },
  ).toArray()
  const ages = new Map()
  for (const account of accounts) {
    const waiver = waivers
      .filter((item) => String(item.userId) === keyOf(account) && Number(item.age) > 0)
      .sort((a, b) => String(b.createdAtISO || '').localeCompare(String(a.createdAtISO || '')))[0]
    const age = Number(waiver?.age || account.age || 0)
    ages.set(keyOf(account), age > 0 ? age : null)
  }
  return ages
}

async function getPlayerProfiles(db, userIds) {
  const ids = [...new Set(userIds.map(String).filter(Boolean))]
  if (!ids.length) return new Map()
  const objectIds = ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id))
  const accounts = await db.collection('user_accounts').find(
    { $or: [{ id: { $in: ids } }, ...(objectIds.length ? [{ _id: { $in: objectIds } }] : [])] },
    { projection: { id: 1, name: 1, email: 1, age: 1, experienceAdjustment: 1 } },
  ).toArray()
  const [games, ages] = await Promise.all([getGamesPlayed(db, ids), getAges(db, accounts)])
  return new Map(accounts.map((account) => {
    const id = keyOf(account)
    const gamesPlayed = games.get(id) || 0
    const adjustment = Math.round(Number(account.experienceAdjustment) || 0)
    const experience = Math.max(0, gamesPlayed + adjustment)
    const age = ages.get(id) ?? null
    return [id, {
      id,
      name: account.name || account.email || id,
      gamesPlayed,
      experienceAdjustment: adjustment,
      experience,
      experienceLevel: getExperienceLevel(experience),
      age,
      ageGroup: getAgeGroup(age),
    }]
  }))
}

// GET /api/players/:id/stats — the player's own profile numbers, or any player's for staff.
router.get('/players/:id/stats', requireAuth, async (req, res) => {
  const id = String(req.params.id || '')
  if (req.user.role === 'user' && String(req.user.id) !== id) {
    return res.status(404).json({ ok: false, error: 'not found' })
  }
  try {
    const db = await getDb()
    const profile = (await getPlayerProfiles(db, [id])).get(id)
    if (!profile) return res.status(404).json({ ok: false, error: 'Player not found' })

    const reservations = await db.collection('reservations').find(
      { $or: [{ userId: id }, { 'teamMembers.id': id }] },
      { projection: { id: 1, reservationDate: 1, reservationTime: 1, reservationStatus: 1, locationName: 1, packageName: 1, userId: 1 } },
    ).sort({ reservationDate: -1 }).limit(200).toArray()
    const today = new Date().toISOString().slice(0, 10)
    const status = (r) => String(r.reservationStatus || '').toLowerCase()

    const [weapons, equipment] = await Promise.all([
      db.collection('weapons').find({ submittedBy: id, approvalStatus: 'approved' }, { projection: { id: 1, name: 1, category: 1 } }).toArray(),
      db.collection('equipments').find({ submittedBy: id, approvalStatus: 'approved' }, { projection: { id: 1, name: 1, category: 1 } }).toArray(),
    ])

    return res.json({
      ok: true,
      data: {
        ...profile,
        reservations: {
          total: reservations.length,
          upcoming: reservations.filter((r) => r.reservationDate >= today && status(r) !== 'cancelled').length,
          cancelled: reservations.filter((r) => status(r) === 'cancelled').length,
          recent: reservations.slice(0, 5).map((r) => ({
            id: r.id,
            reservationDate: r.reservationDate,
            reservationTime: r.reservationTime,
            reservationStatus: r.reservationStatus,
            locationName: r.locationName,
            packageName: r.packageName,
            asCaptain: String(r.userId) === id,
          })),
        },
        ownedGear: [
          ...weapons.map((item) => ({ id: keyOf(item), name: item.name, kind: 'weapon', category: item.category })),
          ...equipment.map((item) => ({ id: keyOf(item), name: item.name, kind: 'equipment', category: item.category })),
        ],
      },
    })
  } catch (err) {
    return sendError(res, err)
  }
})

// PUT /api/players/:id/experience { adjustment, note } — admin adds (or removes) experience,
// e.g. for games played before the system existed.
router.put('/players/:id/experience', requireAuth, requireRole('admin'), async (req, res) => {
  const adjustment = Number(req.body?.adjustment)
  if (!Number.isInteger(adjustment) || Math.abs(adjustment) > 1000) {
    return res.status(400).json({ ok: false, error: 'Adjustment must be a whole number between -1000 and 1000.' })
  }
  const note = String(req.body?.note || '').trim().slice(0, 300)
  try {
    const db = await getDb()
    const account = await findById(db, 'user_accounts', req.params.id)
    if (!account || String(account.role || 'user') !== 'user') return res.status(404).json({ ok: false, error: 'Player not found' })
    const nowISO = new Date().toISOString()
    await db.collection('user_accounts').updateOne(
      { _id: account._id },
      {
        $set: { experienceAdjustment: adjustment, updatedAtISO: nowISO },
        $push: { experienceHistory: { adjustment, previous: Number(account.experienceAdjustment) || 0, note, atISO: nowISO, ...actorOf(req) } },
      },
    )
    const profile = (await getPlayerProfiles(db, [keyOf(account)])).get(keyOf(account))
    return res.json({ ok: true, data: profile })
  } catch (err) {
    return sendError(res, err)
  }
})

// ---------------------------------------------------------------------------
// Balanced team grouping for a session (location + date + time slot)
// ---------------------------------------------------------------------------

function sessionKey(location, date, slot) {
  return `${location}:${date}:${slot}`
}

function readSession(query) {
  const location = String(query.location || '').trim().toLowerCase()
  const date = String(query.date || '').trim()
  const slot = String(query.slot || '').trim().toLowerCase()
  if (!location || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !['morning', 'afternoon', 'evening'].includes(slot)) {
    const invalid = new Error('Choose a location, date, and time slot.')
    invalid.statusCode = 400
    throw invalid
  }
  return { location, date, slot }
}

// Everyone booked into the session: registered players with their experience and age, plus
// unnamed guests for walk-ins and spots not filled by registered teammates.
async function getSessionRoster(db, { location, date, slot }) {
  const reservations = await db.collection('reservations').find({
    reservationStatus: { $in: ACTIVE_RESERVATION_STATUSES },
    reservationDate: date,
    reservationTime: slot,
    locationId: location,
  }).toArray()

  const userIds = reservations.flatMap((r) => [r.userId, ...(r.teamMembers || []).map((m) => m.id)])
    .map(String).filter((id) => id && id !== 'walk-in')
  const profiles = await getPlayerProfiles(db, userIds)

  const roster = []
  for (const reservation of reservations) {
    const registered = [...new Set([reservation.userId, ...(reservation.teamMembers || []).map((m) => m.id)].map(String))]
      .filter((id) => profiles.has(id))
    for (const id of registered) {
      roster.push({ key: `user:${id}`, ...profiles.get(id), reservationId: reservation.id, guest: false })
    }
    const guests = Math.max(0, Number(reservation.numberOfPlayers || 0) - registered.length)
    for (let n = 1; n <= guests; n += 1) {
      const label = reservation.walkIn ? `${reservation.walkInName || 'Walk-in'}` : 'Guest'
      roster.push({
        key: `guest:${reservation.id}:${n}`,
        id: '',
        name: guests > 1 || reservation.walkIn ? `${label} #${n}` : label,
        gamesPlayed: 0,
        experienceAdjustment: 0,
        experience: 0,
        experienceLevel: getExperienceLevel(0),
        age: null,
        ageGroup: getAgeGroup(null),
        reservationId: reservation.id,
        guest: true,
      })
    }
  }
  return roster
}

// GET /api/team-grouping?location&date&slot&teams=2 — roster, a balanced suggestion, and the
// marshal's saved assignment if there is one.
router.get('/team-grouping', requireAuth, requireRole('admin', 'marshal'), async (req, res) => {
  try {
    const session = readSession(req.query)
    const teamCount = Math.min(Math.max(Number(req.query.teams) || 2, 2), 6)
    const db = await getDb()
    const roster = await getSessionRoster(db, session)
    const saved = await db.collection('team_assignments').findOne({ _id: sessionKey(session.location, session.date, session.slot) })
    return res.json({
      ok: true,
      data: {
        roster,
        suggestion: suggestBalancedTeams(roster, teamCount),
        saved: saved ? { teams: saved.teams, savedAtISO: saved.savedAtISO, savedBy: saved.savedBy } : null,
      },
    })
  } catch (err) {
    return sendError(res, err)
  }
})

// POST /api/team-grouping { location, date, slot, teams: [{ name, playerKeys }] } — the marshal's final say.
router.post('/team-grouping', requireAuth, requireRole('admin', 'marshal'), async (req, res) => {
  try {
    const session = readSession(req.body || {})
    const teams = Array.isArray(req.body?.teams) ? req.body.teams : []
    if (teams.length < 2 || teams.length > 6) return res.status(400).json({ ok: false, error: 'Create between 2 and 6 teams.' })
    const cleaned = teams.map((team, index) => ({
      name: String(team?.name || `Team ${index + 1}`).trim().slice(0, 40),
      playerKeys: [...new Set((Array.isArray(team?.playerKeys) ? team.playerKeys : []).map(String))],
    }))
    const seen = new Set()
    for (const key of cleaned.flatMap((team) => team.playerKeys)) {
      if (seen.has(key)) return res.status(400).json({ ok: false, error: 'A player can only be on one team.' })
      seen.add(key)
    }
    const db = await getDb()
    const nowISO = new Date().toISOString()
    await db.collection('team_assignments').updateOne(
      { _id: sessionKey(session.location, session.date, session.slot) },
      { $set: { ...session, teams: cleaned, savedAtISO: nowISO, savedBy: actorOf(req) } },
      { upsert: true },
    )
    return res.json({ ok: true, data: { teams: cleaned, savedAtISO: nowISO } })
  } catch (err) {
    return sendError(res, err)
  }
})

// ---------------------------------------------------------------------------
// Reservation ledger, onsite/balance payments, and extra charges
// ---------------------------------------------------------------------------

const PAID_STATUSES = ['paid', 'confirmed', 'verified', 'approved', 'succeeded']
const ONSITE_METHODS = { cash: 'Cash', gcash: 'GCash', bank_transfer: 'Bank transfer' }

function readPrice(name, fallback) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

export function getChargeConfig() {
  return {
    ammo_reload: { label: 'Extra ammo reload', unitPrice: readPrice('AMMO_RELOAD_PRICE', 100) },
    field_modification: { label: 'Field modification fee', unitPrice: readPrice('FIELD_MODIFICATION_FEE', 500) },
    other: { label: 'Other charge', unitPrice: 0 },
  }
}

function buildLedger(reservation, payments) {
  const active = payments.filter((p) => !['failed', 'rejected'].includes(String(p.paymentStatus || p.status || '').toLowerCase()))
  const collected = Math.round(active.reduce((sum, p) => sum + Number(p.amount || 0), 0) * 100) / 100
  const verified = Math.round(active
    .filter((p) => PAID_STATUSES.includes(String(p.paymentStatus || p.status || '').toLowerCase()))
    .reduce((sum, p) => sum + Number(p.amount || 0), 0) * 100) / 100
  const total = Math.round(Number(reservation.totalAmount || 0) * 100) / 100
  return {
    reservation: {
      id: keyOf(reservation),
      userId: reservation.userId,
      walkIn: reservation.walkIn === true,
      walkInName: reservation.walkInName || '',
      reservationDate: reservation.reservationDate,
      reservationTime: reservation.reservationTime,
      locationId: reservation.locationId,
      locationName: reservation.locationName,
      numberOfPlayers: reservation.numberOfPlayers,
      packageName: reservation.packageName,
      reservationStatus: reservation.reservationStatus,
      teamMembers: reservation.teamMembers || [],
    },
    total,
    depositAmount: Number(reservation.depositAmount || 0),
    breakdown: reservation.pricingBreakdown || [],
    extraCharges: reservation.extraCharges || [],
    payments: payments.map((p) => ({
      id: p.id,
      amount: p.amount,
      paymentMethod: p.paymentMethod,
      paymentStatus: p.paymentStatus || p.status,
      kind: p.kind || 'online',
      transactionReference: p.transactionReference || '',
      createdAtISO: p.createdAtISO,
    })),
    collected,
    verified,
    balanceDue: Math.max(0, Math.round((total - collected) * 100) / 100),
  }
}

router.get('/charge-config', requireAuth, requireRole(...STAFF), (_req, res) => {
  res.json({ ok: true, data: getChargeConfig() })
})

// GET /api/reservations/:id/ledger — everything charged and paid, and the balance still due.
router.get('/reservations/:id/ledger', requireAuth, async (req, res) => {
  try {
    const db = await getDb()
    const reservation = await findById(db, 'reservations', req.params.id)
    const ownsIt = reservation && (String(reservation.userId) === String(req.user.id) ||
      (reservation.teamMembers || []).some((m) => String(m.id) === String(req.user.id)))
    if (!reservation || (req.user.role === 'user' && !ownsIt)) return res.status(404).json({ ok: false, error: 'Reservation not found' })
    const payments = await getReservationPayments(db, reservation)
    const ledger = buildLedger(reservation, payments)
    const captain = reservation.walkIn ? null : await findById(db, 'user_accounts', reservation.userId)
    ledger.reservation.captainName = captain?.name || ''
    return res.json({ ok: true, data: ledger })
  } catch (err) {
    return sendError(res, err)
  }
})

// POST /api/payments/onsite { reservationId, amount, method, reference, note } — staff record the
// balance (or any amount) collected at the field. Recorded as paid since staff took it in person.
router.post('/payments/onsite', requireAuth, requireRole('admin', 'registrar'), async (req, res) => {
  const body = req.body || {}
  const method = String(body.method || '').toLowerCase()
  const amount = money(body.amount)
  const reference = String(body.reference || '').trim().slice(0, 120)
  if (!ONSITE_METHODS[method]) return res.status(400).json({ ok: false, error: 'Choose cash, GCash, or bank transfer.' })
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ ok: false, error: 'Enter the amount received.' })
  if (method !== 'cash' && reference.length < 4) return res.status(400).json({ ok: false, error: 'Enter the transaction reference number.' })

  const db = await getDb()
  const session = startDbSession()
  try {
    let payment
    let reservation
    await session.withTransaction(async () => {
      reservation = await db.collection('reservations').findOne(idFilter(body.reservationId), { session })
      if (!reservation) throw Object.assign(new Error('Reservation not found'), { statusCode: 404 })
      if (String(reservation.reservationStatus || '').toLowerCase() === 'cancelled') {
        throw Object.assign(new Error('This reservation is cancelled.'), { statusCode: 409 })
      }
      const reservationId = keyOf(reservation)
      await db.collection('payment_deposit_locks').updateOne({ _id: reservationId }, { $inc: { version: 1 } }, { upsert: true, session })
      if (reference) {
        const reused = await db.collection('payments').findOne(
          { $expr: { $eq: [{ $toLower: '$transactionReference' }, reference.toLowerCase()] } },
          { session },
        )
        if (reused) throw Object.assign(new Error('This reference number was already recorded.'), { statusCode: 409 })
      }
      const payments = await db.collection('payments').find({ reservationId: { $in: [reservation.id, String(reservation._id)].filter(Boolean) } }, { session }).toArray()
      const { balanceDue } = buildLedger(reservation, payments)
      if (amount > balanceDue + 0.01) {
        throw Object.assign(new Error(`Only ₱${balanceDue.toLocaleString()} is still due.`), { statusCode: 400 })
      }

      const nowISO = new Date().toISOString()
      payment = {
        id: `PMT-${randomUUID()}`,
        reservationId,
        userId: String(reservation.userId || ''),
        amount,
        paymentMethod: ONSITE_METHODS[method],
        paymentStatus: 'paid',
        status: 'paid',
        kind: 'onsite',
        ...(reference ? { transactionReference: reference.toLowerCase() } : {}),
        note: String(body.note || '').trim().slice(0, 300),
        recordedBy: actorOf(req),
        verifiedBy: String(req.user.id),
        verifiedByRole: req.user.role,
        verifiedAtISO: nowISO,
        createdAtISO: nowISO,
      }
      await db.collection('payments').insertOne(payment, { session })
    })
    await syncReservationPaymentState(db, reservation)
    const payments = await getReservationPayments(db, reservation)
    return res.status(201).json({ ok: true, data: payment, ledger: buildLedger(reservation, payments) })
  } catch (err) {
    return sendError(res, err)
  } finally {
    await session.endSession()
  }
})

// POST /api/reservations/:id/charges { type, quantity, unitPrice, note } — ammo reloads, field
// modification fees, or other charges added to the bill. There is no cancellation fee.
router.post('/reservations/:id/charges', requireAuth, requireRole(...STAFF), async (req, res) => {
  const body = req.body || {}
  const config = getChargeConfig()
  const type = String(body.type || '')
  if (!config[type]) return res.status(400).json({ ok: false, error: 'Choose a charge type.' })
  const quantity = Number(body.quantity ?? 1)
  const unitPrice = money(body.unitPrice ?? config[type].unitPrice)
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) return res.status(400).json({ ok: false, error: 'Quantity must be a whole number from 1 to 500.' })
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return res.status(400).json({ ok: false, error: 'Enter the price for this charge.' })
  const note = String(body.note || '').trim().slice(0, 300)
  if (type === 'other' && !note) return res.status(400).json({ ok: false, error: 'Describe the charge.' })

  try {
    const db = await getDb()
    const reservation = await findById(db, 'reservations', req.params.id)
    if (!reservation) return res.status(404).json({ ok: false, error: 'Reservation not found' })
    const amount = Math.round(quantity * unitPrice * 100) / 100
    const label = `${type === 'other' ? note : config[type].label}${quantity > 1 ? ` × ${quantity}` : ''}`
    const nowISO = new Date().toISOString()
    const charge = {
      id: `CHG-${new ObjectId().toHexString().slice(-8).toUpperCase()}`,
      type,
      label,
      quantity,
      unitPrice,
      amount,
      note,
      addedBy: actorOf(req),
      atISO: nowISO,
    }
    await db.collection('reservations').updateOne(
      { _id: reservation._id },
      {
        $inc: { totalAmount: amount, balanceAmount: amount, extraChargesTotal: amount },
        $push: { pricingBreakdown: { label, amount }, extraCharges: charge },
        $set: { updatedAtISO: nowISO },
      },
    )
    const updated = await db.collection('reservations').findOne({ _id: reservation._id })
    const payments = await getReservationPayments(db, updated)
    return res.status(201).json({ ok: true, data: charge, ledger: buildLedger(updated, payments) })
  } catch (err) {
    return sendError(res, err)
  }
})

// ---------------------------------------------------------------------------
// Rental check-out and return, per player and per unit
// ---------------------------------------------------------------------------

const RENTAL_COLLECTIONS = ['weapons', 'equipments']

async function reportRentalProblem(db, rental, condition, note, req) {
  const nowISO = new Date().toISOString()
  const report = {
    id: await nextShortId(db, 'damage_reports', 'DMG'),
    itemType: rental.itemCollection === 'weapons' ? 'weapon' : 'equipment',
    itemId: rental.itemId,
    itemName: `${rental.itemName}${rental.unitLabel ? ` (${rental.unitLabel})` : ''}`,
    reservationId: rental.reservationId,
    playerId: rental.playerId || '',
    playerName: rental.playerName,
    rentalId: rental.id,
    description: condition === 'missing'
      ? `Not returned after the game.${note ? ` ${note}` : ''}`
      : `Returned damaged.${note ? ` ${note}` : ''}`,
    evidenceUrl: '',
    status: 'reported',
    chargeAmount: 0,
    reportedAtISO: nowISO,
    reportedBy: actorOf(req),
  }
  await db.collection('damage_reports').insertOne(report)
  await db.collection(rental.itemCollection).updateOne(
    idFilter(rental.itemId),
    {
      $set: {
        status: MAINTENANCE_STATUS[rental.itemCollection],
        maintenanceReason: `${condition === 'missing' ? 'Missing' : 'Damaged'} after rental ${rental.id} (${report.id})`,
        updatedAtISO: nowISO,
      },
    },
  )
  return report
}

// GET /api/rentals?reservationId=&status=out|returned|missing — rental records, newest first.
router.get('/rentals', requireAuth, requireRole(...STAFF), async (req, res) => {
  try {
    const db = await getDb()
    const filter = {}
    if (req.query.reservationId) filter.reservationId = String(req.query.reservationId)
    if (['out', 'returned', 'missing'].includes(String(req.query.status))) filter.status = String(req.query.status)
    const data = await db.collection('rentals').find(filter).sort({ issuedAtISO: -1 }).limit(500).toArray()
    const today = new Date().toISOString().slice(0, 10)
    return res.json({
      ok: true,
      data: data.map((rental) => ({ ...rental, overdue: rental.status === 'out' && String(rental.reservationDate || '') < today })),
    })
  } catch (err) {
    return sendError(res, err)
  }
})

// POST /api/rentals/issue { reservationId, playerName, playerId?, itemCollection, itemId, unitLabel }
router.post('/rentals/issue', requireAuth, requireRole(...STAFF), async (req, res) => {
  const body = req.body || {}
  const itemCollection = String(body.itemCollection || '')
  const playerName = String(body.playerName || '').trim().slice(0, 120)
  if (!RENTAL_COLLECTIONS.includes(itemCollection)) return res.status(400).json({ ok: false, error: 'Choose a weapon or equipment item.' })
  if (!playerName) return res.status(400).json({ ok: false, error: 'Enter who is receiving the item.' })
  try {
    const db = await getDb()
    const reservation = await findById(db, 'reservations', body.reservationId)
    if (!reservation) return res.status(404).json({ ok: false, error: 'Reservation not found' })
    const item = await findById(db, itemCollection, body.itemId)
    if (!item) return res.status(404).json({ ok: false, error: 'Item not found' })
    const unitLabel = String(body.unitLabel || '').trim().slice(0, 40)
    if (unitLabel) {
      const alreadyOut = await db.collection('rentals').findOne({ itemId: keyOf(item), unitLabel, status: 'out' })
      if (alreadyOut) return res.status(409).json({ ok: false, error: `${item.name} ${unitLabel} is already out with ${alreadyOut.playerName}.` })
    }
    const nowISO = new Date().toISOString()
    const rental = {
      id: await nextShortId(db, 'rentals', 'RNT'),
      reservationId: keyOf(reservation),
      reservationDate: reservation.reservationDate,
      playerName,
      playerId: String(body.playerId || '').trim(),
      itemCollection,
      itemId: keyOf(item),
      itemName: item.name || keyOf(item),
      itemCategory: item.category || '',
      unitLabel,
      status: 'out',
      issuedAtISO: nowISO,
      issuedBy: actorOf(req),
    }
    await db.collection('rentals').insertOne(rental)
    return res.status(201).json({ ok: true, data: rental })
  } catch (err) {
    return sendError(res, err)
  }
})

// PUT /api/rentals/:id/return { condition: 'ok' | 'damaged' | 'missing', note } — damaged or
// missing items open a damage report (for penalty billing) and leave the rental pool.
router.put('/rentals/:id/return', requireAuth, requireRole(...STAFF), async (req, res) => {
  const condition = String(req.body?.condition || '')
  if (!['ok', 'damaged', 'missing'].includes(condition)) return res.status(400).json({ ok: false, error: 'condition must be ok, damaged, or missing' })
  const note = String(req.body?.note || '').trim().slice(0, 300)
  try {
    const db = await getDb()
    const rental = await db.collection('rentals').findOne({ id: String(req.params.id) })
    if (!rental) return res.status(404).json({ ok: false, error: 'Rental not found' })
    if (rental.status !== 'out') return res.status(409).json({ ok: false, error: 'This item was already checked in.' })
    const report = condition === 'ok' ? null : await reportRentalProblem(db, rental, condition, note, req)
    const nowISO = new Date().toISOString()
    const update = {
      status: condition === 'missing' ? 'missing' : 'returned',
      condition,
      returnNote: note,
      returnedAtISO: nowISO,
      returnedBy: actorOf(req),
      ...(report ? { damageReportId: report.id } : {}),
    }
    await db.collection('rentals').updateOne({ _id: rental._id }, { $set: update })
    return res.json({ ok: true, data: { ...rental, ...update }, damageReport: report })
  } catch (err) {
    return sendError(res, err)
  }
})

// ---------------------------------------------------------------------------
// Rental inventory pieces: each physical item is its own record
// ---------------------------------------------------------------------------

const PIECE_FIELDS = ['category', 'price', 'description', 'note', 'status', 'partnerId', 'fpsClass', 'fpsLimit']

function readPieceFields(body) {
  const fields = {}
  for (const key of PIECE_FIELDS) {
    if (body[key] === undefined) continue
    fields[key] = ['price', 'fpsLimit'].includes(key) ? Math.max(0, Number(body[key]) || 0) : String(body[key] ?? '').trim().slice(0, 500)
  }
  return fields
}

// POST /api/inventory/:collection/pieces { model, count, price, category, ... } — "Mask × 5" creates
// five separate masks, each with its own ID and number.
router.post('/inventory/:collection/pieces', requireAuth, requireRole('admin', 'marshal'), async (req, res) => {
  const collection = String(req.params.collection)
  if (!RENTAL_COLLECTIONS.includes(collection)) return res.status(400).json({ ok: false, error: 'collection must be weapons or equipments' })
  const model = String(req.body?.model || '').trim().slice(0, 80)
  const count = Number(req.body?.count)
  if (!model) return res.status(400).json({ ok: false, error: 'Enter the item name.' })
  if (!Number.isInteger(count) || count < 1 || count > 200) return res.status(400).json({ ok: false, error: 'Add between 1 and 200 pieces at a time.' })
  try {
    const db = await getDb()
    const pieces = await createPieces(db, collection, {
      model,
      count,
      fields: { status: 'available', ...readPieceFields(req.body || {}), createdBy: actorOf(req) },
    })
    return res.status(201).json({ ok: true, data: pieces })
  } catch (err) {
    return sendError(res, err)
  }
})

// PUT /api/inventory/:collection/models { model, price, category, ... } — change shared details
// (like the rental price) on every piece of a model at once. Status stays per piece.
router.put('/inventory/:collection/models', requireAuth, requireRole('admin', 'marshal'), async (req, res) => {
  const collection = String(req.params.collection)
  if (!RENTAL_COLLECTIONS.includes(collection)) return res.status(400).json({ ok: false, error: 'collection must be weapons or equipments' })
  const model = String(req.body?.model || '').trim()
  if (!model) return res.status(400).json({ ok: false, error: 'model is required' })
  const { status, ...fields } = readPieceFields(req.body || {})
  if (!Object.keys(fields).length) return res.status(400).json({ ok: false, error: 'Nothing to update.' })
  try {
    const db = await getDb()
    const result = await db.collection(collection).updateMany(modelFilter(model), { $set: { ...fields, updatedAtISO: new Date().toISOString() } })
    return res.json({ ok: true, updated: result.modifiedCount })
  } catch (err) {
    return sendError(res, err)
  }
})

// ---------------------------------------------------------------------------
// Gunsmith repair log
// ---------------------------------------------------------------------------

router.get('/repairs', requireAuth, requireRole('admin', 'marshal'), async (_req, res) => {
  try {
    const db = await getDb()
    const data = await db.collection('repairs').find({}).sort({ openedAtISO: -1 }).limit(500).toArray()
    return res.json({ ok: true, data })
  } catch (err) {
    return sendError(res, err)
  }
})

// GET /api/repairs/summary — repair counts and spend per item and per model/category.
router.get('/repairs/summary', requireAuth, requireRole('admin', 'marshal'), async (_req, res) => {
  try {
    const db = await getDb()
    const group = (field) => db.collection('repairs').aggregate([
      { $group: { _id: field, repairs: { $sum: 1 }, totalCost: { $sum: { $ifNull: ['$totalCost', 0] } }, open: { $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 1, 0] } } } },
      { $sort: { repairs: -1 } },
    ]).toArray()
    const [byItem, byCategory] = await Promise.all([group('$itemName'), group('$itemCategory')])
    return res.json({
      ok: true,
      data: {
        byItem: byItem.map((row) => ({ name: row._id || 'Unknown', repairs: row.repairs, totalCost: row.totalCost, open: row.open })),
        byCategory: byCategory.map((row) => ({ name: row._id || 'Uncategorized', repairs: row.repairs, totalCost: row.totalCost, open: row.open })),
      },
    })
  } catch (err) {
    return sendError(res, err)
  }
})

// The reservation a repair bills: given directly, or the one its damage report is linked to.
async function findRepairReservation(db, reservationId, damageReportId) {
  const directId = String(reservationId || '').trim()
  if (directId) {
    const reservation = await findById(db, 'reservations', directId)
    if (!reservation) throw Object.assign(new Error('Reservation not found.'), { statusCode: 404 })
    return reservation
  }
  const reportId = String(damageReportId || '').trim()
  if (!reportId) return null
  const report = await db.collection('damage_reports').findOne({ id: reportId })
  if (!report) throw Object.assign(new Error('Damage report not found.'), { statusCode: 404 })
  return report.reservationId ? findById(db, 'reservations', report.reservationId) : null
}

// POST /api/repairs { itemCollection, itemId, damage, gunsmith, damageReportId, reservationId, playerInduced }
// — opens a repair and pulls the item from rental. playerInduced repairs bill the player on completion.
router.post('/repairs', requireAuth, requireRole('admin', 'marshal'), async (req, res) => {
  const body = req.body || {}
  const itemCollection = String(body.itemCollection || '')
  const damage = String(body.damage || '').trim().slice(0, 1000)
  if (!RENTAL_COLLECTIONS.includes(itemCollection)) return res.status(400).json({ ok: false, error: 'Choose a weapon or equipment item.' })
  if (!damage) return res.status(400).json({ ok: false, error: 'Describe the damage.' })
  try {
    const db = await getDb()
    const item = await findById(db, itemCollection, body.itemId)
    if (!item) return res.status(404).json({ ok: false, error: 'Item not found' })
    let reservation = null
    try {
      reservation = await findRepairReservation(db, body.reservationId, body.damageReportId)
    } catch (err) {
      return sendError(res, err)
    }
    const nowISO = new Date().toISOString()
    const repair = {
      id: await nextShortId(db, 'repairs', 'RPR'),
      itemCollection,
      itemId: keyOf(item),
      itemName: item.name || keyOf(item),
      itemCategory: item.category || '',
      damage,
      gunsmith: String(body.gunsmith || '').trim().slice(0, 120),
      damageReportId: String(body.damageReportId || '').trim(),
      playerInduced: body.playerInduced === true,
      reservationId: reservation ? keyOf(reservation) : '',
      playerId: reservation ? String(reservation.userId || '') : '',
      status: 'in_progress',
      openedAtISO: nowISO,
      openedBy: actorOf(req),
    }
    await db.collection('repairs').insertOne(repair)
    await db.collection(itemCollection).updateOne(
      { _id: item._id },
      { $set: { status: MAINTENANCE_STATUS[itemCollection], maintenanceReason: `Under repair (${repair.id})`, updatedAtISO: nowISO } },
    )
    return res.status(201).json({ ok: true, data: repair })
  } catch (err) {
    return sendError(res, err)
  }
})

// PUT /api/repairs/:id/complete { partsReplaced, partsCost, laborCost, repairDate, note, returnToService,
// playerInduced, reservationId } — when the damage was player-induced, the repair cost is added to
// that player's reservation balance automatically as a damage penalty.
router.put('/repairs/:id/complete', requireAuth, requireRole('admin', 'marshal'), async (req, res) => {
  const body = req.body || {}
  const partsCost = money(body.partsCost || 0)
  const laborCost = money(body.laborCost || 0)
  const repairDate = String(body.repairDate || '').trim()
  if (!Number.isFinite(partsCost) || partsCost < 0 || !Number.isFinite(laborCost) || laborCost < 0) {
    return res.status(400).json({ ok: false, error: 'Costs must be zero or more.' })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(repairDate)) return res.status(400).json({ ok: false, error: 'Enter the repair date.' })
  try {
    const db = await getDb()
    const repair = await db.collection('repairs').findOne({ id: String(req.params.id) })
    if (!repair) return res.status(404).json({ ok: false, error: 'Repair not found' })
    if (repair.status !== 'in_progress') return res.status(409).json({ ok: false, error: 'This repair is already closed.' })

    const totalCost = Math.round((partsCost + laborCost) * 100) / 100
    const playerInduced = typeof body.playerInduced === 'boolean' ? body.playerInduced : repair.playerInduced === true
    let reservation = null
    if (playerInduced) {
      reservation = await findRepairReservation(db, body.reservationId || repair.reservationId, repair.damageReportId)
      if (!reservation) {
        return res.status(400).json({ ok: false, error: 'Link the reservation of the player who caused the damage so the repair cost can be billed.' })
      }
    }
    const penaltyAmount = playerInduced ? totalCost : 0

    const nowISO = new Date().toISOString()
    const update = {
      status: 'completed',
      partsReplaced: String(body.partsReplaced || '').trim().slice(0, 500),
      partsCost,
      laborCost,
      totalCost,
      repairDate,
      completionNote: String(body.note || '').trim().slice(0, 500),
      completedAtISO: nowISO,
      completedBy: actorOf(req),
      playerInduced,
      penaltyAmount,
      ...(reservation ? { reservationId: keyOf(reservation), playerId: String(reservation.userId || '') } : {}),
    }

    const session = startDbSession()
    try {
      await session.withTransaction(async () => {
        const closed = await db.collection('repairs').updateOne({ _id: repair._id, status: 'in_progress' }, { $set: update }, { session })
        if (closed.modifiedCount === 0) throw Object.assign(new Error('This repair is already closed.'), { statusCode: 409 })
        if (penaltyAmount > 0) {
          await db.collection('reservations').updateOne(
            { _id: reservation._id },
            {
              $inc: { totalAmount: penaltyAmount, balanceAmount: penaltyAmount, damageChargesTotal: penaltyAmount },
              $push: {
                pricingBreakdown: { label: `Repair penalty: ${repair.itemName}`, amount: penaltyAmount },
                damageCharges: { repairId: repair.id, reportId: repair.damageReportId || '', itemName: repair.itemName, amount: penaltyAmount, approvedBy: actorOf(req), atISO: nowISO },
              },
              $set: { updatedAtISO: nowISO },
            },
            { session },
          )
          // The linked damage report is settled by this repair bill.
          if (repair.damageReportId) {
            await db.collection('damage_reports').updateOne(
              { id: repair.damageReportId, status: 'reported' },
              { $set: { status: 'billed', chargeAmount: penaltyAmount, reviewNote: `Billed from repair ${repair.id}`, reviewedAtISO: nowISO, reviewedBy: actorOf(req) } },
              { session },
            )
          }
        }
      })
    } finally {
      await session.endSession()
    }
    if (penaltyAmount > 0) {
      void emailDamageCharge(db, reservation, {
        id: repair.id,
        itemName: repair.itemName,
        chargeAmount: penaltyAmount,
        reviewNote: update.partsReplaced ? `Repair: ${update.partsReplaced}` : '',
      })
    }
    if (body.returnToService !== false) {
      await db.collection(repair.itemCollection).updateOne(
        idFilter(repair.itemId),
        { $set: { status: 'available', updatedAtISO: nowISO }, $unset: { maintenanceReason: '' } },
      )
    }
    return res.json({ ok: true, data: { ...repair, ...update } })
  } catch (err) {
    return sendError(res, err)
  }
})

export default router
