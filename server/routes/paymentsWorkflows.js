import express from 'express'
import { getDb, toObjectId } from '../db/mongo.js'
import Stripe from 'stripe'

const router = express.Router()

const stripeSecretKey = process.env.STRIPE_SECRET_KEY
let stripe = null
if (stripeSecretKey) {
  stripe = new Stripe(stripeSecretKey, { apiVersion: null })
  console.log('Stripe initialized successfully')
} else {
  console.warn('STRIPE_SECRET_KEY not set — Stripe card payments will be disabled.')
}

// POST /api/create-payment-intent — Creates a Stripe PaymentIntent for card payments
router.post('/create-payment-intent', async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ ok: false, error: 'Stripe is not configured. Set STRIPE_SECRET_KEY in environment.' })
  }

  try {
    const { amount, currency = 'php', reservationId, metadata = {} } = req.body || {}

    const numericAmount = Number(amount)
    if (!numericAmount || numericAmount <= 0) {
      return res.status(400).json({ ok: false, error: 'A valid amount is required' })
    }

    // Stripe amounts are in the smallest currency unit (centavos for PHP)
    const amountInSmallestUnit = Math.round(numericAmount * 100)

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInSmallestUnit,
      currency: currency.toLowerCase(),
      metadata: {
        reservationId: String(reservationId || ''),
        ...metadata,
      },
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never',
      },
    })

    return res.json({
      ok: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: numericAmount,
      currency,
    })
  } catch (err) {
    console.error('Stripe create-payment-intent error:', err)
    return res.status(500).json({ ok: false, error: err.message || 'Failed to create payment intent' })
  }
})

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
  const nextStatus = parseStatus(req.body || {})
  if (!nextStatus) return res.status(400).json({ ok: false, error: 'paymentStatus is required' })

  try {
    const db = await getDb()
    const normalizedId = String(id || '').trim()
    const objectId = toObjectId(normalizedId)

    const filter = objectId ? { _id: objectId } : { id: normalizedId }
    const update = {
      $set: {
        paymentStatus: nextStatus,
        updatedAtISO: new Date().toISOString(),
      },
    }

    const result = await db.collection('payments').findOneAndUpdate(
      filter,
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

