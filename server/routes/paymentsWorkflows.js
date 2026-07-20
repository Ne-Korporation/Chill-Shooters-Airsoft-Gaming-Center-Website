import express from 'express'
import { getDb, toObjectId } from '../db/mongo.js'

const router = express.Router()

function parseStatus(body) {
  const s = body?.paymentStatus ?? body?.status
  if (!s || typeof s !== 'string') return null
  const lower = s.toLowerCase()
  if (lower === 'paid') return 'paid'
  if (lower === 'pending') return 'pending'
  if (lower === 'failed') return 'failed'
  if (lower === 'review') return 'review'
  if (lower === 'confirmed') return 'confirmed'
  return s
}

router.put('/payments/:id/verify', async (req, res) => {
  const { id } = req.params
  const _id = toObjectId(id)
  if (!_id) return res.status(400).json({ ok: false, error: 'invalid id' })

  const nextStatus = parseStatus(req.body || {})
  if (!nextStatus) return res.status(400).json({ ok: false, error: 'paymentStatus is required' })

  try {
    const db = await getDb()

    const update = {
      $set: {
        paymentStatus: nextStatus,
        updatedAtISO: new Date().toISOString(),
      },
    }

    const result = await db.collection('payments').findOneAndUpdate(
      { _id },
      update,
      { returnDocument: 'after', upsert: false },
    )

    if (!result?.value) return res.status(404).json({ ok: false, error: 'not found' })

    return res.json({ ok: true, data: result.value })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

export default router

