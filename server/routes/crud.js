import express from 'express'
import { ObjectId } from 'mongodb'
import { randomUUID } from 'crypto'
import { getDb, startDbSession, toObjectId } from '../db/mongo.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { ALLOWED_COLLECTIONS } from './collections.js'
import { calculateBookingPrice } from '../utils/bookingPricing.js'
import { getBookingInventoryRequirements, holdBookingInventory } from '../utils/inventoryHolds.js'
import { submitGcashPayment } from '../utils/gcashPayments.js'
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

function formatShortId(prefix, value) {
  return `${prefix}-${String(value).padStart(6, '0')}`
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

router.get('/team-directory', requireAuth, requireRole('user'), async (_req, res) => {
  try {
    const db = await getDb()
    const players = await db.collection('user_accounts')
      .find({ role: 'user', emailVerified: true }, { projection: { id: 1, name: 1, email: 1 } })
      .limit(500)
      .toArray()
    return res.json({ ok: true, data: players })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

router.get('/reservation-availability', requireAuth, requireRole('user'), async (_req, res) => {
  try {
    const db = await getDb()
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

    return res.json({
      ok: true,
      capacities: getLocationCapacities(),
      data: reservations.map((reservation) => ({
        dateISO: reservation.reservationDate || reservation.dateISO || '',
        fieldIds: extractReservationFieldIds(reservation),
        slot: reservation.reservationTime || reservation.slot || 'morning',
        sessionType: reservation.sessionType || 'public',
        players: Number(reservation.numberOfPlayers || reservation.players || 0),
        reservationStatus: reservation.reservationStatus,
        locationId: normalizeLocationId(reservation.locationId || reservation.location || reservation.locationName),
      })),
    })
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

      if (collection === 'feedback') {
        const count = await db.collection(collection).countDocuments({})
        doc.id = formatShortId('FB', count + 1)
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
        })
      } catch (err) {
        return res.status(409).json({ ok: false, error: err.message || 'Unable to validate selected inventory' })
      }
    } else if (prefix && !doc.id) {
      const count = await db.collection(collection).countDocuments({})
      doc.id = formatShortId(prefix, count + 1)
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

          const sameSlotReservations = await db.collection('reservations').find(
            {
              $and: [
                { $or: [{ reservationDate: doc.reservationDate }, { dateISO: doc.reservationDate }] },
                { $or: [{ reservationTime: doc.reservationTime }, { slot: doc.reservationTime }] },
              ],
            },
            { session },
          ).toArray()
          const blockingReservations = getBlockingSlotReservations({
            reservations: sameSlotReservations,
            locationId: doc.locationId,
            normalizeLocationId,
          })
          const bookedFieldIds = new Set(blockingReservations.flatMap(extractReservationFieldIds))
          const capacity = getLocationCapacities()[doc.locationId][doc.reservationTime]
          const usedPlayers = getSlotPlayerCount(blockingReservations)
          if (usedPlayers + playersCount > capacity) {
            const full = new Error(`This slot has only ${Math.max(0, capacity - usedPlayers)} places remaining.`)
            full.statusCode = 409
            throw full
          }

          if (doc.sessionType === 'private') {
            const conflictedFieldIds = doc.fieldIds.filter((fieldId) => bookedFieldIds.has(fieldId))
            if (conflictedFieldIds.length > 0) {
              const conflict = new Error('One or more selected fields are already booked for this location and time slot.')
              conflict.statusCode = 409
              conflict.conflictedFieldIds = conflictedFieldIds
              throw conflict
            }

            const validation = validatePrivateFieldSelection({
              locationId: doc.locationId,
              fieldIds: doc.fieldIds,
              playersCount,
              bookedFieldIds,
            })
            if (!validation.ok) {
              const invalid = new Error(validation.reason)
              invalid.statusCode = 400
              throw invalid
            }
          }

          await holdBookingInventory({
            db,
            session,
            reservationId: doc.id,
            requirements: doc.inventoryRequirements || [],
          })
          const insert = await db.collection(collection).insertOne(doc, { session })
          insertedId = insert.insertedId
        })
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
        })
        for (const key of Object.keys(doc)) delete doc[key]
        Object.assign(doc, submitted.payment)
        result = { insertedId: submitted.insertedId }
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
        { $match: { itemId: String(existing.id || id), collection: collection === 'equipment' ? 'equipments' : collection, status: 'held' } },
        { $group: { _id: null, quantity: { $sum: '$quantity' } } },
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
