import express from 'express'
import { getDb, toObjectId } from '../db/mongo.js'

const router = express.Router()

function reservationKey(reservation) {
  return String(reservation?.id || reservation?._id || '')
}

async function findReservation(db, rawId) {
  const _id = toObjectId(rawId)
  if (_id) {
    const byObjectId = await db.collection('reservations').findOne({ _id })
    if (byObjectId) return byObjectId
  }

  return db.collection('reservations').findOne({ id: String(rawId) })
}

function parseStatus(body) {
  const status = body?.reservationStatus
  if (!status || typeof status !== 'string') return null
  const lower = status.trim().toLowerCase()
  if (lower === 'pending') return 'pending'
  if (lower === 'needs review' || lower === 'needs_review' || lower === 'review') return 'needs review'
  if (lower === 'confirmed' || lower === 'approved') return 'confirmed'
  return null
}

function isAdminRole(role) {
  return role === 'admin' || role === 'marshal'
}

function mapReservationToGameplay({ reservation }) {
  // Expect reservation schema from frontend:
  // userId, selectedPackageId, mode, fieldId, reservationDate, reservationTime, sessionType,
  // numberOfPlayers, totalAmount, notes, reservationStatus
  // Frontend does not currently store gameplay/group in reservation, so we derive what we can.
  const schedule = `${reservation.reservationDate} ${reservation.reservationTime}`.trim()

  const game = reservation?.game || reservation?.packageName || reservation?.selectedGameplayName || reservation?.selectedPackageId || ''
  const mode = reservation?.mode || reservation?.gameMode || ''

  // Group: use a friendly label if exists, otherwise fallback.
  const group = reservation?.group || reservation?.sessionType || reservation?.fieldId || ''

  const pkg = reservation?.selectedPackageId || reservation?.package || ''

  // Status + Actions should be functional.
  const status = 'Scheduled'
  const actions = {
    canStart: true,
    canComplete: false,
    canCancel: true,
  }

  return {
    Game: game,
    Schedule: schedule,
    Mode: mode,
    Group: group,
    Package: pkg,
    Status: status,
    Actions: actions,
    userId: reservation.userId,
    reservationId: reservation._id ? String(reservation._id) : reservation.reservationId,
    createdAtISO: new Date().toISOString(),
  }
}

async function updateReservationStatus(req, res) {
  const { id } = req.params
  if (!id) return res.status(400).json({ ok: false, error: 'invalid id' })

  const { reservationStatus } = req.body || {}
  const nextStatus = parseStatus({ reservationStatus })
  if (!nextStatus) return res.status(400).json({ ok: false, error: 'reservationStatus is required' })

  // Scoping: since current app doesn't send auth token, we accept:
  // - req.body.userId (frontend) and verify it matches reservation.userId OR
  // - req.body.role to allow admin workflows.
  // This is a minimal fix without changing auth architecture.
  const actorUserId = req.body?.userId
  const actorRole = req.body?.role

  try {
    const db = await getDb()

    const reservation = await findReservation(db, id)
    if (!reservation) return res.status(404).json({ ok: false, error: 'reservation not found' })

    const isActorAdmin = isAdminRole(actorRole)
    if (!isActorAdmin) {
      if (!actorUserId || String(actorUserId) !== String(reservation.userId)) {
        return res.status(403).json({ ok: false, error: 'forbidden' })
      }
    }

    const paymentStatus =
      nextStatus === 'confirmed'
        ? 'confirmed'
        : nextStatus === 'needs review'
          ? 'review'
          : 'pending'

    // Update reservation status.
    const reservationFilter = reservation._id ? { _id: reservation._id } : { id: String(reservation.id || id) }

    const updateRes = await db.collection('reservations').findOneAndUpdate(
      reservationFilter,
      { $set: { reservationStatus: nextStatus, updatedAtISO: new Date().toISOString() } },
      { returnDocument: 'after', upsert: false },
    )

    const updatedReservation = updateRes?.value ?? (await db.collection('reservations').findOne({ _id }))
    if (!updatedReservation) return res.status(404).json({ ok: false, error: 'reservation not found after update' })

    const payment = await db.collection('payments').findOne({
      reservationId: reservationKey(updatedReservation),
    })

    if (payment) {
      await db.collection('payments').findOneAndUpdate(
        { _id: payment._id },
        {
          $set: {
            paymentStatus,
            updatedAtISO: new Date().toISOString(),
          },
        },
        { returnDocument: 'after', upsert: false },
      )
    }

    let gameplayCreated = false
    let gameplay = null

    // Auto-create gameplay only when confirmed.
    if (nextStatus === 'confirmed') {
      const already = await db.collection('gameplay').findOne({ reservationId: reservationKey(updatedReservation) })
      if (already) {
        gameplay = already
      } else {
        const gameplayDoc = mapReservationToGameplay({ reservation: updatedReservation })

        // Ensure reservationId + userId exist
        gameplayDoc.reservationId = reservationKey(updatedReservation)
        gameplayDoc.userId = String(updatedReservation.userId)

        const insert = await db.collection('gameplay').insertOne({
          ...gameplayDoc,
          // also include a deterministic id field for UI
          id: `GP-${reservationKey(updatedReservation).slice(-6)}-${Date.now()}`,
        })

        gameplay = await db.collection('gameplay').findOne({ _id: insert.insertedId })
        gameplayCreated = true
      }
    }

    return res.json({ ok: true, data: updatedReservation, gameplayCreated, gameplay, paymentStatus })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
}

router.put('/reservations/:id/status', updateReservationStatus)
router.put('/reservations/:id/confirm', updateReservationStatus)

export default router

