import express from 'express'
import { randomUUID } from 'crypto'
import { getDb, startDbSession, toObjectId } from '../db/mongo.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { getGcashAmountDue, getSplitPayerIds } from '../utils/paymentRules.js'
import { syncReservationPaymentState } from '../utils/paymentProgress.js'
import { emailPaymentEvent } from '../services/notificationEmails.js'
import { createCheckoutSession, paidPaymentOf, paymongoEnabled, retrieveCheckoutSession, verifyWebhookSignature } from '../utils/paymongo.js'
import { PAYMONGO_CHECKOUTS, recordPaymongoPayment } from '../utils/paymongoPayments.js'
import { appUrlFrom } from './guardianApprovals.js'

// Online payment through PayMongo's hosted checkout (test mode). The player is sent to PayMongo,
// pays, and comes back; the payment is verified with PayMongo by the server (from the webhook
// and when the player returns), recorded, and a fully paid booking is confirmed automatically.
const router = express.Router()
// A checkout link the player opened but didn't pay is reused for this long instead of making a new one.
const REUSE_CHECKOUT_MS = 30 * 60_000

function sendError(res, err) {
  if (err?.statusCode) return res.status(err.statusCode).json({ ok: false, error: err.message })
  console.error('PayMongo error', err)
  return res.status(500).json({ ok: false, error: String(err?.message || err) })
}

async function findReservation(db, rawId) {
  const id = String(rawId || '').trim()
  if (!id) return null
  const objectId = toObjectId(id)
  return db.collection('reservations').findOne({ $or: [{ id }, ...(objectId ? [{ _id: objectId }] : [])] })
}

// Checks the checkout with PayMongo and, once paid, records the payment and updates the booking.
async function settleCheckout(db, checkout) {
  if (checkout.status !== 'paid') {
    const session = await retrieveCheckoutSession(checkout.checkoutId)
    const paid = paidPaymentOf(session)
    if (!paid) return { status: 'unpaid' }
    const { payment, created } = await recordPaymongoPayment({ db, startSession: startDbSession, checkout, paid })
    if (created) {
      const reservation = await db.collection('reservations').findOne({ id: checkout.reservationId })
      await syncReservationPaymentState(db, reservation)
      void emailPaymentEvent(db, payment, payment.paymentStatus)
    }
  }
  const reservation = await db.collection('reservations').findOne({ id: checkout.reservationId })
  const guardianPending = await db.collection('guardian_approvals').countDocuments({ reservationId: checkout.reservationId, status: { $ne: 'approved' } })
  return {
    status: 'paid',
    reservationId: checkout.reservationId,
    reservationStatus: reservation?.reservationStatus || 'pending',
    paymentState: reservation?.paymentState || '',
    waitingForGuardian: guardianPending > 0,
    balanceDue: Math.max(0, Number(reservation?.totalAmount || 0) - Number(reservation?.depositAmount || 0)),
  }
}

router.get('/paymongo/config', (_req, res) => {
  res.json({ ok: true, data: { enabled: paymongoEnabled } })
})

