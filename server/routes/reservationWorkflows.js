import express from 'express'
import { ObjectId } from 'mongodb'
import { getDb, startDbSession, toObjectId } from '../db/mongo.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { updateReservationStatusAtomically } from '../utils/reservationStatus.js'
import { ensureGameplayForReservation } from '../utils/reservationGameplay.js'
import { emailReservationEvent } from '../services/notificationEmails.js'
import { assertGuardianApprovalsComplete } from './guardianApprovals.js'
import { notifyRole, notifyUser, syncReservationPaymentState } from '../utils/paymentProgress.js'
import { buildPaymentStatusUpdate, getPaymentProgress, getSplitPayerIds } from '../utils/paymentRules.js'
import { getReservationPayments } from '../utils/paymentProgress.js'
import { expireInvoice } from '../utils/xendit.js'
import { actorLabel, getActorName } from '../utils/actors.js'

const router = express.Router()

function reservationKey(reservation) {
  return String(reservation?.id || reservation?._id || '')
}

async function findReservation(db, rawId) {
  const normalizedId = String(rawId || '').trim()
  if (!normalizedId) return null

  const byId = await db.collection('reservations').findOne({ id: normalizedId })
  if (byId) return byId

  const objectIdValue = ObjectId.isValid(normalizedId) ? new ObjectId(normalizedId) : null
  if (objectIdValue) {
    const byObjectId = await db.collection('reservations').findOne({ _id: objectIdValue })
    if (byObjectId) return byObjectId
  }

  return null
}

function parseStatus(body) {
  const status = body?.reservationStatus
  if (!status || typeof status !== 'string') return null
  const lower = status.trim().toLowerCase()
  if (lower === 'pending') return 'pending'
  if (lower === 'needs review' || lower === 'needs_review' || lower === 'review' || lower === 'rejected') return 'needs review'
  if (lower === 'confirmed' || lower === 'approved') return 'confirmed'
  return null
}

// Marks a confirmed booking's unverified manual proofs (GCash/bank) as paid, recording who did it.
// Gateway payments are verified by the gateway itself and are left alone.
async function verifyOutstandingPayments(db, reservation, actor) {
  const reservationIds = [reservation?.id, reservation?._id].filter(Boolean).map(String)
  const outstanding = await db.collection('payments').find({
    reservationId: { $in: reservationIds },
    paymentStatus: { $in: ['pending', 'submitted', 'review', 'needs review'] },
    stripePaymentIntentId: { $exists: false },
    paymongoCheckoutId: { $exists: false },
  }).toArray()
  if (!outstanding.length) return
  const actorName = await getActorName(db, actor).catch(() => '')
  const changedAtISO = new Date().toISOString()
  for (const payment of outstanding) {
    const update = buildPaymentStatusUpdate({
      payment,
      nextStatus: 'paid',
      actorId: actor.id,
      actorRole: actor.role,
      actorName,
      reason: 'Verified when the reservation was confirmed',
      changedAtISO,
    })
    await db.collection('payments').updateOne({ _id: payment._id }, update)
  }
  await syncReservationPaymentState(db, reservation)
}

