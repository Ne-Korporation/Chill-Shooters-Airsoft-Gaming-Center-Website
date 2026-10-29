import express from 'express'
import { ObjectId } from 'mongodb'
import { randomUUID } from 'crypto'
import { getDb, startDbSession, toObjectId } from '../db/mongo.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { ALLOWED_COLLECTIONS } from './collections.js'
import { calculateBookingPrice } from '../utils/bookingPricing.js'
import { getBookingInventoryRequirements, getHeldQuantities, holdBookingInventory, stockQuantity } from '../utils/inventoryHolds.js'
import { canonicalEmail, normalizeEmail, sameEmailFilter } from '../utils/emails.js'
import { submitGcashPayment } from '../utils/gcashPayments.js'
import { nextShortId } from '../utils/shortIds.js'
import { emailGearReviewEvent, emailReservationEvent, emailSplitShareRequest } from '../services/notificationEmails.js'
import {
  PAYMENT_WINDOW_HOURS,
  expireOverdueReservations,
  notifyUser,
  syncReservationPaymentState,
} from '../utils/paymentProgress.js'
import {
  BLOCKING_RESERVATION_STATUSES,
  getBlockingSlotReservations,
  getSlotPlayerCount,
  normalizeLocationId,
} from '../utils/bookingSlots.js'

const router = express.Router()
const SLOT_NAMES = ['morning', 'afternoon', 'evening']
const DEFAULT_LOCATION_CAPACITIES = {
  salawag: { morning: 200, afternoon: 190, evening: 180 },
  langkaan: { morning: 200, afternoon: 190, evening: 180 },
  binan: { morning: 400, afternoon: 380, evening: 360 },
}

function getLocationCapacities() {
  return Object.fromEntries(Object.entries(DEFAULT_LOCATION_CAPACITIES).map(([location, slots]) => [
    location,
    Object.fromEntries(SLOT_NAMES.map((slot) => {
      const envKey = `BOOKING_CAPACITY_${location.toUpperCase()}_${slot.toUpperCase()}`
      const raw = process.env[envKey]
      const capacity = raw === undefined ? slots[slot] : Number(raw)
      if (!Number.isInteger(capacity) || capacity <= 0) {
        throw new Error(`${envKey} must be a positive whole number`)
      }
      return [slot, capacity]
    })),
  ]))
}

function shortIdPrefixForCollection(collection) {
  if (collection === 'dashboard_posts') return 'D'
  if (collection === 'notifications') return 'N'
  if (collection === 'reservations') return 'R'
  if (collection === 'user_accounts') return 'P'
  if (collection === 'feedback') return 'FB'
  return null
}

function isDashboardPostCollection(collection) {
  return collection === 'dashboard_posts'
}

