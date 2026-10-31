import { randomUUID } from 'crypto'
import { toObjectId } from '../db/mongo.js'
import { getGcashAmountDue, normalizeGcashReference, paymentAmountMatchesDue } from './paymentRules.js'
import { normalizePhPhone } from './phone.js'

export async function submitGcashPayment({
  db,
  startSession,
  reservationId,
  userId,
  amount,
  transactionReference,
  gcashImageUrl,
  paymentMethod,
  senderNumber,
}) {
  // Players pay online by GCash or bank transfer; both are proof-plus-reference
  // submissions that a registrar verifies.
  const method = /bank/i.test(String(paymentMethod || '')) ? 'Bank Transfer' : 'GCash'
  const normalizedReference = normalizeGcashReference(transactionReference)
  // Optional: the PH mobile number the player paid from, for staff to cross-check.
  const sender = String(senderNumber || '').trim() ? normalizePhPhone(senderNumber) : ''
  if (sender === null) {
    const invalid = new Error('Enter your GCash number as 09XX XXX XXXX.')
    invalid.statusCode = 400
    throw invalid
  }
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
        const duplicate = new Error('This transaction reference has already been submitted.')
        duplicate.statusCode = 409
        throw duplicate
      }

      const objectId = toObjectId(reservationId)
      // The captain, or a teammate sharing a split payment, can pay toward the reservation.
      const reservation = await db.collection('reservations').findOne({
        $and: [
          { $or: [{ userId: String(userId) }, { splitPayerIds: String(userId) }] },
          { $or: [{ id: reservationId }, ...(objectId ? [{ _id: objectId }] : [])] },
        ],
      }, { session })
      if (!reservation || reservation.pricingVerified !== true) {
        const unavailable = new Error('Reservation not found or its price is not verified.')
        unavailable.statusCode = 409
        throw unavailable
      }
      if (String(reservation.reservationStatus || 'pending').toLowerCase() === 'cancelled') {
        const cancelled = new Error('This reservation was cancelled and no longer accepts payments.')
        cancelled.statusCode = 409
        throw cancelled
      }

      const existingPayments = await db.collection('payments').find(
        {
          reservationId,
          paymentStatus: { $nin: ['failed', 'rejected'] },
        },
        { session },
      ).toArray()
      const expectedAmount = getGcashAmountDue(reservation, existingPayments, String(userId))
      if (!paymentAmountMatchesDue(amount, expectedAmount)) {
        const amountConflict = new Error(expectedAmount <= 0
          ? 'Your share for this reservation has already been submitted.'
          : 'Payment amount does not match the reservation amount due.')
        amountConflict.statusCode = expectedAmount <= 0 ? 409 : 400
        throw amountConflict
      }

      const nowISO = new Date().toISOString()
      payment = {
        id: `PMT-${randomUUID()}`,
        reservationId,
        userId: String(userId),
        amount: expectedAmount,
        paymentMethod: method,
        paymentStatus: 'pending',
        status: 'pending',
        transactionReference: normalizedReference,
        ...(gcashImageUrl ? { gcashImageUrl: String(gcashImageUrl) } : {}),
        ...(sender ? { senderNumber: sender } : {}),
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
