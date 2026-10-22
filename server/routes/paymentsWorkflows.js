import express from 'express'
import { getDb, startDbSession, toObjectId } from '../db/mongo.js'
import Stripe from 'stripe'
import { requireAuth, requireRole } from '../middleware/auth.js'
import {
  buildPaymentStatusUpdate,
  hasActivePayment,
  stripeIntentMatchesReservation,
} from '../utils/paymentRules.js'
import { recordVerifiedStripePayment } from '../utils/stripePayments.js'
import { emailPaymentEvent } from '../services/notificationEmails.js'

const router = express.Router()
const SETTINGS_COLLECTION = 'site_settings'
const GCASH_QR_KEY = 'gcash_qr'

const stripeSecretKey = process.env.STRIPE_SECRET_KEY
let stripe = null
if (stripeSecretKey) {
  stripe = new Stripe(stripeSecretKey, { apiVersion: null })
  console.log('Stripe initialized successfully')
} else {
  console.warn('STRIPE_SECRET_KEY not set — Stripe card payments will be disabled.')
}

// POST /api/create-payment-intent — Creates a Stripe PaymentIntent for a saved reservation.
router.post('/create-payment-intent', requireAuth, async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ ok: false, error: 'Stripe is not configured. Set STRIPE_SECRET_KEY in environment.' })
  }

  try {
    const { reservationId } = req.body || {}
    const normalizedReservationId = String(reservationId || '').trim()
    if (!normalizedReservationId) return res.status(400).json({ ok: false, error: 'reservationId is required' })

    const db = await getDb()
    const reservationObjectId = toObjectId(normalizedReservationId)
    const reservation = await db.collection('reservations').findOne({
      $or: [
        { id: normalizedReservationId },
        ...(reservationObjectId ? [{ _id: reservationObjectId }] : []),
      ],
    })
    if (!reservation) return res.status(404).json({ ok: false, error: 'Reservation not found' })
    if (req.user.role === 'user' && String(reservation.userId) !== String(req.user.id)) {
      return res.status(404).json({ ok: false, error: 'Reservation not found' })
    }
    if (reservation.pricingVerified !== true) {
      return res.status(409).json({
        ok: false,
        error: 'Card payments are unavailable until the reservation price is verified by the server. Use GCash or contact staff.',
      })
    }
    if (String(reservation.paymentMode || 'self').toLowerCase() === 'split') {
      return res.status(409).json({ ok: false, error: 'Split card payments are not supported. Use GCash to submit a share.' })
    }
    if (!['pending', 'confirmed', 'approved'].includes(String(reservation.reservationStatus || '').toLowerCase())) {
      return res.status(409).json({ ok: false, error: 'Reservation is not eligible for payment' })
    }

    const numericAmount = Number(reservation.depositAmount)
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ ok: false, error: 'Reservation has no valid deposit due' })
    }
    const priorPayments = await db.collection('payments').find({
      reservationId: normalizedReservationId,
    }).toArray()
    if (hasActivePayment(priorPayments)) {
      return res.status(409).json({ ok: false, error: 'A payment has already been submitted for this reservation. Wait for verification or contact staff.' })
    }

    // Stripe amounts are in the smallest currency unit (centavos for PHP)
    const amountInSmallestUnit = Math.round(numericAmount * 100)

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInSmallestUnit,
      currency: 'php',
      metadata: {
        reservationId: normalizedReservationId,
        userId: String(reservation.userId || ''),
      },
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never',
      },
    }, {
      idempotencyKey: `reservation-${normalizedReservationId}`,
    })

    return res.json({
      ok: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: numericAmount,
      currency: 'php',
    })
  } catch (err) {
    console.error('Stripe create-payment-intent error:', err)
    return res.status(500).json({ ok: false, error: err.message || 'Failed to create payment intent' })
  }
})

