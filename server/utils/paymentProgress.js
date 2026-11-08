import { getGcashAmountDue, getPaymentProgress, getSplitPayerIds } from './paymentRules.js'
import { updateReservationStatusAtomically } from './reservationStatus.js'
import { nextShortId } from './shortIds.js'
import { publicAppUrl } from './appUrl.js'

// How long a pending reservation keeps its slot while it is paid. After this the booking is
// released and the slot opens for anyone again. A captain paying alone has 30 minutes; a team
// splitting the payment has 24 hours, since every teammate pays their own share.
// PAYMENT_WINDOW_MINUTES and SPLIT_PAYMENT_WINDOW_HOURS override the defaults.
export const PAYMENT_WINDOW_MINUTES = Math.max(5, Number(process.env.PAYMENT_WINDOW_MINUTES) || 30)
export const PAYMENT_WINDOW_MS = PAYMENT_WINDOW_MINUTES * 60_000
export const SPLIT_PAYMENT_WINDOW_HOURS = Math.max(1, Number(process.env.SPLIT_PAYMENT_WINDOW_HOURS) || 24)
export const SPLIT_PAYMENT_WINDOW_MS = SPLIT_PAYMENT_WINDOW_HOURS * 3600_000

function isSplit(reservation) {
  return String(reservation?.paymentMode || 'self').toLowerCase() === 'split'
}

export function paymentWindowMsFor(reservation) {
  return isSplit(reservation) ? SPLIT_PAYMENT_WINDOW_MS : PAYMENT_WINDOW_MS
}

function durationLabel(ms) {
  const minutes = Math.round(ms / 60_000)
  if (minutes % 60 === 0) {
    const hours = minutes / 60
    return `${hours} hour${hours === 1 ? '' : 's'}`
  }
  return `${minutes} minutes`
}

export function paymentWindowLabel(reservation) {
  return durationLabel(paymentWindowMsFor(reservation))
}

export function reservationIdsOf(reservation) {
  return [reservation?.id, reservation?._id].filter(Boolean).map(String)
}

export async function getReservationPayments(db, reservation, session) {
  return db.collection('payments')
    .find({ reservationId: { $in: reservationIdsOf(reservation) } }, session ? { session } : {})
    .toArray()
}

