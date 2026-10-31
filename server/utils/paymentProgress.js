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

const GATEWAY_PAID = ['paid', 'succeeded']
const isGatewayPayment = (payment) => Boolean(payment.paymongoCheckoutId || payment.stripePaymentIntentId)

// Confirms a pending booking with no staff step when every share of the online amount was paid
// through the payment gateway (which already verified the money). Bookings with a minor still
// wait for every guardian's approval. Manual GCash or bank proofs keep going to staff instead.
// Returns 'confirmed', 'waiting_guardian', or null when the booking isn't eligible.
export async function autoConfirmIfGatewayPaid(db, reservationId, startSession) {
  const reservation = await db.collection('reservations').findOne({ id: String(reservationId) })
  if (!reservation || String(reservation.reservationStatus || 'pending').toLowerCase() !== 'pending') return null
  const payments = (await getReservationPayments(db, reservation))
    .filter((payment) => !['failed', 'rejected'].includes(String(payment.paymentStatus || payment.status || '').toLowerCase()))
  const progress = getPaymentProgress(reservation, payments)
  const allGatewayPaid = payments.length > 0 && payments.every((payment) =>
    isGatewayPayment(payment) && GATEWAY_PAID.includes(String(payment.paymentStatus || payment.status || '').toLowerCase()))
  if (progress.state !== 'finalized' || !allGatewayPaid) return null

  const guardiansWaiting = await db.collection('guardian_approvals').countDocuments({
    reservationId: String(reservation.id),
    status: { $ne: 'approved' },
  })
  if (guardiansWaiting > 0) return 'waiting_guardian'

  // Loaded on demand so modules (and tests) that only need payment progress don't pull in the
  // database connection and mail service.
  const { ensureGameplayForReservation } = await import('./reservationGameplay.js')
  const { emailReservationEvent } = await import('../services/notificationEmails.js')
  const { startDbSession } = await import('../db/mongo.js')
  const confirmed = await updateReservationStatusAtomically({
    db,
    startSession: startSession || startDbSession,
    reservationFilter: { id: String(reservation.id) },
    reservationId: String(reservation.id),
    nextStatus: 'confirmed',
    actor: { id: 'system', role: 'system' },
    reason: 'Paid online and verified by the payment gateway',
  })
  await ensureGameplayForReservation(db, confirmed)
  await db.collection('reservations').updateOne({ id: String(reservation.id) }, { $set: { autoConfirmedAtISO: new Date().toISOString() } })
  void emailReservationEvent(db, confirmed, 'confirmed', 'auto')
  const balance = Math.max(0, Number(reservation.totalAmount || 0) - Number(reservation.depositAmount || 0))
  await notifyUser(db, {
    userId: reservation.userId,
    type: 'reservation_confirmed',
    title: 'Reservation confirmed',
    message: `Your payment was verified and your reservation for ${reservationLabel(reservation)} is confirmed.${balance > 0 ? ` Please bring the remaining ₱${balance.toLocaleString()} in cash on game day.` : ''}`,
    linkedResourceId: reservation.id,
  })
  await notifyRole(db, {
    role: 'admin',
    type: 'reservation_confirmed',
    title: 'Reservation confirmed automatically',
    message: `Reservation ${reservation.id} for ${reservationLabel(reservation)} was paid online and confirmed without manual review.`,
    linkedResourceId: reservation.id,
  })
  return 'confirmed'
}

// Recomputes the stored payment state after a payment is submitted or reviewed. The first time
// every share is in, a booking paid entirely through the gateway is confirmed automatically;
// otherwise it is forwarded to admins for final approval.
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
    const automatic = await autoConfirmIfGatewayPaid(db, reservation.id)
    if (automatic === 'confirmed') return { ...progress, autoConfirmed: true }
    if (automatic === 'waiting_guardian') {
      await notifyUser(db, {
        userId: reservation.userId,
        type: 'reservation_payment_finalized',
        title: 'Payment received: waiting for guardian approval',
        message: `Your payment for ${reservationLabel(reservation)} is verified. The booking is confirmed as soon as every guardian approves it.`,
        linkedResourceId: reservation.id,
      })
      return { ...progress, waitingGuardian: true }
    }
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
      const split = String(reservation.paymentMode || 'self').toLowerCase() === 'split'
      await notifyUser(db, {
        userId: reservation.userId,
        type: 'reservation_payment_finalized',
        title: split ? 'Your team payment is complete' : 'Your payment is complete',
        message: split
          ? `Every share for ${reservationLabel(reservation)} has been submitted. It is now with the admin for final approval.`
          : `Your payment for ${reservationLabel(reservation)} has been submitted. It is now with the admin for final approval.`,
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