// POST /api/paymongo/checkout { reservationId } — a PayMongo checkout for what this player owes
// right now: the downpayment or full amount, or their share of a split payment.
router.post('/paymongo/checkout', requireAuth, requireRole('user'), async (req, res) => {
  if (!paymongoEnabled) return res.status(503).json({ ok: false, error: 'Online payment is not set up yet. Please contact staff.' })
  try {
    const db = await getDb()
    const reservation = await findReservation(db, req.body?.reservationId)
    const userId = String(req.user.id)
    if (!reservation || !getSplitPayerIds(reservation).includes(userId)) {
      return res.status(404).json({ ok: false, error: 'Reservation not found.' })
    }
    if (reservation.pricingVerified !== true) return res.status(409).json({ ok: false, error: 'The reservation price has not been verified yet.' })
    if (String(reservation.reservationStatus || 'pending').toLowerCase() !== 'pending') {
      return res.status(409).json({ ok: false, error: 'This reservation is no longer waiting for payment.' })
    }

    const reservationId = String(reservation.id)
    const payments = await db.collection('payments').find({ reservationId: { $in: [reservationId, String(reservation._id)] } }).toArray()
    const amount = getGcashAmountDue(reservation, payments, userId)
    if (amount <= 0) return res.status(409).json({ ok: false, error: 'Your payment for this reservation is already in.' })

    const checkouts = db.collection(PAYMONGO_CHECKOUTS)
    const open = await checkouts.findOne({
      reservationId, userId, amount, status: 'open',
      createdAtISO: { $gt: new Date(Date.now() - REUSE_CHECKOUT_MS).toISOString() },
    })
    if (open) {
      // It may have been paid in another tab; settle before sending the player to pay again.
      const settled = await settleCheckout(db, open)
      if (settled.status === 'paid') return res.status(409).json({ ok: false, error: 'This payment is already complete.', data: settled })
      return res.json({ ok: true, data: { checkoutUrl: open.checkoutUrl, ref: open._id, amount } })
    }

    const ref = `PMC-${randomUUID()}`
    const appUrl = appUrlFrom(req)
    const fullPlan = reservation.paymentPlan === 'full'
    const share = String(reservation.paymentMode || 'self').toLowerCase() === 'split'
    const label = share ? 'Your share of the payment' : fullPlan ? 'Full payment' : 'Downpayment (balance paid in cash at the field)'
    const session = await createCheckoutSession({
      amount,
      name: `Chill Shooters reservation ${reservationId}`,
      description: `${label} • ${reservation.reservationDate} ${reservation.reservationTime} • ${reservation.locationName || reservation.locationId || ''}`.slice(0, 255),
      reference: ref,
      successUrl: `${appUrl}/app/payment/complete?ref=${encodeURIComponent(ref)}`,
      cancelUrl: `${appUrl}/app/payment/complete?ref=${encodeURIComponent(ref)}&cancelled=1`,
      metadata: { reservationId, userId, checkoutRef: ref },
    })
    await checkouts.insertOne({
      _id: ref,
      reservationId,
      userId,
      amount,
      checkoutId: session.id,
      checkoutUrl: session.checkoutUrl,
      status: 'open',
      createdAtISO: new Date().toISOString(),
    })
    await checkouts.createIndex({ checkoutId: 1 }, { unique: true }).catch(() => null)
    return res.json({ ok: true, data: { checkoutUrl: session.checkoutUrl, ref, amount } })
  } catch (err) {
    return sendError(res, err)
  }
})

// POST /api/paymongo/verify { ref } — called when the player comes back from PayMongo. Asks
// PayMongo directly whether the checkout was paid, so it works even without the webhook.
router.post('/paymongo/verify', requireAuth, async (req, res) => {
  if (!paymongoEnabled) return res.status(503).json({ ok: false, error: 'Online payment is not set up.' })
  try {
    const db = await getDb()
    const checkout = await db.collection(PAYMONGO_CHECKOUTS).findOne({ _id: String(req.body?.ref || '') })
    if (!checkout || (req.user.role === 'user' && String(checkout.userId) !== String(req.user.id))) {
      return res.status(404).json({ ok: false, error: 'Payment not found.' })
    }
    return res.json({ ok: true, data: { ...(await settleCheckout(db, checkout)), amount: checkout.amount } })
  } catch (err) {
    return sendError(res, err)
  }
})

// POST /api/paymongo/webhook — PayMongo's notification that a checkout was paid. The signature
// proves it came from PayMongo; the payment itself is still re-read from PayMongo's API.
router.post('/paymongo/webhook', async (req, res) => {
  if (!verifyWebhookSignature(req.get('paymongo-signature'), req.rawBody)) {
    return res.status(401).json({ ok: false, error: 'Invalid signature' })
  }
  try {
    const event = req.body?.data?.attributes || {}
    const resource = event.data || {}
    // Test mode only; checkout events carry the checkout session itself.
    if (event.livemode === true || resource.type !== 'checkout_session' || !resource.id) return res.json({ ok: true })
    const db = await getDb()
    const checkout = await db.collection(PAYMONGO_CHECKOUTS).findOne({ checkoutId: resource.id })
    if (checkout) await settleCheckout(db, checkout)
    return res.json({ ok: true })
  } catch (err) {
    // A non-2xx answer makes PayMongo retry later, which is what we want for a temporary failure.
    return sendError(res, err)
  }
})

export default router