// `fields` adds extra fields to the stored notification (e.g. a key used to update it later).
export async function notifyUser(db, { userId, targetRole, type, title, message, linkedResourceId, fields }) {
  try {
    await db.collection('notifications').insertOne({
      id: await nextShortId(db, 'notifications', 'N'),
      userId: String(userId),
      ...(targetRole ? { targetRole } : {}),
      type,
      title,
      message,
      ...(linkedResourceId ? { linkedResourceId: String(linkedResourceId) } : {}),
      ...(fields || {}),
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

const VERIFIED_STATUSES = ['paid', 'succeeded', 'confirmed', 'verified', 'approved']
const isGatewayPayment = (payment) => Boolean(payment.xenditInvoiceId || payment.paymongoCheckoutId || payment.stripePaymentIntentId)

// Confirms a pending booking with no separate booking review once the online amount (full price
// or the 50% downpayment) is in and every payment is verified: by Xendit itself, or by staff on
// Verification & receipts for older proof uploads. Bookings with a minor still wait for every
// guardian's approval. Returns 'confirmed', 'waiting_guardian', or null when not eligible.
export async function autoConfirmIfVerified(db, reservationId, startSession) {
  const reservation = await db.collection('reservations').findOne({ id: String(reservationId) })
  if (!reservation || String(reservation.reservationStatus || 'pending').toLowerCase() !== 'pending') return null
  const payments = (await getReservationPayments(db, reservation))
    .filter((payment) => !['failed', 'rejected'].includes(String(payment.paymentStatus || payment.status || '').toLowerCase()))
  const progress = getPaymentProgress(reservation, payments)
  const allVerified = payments.length > 0 && payments.every((payment) =>
    VERIFIED_STATUSES.includes(String(payment.paymentStatus || payment.status || '').toLowerCase()))
  if (progress.state !== 'finalized' || !allVerified) return null
  const paidOnline = payments.every(isGatewayPayment)

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
    reason: paidOnline ? 'Paid online and verified by the payment gateway' : 'Payments verified by staff',
  })
  await ensureGameplayForReservation(db, confirmed)
  await db.collection('reservations').updateOne({ id: String(reservation.id) }, { $set: { autoConfirmedAtISO: new Date().toISOString() } })
  void emailReservationEvent(db, confirmed, 'confirmed', 'auto')
  const balance = Math.max(0, Number(reservation.totalAmount || 0) - Number(reservation.depositAmount || 0))
  await notifyUser(db, {
    userId: reservation.userId,
    type: 'reservation_confirmed',
    title: 'Reservation confirmed',
    message: `Your payment was verified and your reservation for ${reservationLabel(reservation)} is confirmed.${balance > 0 ? ` Please pay the remaining ₱${balance.toLocaleString()} at the counter on game day by cash, GCash, or bank transfer.` : ''}`,
    linkedResourceId: reservation.id,
  })
  // Staff aren't told: an automatic confirmation needs nobody to act (it shows on Reservations).
  return 'confirmed'
}

// Recomputes the stored payment state after a payment is submitted or reviewed. Once every share
// is in and verified, the booking is confirmed automatically; while a payment still needs a staff
// check, admins are told to verify it on Verification & receipts.
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

  if (isSplit(reservation)) await notifyTeamOfNewShares(db, reservation, progress)

  if (progress.state !== 'finalized' && reservation.forwardedToAdminAtISO) {
    // A share was rejected after forwarding; take it back off the admin queue until it's resubmitted,
    // and give the team a fresh window so the rejection doesn't instantly release the slot.
    const freshDueISO = new Date(Date.now() + paymentWindowMsFor(reservation)).toISOString()
    await db.collection('reservations').updateOne(filter, {
      $unset: { forwardedToAdminAtISO: '', paymentFinalizedAtISO: '' },
      $max: { paymentDueAtISO: freshDueISO },
    })
  }

  // Only bookings still awaiting approval go to the admin queue (not walk-ins or balances paid later).
  const awaitingApproval = ['pending', 'needs review'].includes(String(reservation.reservationStatus || '').toLowerCase())
  if (progress.state === 'finalized' && awaitingApproval) {
    const automatic = await autoConfirmIfVerified(db, reservation.id)
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
      // Registrars handle payments, so they're told as well as admins.
      for (const role of ['admin', 'registrar']) {
        await notifyRole(db, {
          role,
          type: 'reservation_payment_finalized',
          title: 'Reservation fully paid: payment needs verifying',
          message: `All payments for ${reservationLabel(reservation)} are in. Verify them on Payments; the booking is confirmed as soon as they are.`,
          linkedResourceId: reservation.id,
        })
      }
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

// Tells the rest of the team each time a teammate's share comes in, once per teammate.
async function notifyTeamOfNewShares(db, reservation, progress) {
  const announced = new Set((reservation.splitPaidAnnouncedIds || []).map(String))
  const newlyPaid = progress.paidPayerIds.filter((id) => !announced.has(id))
  if (!newlyPaid.length) return
  // Claim them first so two syncs at once don't both announce.
  const claimed = await db.collection('reservations').updateOne(
    { id: String(reservation.id), splitPaidAnnouncedIds: { $nin: newlyPaid } },
    { $addToSet: { splitPaidAnnouncedIds: { $each: newlyPaid } } },
  )
  if (claimed.modifiedCount !== 1) return

  const payerIds = getSplitPayerIds(reservation)
  const accounts = await db.collection('user_accounts')
    .find({ id: { $in: newlyPaid } }, { projection: { id: 1, name: 1 } })
    .toArray()
  const nameOf = (id) => accounts.find((account) => String(account.id) === id)?.name || 'A teammate'
  const paidCount = progress.paidPayerIds.length
  const left = progress.pendingPayerIds.length
  for (const paidId of newlyPaid) {
    for (const userId of payerIds.filter((id) => id !== paidId)) {
      await notifyUser(db, {
        userId,
        type: 'split_share_paid',
        title: `${nameOf(paidId)} paid their share`,
        message: left > 0
          ? `${paidCount} of ${payerIds.length} shares are in for ${reservationLabel(reservation)}. Waiting on ${left} more.`
          : `Every share is in for ${reservationLabel(reservation)}.`,
        linkedResourceId: reservation.id,
      })
    }
  }
}

// Warnings sent before a split payment's deadline to teammates who haven't paid: one at 12 hours
// left and one at 2 hours left. The captain is told who is still missing.
const SPLIT_WARNING_STAGES = [
  { stage: '2h', withinMs: 2 * 3600_000 },
  { stage: '12h', withinMs: 12 * 3600_000 },
]
let lastWarningRun = 0

export async function sendSplitPaymentWarnings(db, { force = false } = {}) {
  const now = Date.now()
  if (!force && now - lastWarningRun < 60_000) return 0
  lastWarningRun = now

  const reservations = await db.collection('reservations').find({
    paymentMode: 'split',
    reservationStatus: { $in: ['pending', 'needs review'] },
    paymentState: { $ne: 'finalized' },
    paymentDueAtISO: { $gt: new Date(now).toISOString(), $lte: new Date(now + SPLIT_WARNING_STAGES[1].withinMs).toISOString() },
  }).limit(200).toArray()

  const { emailSplitShareWarning } = await import('../services/notificationEmails.js')
  const appUrl = publicAppUrl()
  let warned = 0
  for (const reservation of reservations) {
    const timeLeftMs = new Date(reservation.paymentDueAtISO).getTime() - now
    // The latest stage reached; an earlier stage that was skipped isn't sent late.
    const current = SPLIT_WARNING_STAGES.find((entry) => timeLeftMs <= entry.withinMs)
    if (!current || reservation.splitWarningsSent?.[current.stage]) continue
    const claimed = await db.collection('reservations').updateOne(
      { _id: reservation._id, [`splitWarningsSent.${current.stage}`]: { $exists: false } },
      { $set: { [`splitWarningsSent.${current.stage}`]: new Date(now).toISOString() } },
    )
    if (claimed.modifiedCount !== 1) continue

    const payments = await getReservationPayments(db, reservation)
    const progress = getPaymentProgress(reservation, payments)
    if (progress.state === 'finalized' || !progress.pendingPayerIds.length) continue
    const dueLabel = new Date(reservation.paymentDueAtISO).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })
    const timeLeftLabel = timeLeftMs < 3600_000 ? `${Math.max(1, Math.round(timeLeftMs / 60_000))} minutes` : durationLabel(Math.round(timeLeftMs / 3600_000) * 3600_000)

    for (const userId of progress.pendingPayerIds) {
      let share = 0
      try { share = getGcashAmountDue(reservation, payments, userId) } catch { share = 0 }
      await notifyUser(db, {
        userId,
        type: 'split_share_due_soon',
        title: `Pay your share: about ${timeLeftLabel} left`,
        message: `Your team's reservation for ${reservationLabel(reservation)} is waiting on your share${share > 0 ? ` of ₱${share.toLocaleString()}` : ''}. Pay before ${dueLabel} or the reservation is released.`,
        linkedResourceId: reservation.id,
      })
      void emailSplitShareWarning(db, reservation, userId, {
        share,
        dueLabel,
        timeLeftLabel,
        stage: current.stage,
        payLink: appUrl ? `${appUrl}/app/split-payments` : '',
      })
      warned += 1
    }

    const captainId = String(reservation.userId || '')
    const missing = progress.pendingPayerIds.filter((id) => id !== captainId)
    if (captainId && missing.length) {
      const accounts = await db.collection('user_accounts')
        .find({ id: { $in: missing } }, { projection: { id: 1, name: 1 } })
        .toArray()
      const names = missing.map((id) => accounts.find((account) => String(account.id) === id)?.name || id)
      await notifyUser(db, {
        userId: captainId,
        type: 'split_share_due_soon',
        title: `${missing.length} teammate${missing.length === 1 ? '' : 's'} still haven't paid`,
        message: `About ${timeLeftLabel} left for ${reservationLabel(reservation)}. Still waiting on: ${names.join(', ')}. If not every share is in by ${dueLabel}, the reservation is released.`,
        linkedResourceId: reservation.id,
      })
    }
  }
  return warned
}

let lastExpiryRun = 0

// Expires pending reservations whose payment window ran out before every share was submitted,
// which releases their slot and inventory. This is the only way a booking ends early: there is
// no cancellation policy. It is stored as "cancelled" with reason "payment_window_expired". Throttled so request handlers can call it freely.
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
          message: `The reservation for ${reservationLabel(reservation)} expired because payment was not completed within ${paymentWindowLabel(reservation)}. The slot is open for anyone to book again.`,
          linkedResourceId: reservation.id,
        })
      }
    } catch (err) {
      console.error('Payment window expiry failed', reservation.id, err?.message || err)
    }
  }
  return expired
}
