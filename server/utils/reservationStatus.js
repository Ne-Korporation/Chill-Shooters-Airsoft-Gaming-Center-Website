import { releaseBookingInventory } from './inventoryHolds.js'
import { normalizeLocationId, syncPublicGrounds } from './bookingSlots.js'
import { getPaymentProgress } from './paymentRules.js'
import { getActorName } from './actors.js'
import { logAudit } from './audit.js'

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
  let previousStatus = ''
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
        // A public group leaving can shrink the grounds the rest of the slot needs.
        if (String(current.sessionType || 'public').toLowerCase() !== 'private') {
          await syncPublicGrounds(db, {
            locationId: normalizeLocationId(current.locationId || current.location || current.locationName),
            reservationDate: String(current.reservationDate || current.dateISO || ''),
            reservationTime: String(current.reservationTime || current.slot || '').toLowerCase(),
          }, session)
        }
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
      previousStatus = String(current.reservationStatus || '')
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
  // Changes made by staff or players are recorded with their request; automatic ones are recorded
  // here, under "System (automatic)".
  if (updatedReservation && actor?.role === 'system') {
    const why = ({ payment_window_expired: 'the payment window ran out', account_closed: "the captain's account was closed" })[reason] || String(reason || '').replace(/_/g, ' ')
    await logAudit(db, null, {
      module: 'reservation',
      action: `reservation_${nextStatus}_automatically`,
      label: `Reservation ${nextStatus} automatically`,
      severity: nextStatus === 'cancelled' ? 'warning' : 'info',
      resourceType: 'reservations',
      resourceId: String(reservationId || updatedReservation.id || ''),
      summary: `Reservation ${reservationId} ${nextStatus} automatically${why ? ` because ${why}` : ''}`,
      details: { reason },
      ...(previousStatus ? { before: { reservationStatus: previousStatus } } : {}),
      after: { reservationStatus: nextStatus },
    })
  }
  return updatedReservation
}
