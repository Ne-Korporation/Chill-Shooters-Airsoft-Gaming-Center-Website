import express from 'express'
import { getDb, toObjectId } from '../db/mongo.js'

const router = express.Router()

function parseStatus(body) {
  const status = body?.reservationStatus
  if (!status || typeof status !== 'string') return null
  return status
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

router.put('/reservations/:id/confirm', async (req, res) => {
  const { id } = req.params
  const _id = toObjectId(id)
  if (!_id) return res.status(400).json({ ok: false, error: 'invalid id' })

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

    const reservation = await db.collection('reservations').findOne({ _id })
    if (!reservation) return res.status(404).json({ ok: false, error: 'reservation not found' })

    const isActorAdmin = isAdminRole(actorRole)
    if (!isActorAdmin) {
      if (!actorUserId || String(actorUserId) !== String(reservation.userId)) {
        return res.status(403).json({ ok: false, error: 'forbidden' })
      }
    }

    // Update reservation status.
    const updateRes = await db.collection('reservations').findOneAndUpdate(
      { _id },
      { $set: { reservationStatus: nextStatus, updatedAtISO: new Date().toISOString() } },
      { returnDocument: 'after', upsert: false },
    )

    if (!updateRes?.value) return res.status(404).json({ ok: false, error: 'reservation not found after update' })

    // Auto-create gameplay only when set to Confirmed.
    if (String(nextStatus).toLowerCase() !== 'confirmed') {
      return res.json({ ok: true, data: updateRes.value, gameplayCreated: false })
    }

    const already = await db.collection('gameplay').findOne({ reservationId: String(reservation._id) })
    if (already) {
      // Idempotent: don’t duplicate. Return existing.
      return res.json({ ok: true, data: updateRes.value, gameplayCreated: false, gameplay: already })
    }

    const gameplayDoc = mapReservationToGameplay({ reservation: updateRes.value })

    // Ensure reservationId + userId exist
    gameplayDoc.reservationId = String(reservation._id)
    gameplayDoc.userId = String(updateRes.value.userId)

    const insert = await db.collection('gameplay').insertOne({
      ...gameplayDoc,
      // also include a deterministic id field for UI
      id: `GP-${String(reservation._id).slice(-6)}-${Date.now()}`,
    })

    const gameplay = await db.collection('gameplay').findOne({ _id: insert.insertedId })

    return res.json({ ok: true, data: updateRes.value, gameplayCreated: true, gameplay })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

export default router

