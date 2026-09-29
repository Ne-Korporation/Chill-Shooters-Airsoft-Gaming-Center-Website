import express from 'express'
import { ObjectId } from 'mongodb'
import { getDb, toObjectId } from '../db/mongo.js'

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

function isAdminRole(role) {
  return role === 'admin' || role === 'marshal' || role === 'registrar'
}

function mapReservationToGameplay({ reservation }) {
  const scheduleParts = [reservation?.reservationDate, reservation?.reservationTime].filter(Boolean)
  const schedule = scheduleParts.join(' • ') || reservation?.createdAtISO || ''

  const game =
    reservation?.game ||
    reservation?.packageName ||
    reservation?.selectedGameplayName ||
    reservation?.selectedPackageId ||
    reservation?.mode ||
    '—'

  const mode = reservation?.mode || reservation?.gameMode || reservation?.sessionType || '—'
  const group = reservation?.group || reservation?.sessionType || `${reservation?.numberOfPlayers || '—'} players`
  const pkg = reservation?.packageName || reservation?.selectedGameplayName || reservation?.selectedPackageId || reservation?.package || '—'

  return {
    Game: game,
    Schedule: schedule,
    Mode: mode,
    Group: group,
    Package: pkg,
    Status: 'Scheduled',
    Actions: {
      canStart: true,
      canComplete: false,
      canDelete: false,
    },
    userId: reservation.userId,
    reservationId: reservation._id ? String(reservation._id) : reservation.reservationId,
    createdAtISO: new Date().toISOString(),
    updatedAtISO: new Date().toISOString(),
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

    // Update reservation status using the stable string id first, and only use ObjectId lookup when the value is truly valid.
    const reservationFilter = {
      $or: [
        { id: String(reservation?.id || id) },
        ...(reservation?._id && ObjectId.isValid(String(reservation._id))
          ? [{ _id: new ObjectId(String(reservation._id)) }]
          : []),
      ],
    }

    const updateRes = await db.collection('reservations').findOneAndUpdate(
      reservationFilter,
      { $set: { reservationStatus: nextStatus, updatedAtISO: new Date().toISOString() } },
      { returnDocument: 'after', upsert: false },
    )

    const updatedReservation = updateRes?.value ?? (await db.collection('reservations').findOne(reservationFilter))
    if (!updatedReservation) return res.status(404).json({ ok: false, error: 'reservation not found after update' })

    const payment = await db.collection('payments').findOne({
      reservationId: reservationKey(updatedReservation),
    })

    if (payment) {
      const paymentFilter = {
        $or: [
          { reservationId: reservationKey(updatedReservation) },
          ...(payment?._id && ObjectId.isValid(String(payment._id))
            ? [{ _id: new ObjectId(String(payment._id)) }]
            : []),
        ],
      }

      await db.collection('payments').findOneAndUpdate(
        paymentFilter,
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
        const normalizedGameplay = {
          ...already,
          Game: already.Game || already.game || updatedReservation.packageName || updatedReservation.selectedGameplayName || updatedReservation.selectedPackageId || '—',
          Schedule: already.Schedule || [updatedReservation.reservationDate, updatedReservation.reservationTime].filter(Boolean).join(' • ') || updatedReservation.createdAtISO || '',
          Mode: already.Mode || already.mode || updatedReservation.mode || updatedReservation.gameMode || updatedReservation.sessionType || '—',
          Group: already.Group || already.group || updatedReservation.group || updatedReservation.sessionType || `${updatedReservation.numberOfPlayers || '—'} players`,
          Package: already.Package || already.package || updatedReservation.packageName || updatedReservation.selectedGameplayName || updatedReservation.selectedPackageId || '—',
          Status: already.Status || already.status || 'Scheduled',
          updatedAtISO: new Date().toISOString(),
        }
        await db.collection('gameplay').updateOne({ _id: already._id }, { $set: normalizedGameplay })
        gameplay = already
      } else {
        const gameplayDoc = mapReservationToGameplay({ reservation: updatedReservation })

        // Ensure reservationId + userId exist
        gameplayDoc.reservationId = reservationKey(updatedReservation)
        gameplayDoc.userId = String(updatedReservation.userId)

        // Generate sequential GP id like GP-000001 (matching reservation R- prefix pattern)
        const gameplayCount = await db.collection('gameplay').countDocuments({})
        const gameplayId = `GP-${String(gameplayCount + 1).padStart(6, '0')}`

        const insert = await db.collection('gameplay').insertOne({
          ...gameplayDoc,
          id: gameplayId,
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

// DELETE reservation (admin/marshal only, cascades to payments + gameplay)
router.delete('/reservations/:id', async (req, res) => {
  const { id } = req.params
  if (!id) return res.status(400).json({ ok: false, error: 'invalid id' })

  const actorRole = req.body?.role || req.query?.role

  try {
    const db = await getDb()

    const reservation = await findReservation(db, id)
    if (!reservation) return res.status(404).json({ ok: false, error: 'reservation not found' })

    if (!isAdminRole(actorRole)) {
      return res.status(403).json({ ok: false, error: 'forbidden — admin or marshal role required' })
    }

    const reservationKeyValue = reservationKey(reservation)

    // Delete linked payment records
    await db.collection('payments').deleteMany({
      reservationId: reservationKeyValue,
    })

    // Delete linked gameplay records
    await db.collection('gameplay').deleteMany({
      reservationId: reservationKeyValue,
    })

    // Delete the reservation itself
    const reservationFilter = reservation._id ? { _id: reservation._id } : { id: String(reservation.id || id) }
    await db.collection('reservations').deleteOne(reservationFilter)

    return res.json({
      ok: true,
      message: 'Reservation and related records deleted successfully',
      deletedReservationId: id,
    })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

export default router

