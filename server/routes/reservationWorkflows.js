import express from 'express'
import { ObjectId } from 'mongodb'
import { getDb, startDbSession, toObjectId } from '../db/mongo.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { updateReservationStatusAtomically } from '../utils/reservationStatus.js'
import { ensureGameplayForReservation } from '../utils/reservationGameplay.js'
import { emailReservationEvent } from '../services/notificationEmails.js'
import { assertGuardianApprovalsComplete } from './guardianApprovals.js'
import { notifyUser } from '../utils/paymentProgress.js'

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
  if (lower === 'cancelled' || lower === 'canceled') return 'cancelled'
  return null
}

async function updateReservationStatus(req, res) {
  const { id } = req.params
  if (!id) return res.status(400).json({ ok: false, error: 'invalid id' })

  const { reservationStatus } = req.body || {}
  const nextStatus = parseStatus({ reservationStatus })
  if (!nextStatus) return res.status(400).json({ ok: false, error: 'reservationStatus is required' })
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

router.put('/reservations/:id/status', requireAuth, requireRole('admin', 'registrar'), updateReservationStatus)
router.put('/reservations/:id/confirm', requireAuth, requireRole('admin', 'registrar'), updateReservationStatus)

// Keep reservations and financial/gameplay history; cancellation releases active inventory holds.
router.delete('/reservations/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params
  if (!id) return res.status(400).json({ ok: false, error: 'invalid id' })

  try {
    const db = await getDb()

    const reservation = await findReservation(db, id)
    if (!reservation) return res.status(404).json({ ok: false, error: 'reservation not found' })

    const reservationFilter = reservation._id ? { _id: reservation._id } : { id: String(reservation.id || id) }
    await updateReservationStatusAtomically({
      db,
      startSession: startDbSession,
      reservationFilter,
      reservationId: reservationKey(reservation),
      nextStatus: 'cancelled',
      actor: req.user,
    })

    return res.json({
      ok: true,
      message: 'Reservation cancelled; linked payment and gameplay history was retained.',
      cancelledReservationId: id,
    })
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ ok: false, error: err.message })
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

export default router
