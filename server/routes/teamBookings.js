import express from 'express'
import { getDb, startDbSession } from '../db/mongo.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { getGcashAmountDue, getPaymentProgress, getSplitPayerIds } from '../utils/paymentRules.js'
import { updateReservationStatusAtomically } from '../utils/reservationStatus.js'
import {
  expireOverdueReservations,
  getReservationPayments,
  notifyUser,
} from '../utils/paymentProgress.js'
import { emailReservationEvent } from '../services/notificationEmails.js'

const router = express.Router()
const OPEN_STATUSES = ['pending', 'needs review', 'confirmed']

async function namesById(db, ids) {
  const accounts = ids.length
    ? await db.collection('user_accounts').find({ id: { $in: ids } }, { projection: { id: 1, name: 1, email: 1 } }).toArray()
    : []
  return new Map(accounts.map((account) => [String(account.id), account]))
}

function summarize(reservation) {
  return {
    id: String(reservation.id),
    reservationDate: reservation.reservationDate,
    reservationTime: reservation.reservationTime,
    locationName: reservation.locationName || reservation.locationId,
    numberOfPlayers: reservation.numberOfPlayers,
    packageName: reservation.packageName || reservation.selectedGameplayName || 'Custom selection',
    totalAmount: reservation.totalAmount,
    depositAmount: reservation.depositAmount,
    reservationStatus: reservation.reservationStatus,
    paymentDueAtISO: reservation.paymentDueAtISO,
  }
}

// GET /api/split-payments/mine — split payments the player still has to pay, or (as captain)
// is tracking. Empty once everything is paid, which hides the sidebar module.
router.get('/split-payments/mine', requireAuth, requireRole('user'), async (req, res) => {
  try {
    const db = await getDb()
    await expireOverdueReservations(db, startDbSession)
    const me = String(req.user.id)
    const reservations = await db.collection('reservations').find({
      paymentMode: 'split',
      reservationStatus: { $in: OPEN_STATUSES },
      $or: [{ userId: me }, { splitPayerIds: me }],
    }).limit(50).toArray()

    const items = []
    for (const reservation of reservations) {
      const payments = await getReservationPayments(db, reservation)
      const progress = getPaymentProgress(reservation, payments)
      const isCaptain = String(reservation.userId) === me
      const iHavePaid = progress.paidPayerIds.includes(me)
      if (progress.state === 'finalized' || (!isCaptain && iHavePaid)) continue

      let myShareDue = 0
      if (!iHavePaid) {
        try {
          myShareDue = getGcashAmountDue(reservation, payments, me)
        } catch {
          myShareDue = 0
        }
      }
      const payerIds = getSplitPayerIds(reservation)
      const accounts = await namesById(db, payerIds)
      const paidByUser = new Map()
      for (const payment of payments) {
        const status = String(payment.paymentStatus || payment.status || '').toLowerCase()
        if (['failed', 'rejected'].includes(status)) continue
        paidByUser.set(String(payment.userId), { amount: Number(payment.amount || 0), status })
      }

      items.push({
        reservation: summarize(reservation),
        isCaptain,
        captainName: accounts.get(String(reservation.userId))?.name || 'Team captain',
        myShareDue,
        iHavePaid,
        progress: {
          target: progress.target,
          submitted: progress.submitted,
          remaining: progress.remaining,
          state: progress.state,
        },
        // Captains see who has paid; teammates only see their own share.
        members: isCaptain
          ? payerIds.map((id) => ({
            id,
            name: accounts.get(id)?.name || id,
            isCaptain: id === String(reservation.userId),
            paid: paidByUser.has(id),
            amount: paidByUser.get(id)?.amount || 0,
            paymentStatus: paidByUser.get(id)?.status || null,
          }))
          : undefined,
      })
    }

    return res.json({ ok: true, data: items })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// POST /api/reservations/:id/cancel — the captain cancels before payment is complete, releasing the slot.
router.post('/reservations/:id/cancel', requireAuth, requireRole('user'), async (req, res) => {
  try {
    const db = await getDb()
    const id = String(req.params.id || '').trim()
    const reservation = await db.collection('reservations').findOne({ id, userId: String(req.user.id) })
    if (!reservation) return res.status(404).json({ ok: false, error: 'Reservation not found.' })
    if (!OPEN_STATUSES.includes(String(reservation.reservationStatus || '').toLowerCase())) {
      return res.status(409).json({ ok: false, error: `A ${reservation.reservationStatus} reservation can't be cancelled.` })
    }

    const updated = await updateReservationStatusAtomically({
      db,
      startSession: startDbSession,
      reservationFilter: { id },
      reservationId: id,
      nextStatus: 'cancelled',
      actor: req.user,
      reason: 'cancelled_by_player',
    })

    for (const userId of getSplitPayerIds(reservation).filter((payerId) => payerId !== String(req.user.id))) {
      await notifyUser(db, {
        userId,
        type: 'reservation_status_update',
        title: 'Team reservation cancelled',
        message: `The captain cancelled the reservation for ${reservation.reservationDate} (${reservation.reservationTime}). No further payment is needed.`,
        linkedResourceId: id,
      })
    }
    void emailReservationEvent(db, updated, 'cancelled')
    return res.json({ ok: true, data: updated })
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ ok: false, error: err.message })
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// GET /api/admin/payment-complete-reservations — fully paid reservations forwarded for final
// approval, compiled with every payment proof and the team's waivers.
router.get('/admin/payment-complete-reservations', requireAuth, requireRole('admin'), async (_req, res) => {
  try {
    const db = await getDb()
    const reservations = await db.collection('reservations').find({
      forwardedToAdminAtISO: { $exists: true },
      reservationStatus: { $in: ['pending', 'needs review'] },
    }).sort({ forwardedToAdminAtISO: 1 }).limit(100).toArray()

    const data = []
    for (const reservation of reservations) {
      const payments = (await getReservationPayments(db, reservation))
        .filter((payment) => !['failed', 'rejected'].includes(String(payment.paymentStatus || payment.status || '').toLowerCase()))
      const memberIds = [String(reservation.userId), ...(reservation.teamMembers || []).map((member) => String(member.id))]
      const accounts = await namesById(db, memberIds)
      const waivers = await db.collection('waivers').find(
        { userId: { $in: memberIds } },
        { projection: { id: 1, userId: 1, fullName: 1, status: 1, createdAtISO: 1, submittedAtISO: 1 } },
      ).toArray()

      data.push({
        reservation: {
          ...summarize(reservation),
          paymentMode: reservation.paymentMode || 'self',
          forwardedToAdminAtISO: reservation.forwardedToAdminAtISO,
          captainName: accounts.get(String(reservation.userId))?.name || reservation.userId,
        },
        payments: payments.map((payment) => ({
          id: payment.id,
          payerName: accounts.get(String(payment.userId))?.name || payment.userId,
          amount: payment.amount,
          paymentMethod: payment.paymentMethod,
          paymentStatus: payment.paymentStatus || payment.status,
          transactionReference: payment.transactionReference,
          proofUrl: payment.gcashImageUrl || '',
        })),
        waivers: memberIds.map((userId) => {
          const waiver = waivers.find((item) => String(item.userId) === userId)
          return {
            userId,
            name: accounts.get(userId)?.name || userId,
            waiverId: waiver?.id || (waiver?._id ? String(waiver._id) : null),
            status: waiver?.status || 'missing',
          }
        }),
      })
    }
    return res.json({ ok: true, data })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

export default router
