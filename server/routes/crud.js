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
    // Ping by listing collections (cheap enough for health)
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

// GET all documents
router.get('/:collection', async (req, res) => {
  const { collection } = req.params
  if (!ALLOWED_COLLECTIONS.has(collection)) {
    return res.status(400).json({ ok: false, error: 'collection not allowed', collectionReceived: collection, allowed: Array.from(ALLOWED_COLLECTIONS) })
  }


  const limit = Math.min(Number(req.query.limit || 50), 200)
  const skip = Math.max(Number(req.query.skip || 0), 0)

  // Basic filter support: ?filter[field]=value (optional)
  // To keep it safe/simple, we only allow JSON-stringified filter via ?q={...}
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

  const _id = safeIdParam(id)
  if (!_id) return res.status(400).json({ ok: false, error: 'invalid id' })

  try {
    const db = await getDb()
    const doc = await db.collection(collection).findOne({ _id })
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

// UPDATE (replace fields provided via $set)
router.put('/:collection/:id', async (req, res) => {
  const { collection, id } = req.params
  if (!ALLOWED_COLLECTIONS.has(collection)) {
    return res.status(400).json({ ok: false, error: 'collection not allowed' })
  }

  const _id = safeIdParam(id)
  if (!_id) return res.status(400).json({ ok: false, error: 'invalid id' })

  const payload = req.body
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ ok: false, error: 'body must be an object' })
  }

  try {
    const db = await getDb()

    // If client provided { $set: {...} } use it; else default to $set: payload
    const update = payload.$set || payload.$inc || payload.$push || payload.$addToSet || payload.$unset
      ? payload
      : { $set: payload }

    const result = await db.collection(collection).findOneAndUpdate(
      { _id },
      update,
      { returnDocument: 'after', upsert: false },
    )

    if (!result || !result.value) return res.status(404).json({ ok: false, error: 'not found' })
    return res.json({ ok: true, data: result.value })
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

  const _id = safeIdParam(id)
  if (!_id) return res.status(400).json({ ok: false, error: 'invalid id' })

  try {
    const db = await getDb()
    const result = await db.collection(collection).deleteOne({ _id })
    if (!result.deletedCount) return res.status(404).json({ ok: false, error: 'not found' })
    return res.json({ ok: true })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

export default router

