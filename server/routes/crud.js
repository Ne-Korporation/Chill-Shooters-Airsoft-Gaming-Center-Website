import express from 'express'
import { ObjectId } from 'mongodb'
import { getDb, toObjectId } from '../db/mongo.js'
import { ALLOWED_COLLECTIONS } from './collections.js'

const router = express.Router()

function shortIdPrefixForCollection(collection) {
  if (collection === 'reservations') return 'R'
  if (collection === 'user_accounts') return 'P'
  return null
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

function safeIdParam(id) {
  try {
    return toObjectId(id)
  } catch {
    return null
  }
}

const BLOCKING_RESERVATION_STATUSES = ['pending', 'confirmed', 'approved']

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

function normalizeLocationId(value) {
  const v = String(value || '').trim().toLowerCase()
  if (!v) return ''
  if (v.includes('salawag')) return 'salawag'
  if (v.includes('langkaan')) return 'langkaan'
  if (v.includes('binan')) return 'binan'
  return v
}

function getFieldBandById(fieldId) {
  const id = String(fieldId || '').toLowerCase()
  if (id.endsWith('-field-1')) return { min: 10, max: 19 }
  if (id.endsWith('-field-2')) return { min: 20, max: 49 }
  return { min: 50 }
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
router.get('/:collection', async (req, res) => {
  const { collection } = req.params
  if (!ALLOWED_COLLECTIONS.has(collection)) {
    return res.status(400).json({ ok: false, error: 'collection not allowed', collectionReceived: collection, allowed: Array.from(ALLOWED_COLLECTIONS) })
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
    const docs = await db
      .collection(collection)
      .find(filter)
      .skip(skip)
      .limit(limit)
      .toArray()

    return res.json({ ok: true, data: docs })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// GET one by id
router.get('/:collection/:id', async (req, res) => {
  const { collection, id } = req.params
  if (!ALLOWED_COLLECTIONS.has(collection)) {
    return res.status(400).json({ ok: false, error: 'collection not allowed' })
  }

  try {
    const db = await getDb()
    const doc = await findDocumentById(db, collection, id)
    if (!doc) return res.status(404).json({ ok: false, error: 'not found' })
    return res.json({ ok: true, data: doc })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// CREATE
router.post('/:collection', async (req, res) => {
  const { collection } = req.params
  if (!ALLOWED_COLLECTIONS.has(collection)) {
    return res.status(400).json({ ok: false, error: 'collection not allowed', collectionReceived: collection, allowed: Array.from(ALLOWED_COLLECTIONS) })
  }

  const payload = req.body || {}

  try {
    const db = await getDb()

    if (collection === 'waivers' && payload.userId) {
      const existingWaiver = await db.collection(collection).findOne({ userId: String(payload.userId) })
      if (existingWaiver) {
        return res.status(409).json({ ok: false, error: 'User has already submitted a waiver' })
      }
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
      if (!reservationDate) return res.status(400).json({ ok: false, error: 'reservationDate is required' })
      if (!['morning', 'afternoon', 'evening'].includes(reservationTime)) {
        return res.status(400).json({ ok: false, error: 'reservationTime must be morning, afternoon, or evening' })
      }
      if (!['public', 'private'].includes(sessionType)) {
        return res.status(400).json({ ok: false, error: 'sessionType must be public or private' })
      }
      if (!Number.isFinite(playersCount) || playersCount <= 0) {
        return res.status(400).json({ ok: false, error: 'numberOfPlayers must be greater than 0' })
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

      const sameDateSlotReservations = await db.collection('reservations').find({
        reservationDate,
        reservationTime,
      }).toArray()

      const blockingReservations = sameDateSlotReservations.filter((r) => {
        const status = String(r?.reservationStatus || '').toLowerCase()
        const sameLocation = normalizeLocationId(r?.locationId || r?.location || r?.locationName) === locationId
        return sameLocation && BLOCKING_RESERVATION_STATUSES.includes(status)
      })

      const bookedFieldIds = new Set(
        blockingReservations.flatMap((r) => extractReservationFieldIds(r)),
      )

      // Weekday private game rule: one reservation per field+slot+location.
      if (isWeekday && sessionType === 'private') {
        const conflictedFieldIds = fieldIds.filter((id) => bookedFieldIds.has(id))
        if (conflictedFieldIds.length > 0) {
          return res.status(409).json({
            ok: false,
            error: 'One or more selected fields are already booked for this location and time slot.',
            conflictedFieldIds,
          })
        }
      }

      if (sessionType === 'private') {
        const validation = validatePrivateFieldSelection({
          locationId,
          fieldIds,
          playersCount,
          bookedFieldIds,
        })
        if (!validation.ok) {
          return res.status(400).json({ ok: false, error: validation.reason })
        }
      }
    }

    const prefix = shortIdPrefixForCollection(collection)
    const doc = { ...payload }

    if (collection === 'reservations') {
      doc.locationId = normalizeLocationId(payload.locationId || payload.location || payload.locationName)
      doc.fieldIds = Array.from(new Set(
        (Array.isArray(payload.fieldIds) ? payload.fieldIds : (payload.fieldId ? [payload.fieldId] : []))
          .map((id) => String(id))
          .filter(Boolean),
      ))
      if (!doc.fieldId && doc.fieldIds.length > 0) {
        doc.fieldId = doc.fieldIds[0]
      }
    }

    if (prefix && !doc.id) {
      const count = await db.collection(collection).countDocuments({})
      doc.id = formatShortId(prefix, count + 1)
    }

    const result = await db.collection(collection).insertOne(doc)
    return res.status(201).json({ ok: true, insertedId: result.insertedId, data: doc })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// UPDATE - fixed: uses updateOne + separate findOne to avoid MongoDB driver v6 bug
// where findOneAndUpdate with returnDocument:'after' returns value:null on success
router.put('/:collection/:id', async (req, res) => {
  const { collection, id } = req.params
  if (!ALLOWED_COLLECTIONS.has(collection)) {
    return res.status(400).json({ ok: false, error: 'collection not allowed' })
  }

  const payload = req.body
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ ok: false, error: 'body must be an object' })
  }

  try {
    const db = await getDb()
    const existing = await findDocumentById(db, collection, id)
    if (!existing) return res.status(404).json({ ok: false, error: 'not found' })

    // Build the update operation
    const update = payload.$set || payload.$inc || payload.$push || payload.$addToSet || payload.$unset
      ? payload
      : { $set: payload }

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
router.delete('/:collection/:id', async (req, res) => {
  const { collection, id } = req.params
  if (!ALLOWED_COLLECTIONS.has(collection)) {
    return res.status(400).json({ ok: false, error: 'collection not allowed' })
  }

  try {
    const db = await getDb()
    const existing = await findDocumentById(db, collection, id)
    if (!existing) return res.status(404).json({ ok: false, error: 'not found' })

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