router.get('/health', async (req, res) => {
  try {
    const db = await getDb()
    await db.listCollections().toArray()
    return res.json({ ok: true })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// GET /api/team-directory/lookup?email=... — finds one registered player by exact
// email so a captain can add them as a teammate without browsing every account.
// Players can only read their own waivers, so the teammate's approval is
// reported as a flag instead of exposing their waiver record.
router.get('/team-directory/lookup', requireAuth, requireRole('user'), async (req, res) => {
  const email = normalizeEmail(req.query.email)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: 'Enter a valid email address.' })
  }

  try {
    const db = await getDb()
    const player = await db.collection('user_accounts').findOne(
      { $and: [sameEmailFilter(email), { role: { $in: ['user', null] } }] },
      { projection: { id: 1, name: 1, email: 1, emailVerified: 1 } },
    )
    if (!player) {
      return res.status(404).json({ ok: false, error: 'No registered player uses that email. They can join as a walk-in instead.' })
    }
    const playerId = String(player.id || player._id)
    if (playerId === String(req.user.id)) {
      return res.status(400).json({ ok: false, error: 'You are already counted as the team captain.' })
    }
    if (player.emailVerified === false) {
      return res.status(409).json({ ok: false, error: 'That player has not verified their email yet.' })
    }

    const approvedWaiver = await db.collection('waivers').findOne(
      {
        status: { $regex: '^approved$', $options: 'i' },
        $or: [{ userId: playerId }, { playerId }, { accountId: playerId }],
      },
      { projection: { _id: 1 } },
    )
    const weaponOwnerIds = await getApprovedWeaponOwnerIds(db, [playerId])

    return res.json({
      ok: true,
      data: {
        id: playerId,
        name: player.name || '',
        email: player.email,
        waiverApproved: Boolean(approvedWaiver),
        // Only a yes/no flag: teammates don't see each other's registered gear.
        hasApprovedWeapon: weaponOwnerIds.has(playerId),
      },
    })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// GET /api/inventory-availability?date=YYYY-MM-DD&slot=morning
// Rental stock left for one date/slot after existing booking holds.
router.get('/inventory-availability', requireAuth, async (req, res) => {
  const reservationDate = String(req.query.date || '').trim()
  const reservationTime = String(req.query.slot || '').trim().toLowerCase()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reservationDate) || !SLOT_NAMES.includes(reservationTime)) {
    return res.status(400).json({ ok: false, error: 'date (YYYY-MM-DD) and slot are required' })
  }

  try {
    const db = await getDb()
    const held = await getHeldQuantities(db, { reservationDate, reservationTime })
    const summarize = async (collection) => {
      const items = await db.collection(collection)
        .find({}, { projection: { id: 1, qty: 1, quantity: 1, stock: 1, status: 1 } })
        .toArray()
      return Object.fromEntries(items.map((item) => {
        const id = String(item.id || item._id)
        const stock = stockQuantity(item, collection)
        const heldUnits = Number(held.get(`${collection}:${id}`) || 0)
        const usable = String(item.status || 'available').toLowerCase() === 'available'
        return [id, { stock, held: heldUnits, available: usable ? Math.max(0, stock - heldUnits) : 0 }]
      }))
    }
    const [weapons, equipments] = await Promise.all([summarize('weapons'), summarize('equipments')])
    return res.json({ ok: true, data: { reservationDate, reservationTime, weapons, equipments } })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

router.get('/reservation-availability', requireAuth, requireRole('user'), async (req, res) => {
  try {
    const db = await getDb()
    await expireOverdueReservations(db, startDbSession)
    const todayISO = new Date().toISOString().slice(0, 10)
    const reservations = await db.collection('reservations').find(
      {
        $and: [
          { reservationStatus: { $in: BLOCKING_RESERVATION_STATUSES } },
          {
            $or: [
              { reservationDate: { $gte: todayISO } },
              { dateISO: { $gte: todayISO } },
            ],
          },
        ],
      },
      {
        projection: {
          reservationDate: 1,
          dateISO: 1,
          reservationTime: 1,
          slot: 1,
          sessionType: 1,
          numberOfPlayers: 1,
          players: 1,
          locationId: 1,
          location: 1,
          locationName: 1,
          fieldId: 1,
          fieldIds: 1,
          reservationStatus: 1,
        },
      },
    ).toArray()

    // Slots other players are in the middle of booking count as taken too.
    const holds = await db.collection('slot_holds').find({
      reservationDate: { $gte: todayISO },
      expiresAt: { $gt: new Date() },
      userId: { $ne: String(req.user.id) },
    }).toArray()

    return res.json({
      ok: true,
      capacities: getLocationCapacities(),
      data: [
        ...reservations.map((reservation) => ({
          dateISO: reservation.reservationDate || reservation.dateISO || '',
          fieldIds: extractReservationFieldIds(reservation),
          slot: reservation.reservationTime || reservation.slot || 'morning',
          sessionType: reservation.sessionType || 'public',
          players: Number(reservation.numberOfPlayers || reservation.players || 0),
          reservationStatus: reservation.reservationStatus,
          locationId: normalizeLocationId(reservation.locationId || reservation.location || reservation.locationName),
        })),
        ...holds.map((hold) => ({
          dateISO: hold.reservationDate,
          fieldIds: hold.fieldIds || [],
          slot: hold.reservationTime,
          sessionType: hold.sessionType,
          players: Number(hold.players || 0),
          reservationStatus: 'held',
          locationId: hold.locationId,
        })),
      ],
    })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

const SLOT_HOLD_MINUTES = Math.max(1, Number(process.env.SLOT_HOLD_MINUTES) || 15)

async function getApprovedWeaponOwnerIds(db, userIds) {
  const owners = await db.collection('weapons').distinct('submittedBy', {
    approvalStatus: 'approved',
    ...(userIds ? { submittedBy: { $in: userIds.map(String) } } : {}),
  })
  return new Set(owners.map((id) => String(id || '')).filter(Boolean))
}

// Throws a statusCode error when the slot can't take this booking. Counts blocking reservations
// plus other players' live slot holds, so two people can't book the same slot at once.
async function assertSlotAvailable({ db, session, locationId, reservationDate, reservationTime, sessionType, fieldIds, playersCount, excludeUserId }) {
  const sameSlotReservations = await db.collection('reservations').find(
    {
      $and: [
        { $or: [{ reservationDate }, { dateISO: reservationDate }] },
        { $or: [{ reservationTime }, { slot: reservationTime }] },
      ],
    },
    { session },
  ).toArray()
  const blockingReservations = getBlockingSlotReservations({
    reservations: sameSlotReservations,
    locationId,
    normalizeLocationId,
  })
  const holds = await db.collection('slot_holds').find(
    {
      locationId,
      reservationDate,
      reservationTime,
      expiresAt: { $gt: new Date() },
      ...(excludeUserId ? { userId: { $ne: String(excludeUserId) } } : {}),
    },
    { session },
  ).toArray()

  const bookedFieldIds = new Set([
    ...blockingReservations.flatMap(extractReservationFieldIds),
    ...holds.filter((hold) => hold.sessionType === 'private').flatMap((hold) => hold.fieldIds || []),
  ])
  const capacity = getLocationCapacities()[locationId][reservationTime]
  const usedPlayers = getSlotPlayerCount(blockingReservations) + holds.reduce((sum, hold) => sum + Number(hold.players || 0), 0)
  if (usedPlayers + playersCount > capacity) {
    const full = new Error(`This slot has only ${Math.max(0, capacity - usedPlayers)} places remaining.`)
    full.statusCode = 409
    throw full
  }

  if (sessionType === 'private') {
    const conflictedFieldIds = fieldIds.filter((fieldId) => bookedFieldIds.has(fieldId))
    if (conflictedFieldIds.length > 0) {
      const conflict = new Error('One or more selected fields are already booked or being booked for this time slot.')
      conflict.statusCode = 409
      conflict.conflictedFieldIds = conflictedFieldIds
      throw conflict
    }

    const validation = validatePrivateFieldSelection({ locationId, fieldIds, playersCount, bookedFieldIds })
    if (!validation.ok) {
      const invalid = new Error(validation.reason)
      invalid.statusCode = 400
      throw invalid
    }
  }
}

// POST /api/slot-holds - temporarily locks the chosen slot while the player finishes booking.
// Calling it again refreshes the hold; each player has at most one hold.
router.post('/slot-holds', requireAuth, requireRole('user'), async (req, res) => {
  const body = req.body || {}
  const locationId = normalizeLocationId(body.locationId)
  const reservationDate = String(body.reservationDate || '').trim()
  const reservationTime = String(body.reservationTime || '').trim().toLowerCase()
  const sessionType = String(body.sessionType || '').trim().toLowerCase()
  const playersCount = Number(body.players)
  const fieldIds = Array.from(new Set((Array.isArray(body.fieldIds) ? body.fieldIds : []).map(String).filter(Boolean)))

  if (!LOCATION_FIELD_DEFS[locationId]) return res.status(400).json({ ok: false, error: 'locationId is not supported' })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reservationDate)) return res.status(400).json({ ok: false, error: 'reservationDate must be YYYY-MM-DD' })
  if (!SLOT_NAMES.includes(reservationTime)) return res.status(400).json({ ok: false, error: 'reservationTime must be morning, afternoon, or evening' })
  if (!['public', 'private'].includes(sessionType)) return res.status(400).json({ ok: false, error: 'sessionType must be public or private' })
  if (!Number.isInteger(playersCount) || playersCount <= 0 || playersCount > 600) {
    return res.status(400).json({ ok: false, error: 'players must be a whole number between 1 and 600' })
  }
  const knownFieldIds = new Set(LOCATION_FIELD_DEFS[locationId].map((f) => f.id))
  if (fieldIds.length === 0 || fieldIds.some((id) => !knownFieldIds.has(id))) {
    return res.status(400).json({ ok: false, error: 'Select valid fields for this location.' })
  }

  let session
  try {
    const db = await getDb()
    await expireOverdueReservations(db, startDbSession)
    session = startDbSession()
    let hold
    await session.withTransaction(async () => {
      await db.collection('reservation_slot_locks').updateOne(
        { _id: `${locationId}:${reservationDate}:${reservationTime}` },
        { $inc: { version: 1 } },
        { upsert: true, session },
      )
      await assertSlotAvailable({
        db, session, locationId, reservationDate, reservationTime, sessionType, fieldIds, playersCount,
        excludeUserId: req.user.id,
      })
      hold = {
        userId: String(req.user.id),
        locationId,
        reservationDate,
        reservationTime,
        sessionType,
        fieldIds,
        players: playersCount,
        expiresAt: new Date(Date.now() + SLOT_HOLD_MINUTES * 60_000),
        updatedAtISO: new Date().toISOString(),
      }
      await db.collection('slot_holds').updateOne(
        { _id: `user:${req.user.id}` },
        { $set: hold },
        { upsert: true, session },
      )
    })
    db.collection('slot_holds').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => null)
    return res.json({ ok: true, data: { ...hold, expiresAtISO: hold.expiresAt.toISOString() } })
  } catch (err) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({
        ok: false,
        error: err.message,
        ...(err.conflictedFieldIds ? { conflictedFieldIds: err.conflictedFieldIds } : {}),
      })
    }
    return res.status(500).json({ ok: false, error: String(err) })
  } finally {
    await session?.endSession()
  }
})

router.delete('/slot-holds/mine', requireAuth, requireRole('user'), async (req, res) => {
  try {
    const db = await getDb()
    await db.collection('slot_holds').deleteOne({ _id: `user:${req.user.id}` })
    return res.json({ ok: true })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

const WALK_IN_LOCATION_NAMES = {
  salawag: 'Delta Stronghold (Salawag)',
  langkaan: 'Delta Stronghold (Langkaan)',
  binan: 'LOMA Binan Laguna',
}
const ONSITE_PAYMENT_METHODS = { cash: 'Cash', gcash: 'GCash', bank_transfer: 'Bank transfer' }

// POST /api/walk-ins — the counter registers a walk-in group for today's public game: own-gear
// players pay the entrance fee; rental walk-ins only get gear that is still free. Uses the same
// capacity, inventory, and pricing checks as online bookings, and records the onsite payment.
router.post('/walk-ins', requireAuth, requireRole('admin', 'registrar'), async (req, res) => {
  const body = req.body || {}
  const walkInName = String(body.name || '').trim().slice(0, 120)
  const locationId = normalizeLocationId(body.locationId)
  const reservationTime = String(body.reservationTime || '').trim().toLowerCase()
  const playersCount = Number(body.players)
  const mode = String(body.mode || 'own_gear')
  const paymentMethod = String(body.paymentMethod || '').toLowerCase()
  const reference = String(body.reference || '').trim().slice(0, 120)
  const reservationDate = manilaTodayISO()

  if (!walkInName) return res.status(400).json({ ok: false, error: 'Enter the walk-in name.' })
  if (!LOCATION_FIELD_DEFS[locationId]) return res.status(400).json({ ok: false, error: 'Choose a location.' })
  if (!SLOT_NAMES.includes(reservationTime)) return res.status(400).json({ ok: false, error: 'Choose a time slot.' })
  if (!Number.isInteger(playersCount) || playersCount < 1 || playersCount > 100) {
    return res.status(400).json({ ok: false, error: 'Players must be a whole number from 1 to 100.' })
  }
  if (!['own_gear', 'package', 'custom'].includes(mode)) return res.status(400).json({ ok: false, error: 'Choose own gear, a package, or custom rentals.' })
  if (isWeekdayDateISO(reservationDate)) {
    return res.status(400).json({ ok: false, error: 'Walk-ins are only accepted for public games on weekends.' })
  }
  if (paymentMethod && !ONSITE_PAYMENT_METHODS[paymentMethod]) return res.status(400).json({ ok: false, error: 'Choose a valid payment method.' })
  if (paymentMethod && paymentMethod !== 'cash' && reference.length < 4) {
    return res.status(400).json({ ok: false, error: 'Enter the transaction reference number.' })
  }

  const nowISO = new Date().toISOString()
  const doc = {
    id: `R-${randomUUID()}`,
    userId: 'walk-in',
    walkIn: true,
    walkInName,
    walkInContact: String(body.contact || '').trim().slice(0, 60),
    locationId,
    locationName: WALK_IN_LOCATION_NAMES[locationId],
    reservationDate,
    reservationTime,
    sessionType: 'public',
    numberOfPlayers: playersCount,
    fieldIds: [LOCATION_FIELD_DEFS[locationId][0].id],
    fieldId: LOCATION_FIELD_DEFS[locationId][0].id,
    selectionMode: mode === 'package' ? 'package' : 'custom',
    selectedPackageId: mode === 'package' ? String(body.selectedPackageId || '') : undefined,
    customWeaponIds: mode === 'custom' && Array.isArray(body.customWeaponIds) ? body.customWeaponIds.map(String) : [],
    customEquipmentIds: mode === 'custom' && Array.isArray(body.customEquipmentIds) ? body.customEquipmentIds.map(String) : [],
    packageName: mode === 'own_gear' ? 'Walk-in (own gear)' : undefined,
    paymentMode: 'self',
    teamSize: 1,
    teamMembers: [],
    notes: String(body.notes || '').trim().slice(0, 500),
    reservationStatus: 'confirmed',
    createdAtISO: nowISO,
    updatedAtISO: nowISO,
    createdBy: { id: String(req.user.id), role: req.user.role },
    statusHistory: [{ status: 'confirmed', changedBy: String(req.user.id), changedByRole: req.user.role, changedAtISO: nowISO, reason: 'walk_in' }],
  }

  let session
  try {
    const db = await getDb()
    if (mode === 'package') {
      const pkg = await findDocumentById(db, 'packages', doc.selectedPackageId)
      doc.packageName = pkg?.name || 'Rental package'
      doc.selectedGameplayName = doc.packageName
    } else if (mode === 'custom') {
      doc.packageName = 'Walk-in (custom rentals)'
    }
    try {
      Object.assign(doc, await calculateBookingPrice({ db, payload: doc, players: playersCount, findDocumentById, userId: null }))
      doc.inventoryRequirements = await getBookingInventoryRequirements({ db, payload: doc, players: playersCount, findDocumentById })
    } catch (err) {
      return res.status(409).json({ ok: false, error: err.message || 'That gear is not available for this group.' })
    }

    session = startDbSession()
    await session.withTransaction(async () => {
      await db.collection('reservation_slot_locks').updateOne(
        { _id: `${locationId}:${reservationDate}:${reservationTime}` },
        { $inc: { version: 1 } },
        { upsert: true, session },
      )
      await assertSlotAvailable({
        db, session, locationId, reservationDate, reservationTime, sessionType: 'public', fieldIds: doc.fieldIds, playersCount,
      })
      await holdBookingInventory({ db, session, reservationId: doc.id, requirements: doc.inventoryRequirements || [] })
      await db.collection('reservations').insertOne(doc, { session })
    })

    // Marshals see walk-ins on the games board like any confirmed booking.
    await db.collection('gameplay').insertOne({
      id: await nextShortId(db, 'gameplay', 'GP'),
      Game: doc.packageName,
      Schedule: `${reservationDate} • ${reservationTime}`,
      Mode: "Marshal's choice",
      Group: `${playersCount} players (walk-in)`,
      Package: doc.packageName,
      LayoutRequest: '',
      Notes: doc.notes,
      Status: 'Scheduled',
      Actions: { canStart: true, canComplete: false, canDelete: false },
      userId: 'walk-in',
      reservationId: doc.id,
      createdAtISO: nowISO,
      updatedAtISO: nowISO,
    })

    let payment = null
    if (paymentMethod) {
      payment = {
        id: `PMT-${randomUUID()}`,
        reservationId: doc.id,
        userId: 'walk-in',
        amount: doc.totalAmount,
        paymentMethod: ONSITE_PAYMENT_METHODS[paymentMethod],
        paymentStatus: 'paid',
        status: 'paid',
        kind: 'onsite',
        ...(reference ? { transactionReference: reference.toLowerCase() } : {}),
        recordedBy: { actorId: String(req.user.id), actorRole: req.user.role },
        verifiedBy: String(req.user.id),
        verifiedByRole: req.user.role,
        verifiedAtISO: nowISO,
        createdAtISO: nowISO,
      }
      await db.collection('payments').insertOne(payment)
      await syncReservationPaymentState(db, doc)
    }
    return res.status(201).json({ ok: true, data: doc, payment })
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ ok: false, error: err.message })
    return res.status(500).json({ ok: false, error: String(err) })
  } finally {
    await session?.endSession()
  }
})

// Game modes players can request when booking; marshals see the choice on the game.
const GAME_MODES = [
  "Marshal's choice",
  'Team Deathmatch',
  'Capture the Flag',
  'Search & Destroy (bomb defusal)',
  'Domination / King of the Hill',
  'VIP Escort',
  'Attack & Defend',
]

const RESCHEDULE_CUTOFF_DAYS = 3
const RESCHEDULABLE_STATUSES = ['pending', 'needs review', 'confirmed']

// Calendar date in the field's timezone, so the cutoff doesn't shift at UTC midnight.
function manilaTodayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())
}

function daysBetweenISO(fromISO, toISO) {
  return Math.round((Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) / 86400000)
}

// POST /api/reservations/:id/reschedule { reservationDate, reservationTime, fieldIds?, reason }
// Moves a booking to a new date/slot at least three days before the original date.
// Payments stay linked to the same reservation id, so the deposit carries over.
router.post('/reservations/:id/reschedule', requireAuth, requireRole('user', 'admin', 'registrar'), async (req, res) => {
  const body = req.body || {}
  const newDate = String(body.reservationDate || '').trim()
  const newTime = String(body.reservationTime || '').trim().toLowerCase()
  const reason = String(body.reason || '').trim().slice(0, 500)

  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate) || Number.isNaN(Date.parse(`${newDate}T00:00:00Z`))) {
    return res.status(400).json({ ok: false, error: 'reservationDate must be a valid YYYY-MM-DD date' })
  }
  if (!SLOT_NAMES.includes(newTime)) {
    return res.status(400).json({ ok: false, error: 'reservationTime must be morning, afternoon, or evening' })
  }
  if (!reason) return res.status(400).json({ ok: false, error: 'Please give a reason for rescheduling.' })

  const todayISO = manilaTodayISO()
  if (newDate <= todayISO) {
    return res.status(400).json({ ok: false, error: 'The new date must be after today.' })
  }

  try {
    const db = await getDb()
    const reservation = await findDocumentById(db, 'reservations', req.params.id)
    if (!reservation) return res.status(404).json({ ok: false, error: 'Reservation not found' })
    if (req.user.role === 'user' && !isOwnedByUser(reservation, req.user.id)) {
      return res.status(403).json({ ok: false, error: 'You can only reschedule your own reservations.' })
    }

    const status = String(reservation.reservationStatus || 'pending').toLowerCase()
    if (!RESCHEDULABLE_STATUSES.includes(status)) {
      return res.status(409).json({ ok: false, error: `A ${status} reservation cannot be rescheduled.` })
    }

    const originalDate = String(reservation.reservationDate || reservation.dateISO || '')
    const originalTime = String(reservation.reservationTime || reservation.slot || '').toLowerCase()
    if (req.user.role === 'user' && daysBetweenISO(todayISO, originalDate) < RESCHEDULE_CUTOFF_DAYS) {
      return res.status(409).json({
        ok: false,
        error: `Reservations can only be rescheduled at least ${RESCHEDULE_CUTOFF_DAYS} days before the original date.`,
      })
    }
    if (newDate === originalDate && newTime === originalTime && !Array.isArray(body.fieldIds)) {
      return res.status(400).json({ ok: false, error: 'Choose a different date or time slot.' })
    }

    const locationId = normalizeLocationId(reservation.locationId || reservation.location || reservation.locationName)
    const sessionType = String(reservation.sessionType || 'public').toLowerCase()
    const playersCount = Number(reservation.numberOfPlayers ?? reservation.players ?? 0)
    if (isWeekdayDateISO(newDate) && sessionType !== 'private') {
      return res.status(400).json({ ok: false, error: 'Weekday reservations must be private sessions.' })
    }

    const knownFieldIds = new Set((LOCATION_FIELD_DEFS[locationId] || []).map((field) => field.id))
    const fieldIds = Array.isArray(body.fieldIds)
      ? Array.from(new Set(body.fieldIds.map(String).filter(Boolean)))
      : extractReservationFieldIds(reservation)
    if (fieldIds.length === 0 || fieldIds.some((id) => !knownFieldIds.has(id))) {
      return res.status(400).json({ ok: false, error: 'One or more selected fields are invalid for this location.' })
    }

    const reservationId = String(reservation.id || reservation._id)
    const nowISO = new Date().toISOString()
    const rescheduleEvent = {
      fromDate: originalDate,
      fromTime: originalTime,
      toDate: newDate,
      toTime: newTime,
      fieldIds,
      reason,
      actorId: String(req.user.id || ''),
      actorRole: req.user.role,
      atISO: nowISO,
    }

    const session = startDbSession()
    try {
      let updated
      await session.withTransaction(async () => {
        const lockId = `${locationId}:${newDate}:${newTime}`
        await db.collection('reservation_slot_locks').updateOne(
          { _id: lockId },
          { $inc: { version: 1 } },
          { upsert: true, session },
        )

        const sameSlot = await db.collection('reservations').find(
          {
            $and: [
              { $or: [{ reservationDate: newDate }, { dateISO: newDate }] },
              { $or: [{ reservationTime: newTime }, { slot: newTime }] },
            ],
          },
          { session },
        ).toArray()
        const blocking = getBlockingSlotReservations({ reservations: sameSlot, locationId, normalizeLocationId })
          .filter((other) => String(other.id || other._id) !== reservationId)

        const capacity = getLocationCapacities()[locationId][newTime]
        const usedPlayers = getSlotPlayerCount(blocking)
        if (usedPlayers + playersCount > capacity) {
          const full = new Error(`The new slot has only ${Math.max(0, capacity - usedPlayers)} places remaining.`)
          full.statusCode = 409
          throw full
        }

        if (sessionType === 'private') {
          const bookedFieldIds = new Set(blocking.flatMap(extractReservationFieldIds))
          const validation = validatePrivateFieldSelection({ locationId, fieldIds, playersCount, bookedFieldIds })
          if (!validation.ok) {
            const conflict = new Error(validation.reason)
            conflict.statusCode = 409
            throw conflict
          }
        }

        updated = await db.collection('reservations').findOneAndUpdate(
          { _id: reservation._id, reservationStatus: reservation.reservationStatus },
          {
            $set: {
              reservationDate: newDate,
              dateISO: newDate,
              reservationTime: newTime,
              slot: newTime,
              fieldIds,
              fieldId: fieldIds[0],
              rescheduledAtISO: nowISO,
              updatedAtISO: nowISO,
            },
            $push: { rescheduleHistory: rescheduleEvent },
          },
          { session, returnDocument: 'after' },
        )
        if (!updated) {
          const changed = new Error('This reservation changed while you were rescheduling. Please reload and try again.')
          changed.statusCode = 409
          throw changed
        }

        // Rental holds are per date/slot, so they move with the booking.
        await db.collection('inventory_holds').updateMany(
          { reservationId, status: 'held' },
          { $set: { reservationDate: newDate, reservationTime: newTime } },
          { session },
        )
      })

      // A confirmed booking already has a gameplay entry; keep its schedule in step.
      await db.collection('gameplay').updateMany(
        { reservationId: { $in: [reservationId, String(reservation._id)] } },
        { $set: { Schedule: `${newDate} • ${newTime}`, updatedAtISO: nowISO } },
      )

      await db.collection('audit_logs').insertOne({
        action: 'reservation_rescheduled',
        resourceType: 'reservations',
        resourceId: reservationId,
        actorId: String(req.user.id || ''),
        actorRole: req.user.role,
        details: rescheduleEvent,
        createdAtISO: nowISO,
      }).catch((err) => console.error('Failed to write reschedule audit log', err))

      void emailReservationEvent(db, updated, 'rescheduled', nowISO)
      return res.json({ ok: true, data: updated })
    } catch (err) {
      if (err?.statusCode) return res.status(err.statusCode).json({ ok: false, error: err.message })
      throw err
    } finally {
      await session.endSession()
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

function safeIdParam(id) {
  try {
    return toObjectId(id)
  } catch {
    return null
  }
}

const STAFF_ROLES = ['admin', 'registrar', 'marshal']
const READ_ROLES = {
  dashboard_posts: ['admin', 'registrar', 'marshal', 'user'],
  equipment: STAFF_ROLES,
  equipments: ['admin', 'registrar', 'marshal', 'user'],
  feedback: [...STAFF_ROLES, 'user'],
  gameplay: ['admin', 'registrar', 'marshal', 'user'],
  packages: ['admin', 'registrar', 'marshal', 'user'],
  notifications: [...STAFF_ROLES, 'user'],
  partnerships: ['admin', 'registrar'],
  payments: ['admin', 'registrar', 'user'],
  reservations: [...STAFF_ROLES, 'user'],
  user_accounts: [...STAFF_ROLES, 'user'],
  waivers: ['admin', 'registrar', 'user'],
  weapons: ['admin', 'registrar', 'marshal', 'user'],
}

const USER_OWNED_COLLECTIONS = new Set(['feedback', 'gameplay', 'payments', 'reservations', 'user_accounts', 'waivers'])

function canReadCollection(role, collection) {
  return READ_ROLES[collection]?.includes(role) ?? false
}

function isOwnedByUser(doc, userId) {
  return [doc?.userId, doc?.playerId, doc?.accountId, doc?.submittedBy]
    .some((ownerId) => ownerId != null && String(ownerId) === String(userId))
}

function canAccessNotification(doc, user) {
  if (user?.role === 'admin') return true
  if (String(doc?.userId) === String(user?.id)) return true
  return doc?.userId === 'broadcast' && ['all', user?.role].includes(doc?.targetRole)
}

function playerOwnershipFilter(userId) {
  return {
    $or: [
      { userId: String(userId) },
      { playerId: String(userId) },
      { accountId: String(userId) },
      { submittedBy: String(userId) },
    ],
  }
}

function mergeFilters(...filters) {
  const active = filters.filter((filter) => filter && Object.keys(filter).length > 0)
  if (active.length === 0) return {}
  return active.length === 1 ? active[0] : { $and: active }
}

function canCreateCollection(role, collection) {
  if (role === 'admin') return true
  if (role === 'registrar') return ['reservations', 'payments'].includes(collection)
  if (role === 'marshal') return ['equipments', 'weapons'].includes(collection)
  if (role === 'user') return ['reservations', 'payments', 'waivers', 'equipments', 'feedback', 'weapons'].includes(collection)
  return false
}

const LOCATION_FIELD_DEFS = {
  salawag: [
    { id: 'salawag-field-1', name: 'Upper Ground' },
    { id: 'salawag-field-2', name: 'Lower Ground' },
    { id: 'salawag-field-3', name: 'Forest' },
  ],
  langkaan: [
    { id: 'langkaan-field-1', name: 'Upper Ground' },
    { id: 'langkaan-field-2', name: 'Lower Ground' },
    { id: 'langkaan-field-3', name: 'Forest' },
  ],
  binan: [
    { id: 'binan-field-1', name: 'Upper Ground' },
    { id: 'binan-field-2', name: 'Lower Ground' },
    { id: 'binan-field-3', name: 'Forest' },
  ],
}

function getFieldBandById(fieldId) {
  return { min: 10 }
}

function isWeekdayDateISO(isoDate) {
  const dateValue = String(isoDate || '').trim()
  if (!dateValue) return false
  const d = new Date(`${dateValue}T12:00:00`)
  if (Number.isNaN(d.getTime())) return false
  const day = d.getDay()
  return day >= 1 && day <= 5
}

function extractReservationFieldIds(reservation) {
  if (Array.isArray(reservation?.fieldIds)) {
    return reservation.fieldIds.map((id) => String(id)).filter(Boolean)
  }
  if (reservation?.fieldId) {
    return [String(reservation.fieldId)]
  }
  return []
}

function validatePrivateFieldSelection({ locationId, fieldIds, playersCount, bookedFieldIds }) {
  const locationFields = LOCATION_FIELD_DEFS[locationId] || []
  const selectedFields = locationFields.filter((field) => fieldIds.includes(field.id))
  if (selectedFields.length === 0) {
    return { ok: false, reason: 'Select at least one valid field for the chosen location.' }
  }

  const hasBookedSelection = selectedFields.some((field) => bookedFieldIds.has(field.id))
  if (hasBookedSelection) {
    return { ok: false, reason: 'One or more selected fields are already booked for this location and time slot.' }
  }

  const allMeetSelectedMinimums = selectedFields.every((field) => playersCount >= getFieldBandById(field.id).min)
  if (allMeetSelectedMinimums) return { ok: true }

  const suitableFields = locationFields
    .filter((field) => {
      const band = getFieldBandById(field.id)
      return playersCount >= band.min && (band.max === undefined || playersCount <= band.max)
    })
    .sort((a, b) => getFieldBandById(a.id).min - getFieldBandById(b.id).min)

  const smallestSuitableField = suitableFields[0]
  if (!smallestSuitableField) {
    return { ok: false, reason: 'Selected field combination is not valid for this group size.' }
  }

  const smallestMin = getFieldBandById(smallestSuitableField.id).min
  const smallestFieldBooked = bookedFieldIds.has(smallestSuitableField.id)

  const allBelowMinimumSelectionsAreLarger = selectedFields
    .filter((field) => playersCount < getFieldBandById(field.id).min)
    .every((field) => {
    const band = getFieldBandById(field.id)
      return band.min > smallestMin
  })

  if (smallestFieldBooked && allBelowMinimumSelectionsAreLarger) {
    return { ok: true, usedException: true }
  }

  return { ok: false, reason: 'Selected field combination is not valid for this group size.' }
}

async function findDocumentById(db, collection, id) {
  const normalizedId = String(id || '').trim()
  if (!normalizedId) return null

  const byPublicId = await db.collection(collection).findOne({ id: normalizedId })
  if (byPublicId) return byPublicId

  const objectId = safeIdParam(normalizedId)
  if (objectId) {
    const byObjectId = await db.collection(collection).findOne({ _id: objectId })
    if (byObjectId) return byObjectId
  }

  return null
}

// GET all documents
router.get('/:collection', requireAuth, async (req, res) => {
  const { collection } = req.params
  if (!ALLOWED_COLLECTIONS.has(collection)) {
    return res.status(400).json({ ok: false, error: 'collection not allowed', collectionReceived: collection, allowed: Array.from(ALLOWED_COLLECTIONS) })
  }
  if (!canReadCollection(req.user.role, collection)) {
    return res.status(403).json({ ok: false, error: 'Forbidden: insufficient role permissions' })
  }

  const limit = Math.min(Number(req.query.limit || 50), 200)
  const skip = Math.max(Number(req.query.skip || 0), 0)

  let filter = {}
  if (req.query.q) {
    try {
      filter = JSON.parse(String(req.query.q))
    } catch {
      return res.status(400).json({ ok: false, error: 'invalid q JSON' })
    }
  }

  try {
    const db = await getDb()
    const playerUser = req.user.role === 'user'
    if (playerUser && collection === 'user_accounts') {
      const objectId = safeIdParam(req.user.id)
      const docs = await db.collection(collection).findOne(
        mergeFilters(
          { $or: [{ id: String(req.user.id) }, ...(objectId ? [{ _id: objectId }] : [])] },
          filter,
        ),
        { projection: { password: 0, otpCode: 0, otpExpiresAt: 0 } },
      )
      if (docs) {
        delete docs.identityDocumentUrl
        delete docs.email
      }
      return res.json({ ok: true, data: docs ? [docs] : [] })
    }

    if (playerUser && USER_OWNED_COLLECTIONS.has(collection)) {
      filter = mergeFilters(filter, playerOwnershipFilter(req.user.id))
    }
    if (playerUser && collection === 'notifications') {
      filter = mergeFilters(filter, {
        $or: [
          { userId: String(req.user.id) },
          { userId: 'broadcast', targetRole: 'all' },
          { userId: 'broadcast', targetRole: 'user' },
        ],
      })
    }
    if (!playerUser && collection === 'notifications' && req.user.role !== 'admin') {
      filter = mergeFilters(filter, {
        $or: [
          { userId: String(req.user.id) },
          { userId: 'broadcast', targetRole: 'all' },
          { userId: 'broadcast', targetRole: req.user.role },
        ],
      })
    }

    let query = db
      .collection(collection)
      .find(filter)
      .skip(skip)
      .limit(limit)

    if (collection === 'user_accounts') {
      const projection = { password: 0, otpCode: 0, otpExpiresAt: 0 }
      if (req.user.role !== 'admin') projection.identityDocumentUrl = 0
      if (playerUser) projection.email = 0
      query = query.project(projection)
    }
    const docs = await query.toArray()

    return res.json({ ok: true, data: docs })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// GET one by id
router.get('/:collection/:id', requireAuth, async (req, res) => {
  const { collection, id } = req.params
  if (!ALLOWED_COLLECTIONS.has(collection)) {
    return res.status(400).json({ ok: false, error: 'collection not allowed' })
  }
  if (!canReadCollection(req.user.role, collection)) {
    return res.status(403).json({ ok: false, error: 'Forbidden: insufficient role permissions' })
  }

  try {
    const db = await getDb()
    const doc = await findDocumentById(db, collection, id)
    if (!doc) return res.status(404).json({ ok: false, error: 'not found' })
    if (req.user.role === 'user' && collection === 'user_accounts' && String(doc.id || doc._id) !== String(req.user.id)) {
      return res.status(404).json({ ok: false, error: 'not found' })
    }
    if (req.user.role === 'user' && USER_OWNED_COLLECTIONS.has(collection) && !isOwnedByUser(doc, req.user.id)) {
      return res.status(404).json({ ok: false, error: 'not found' })
    }
    if (collection === 'notifications' && !canAccessNotification(doc, req.user)) {
      return res.status(404).json({ ok: false, error: 'not found' })
    }
    if (collection === 'user_accounts') {
      delete doc.password
      delete doc.otpCode
      delete doc.otpExpiresAt
      if (req.user.role !== 'admin') delete doc.identityDocumentUrl
      if (req.user.role === 'user') {
        delete doc.email
      }
    }
    return res.json({ ok: true, data: doc })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// Rebuilds the team from verified accounts (never trusting client names or sizes), works out
// who shares a split payment, and counts own weapons only for players with an approved one on file.
async function resolveTeamAndOwnWeapons(db, doc) {
  const captainId = String(doc.userId)
  const requestedIds = Array.from(new Set(
    (Array.isArray(doc.selectedTeammateIds) ? doc.selectedTeammateIds : []).map(String).filter((id) => id && id !== captainId),
  ))
  if (requestedIds.length > Math.max(0, doc.numberOfPlayers - 1)) {
    const tooMany = new Error('You selected more teammates than the group size allows.')
    tooMany.statusCode = 400
    throw tooMany
  }
  const objectIds = requestedIds.map((id) => toObjectId(id)).filter(Boolean)
  const accounts = requestedIds.length
    ? await db.collection('user_accounts').find(
      { role: 'user', $or: [{ id: { $in: requestedIds } }, ...(objectIds.length ? [{ _id: { $in: objectIds } }] : [])] },
      { projection: { id: 1, name: 1, email: 1 } },
    ).toArray()
    : []
  if (accounts.length !== requestedIds.length) {
    const unknown = new Error('One or more selected teammates could not be found.')
    unknown.statusCode = 400
    throw unknown
  }
  const teamMembers = accounts.map((account) => ({ id: String(account.id || account._id), name: account.name || '', email: account.email || '' }))
  const split = String(doc.paymentMode || 'self').toLowerCase() === 'split'
  if (split && teamMembers.length === 0) {
    const noTeam = new Error('Add at least one registered teammate to split the payment.')
    noTeam.statusCode = 400
    throw noTeam
  }

  const memberIds = new Set([captainId, ...teamMembers.map((member) => member.id)])
  const bringerIds = Array.from(new Set(
    (Array.isArray(doc.ownWeaponBringerIds) ? doc.ownWeaponBringerIds : []).map(String).filter((id) => memberIds.has(id)),
  ))
  const owners = bringerIds.length ? await getApprovedWeaponOwnerIds(db, bringerIds) : new Set()
  const ownWeaponBringers = bringerIds.map((userId) => ({ userId, verified: owners.has(userId) }))

  return {
    teamMembers,
    selectedTeammateIds: teamMembers.map((member) => member.id),
    paymentMode: split ? 'split' : 'self',
    teamSize: split ? teamMembers.length + 1 : 1,
    splitPayerIds: split ? teamMembers.map((member) => member.id) : [],
    ownWeaponBringerIds: bringerIds,
    ownWeaponBringers,
    ownWeaponTarget: Math.max(0, Math.round(Number(doc.ownWeaponTarget) || 0)),
    verifiedOwnWeaponCount: Math.min(doc.numberOfPlayers, ownWeaponBringers.filter((bringer) => bringer.verified).length),
  }
}

// Tells each teammate in a split payment what they owe and by when.
async function notifySplitPayers(db, reservation) {
  if (reservation.paymentMode !== 'split') return
  const share = Math.round((Number(reservation.depositAmount || 0) / reservation.teamSize) * 100) / 100
  const captain = await findDocumentById(db, 'user_accounts', reservation.userId)
  const captainName = captain?.name || 'Your team captain'
  const dueLabel = new Date(reservation.paymentDueAtISO).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })
  for (const userId of reservation.splitPayerIds) {
    await notifyUser(db, {
      userId,
      type: 'split_payment_requested',
      title: 'Your split payment share is due',
      message: `${captainName} added you to a reservation on ${reservation.reservationDate} (${reservation.reservationTime}). Your share is ₱${share.toLocaleString()}; pay it from Split Payment before ${dueLabel}.`,
      linkedResourceId: reservation.id,
    })
    void emailSplitShareRequest(db, reservation, userId, share, captainName, dueLabel)
  }
}

// CREATE
router.post('/:collection', requireAuth, async (req, res) => {
  const { collection } = req.params
  if (!ALLOWED_COLLECTIONS.has(collection)) {
    return res.status(400).json({ ok: false, error: 'collection not allowed', collectionReceived: collection, allowed: Array.from(ALLOWED_COLLECTIONS) })
  }

  if (isDashboardPostCollection(collection) && req.user?.role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Forbidden: insufficient role permissions' })
  }

  if (collection === 'payments' && req.user.role !== 'user') {
    return res.status(403).json({ ok: false, error: 'Staff payments must use an audited payment workflow.' })
  }

  if (!canCreateCollection(req.user.role, collection)) {
    return res.status(403).json({ ok: false, error: 'Forbidden: insufficient role permissions' })
  }
  const payload = { ...(req.body || {}) }
  let paymentReservationId = ''
  if (collection === 'user_accounts') {
    const email = normalizeEmail(payload.email)
    if (!email) return res.status(400).json({ ok: false, error: 'email is required' })
    try {
      const db = await getDb()
      if (await db.collection('user_accounts').findOne(sameEmailFilter(email), { projection: { _id: 1 } })) {
        return res.status(409).json({ ok: false, error: 'email already registered' })
      }
    } catch (err) {
      return res.status(500).json({ ok: false, error: String(err) })
    }
    payload.email = email
    payload.emailCanonical = canonicalEmail(email)
  }
  if (collection === 'reservations') {
    for (const field of [
      'pricingVerified',
      'totalAmount',
      'depositAmount',
      'balanceAmount',
      'pricingBreakdown',
      'pricingConfigVersion',
      'packageDiscountAmount',
      'paymentDepositPolicy',
      'fieldPrice',
      'equipmentPrice',
      'entranceFee',
      'serviceFee',
      'itemizedBreakdown',
      'verifiedOwnWeaponCount',
      'ownWeaponBringers',
      'splitPayerIds',
      'teamSize',
      'paymentState',
      'paymentDueAtISO',
      'paymentSubmittedAmount',
      'paymentVerifiedAmount',
      'paymentFinalizedAtISO',
      'forwardedToAdminAtISO',
      'cancellationReason',
    ]) {
      delete payload[field]
    }
  }
  if (req.user.role === 'user') {
    if (collection === 'reservations' || collection === 'payments' || collection === 'waivers') {
      payload.userId = String(req.user.id)
    }
    if (collection === 'payments') {
      payload.paymentStatus = 'pending'
      payload.status = 'pending'
    }
    if (collection === 'equipments' || collection === 'weapons') {
      payload.submittedBy = String(req.user.id)
      payload.source = 'player'
      payload.approvalStatus = 'pending'
      payload.status = 'available'
    }
    if (collection === 'feedback') payload.userId = String(req.user.id)
    if (collection === 'notifications') {
      if (payload.targetRole || (payload.userId && String(payload.userId) !== String(req.user.id))) {
        return res.status(403).json({ ok: false, error: 'Players cannot create notifications for other users or roles' })
      }
      payload.userId = String(req.user.id)
      delete payload.targetRole
    }
  }

  try {
    const db = await getDb()

    if (isDashboardPostCollection(collection)) {
      const message = String(payload.message || '').trim()
      if (!message) {
        return res.status(400).json({ ok: false, error: 'message is required' })
      }
    }

    if (collection === 'waivers' && payload.userId) {
      const existingWaiver = await db.collection(collection).findOne({ userId: String(payload.userId) })
      if (existingWaiver) {
        return res.status(409).json({ ok: false, error: 'User has already submitted a waiver' })
      }
    }

    if (collection === 'payments' && req.user.role === 'user') {
      paymentReservationId = String(payload.reservationId || '').trim()
      if (!paymentReservationId) return res.status(400).json({ ok: false, error: 'reservationId is required' })
    }

    if (collection === 'feedback') {
      const ratings = ['reservationRating', 'cleanlinessRating', 'equipmentRating', 'layoutRating', 'staffRating']
      const invalidRating = ratings.some((key) => !Number.isInteger(Number(payload[key])) || Number(payload[key]) < 1 || Number(payload[key]) > 5)
      const gameplayId = String(payload.gameplayId || '').trim()
      if (invalidRating) return res.status(400).json({ ok: false, error: 'All feedback ratings must be whole numbers from 1 to 5.' })
      if (!gameplayId) return res.status(400).json({ ok: false, error: 'gameplayId is required.' })
      if (req.user.role === 'user') {
        const gameplay = await findDocumentById(db, 'gameplay', gameplayId)
        if (!gameplay || !isOwnedByUser(gameplay, req.user.id)) {
          return res.status(404).json({ ok: false, error: 'Completed gameplay not found.' })
        }
        if (!['completed', 'archived'].includes(String(gameplay.Status || gameplay.status || '').toLowerCase())) {
          return res.status(409).json({ ok: false, error: 'Feedback can only be submitted after gameplay is completed.' })
        }
        const existingFeedback = await db.collection('feedback').findOne({
          gameplayId,
          userId: String(req.user.id),
        })
        if (existingFeedback) return res.status(409).json({ ok: false, error: 'Feedback was already submitted for this game.' })
        payload.userId = String(req.user.id)
        payload.status = 'submitted'
      }
      for (const key of ratings) payload[key] = Number(payload[key])
      payload.comment = String(payload.comment || '').trim().slice(0, 2000)
      payload.createdAtISO = new Date().toISOString()
    }

    if (collection === 'reservations') {
      const locationId = normalizeLocationId(payload.locationId || payload.location || payload.locationName)
      const reservationDate = String(payload.reservationDate || payload.dateISO || '').trim()
      const reservationTime = String(payload.reservationTime || payload.slot || '').trim().toLowerCase()
      const sessionType = String(payload.sessionType || '').trim().toLowerCase()
      const playersCount = Number(payload.numberOfPlayers ?? payload.players ?? 0)
      const fieldIds = Array.from(new Set(
        (Array.isArray(payload.fieldIds) ? payload.fieldIds : (payload.fieldId ? [payload.fieldId] : []))
          .map((id) => String(id))
          .filter(Boolean),
      ))

      if (!locationId) return res.status(400).json({ ok: false, error: 'locationId is required' })
      if (!/^\d{4}-\d{2}-\d{2}$/.test(reservationDate) || Number.isNaN(new Date(`${reservationDate}T12:00:00`).getTime())) {
        return res.status(400).json({ ok: false, error: 'reservationDate must be a valid YYYY-MM-DD date' })
      }
      if (reservationDate < new Date().toISOString().slice(0, 10)) {
        return res.status(400).json({ ok: false, error: 'Reservation date cannot be in the past' })
      }
      if (!['morning', 'afternoon', 'evening'].includes(reservationTime)) {
        return res.status(400).json({ ok: false, error: 'reservationTime must be morning, afternoon, or evening' })
      }

      if (!['public', 'private'].includes(sessionType)) {
        return res.status(400).json({ ok: false, error: 'sessionType must be public or private' })
      }
      if (!Number.isInteger(playersCount) || playersCount <= 0 || playersCount > 600) {
        return res.status(400).json({ ok: false, error: 'numberOfPlayers must be a whole number between 1 and 600' })
      }
      if (fieldIds.length === 0) {
        return res.status(400).json({ ok: false, error: 'Select at least one field.' })
      }

      const gameModePreference = String(payload.gameModePreference || '').trim()
      if (gameModePreference && !GAME_MODES.includes(gameModePreference)) {
        return res.status(400).json({ ok: false, error: 'Choose a game mode from the list.' })
      }
      payload.gameModePreference = gameModePreference || undefined
      payload.layoutRequest = String(payload.layoutRequest || '').trim().slice(0, 500) || undefined
      payload.notes = String(payload.notes || '').trim().slice(0, 1000)

      const knownFieldIds = new Set((LOCATION_FIELD_DEFS[locationId] || []).map((f) => f.id))
      const hasUnknownField = fieldIds.some((id) => !knownFieldIds.has(id))
      if (hasUnknownField) {
        return res.status(400).json({ ok: false, error: 'One or more selected fields are invalid for this location.' })
      }

      const isWeekday = isWeekdayDateISO(reservationDate)
      if (isWeekday && sessionType !== 'private') {
        return res.status(400).json({ ok: false, error: 'Weekday reservations must be private sessions.' })
      }

      if (!LOCATION_FIELD_DEFS[locationId]) {
        return res.status(400).json({ ok: false, error: 'locationId is not supported' })
      }
      if (req.user.role === 'user') payload.userId = String(req.user.id)
    }

    const prefix = shortIdPrefixForCollection(collection)
    const nowISO = new Date().toISOString()
    const doc = { ...payload }

    if (collection === 'reservations') {
      doc.locationId = normalizeLocationId(payload.locationId || payload.location || payload.locationName)
      doc.reservationDate = String(payload.reservationDate || payload.dateISO).trim()
      doc.reservationTime = String(payload.reservationTime || payload.slot).trim().toLowerCase()
      doc.sessionType = String(payload.sessionType).trim().toLowerCase()
      doc.numberOfPlayers = Number(payload.numberOfPlayers ?? payload.players)
      doc.fieldIds = Array.from(new Set(
        (Array.isArray(payload.fieldIds) ? payload.fieldIds : (payload.fieldId ? [payload.fieldId] : []))
          .map((id) => String(id))
          .filter(Boolean),
      ))
      if (!doc.fieldId && doc.fieldIds.length > 0) {
        doc.fieldId = doc.fieldIds[0]
      }
    }

    if (isDashboardPostCollection(collection)) {
      doc.message = String(payload.message || '').trim()
      doc.imageUrl = String(payload.imageUrl || '').trim() || undefined
      doc.postedAtISO = nowISO
      doc.createdAtISO = nowISO
      doc.updatedAtISO = nowISO
      doc.createdByUserId = req.user?.id || ''
      doc.createdByEmail = req.user?.email || ''
      doc.createdByRole = req.user?.role || ''
    }

    if (collection === 'reservations') {
      doc.id = `R-${randomUUID()}`
      doc.createdAtISO = nowISO
      doc.updatedAtISO = nowISO
      doc.reservationStatus = 'pending'
      doc.paymentState = 'awaiting'
      doc.paymentDueAtISO = new Date(Date.now() + PAYMENT_WINDOW_HOURS * 3600_000).toISOString()
      try {
        Object.assign(doc, await resolveTeamAndOwnWeapons(db, doc))
      } catch (err) {
        return res.status(err?.statusCode || 400).json({ ok: false, error: err.message || 'Invalid team selection' })
      }
      try {
        Object.assign(doc, await calculateBookingPrice({
          db,
          payload: doc,
          playersCount: doc.numberOfPlayers,
          players: doc.numberOfPlayers,
          findDocumentById,
          userId: doc.userId,
        }))
      } catch (err) {
        return res.status(400).json({ ok: false, error: err.message || 'Unable to calculate reservation price' })
      }
      try {
        doc.inventoryRequirements = await getBookingInventoryRequirements({
          db,
          payload: doc,
          players: doc.numberOfPlayers,
          findDocumentById,
          heldQuantities: await getHeldQuantities(db, {
            reservationDate: doc.reservationDate,
            reservationTime: doc.reservationTime,
          }),
        })
      } catch (err) {
        return res.status(409).json({ ok: false, error: err.message || 'Unable to validate selected inventory' })
      }
    } else if (prefix && !doc.id) {
      doc.id = await nextShortId(db, collection, prefix)
    }

    if (collection === 'reservations') {
      const session = startDbSession()
      try {
        let insertedId
        await session.withTransaction(async () => {
          const lockId = `${doc.locationId}:${doc.reservationDate}:${doc.reservationTime}`
          await db.collection('reservation_slot_locks').updateOne(
            { _id: lockId },
            { $inc: { version: 1 } },
            { upsert: true, session },
          )

          await assertSlotAvailable({
            db,
            session,
            locationId: doc.locationId,
            reservationDate: doc.reservationDate,
            reservationTime: doc.reservationTime,
            sessionType: doc.sessionType,
            fieldIds: doc.fieldIds,
            playersCount: doc.numberOfPlayers,
            excludeUserId: doc.userId,
          })

          await holdBookingInventory({
            db,
            session,
            reservationId: doc.id,
            requirements: doc.inventoryRequirements || [],
            reservationDate: doc.reservationDate,
            reservationTime: doc.reservationTime,
          })
          const insert = await db.collection(collection).insertOne(doc, { session })
          insertedId = insert.insertedId
          // The booking now holds the slot itself.
          await db.collection('slot_holds').deleteOne({ _id: `user:${doc.userId}` }, { session })
        })
        void emailReservationEvent(db, doc, 'received')
        void notifySplitPayers(db, doc)
        return res.status(201).json({ ok: true, insertedId, data: doc })
      } catch (err) {
        if (err?.statusCode) {
          return res.status(err.statusCode).json({
            ok: false,
            error: err.message,
            ...(err.conflictedFieldIds ? { conflictedFieldIds: err.conflictedFieldIds } : {}),
          })
        }
        throw err
      } finally {
        await session.endSession()
      }
    }

    if (collection === 'feedback') {
      await db.collection(collection).createIndex(
        { gameplayId: 1, userId: 1 },
        {
          unique: true,
          partialFilterExpression: {
            gameplayId: { $type: 'string' },
            userId: { $type: 'string' },
          },
        },
      )
    }
    let result
    try {
      if (collection === 'payments' && req.user.role === 'user') {
        const submitted = await submitGcashPayment({
          db,
          startSession: startDbSession,
          reservationId: paymentReservationId,
          userId: req.user.id,
          amount: payload.amount,
          transactionReference: payload.transactionReference,
          gcashImageUrl: payload.gcashImageUrl,
          paymentMethod: payload.paymentMethod,
        })
        for (const key of Object.keys(doc)) delete doc[key]
        Object.assign(doc, submitted.payment)
        result = { insertedId: submitted.insertedId }
        const paidReservation = await findDocumentById(db, 'reservations', paymentReservationId)
        await syncReservationPaymentState(db, paidReservation)
      } else {
        result = await db.collection(collection).insertOne(doc)
      }
    } catch (err) {
      if (collection === 'feedback' && err?.code === 11000) {
        return res.status(409).json({ ok: false, error: 'Feedback was already submitted for this game.' })
      }
      if (collection === 'payments' && err?.code === 11000) {
        return res.status(409).json({ ok: false, error: 'This payment reference has already been submitted.' })
      }
      if (err?.statusCode) return res.status(err.statusCode).json({ ok: false, error: err.message })
      throw err
    }
    return res.status(201).json({ ok: true, insertedId: result.insertedId, data: doc })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// When staff approve or reject a player's submitted gear, tell the owner in-app and by email.
async function notifyGearReview(db, collection, before, after) {
  const status = String(after.approvalStatus || '').toLowerCase()
  if (!after.submittedBy || status === String(before.approvalStatus || '').toLowerCase()) return
  if (!['approved', 'rejected'].includes(status)) return
  const kind = collection === 'weapons' ? 'weapon' : 'equipment'
  const name = after.name || after.id || 'your item'
  try {
    await db.collection('notifications').insertOne({
      id: await nextShortId(db, 'notifications', 'N'),
      userId: String(after.submittedBy),
      type: `${kind}_${status}`,
      title: status === 'approved' ? `Your ${kind} was approved` : `Your ${kind} was not approved`,
      message: status === 'approved'
        ? `"${name}" passed admin review. You can now bring it to your games.`
        : `"${name}" was not approved.${after.rejectionReason ? ` Reason: ${after.rejectionReason}` : ''}`,
      linkedResourceId: String(after.id || after._id),
      read: false,
      createdAtISO: new Date().toISOString(),
    })
  } catch (err) {
    console.error('Gear review notification failed', err?.message || err)
  }
  void emailGearReviewEvent(db, after, kind, status)
}

// UPDATE - fixed: uses updateOne + separate findOne to avoid MongoDB driver v6 bug
// where findOneAndUpdate with returnDocument:'after' returns value:null on success
router.put('/:collection/:id', requireAuth, async (req, res) => {
  const { collection, id } = req.params
  if (!ALLOWED_COLLECTIONS.has(collection)) {
    return res.status(400).json({ ok: false, error: 'collection not allowed' })
  }

  const payload = req.body
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ ok: false, error: 'body must be an object' })
  }
  const updateRole = req.user.role
  const allowedUpdateRoles = {
    dashboard_posts: ['admin'],
    equipment: ['admin', 'marshal'],
    equipments: ['admin', 'marshal'],
    feedback: ['admin'],
    gameplay: ['admin', 'registrar', 'marshal'],
    packages: ['admin'],
    notifications: ['admin', 'registrar', 'marshal', 'user'],
    partnerships: ['admin'],
    payments: [],
    reservations: [],
    user_accounts: ['admin', 'user'],
    waivers: ['admin', 'registrar'],
    weapons: ['admin', 'marshal'],
  }
  if (!allowedUpdateRoles[collection]?.includes(updateRole)) {
    return res.status(403).json({ ok: false, error: 'Forbidden: insufficient role permissions' })
  }
  if (updateRole === 'user' && collection === 'user_accounts') {
    const changes = payload.$set || payload
    const usesUnsupportedOperator = Object.keys(payload).some((field) => field.startsWith('$') && field !== '$set')
    const hasMixedUpdateShape = Object.prototype.hasOwnProperty.call(payload, '$set') &&
      Object.keys(payload).some((field) => field !== '$set')
    const allowedProfileFields = new Set(['name', 'email', 'profileImageUrl'])
    if (
      usesUnsupportedOperator ||
      hasMixedUpdateShape ||
      Object.keys(changes).some((field) => !allowedProfileFields.has(field))
    ) {
      return res.status(403).json({ ok: false, error: 'Profile update contains fields that players cannot change' })
    }
  }
  if (collection === 'notifications' && updateRole !== 'admin') {
    const changes = payload.$set || payload
    if (Object.keys(changes).some((field) => field !== 'read') || changes.read !== true) {
      return res.status(403).json({ ok: false, error: 'Users may only mark notifications as read' })
    }
  }

  try {
    const db = await getDb()
    const existing = await findDocumentById(db, collection, id)
    if (!existing) return res.status(404).json({ ok: false, error: 'not found' })
    if (updateRole === 'user' && collection === 'user_accounts' && String(existing.id || existing._id) !== String(req.user.id)) {
      return res.status(404).json({ ok: false, error: 'not found' })
    }
    if (collection === 'notifications' && !canAccessNotification(existing, req.user)) {
      return res.status(404).json({ ok: false, error: 'not found' })
    }

    if (collection === 'user_accounts') {
      const changes = payload.$set || payload
      if (Object.prototype.hasOwnProperty.call(changes, 'email')) {
        const email = normalizeEmail(changes.email)
        if (!email) return res.status(400).json({ ok: false, error: 'email cannot be empty' })
        const taken = await db.collection('user_accounts').findOne(
          { $and: [sameEmailFilter(email), { _id: { $ne: existing._id } }] },
          { projection: { _id: 1 } },
        )
        if (taken) return res.status(409).json({ ok: false, error: 'That email is already used by another account.' })
        changes.email = email
        changes.emailCanonical = canonicalEmail(email)
      }
    }

    if (['equipment', 'equipments', 'weapons'].includes(collection)) {
      const changes = payload.$set || payload
      if (Object.keys(payload).some((field) => field.startsWith('$') && field !== '$set')) {
        return res.status(400).json({ ok: false, error: 'Inventory updates support direct fields or $set only.' })
      }
      const existingQuantity = Number(existing.qty ?? existing.quantity ?? existing.stock ?? (collection === 'weapons' ? 1 : 0))
      const nextQuantity = Number(changes.qty ?? changes.quantity ?? changes.stock ?? existingQuantity)
      if (!Number.isInteger(nextQuantity) || nextQuantity < 0) {
        return res.status(400).json({ ok: false, error: 'Inventory quantity must be a non-negative whole number.' })
      }
      const held = await db.collection('inventory_holds').aggregate([
        {
          $match: {
            itemId: String(existing.id || id),
            collection: collection === 'equipment' ? 'equipments' : collection,
            status: 'held',
            reservationDate: { $gte: new Date().toISOString().slice(0, 10) },
          },
        },
        // Units are held per date/slot, so the busiest upcoming slot sets the floor.
        { $group: { _id: { date: '$reservationDate', slot: '$reservationTime' }, quantity: { $sum: '$quantity' } } },
        { $sort: { quantity: -1 } },
        { $limit: 1 },
      ]).toArray()
      const heldQuantity = Number(held[0]?.quantity || 0)
      const nextStatus = String(changes.status ?? existing.status ?? 'available').toLowerCase()
      if (nextQuantity < heldQuantity || (heldQuantity > 0 && nextStatus !== 'available')) {
        return res.status(409).json({
          ok: false,
          error: `Inventory has ${heldQuantity} unit(s) held for active reservations and cannot be reduced or disabled.`,
        })
      }
    }

    if (isDashboardPostCollection(collection)) {
      const nextMessage = String(payload.message ?? existing.message ?? '').trim()
      if (!nextMessage) {
        return res.status(400).json({ ok: false, error: 'message is required' })
      }
    }

    // Build the update operation
    const update = payload.$set || payload.$inc || payload.$push || payload.$addToSet || payload.$unset
      ? payload
      : { $set: payload }

    if (isDashboardPostCollection(collection)) {
      update.$set = { ...(update.$set || {}), updatedAtISO: new Date().toISOString() }
      if (typeof update.$set.message === 'string') {
        update.$set.message = update.$set.message.trim()
      }
      if (typeof update.$set.imageUrl === 'string') {
        update.$set.imageUrl = update.$set.imageUrl.trim()
      }
    }

    // Prefer the public `id` field for updates to avoid ObjectId type mismatch
    const filter = existing.id
      ? { id: String(existing.id) }
      : existing._id && typeof existing._id === 'object'
        ? { _id: existing._id }
        : { id: String(id) }

    // Use updateOne + independent findOne instead of findOneAndUpdate
    // because MongoDB driver v6+ can return { value: null } even on success
    await db.collection(collection).updateOne(filter, update)

    const updatedDoc = await findDocumentById(db, collection, existing.id || id)
    if (!updatedDoc) return res.status(404).json({ ok: false, error: 'not found' })

    if (['equipment', 'equipments', 'weapons'].includes(collection)) {
      await notifyGearReview(db, collection, existing, updatedDoc)
    }

    return res.json({ ok: true, data: updatedDoc })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// DELETE
router.delete('/:collection/:id', requireAuth, async (req, res) => {
  const { collection, id } = req.params
  if (!ALLOWED_COLLECTIONS.has(collection)) {
    return res.status(400).json({ ok: false, error: 'collection not allowed' })
  }

  const deleteRole = req.user.role
  const allowedDeleteRoles = {
    dashboard_posts: ['admin'],
    equipment: ['admin'],
    equipments: ['admin'],
    feedback: ['admin'],
    gameplay: [],
    packages: ['admin'],
    notifications: ['admin', 'registrar', 'marshal', 'user'],
    partnerships: ['admin'],
    payments: [],
    reservations: [],
    user_accounts: ['admin'],
    waivers: ['admin'],
    weapons: ['admin'],
  }
  if (!allowedDeleteRoles[collection]?.includes(deleteRole)) {
    return res.status(403).json({ ok: false, error: 'Forbidden: insufficient role permissions' })
  }

  try {
    const db = await getDb()
    const existing = await findDocumentById(db, collection, id)
    if (!existing) return res.status(404).json({ ok: false, error: 'not found' })
    if (collection === 'notifications' && !canAccessNotification(existing, req.user)) {
      return res.status(404).json({ ok: false, error: 'not found' })
    }
    if (deleteRole !== 'admin' && collection !== 'notifications') {
      return res.status(404).json({ ok: false, error: 'not found' })
    }

    const delFilter = existing._id && typeof existing._id === 'object'
      ? { _id: existing._id }
      : { id: String(existing.id || id) }

    const result = await db.collection(collection).deleteOne(delFilter)
    if (!result.deletedCount) return res.status(404).json({ ok: false, error: 'not found' })
    return res.json({ ok: true })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

export default router
