import express from 'express'
import { randomUUID } from 'crypto'
import { getDb, startDbSession, toObjectId } from '../db/mongo.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { getGcashAmountDue, getSplitPayerIds } from '../utils/paymentRules.js'
import { syncReservationPaymentState } from '../utils/paymentProgress.js'
import { emailPaymentEvent } from '../services/notificationEmails.js'
import { createInvoice, paidPaymentOf, retrieveInvoice, verifyCallbackToken, XENDIT_CHANNELS, xenditEnabled } from '../utils/xendit.js'
import { XENDIT_CHECKOUTS, recordXenditPayment } from '../utils/xenditPayments.js'
import { appUrlFrom } from './guardianApprovals.js'

// Online payment through Xendit's hosted invoice page (test mode). The player is sent to Xendit,
// pays, and comes back; the payment is verified with Xendit by the server (from the webhook
// and when the player returns), recorded, and a fully paid booking is confirmed automatically.
// GCash and bank transfer with proof upload stay available, so an outage never blocks payment.
const router = express.Router()
// An invoice the player opened but didn't pay is reused for this long instead of making a new one.
const REUSE_CHECKOUT_MS = 30 * 60_000

function sendError(res, err) {
  if (err?.statusCode) return res.status(err.statusCode).json({ ok: false, error: err.message })
  console.error('Xendit error', err)
  return res.status(500).json({ ok: false, error: String(err?.message || err) })
}

async function findReservation(db, rawId) {
  const id = String(rawId || '').trim()
  if (!id) return null
  const objectId = toObjectId(id)
  return db.collection('reservations').findOne({ $or: [{ id }, ...(objectId ? [{ _id: objectId }] : [])] })
}

// Checks the invoice with Xendit and, once paid, records the payment and updates the booking.
async function settleCheckout(db, checkout) {
  if (checkout.status !== 'paid') {
    const invoice = await retrieveInvoice(checkout.invoiceId)
    const paid = paidPaymentOf(invoice)
    if (!paid) {
      if (String(invoice?.status || '').toUpperCase() === 'EXPIRED') {
        await db.collection(XENDIT_CHECKOUTS).updateOne({ _id: checkout._id }, { $set: { status: 'expired' } })
      }
      return { status: 'unpaid' }
    }
    const { payment, created } = await recordXenditPayment({ db, startSession: startDbSession, checkout, paid })
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

router.get('/xendit/config', (_req, res) => {
  res.json({ ok: true, data: { enabled: xenditEnabled } })
})

// POST /api/xendit/checkout { reservationId, channel? } — a Xendit invoice for what this player owes
// right now: the downpayment or full amount, or their share of a split payment.
router.post('/xendit/checkout', requireAuth, requireRole('user'), async (req, res) => {
  if (!xenditEnabled) return res.status(503).json({ ok: false, error: 'Online payment is not set up. Please pay by GCash or bank transfer.' })
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

    // gcash or qrph: the invoice page offers only that channel.
    const channelKey = String(req.body?.channel || '').toLowerCase()
    const channel = XENDIT_CHANNELS[channelKey] || ''
    const checkouts = db.collection(XENDIT_CHECKOUTS)
    const open = await checkouts.findOne({
      reservationId, userId, amount, status: 'open', channel,
      createdAtISO: { $gt: new Date(Date.now() - REUSE_CHECKOUT_MS).toISOString() },
    })
    if (open) {
      // It may have been paid in another tab; settle before sending the player to pay again.
      const settled = await settleCheckout(db, open)
      if (settled.status === 'paid') return res.status(409).json({ ok: false, error: 'This payment is already complete.', data: settled })
      const stillOpen = await checkouts.findOne({ _id: open._id, status: 'open' })
      if (stillOpen) return res.json({ ok: true, data: { checkoutUrl: open.invoiceUrl, ref: open._id, amount } })
    }

    const ref = `XNC-${randomUUID()}`
    const appUrl = appUrlFrom(req)
    const fullPlan = reservation.paymentPlan === 'full'
    const share = String(reservation.paymentMode || 'self').toLowerCase() === 'split'
    const label = share ? 'Your share of the payment' : fullPlan ? 'Full payment' : 'Downpayment (balance paid at the field)'
    const account = await db.collection('user_accounts').findOne(
      { $or: [{ id: userId }, ...(toObjectId(userId) ? [{ _id: toObjectId(userId) }] : [])] },
      { projection: { name: 1, email: 1 } },
    )
    const invoice = await createInvoice({
      amount,
      externalId: ref,
      description: `Chill Shooters reservation ${reservationId} • ${label} • ${reservation.reservationDate} ${reservation.reservationTime} • ${reservation.locationName || reservation.locationId || ''}`.slice(0, 255),
      successUrl: `${appUrl}/app/payment/complete?ref=${encodeURIComponent(ref)}`,
      failureUrl: `${appUrl}/app/payment/complete?ref=${encodeURIComponent(ref)}&cancelled=1`,
      customer: account?.email ? { name: account.name, email: account.email } : null,
      channels: channel ? [channel] : undefined,
    })
    await checkouts.insertOne({
      _id: ref,
      reservationId,
      userId,
      amount,
      invoiceId: invoice.id,
      invoiceUrl: invoice.invoiceUrl,
      channel,
      status: 'open',
      createdAtISO: new Date().toISOString(),
    })
    await checkouts.createIndex({ invoiceId: 1 }, { unique: true }).catch(() => null)
    return res.json({ ok: true, data: { checkoutUrl: invoice.invoiceUrl, ref, amount } })
  } catch (err) {
    return sendError(res, err)
  }
})

// POST /api/xendit/verify { ref } — called when the player comes back from Xendit. Asks
// Xendit directly whether the invoice was paid, so it works even without the webhook.
router.post('/xendit/verify', requireAuth, async (req, res) => {
  if (!xenditEnabled) return res.status(503).json({ ok: false, error: 'Online payment is not set up.' })
  try {
    const db = await getDb()
    const checkout = await db.collection(XENDIT_CHECKOUTS).findOne({ _id: String(req.body?.ref || '') })
    if (!checkout || (req.user.role === 'user' && String(checkout.userId) !== String(req.user.id))) {
      return res.status(404).json({ ok: false, error: 'Payment not found.' })
    }
    return res.json({ ok: true, data: { ...(await settleCheckout(db, checkout)), amount: checkout.amount } })
  } catch (err) {
    return sendError(res, err)
  }
})

// POST /api/xendit/webhook — Xendit's invoice callback. The callback token proves it came from
// Xendit; the invoice itself is still re-read from Xendit's API before anything is recorded.
router.post('/xendit/webhook', async (req, res) => {
  if (!verifyCallbackToken(req.get('x-callback-token'))) {
    return res.status(401).json({ ok: false, error: 'Invalid callback token' })
  }
  try {
    const invoiceId = String(req.body?.id || '')
    if (!invoiceId) return res.json({ ok: true })
    const db = await getDb()
    const checkout = await db.collection(XENDIT_CHECKOUTS).findOne({ invoiceId })
    if (checkout) await settleCheckout(db, checkout)
    return res.json({ ok: true })
  } catch (err) {
    // A non-2xx answer makes Xendit retry later, which is what we want for a temporary failure.
    return sendError(res, err)
  }
})

export default router
