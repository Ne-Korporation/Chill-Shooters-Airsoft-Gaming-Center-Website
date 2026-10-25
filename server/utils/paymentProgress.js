import { getPaymentProgress, getSplitPayerIds } from './paymentRules.js'
import { updateReservationStatusAtomically } from './reservationStatus.js'
import { nextShortId } from './shortIds.js'

// How long a pending reservation keeps its slot while the team pays.
export const PAYMENT_WINDOW_HOURS = Math.max(1, Number(process.env.PAYMENT_WINDOW_HOURS) || 24)

export function reservationIdsOf(reservation) {
  return [reservation?.id, reservation?._id].filter(Boolean).map(String)
}

export async function getReservationPayments(db, reservation, session) {
  return db.collection('payments')
    .find({ reservationId: { $in: reservationIdsOf(reservation) } }, session ? { session } : {})
    .toArray()
}

export async function notifyUser(db, { userId, targetRole, type, title, message, linkedResourceId }) {
  try {
    await db.collection('notifications').insertOne({
      id: await nextShortId(db, 'notifications', 'N'),
      userId: String(userId),
      ...(targetRole ? { targetRole } : {}),
      type,
      title,
      message,
      ...(linkedResourceId ? { linkedResourceId: String(linkedResourceId) } : {}),
      read: false,
      createdAtISO: new Date().toISOString(),
    })
  } catch (err) {
    console.error('Notification insert failed', err?.message || err)
  }
}

export function notifyRole(db, { role, ...rest }) {
  return notifyUser(db, { ...rest, userId: 'broadcast', targetRole: role })
}

function reservationLabel(reservation) {
  return `${reservation.reservationDate || ''} (${reservation.reservationTime || ''})`
}

// Recomputes the stored payment state after a payment is submitted or reviewed. The first time
// every share is in, the reservation is forwarded to admins for final approval.
export async function syncReservationPaymentState(db, reservation) {
  if (!reservation) return null
  const payments = await getReservationPayments(db, reservation)
  const progress = getPaymentProgress(reservation, payments)
  const filter = { id: String(reservation.id) }
  const nowISO = new Date().toISOString()

  await db.collection('reservations').updateOne(filter, {
    $set: {
      paymentState: progress.state,
      paymentSubmittedAmount: progress.submitted,
      paymentVerifiedAmount: progress.verified,
      updatedAtISO: nowISO,
    },
  })

  if (progress.state !== 'finalized' && reservation.forwardedToAdminAtISO) {
    // A share was rejected after forwarding; take it back off the admin queue until it's resubmitted,
    // and give the team a fresh window so the rejection doesn't instantly release the slot.
    const freshDueISO = new Date(Date.now() + PAYMENT_WINDOW_HOURS * 3600_000).toISOString()
    await db.collection('reservations').updateOne(filter, {
      $unset: { forwardedToAdminAtISO: '', paymentFinalizedAtISO: '' },
      $max: { paymentDueAtISO: freshDueISO },
    })
  }

  // Only bookings still awaiting approval go to the admin queue (not walk-ins or balances paid later).
  const awaitingApproval = ['pending', 'needs review'].includes(String(reservation.reservationStatus || '').toLowerCase())
  if (progress.state === 'finalized' && awaitingApproval) {
    const forwarded = await db.collection('reservations').updateOne(
      { ...filter, forwardedToAdminAtISO: { $exists: false } },
      { $set: { forwardedToAdminAtISO: nowISO, paymentFinalizedAtISO: nowISO } },
    )
    if (forwarded.modifiedCount === 1) {
      await notifyRole(db, {
        role: 'admin',
        type: 'reservation_payment_finalized',
        title: 'Reservation fully paid — ready for approval',
        message: `All payments for ${reservationLabel(reservation)} are in. Review the proofs and waivers to approve it.`,
        linkedResourceId: reservation.id,
      })
      await notifyUser(db, {
        userId: reservation.userId,
        type: 'reservation_payment_finalized',
        title: 'Your team payment is complete',
        message: `Every share for ${reservationLabel(reservation)} has been submitted. It is now with the admin for final approval.`,
        linkedResourceId: reservation.id,
      })
    }
  }
  return progress
}

let lastExpiryRun = 0

// Cancels pending reservations whose payment window ran out before every share was submitted,
// which releases their slot and inventory. Throttled so request handlers can call it freely.
export async function expireOverdueReservations(db, startSession, { force = false } = {}) {
  const now = Date.now()
  if (!force && now - lastExpiryRun < 60_000) return 0
  lastExpiryRun = now

  const overdue = await db.collection('reservations').find({
    reservationStatus: { $in: ['pending', 'needs review'] },
    paymentDueAtISO: { $lt: new Date(now).toISOString() },
    paymentState: { $ne: 'finalized' },
  }).limit(100).toArray()

  let expired = 0
  for (const reservation of overdue) {
    try {
      const payments = await getReservationPayments(db, reservation)
      if (getPaymentProgress(reservation, payments).state === 'finalized') continue
      await updateReservationStatusAtomically({
        db,
        startSession,
        reservationFilter: { id: String(reservation.id) },
        reservationId: String(reservation.id),
        nextStatus: 'cancelled',
        actor: { id: 'system', role: 'system' },
        reason: 'payment_window_expired',
      })
      expired += 1
      for (const userId of getSplitPayerIds(reservation)) {
        await notifyUser(db, {
          userId,
          type: 'reservation_status_update',
          title: 'Reservation released — payment window expired',
          message: `The reservation for ${reservationLabel(reservation)} was cancelled because payment was not completed within ${PAYMENT_WINDOW_HOURS} hours. The slot has been released.`,
          linkedResourceId: reservation.id,
        })
      }
    } catch (err) {
      console.error('Payment window expiry failed', reservation.id, err?.message || err)
    }
  }
  return expired
}