router.post('/payments/stripe-confirm', requireAuth, async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ ok: false, error: 'Stripe is not configured.' })
  }

  const reservationId = String(req.body?.reservationId || '').trim()
  const paymentIntentId = String(req.body?.paymentIntentId || '').trim()
  if (!reservationId || !paymentIntentId) {
    return res.status(400).json({ ok: false, error: 'reservationId and paymentIntentId are required' })
  }

  try {
    const db = await getDb()
    const reservationObjectId = toObjectId(reservationId)
    const reservation = await db.collection('reservations').findOne({
      $or: [
        { id: reservationId },
        ...(reservationObjectId ? [{ _id: reservationObjectId }] : []),
      ],
    })
    if (!reservation || (req.user.role === 'user' && String(reservation.userId) !== String(req.user.id))) {
      return res.status(404).json({ ok: false, error: 'Reservation not found' })
    }
    if (reservation.pricingVerified !== true) {
      return res.status(409).json({ ok: false, error: 'Reservation price has not been verified by the server.' })
    }

    const intent = await stripe.paymentIntents.retrieve(paymentIntentId)
    const expectedAmount = Math.round(Number(reservation.depositAmount) * 100)
    if (!stripeIntentMatchesReservation(intent, reservation, reservationId)) {
      return res.status(409).json({ ok: false, error: 'Stripe payment does not match this reservation or is not complete.' })
    }

    const payments = db.collection('payments')
    await payments.createIndex({ stripePaymentIntentId: 1 }, { unique: true, sparse: true })
    const payment = await recordVerifiedStripePayment({
      db,
      startSession: startDbSession,
      reservationId,
      userId: reservation.userId,
      paymentIntentId,
      amount: expectedAmount / 100,
    })

    void emailPaymentEvent(db, payment, payment?.paymentStatus || 'paid')
    return res.json({ ok: true, data: payment })
  } catch (err) {
    console.error('Stripe payment confirmation error:', err)
    if (err?.statusCode) return res.status(err.statusCode).json({ ok: false, error: err.message })
    return res.status(500).json({ ok: false, error: err.message || 'Failed to verify Stripe payment' })
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
  return null
}

async function readGcashQrSettings() {
  const db = await getDb()
  return db.collection(SETTINGS_COLLECTION).findOne({ key: GCASH_QR_KEY })
}

router.get('/payments/gcash-qr', async (_req, res) => {
  try {
    const settings = await readGcashQrSettings()
    return res.json({
      ok: true,
      data: {
        key: GCASH_QR_KEY,
        imageUrl: settings?.imageUrl || '',
        phoneNumber: settings?.phoneNumber || '',
        updatedAtISO: settings?.updatedAtISO || null,
        updatedBy: settings?.updatedBy || null,
      },
    })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

router.put('/payments/gcash-qr', requireAuth, requireRole('admin'), async (req, res) => {
  const imageUrl = String(req.body?.imageUrl || '').trim()
  const phoneNumber = String(req.body?.phoneNumber || '').trim()
  if (!imageUrl) return res.status(400).json({ ok: false, error: 'imageUrl is required' })
  if (!phoneNumber) return res.status(400).json({ ok: false, error: 'phoneNumber is required' })

  try {
    const db = await getDb()
    const updatedAtISO = new Date().toISOString()
    await db.collection(SETTINGS_COLLECTION).updateOne(
      { key: GCASH_QR_KEY },
      {
        $set: {
          key: GCASH_QR_KEY,
          imageUrl,
          phoneNumber,
          updatedAtISO,
          updatedBy: req.user?.id || req.user?.email || 'admin',
        },
      },
      { upsert: true },
    )

    return res.json({
      ok: true,
      data: {
        key: GCASH_QR_KEY,
        imageUrl,
        phoneNumber,
        updatedAtISO,
        updatedBy: req.user?.id || req.user?.email || 'admin',
      },
    })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

router.put('/payments/:id/verify', requireAuth, requireRole('admin', 'registrar'), async (req, res) => {
  const { id } = req.params
  const nextStatus = parseStatus(req.body || {})
  if (!nextStatus) return res.status(400).json({ ok: false, error: 'paymentStatus is required' })

  try {
    const db = await getDb()
    const normalizedId = String(id || '').trim()
    const objectId = toObjectId(normalizedId)

    const filter = objectId ? { _id: objectId } : { id: normalizedId }
    const payment = await db.collection('payments').findOne(filter)
    if (!payment) return res.status(404).json({ ok: false, error: 'not found' })
    const changedAtISO = new Date().toISOString()
    const reason = String(req.body?.reason || '').trim().slice(0, 500)
    let update
    try {
      update = buildPaymentStatusUpdate({
        payment,
        nextStatus,
        actorId: req.user.id,
        actorRole: req.user.role,
        reason,
        changedAtISO,
      })
    } catch (err) {
      if (err?.statusCode) return res.status(err.statusCode).json({ ok: false, error: err.message })
      throw err
    }

    const result = await db.collection('payments').findOneAndUpdate(
      filter,
      update,
      { returnDocument: 'after', upsert: false },
    )

    const updated = result?.value ?? result
    if (!updated) return res.status(404).json({ ok: false, error: 'not found' })

    void emailPaymentEvent(db, updated, nextStatus, reason)
    return res.json({ ok: true, data: updated })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

export default router