async function updateReservationStatus(req, res) {
  const { id } = req.params
  if (!id) return res.status(400).json({ ok: false, error: 'invalid id' })

  const { reservationStatus } = req.body || {}
  const nextStatus = parseStatus({ reservationStatus })
  // There is no cancellation policy: staff can't cancel bookings. Only unpaid bookings expire,
  // automatically, when their payment window runs out (utils/paymentProgress.js).
  if (/^cancel/i.test(String(reservationStatus || '').trim())) {
    return res.status(400).json({ ok: false, error: 'Reservations cannot be cancelled. Send the booking back to the player with a note instead.' })
  }
  if (!nextStatus) return res.status(400).json({ ok: false, error: 'reservationStatus must be pending, needs review, or confirmed' })
  // Sending a booking back to the player: staff explain why, and the player can pick a new date.
  const sendBackNote = req.body?.sendBack === true ? String(req.body?.note || '').trim().slice(0, 500) : ''
  if (req.body?.sendBack === true && (nextStatus !== 'needs review' || !sendBackNote)) {
    return res.status(400).json({ ok: false, error: 'Write a short note telling the player why the reservation is being sent back.' })
  }

  try {
    const db = await getDb()

    const reservation = await findReservation(db, id)
    if (!reservation) return res.status(404).json({ ok: false, error: 'reservation not found' })
    if (String(reservation.reservationStatus || '').toLowerCase() === 'cancelled' && nextStatus !== 'cancelled') {
      return res.status(409).json({ ok: false, error: 'Cancelled reservations cannot be reopened. Create a new reservation instead.' })
    }
    // Every minor on the booking needs their guardian's approval before it is confirmed.
    if (nextStatus === 'confirmed') await assertGuardianApprovalsComplete(db, reservationKey(reservation))

    // Update reservation status using the stable string id first, and only use ObjectId lookup when the value is truly valid.
    const reservationFilter = {
      $or: [
        { id: String(reservation?.id || id) },
        ...(reservation?._id && ObjectId.isValid(String(reservation._id))
          ? [{ _id: new ObjectId(String(reservation._id)) }]
          : []),
      ],
    }

    const updatedReservation = await updateReservationStatusAtomically({
      db,
      startSession: startDbSession,
      reservationFilter,
      reservationId: reservationKey(reservation),
      nextStatus,
      actor: req.user,
      reason: sendBackNote,
    })

    if (sendBackNote) {
      const sentBack = { note: sendBackNote, atISO: new Date().toISOString(), byId: String(req.user.id || ''), byRole: req.user.role }
      await db.collection('reservations').updateOne(reservationFilter, { $set: { sentBack } })
      updatedReservation.sentBack = sentBack
      await notifyUser(db, {
        userId: updatedReservation.userId,
        type: 'reservation_status_update',
        title: 'Your reservation was sent back',
        message: `Reason: ${sendBackNote} Open My Reservations to choose a new date.`,
        linkedResourceId: reservationKey(updatedReservation),
      })
    } else if (reservation.sentBack) {
      // Any other decision (or a fresh "needs review" without a note) closes the send-back.
      await db.collection('reservations').updateOne(reservationFilter, { $unset: { sentBack: '' } })
      delete updatedReservation.sentBack
    }

    // Confirming a booking accepts the proofs staff just reviewed. Without this, a booking approved
    // from the dashboard stayed confirmed while its payments still sat in "Needs review".
    if (nextStatus === 'confirmed') await verifyOutstandingPayments(db, updatedReservation, req.user)

    const payment = await db.collection('payments').findOne({
      reservationId: reservationKey(updatedReservation),
    })

    let gameplayCreated = false
    let gameplay = null

    // Auto-create gameplay only when confirmed.
    if (nextStatus === 'confirmed') {
      const result = await ensureGameplayForReservation(db, updatedReservation)
      gameplay = result.gameplay
      gameplayCreated = result.created
    }

    void emailReservationEvent(db, updatedReservation, nextStatus, String(updatedReservation?.statusHistory?.length || ''))

    // Admins and registrars can both decide bookings, so tell both who made this decision.
    if (String(reservation.reservationStatus || '').toLowerCase() !== nextStatus) {
      const by = actorLabel(req.user, await getActorName(db, req.user).catch(() => ''))
      const verb = { confirmed: 'approved', pending: 'marked pending', 'needs review': 'marked for review', cancelled: 'cancelled' }[nextStatus]
      const message = `${by} ${verb} reservation ${reservationKey(updatedReservation)} for ${updatedReservation.reservationDate} (${updatedReservation.reservationTime}).${sendBackNote ? ` Note: ${sendBackNote}` : ''}`
      for (const role of ['admin', 'registrar']) {
        await notifyRole(db, {
          role,
          type: 'reservation_status_update',
          title: `Reservation ${verb} by ${by}`,
          message,
          linkedResourceId: reservationKey(updatedReservation),
        })
      }
      if (!sendBackNote && nextStatus === 'confirmed') {
        await notifyUser(db, {
          userId: updatedReservation.userId,
          type: 'reservation_confirmed',
          title: 'Reservation confirmed',
          message: `Your reservation for ${updatedReservation.reservationDate} (${updatedReservation.reservationTime}) was approved by ${by}.`,
          linkedResourceId: reservationKey(updatedReservation),
        })
      }
    }

    return res.json({
      ok: true,
      data: updatedReservation,
      gameplayCreated,
      gameplay,
      paymentStatus: payment?.paymentStatus || payment?.status || null,
    })
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ ok: false, error: err.message })
    return res.status(500).json({ ok: false, error: String(err) })
  }
}

