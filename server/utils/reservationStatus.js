import { releaseBookingInventory } from './inventoryHolds.js'

export async function updateReservationStatusAtomically({
  db,
  startSession,
  reservationFilter,
  reservationId,
  nextStatus,
  actor,
}) {
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

      if (String(current.reservationStatus || '').toLowerCase() === nextStatus) {
        updatedReservation = current
        return
      }

      const changedAtISO = new Date().toISOString()
      const statusEvent = {
        status: nextStatus,
        changedBy: String(actor.id),
        changedByRole: actor.role,
        changedAtISO,
      }
      await db.collection('reservations').updateOne(
        reservationFilter,
        {
          $set: { reservationStatus: nextStatus, updatedAtISO: changedAtISO },
          $push: { statusHistory: statusEvent },
        },
        { session },
      )
      if (nextStatus === 'cancelled') {
        await releaseBookingInventory(db, reservationId, session)
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
