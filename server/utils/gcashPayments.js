import { randomUUID } from 'crypto'
import { toObjectId } from '../db/mongo.js'
import { getGcashAmountDue, normalizeGcashReference, paymentAmountMatchesDue } from './paymentRules.js'

export async function submitGcashPayment({
  db,
  startSession,
  reservationId,
  userId,
  amount,
  transactionReference,
  gcashImageUrl,
}) {
  const normalizedReference = normalizeGcashReference(transactionReference)
  const session = startSession()
  let payment
  let insertedId
  try {
    await session.withTransaction(async () => {
      await db.collection('payment_deposit_locks').updateOne(
        { _id: reservationId },
        { $inc: { version: 1 } },
        { upsert: true, session },
      )
      await db.collection('payment_reference_locks').updateOne(
        { _id: normalizedReference },
        { $inc: { version: 1 } },
        { upsert: true, session },
      )

      const reusedReference = await db.collection('payments').findOne(
        { $expr: { $eq: [{ $toLower: '$transactionReference' }, normalizedReference] } },
        { session },
      )
      if (reusedReference) {
        const duplicate = new Error('This GCash transaction reference has already been submitted.')
        duplicate.statusCode = 409
        throw duplicate
      }

      const objectId = toObjectId(reservationId)
      const reservation = await db.collection('reservations').findOne({
        $and: [
          { userId: String(userId) },
          { $or: [{ id: reservationId }, ...(objectId ? [{ _id: objectId }] : [])] },
        ],
      }, { session })
      if (!reservation || reservation.pricingVerified !== true) {
        const unavailable = new Error('Reservation not found or its price is not verified.')
        unavailable.statusCode = 409
        throw unavailable
      }

      const existingPayments = await db.collection('payments').find(
        {
          reservationId,
          paymentStatus: { $nin: ['failed', 'rejected'] },
        },
        { session },
      ).toArray()
      const expectedAmount = getGcashAmountDue(reservation, existingPayments)
      if (!paymentAmountMatchesDue(amount, expectedAmount)) {
        const amountConflict = new Error('Payment amount does not match the reservation amount due.')
        amountConflict.statusCode = expectedAmount <= 0 ? 409 : 400
        throw amountConflict
      }

      const nowISO = new Date().toISOString()
      payment = {
        id: `PMT-${randomUUID()}`,
        reservationId,
        userId: String(userId),
        amount: expectedAmount,
        paymentMethod: 'GCash',
        paymentStatus: 'pending',
        status: 'pending',
        transactionReference: normalizedReference,
        ...(gcashImageUrl ? { gcashImageUrl: String(gcashImageUrl) } : {}),
        createdAtISO: nowISO,
      }
      const result = await db.collection('payments').insertOne(payment, { session })
      insertedId = result.insertedId
    })
  } finally {
    await session.endSession()
  }
  return { payment, insertedId }
}
