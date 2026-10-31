import { randomUUID } from 'crypto'
import { PAYMENT_METHOD_LABELS } from './paymongo.js'

export const PAYMONGO_CHECKOUTS = 'paymongo_checkouts'

// Records the payment for a paid PayMongo checkout exactly once, whether the webhook or the
// player's return to the site gets here first. The amount comes from PayMongo, never the browser.
// A payment that doesn't match what was asked for (or lands on a booking that was cancelled in the
// meantime) is still recorded, since the money was taken, but goes to staff for review.
export async function recordPaymongoPayment({ db, startSession, checkout, paid }) {
  const payments = db.collection('payments')
  await payments.createIndex({ paymongoCheckoutId: 1 }, { unique: true, sparse: true }).catch(() => null)

  const session = startSession()
  let payment
  let created = false
  try {
    await session.withTransaction(async () => {
      await db.collection('payment_deposit_locks').updateOne(
        { _id: checkout.reservationId },
        { $inc: { version: 1 } },
        { upsert: true, session },
      )
      payment = await payments.findOne({ paymongoCheckoutId: checkout.checkoutId }, { session })
      if (payment) return

      const reservation = await db.collection('reservations').findOne({ id: checkout.reservationId }, { session })
      const cancelled = String(reservation?.reservationStatus || '').toLowerCase() === 'cancelled'
      const amountMatches = Math.abs(paid.amount - Number(checkout.amount)) <= 0.01
      const needsReview = cancelled || !amountMatches
      const nowISO = new Date().toISOString()
      payment = {
        id: `PMT-${randomUUID()}`,
        reservationId: checkout.reservationId,
        userId: String(checkout.userId),
        amount: paid.amount,
        paymentMethod: `PayMongo – ${PAYMENT_METHOD_LABELS[paid.method] || paid.method}`,
        paymentStatus: needsReview ? 'review' : 'paid',
        status: needsReview ? 'review' : 'paid',
        kind: 'online',
        paymongoCheckoutId: checkout.checkoutId,
        paymongoPaymentId: paid.id,
        transactionReference: paid.id,
        ...(needsReview ? {
          reviewReason: cancelled
            ? 'Paid through PayMongo after the reservation was cancelled. Refund or rebook the player.'
            : `PayMongo charged ₱${paid.amount} but ₱${checkout.amount} was due.`,
        } : {}),
        verifiedBy: 'paymongo',
        verifiedAtISO: nowISO,
        createdAtISO: nowISO,
      }
      await payments.insertOne(payment, { session })
      created = true
    })
  } finally {
    await session.endSession()
  }

  await db.collection(PAYMONGO_CHECKOUTS).updateOne(
    { _id: checkout._id },
    { $set: { status: 'paid', paymentId: payment.id, paidAtISO: payment.createdAtISO } },
  )
  return { payment, created }
}
