import express from 'express'
import { ObjectId } from 'mongodb'
import { getDb, startDbSession, toObjectId } from '../db/mongo.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { updateReservationStatusAtomically } from '../utils/reservationStatus.js'

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

  try {
    const db = await getDb()

    const reservation = await findReservation(db, id)
    if (!reservation) return res.status(404).json({ ok: false, error: 'reservation not found' })
    if (String(reservation.reservationStatus || '').toLowerCase() === 'cancelled' && nextStatus !== 'cancelled') {
      return res.status(409).json({ ok: false, error: 'Cancelled reservations cannot be reopened. Create a new reservation instead.' })
    }

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
    })

    const payment = await db.collection('payments').findOne({
      reservationId: reservationKey(updatedReservation),
    })

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
