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
    const prefix = shortIdPrefixForCollection(collection)
    const doc = { ...payload }

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

