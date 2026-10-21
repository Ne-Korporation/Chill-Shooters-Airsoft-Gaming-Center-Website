import { randomUUID } from 'crypto'

export async function recordVerifiedStripePayment({
  db,
  startSession,
  reservationId,
  userId,
  paymentIntentId,
  amount,
}) {
  const session = startSession()
  let payment
  try {
    await session.withTransaction(async () => {
      await db.collection('payment_deposit_locks').updateOne(
        { _id: reservationId },
        { $inc: { version: 1 } },
        { upsert: true, session },
      )

      payment = await db.collection('payments').findOne({ stripePaymentIntentId: paymentIntentId }, { session })
      if (payment) return

      const activePayment = await db.collection('payments').findOne(
        {
          reservationId,
          paymentStatus: { $nin: ['failed', 'rejected'] },
        },
        { session },
      )
      if (activePayment) {
        const conflict = new Error('A payment has already been submitted for this reservation.')
        conflict.statusCode = 409
        throw conflict
      }

      payment = {
        id: `PMT-${randomUUID()}`,
        reservationId,
        userId: String(userId || ''),
        amount,
        paymentMethod: 'Card',
        paymentStatus: 'paid',
        status: 'paid',
        stripePaymentIntentId: paymentIntentId,
        createdAtISO: new Date().toISOString(),
      }
      await db.collection('payments').insertOne(payment, { session })
    })
  } finally {
    await session.endSession()
  }
  return payment
}
