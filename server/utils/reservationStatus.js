import { releaseBookingInventory } from './inventoryHolds.js'
import { getPaymentProgress } from './paymentRules.js'
import { getActorName } from './actors.js'

const CANCELLABLE_PAYMENT_STATUSES = ['pending', 'submitted', 'review', 'needs review']

export async function updateReservationStatusAtomically({
  db,
  startSession,
  reservationFilter,
  reservationId,
  nextStatus,
  actor,
  reason = '',
}) {
  const actorName = actor?.role === 'system' ? '' : await getActorName(db, actor).catch(() => '')
  const session = startSession()
  let updatedReservation
  try {
    await session.withTransaction(async () => {
      await db.collection('reservation_status_locks').updateOne(
        { _id: reservationId },
        { $inc: { version: 1 } },
        { upsert: true, session },
      )
      const current = await db.collection('reservations').findOne(reservationFilter, { session })
      if (!current) {
        const missing = new Error('Reservation not found.')
        missing.statusCode = 404
        throw missing
      }
      if (String(current.reservationStatus || '').toLowerCase() === 'cancelled' && nextStatus !== 'cancelled') {
        const conflict = new Error('Cancelled reservations cannot be reopened. Create a new reservation instead.')
        conflict.statusCode = 409
        throw conflict
      }

      // No-cancellation policy: once every share of the payment is in, the booking stands.
      if (nextStatus === 'cancelled' && String(current.reservationStatus || '').toLowerCase() !== 'cancelled') {
        const reservationIds = [current.id, current._id].filter(Boolean).map(String)
        const payments = await db.collection('payments').find({ reservationId: { $in: reservationIds } }, { session }).toArray()
        if (getPaymentProgress(current, payments).state === 'finalized') {
          const locked = new Error('This reservation is fully paid and can no longer be cancelled (no-cancellation policy).')
          locked.statusCode = 409
          throw locked
        }
      }

      if (String(current.reservationStatus || '').toLowerCase() === nextStatus) {
        updatedReservation = current
        return
      }

      const changedAtISO = new Date().toISOString()
      const statusEvent = {
        status: nextStatus,
        changedBy: String(actor.id),
        changedByRole: actor.role,
        ...(actorName ? { changedByName: actorName } : {}),
        changedAtISO,
        ...(reason ? { reason: String(reason).slice(0, 200) } : {}),
      }
      await db.collection('reservations').updateOne(
        reservationFilter,
        {
          $set: {
            reservationStatus: nextStatus,
            updatedAtISO: changedAtISO,
            // Who made the latest decision, shown on the reservation lists.
            lastStatusChange: { status: nextStatus, byId: String(actor.id), byRole: actor.role, byName: actorName, atISO: changedAtISO },
            ...(nextStatus === 'cancelled' && reason ? { cancellationReason: String(reason).slice(0, 200) } : {}),
          },
          $push: { statusHistory: statusEvent },
        },
        { session },
      )
      if (nextStatus === 'cancelled') {
        await releaseBookingInventory(db, reservationId, session)
        // Proofs nobody verified yet no longer need review, and stop counting as money pending.
        // Verified payments are kept as they are for the financial record.
        const reservationIds = [current.id, current._id].filter(Boolean).map(String)
        await db.collection('payments').updateMany(
          {
            reservationId: { $in: reservationIds },
            paymentStatus: { $in: CANCELLABLE_PAYMENT_STATUSES },
          },
          {
            $set: { paymentStatus: 'cancelled', updatedAtISO: changedAtISO },
            $push: {
              auditTrail: {
                status: 'cancelled',
                changedBy: String(actor.id),
                changedByRole: actor.role,
                changedByName: actorName,
                reason: 'Reservation cancelled',
                changedAtISO,
              },
            },
          },
          { session },
        )
      }
      updatedReservation = {
        ...current,
        reservationStatus: nextStatus,
        updatedAtISO: changedAtISO,
        statusHistory: [...(current.statusHistory || []), statusEvent],
      }
    })
  } finally {
    await session.endSession()
  }
  return updatedReservation
}