// POST /api/reservations/:id/cancel — the captain cancels their own booking while nothing has been
// paid yet. The slot opens for anyone again. Once any payment is in, it can't be cancelled here.
router.post('/reservations/:id/cancel', requireAuth, requireRole('user'), async (req, res) => {
  try {
    const db = await getDb()
    const id = String(req.params.id || '')
    const objectId = toObjectId(id)
    const reservation = await db.collection('reservations').findOne({ $or: [{ id }, ...(objectId ? [{ _id: objectId }] : [])] })
    if (!reservation || String(reservation.userId) !== String(req.user.id)) {
      return res.status(404).json({ ok: false, error: 'Reservation not found.' })
    }
    const status = String(reservation.reservationStatus || '').toLowerCase()
    if (!['pending', 'needs review'].includes(status)) {
      return res.status(409).json({ ok: false, error: status === 'cancelled' ? 'This reservation is already cancelled.' : 'Only bookings that are still waiting for payment can be cancelled.' })
    }
    const payments = await getReservationPayments(db, reservation)
    if (getPaymentProgress(reservation, payments).submitted > 0) {
      return res.status(409).json({ ok: false, error: 'A payment was already made for this booking, so it can no longer be cancelled. Contact the staff for help.' })
    }

    // Close any Xendit payment page still open for it, so nobody pays a cancelled booking.
    const checkouts = await db.collection('xendit_checkouts').find({ reservationId: String(reservation.id), status: 'open' }).toArray()
    for (const checkout of checkouts) {
      await expireInvoice(checkout.invoiceId).catch(() => null)
      await db.collection('xendit_checkouts').updateOne({ _id: checkout._id }, { $set: { status: 'cancelled' } })
    }

    const cancelled = await updateReservationStatusAtomically({
      db,
      startSession: startDbSession,
      reservationFilter: { _id: reservation._id },
      reservationId: String(reservation.id),
      nextStatus: 'cancelled',
      actor: { id: String(req.user.id), role: 'user' },
      reason: 'cancelled_by_player_before_payment',
    })
    await db.collection('reservations').updateOne({ _id: reservation._id }, { $set: { cancellationReason: 'cancelled_by_player_before_payment' } })
    void emailReservationEvent(db, cancelled, 'cancelled', 'player')
    const label = `${reservation.reservationDate} (${reservation.reservationTime})`
    for (const userId of getSplitPayerIds(reservation).filter((payerId) => payerId !== String(req.user.id))) {
      await notifyUser(db, {
        userId,
        type: 'reservation_status_update',
        title: 'Reservation cancelled',
        message: `The team captain cancelled the reservation for ${label}. You don't need to pay your share.`,
        linkedResourceId: reservation.id,
      })
    }
    return res.json({ ok: true, data: { id: String(reservation.id), reservationStatus: 'cancelled' } })
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ ok: false, error: err.message })
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

router.put('/reservations/:id/status', requireAuth, requireRole('admin', 'registrar'), updateReservationStatus)
router.put('/reservations/:id/confirm', requireAuth, requireRole('admin', 'registrar'), updateReservationStatus)

export default router
