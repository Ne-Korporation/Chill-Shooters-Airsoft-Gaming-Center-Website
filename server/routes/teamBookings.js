import express from 'express'
import { ObjectId } from 'mongodb'
import { getDb, startDbSession } from '../db/mongo.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { getGcashAmountDue, getPaymentProgress, getSplitPayerIds } from '../utils/paymentRules.js'
import { expireOverdueReservations, getReservationPayments } from '../utils/paymentProgress.js'
import { loadoutOf } from '../utils/splitShares.js'
import { playerGunsOf, rentOnlyOf } from '../utils/ownGearRentals.js'
import {
  ACTIVE_BOOKING_STATUSES,
  acceptInvite,
  coverOpenSlot,
  declineInvite,
  fillOpenSlot,
  latestInvite,
} from '../utils/teamInvites.js'
import { manilaDateISO } from '../utils/reminders.js'

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
    // What the total is made of (entrance fee, package or rentals, discounts), for the fee details.
    pricingBreakdown: Array.isArray(reservation.pricingBreakdown)
      ? reservation.pricingBreakdown.map((line) => ({ label: String(line?.label || ''), amount: Number(line?.amount) || 0 }))
      : [],
    paymentPlan: reservation.paymentPlan === 'full' ? 'full' : 'cash_balance',
    teamSize: Number(reservation.teamSize) || 1,
    // Shares follow what each player gets (package / own gun / own gun and gear) instead of an even split.
    unevenShares: Boolean(reservation.splitShares),
    reservationStatus: reservation.reservationStatus,
    sessionType: reservation.sessionType || 'public',
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
      // An invite still waiting for an answer is shown under Game invites; the share comes after accepting.
      if (!isCaptain && latestInvite(reservation, me)?.status === 'pending') continue
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
      const memberIds = (reservation.teamMembers || []).map((m) => String(m?.id || '')).filter(Boolean)
      const accounts = await namesById(db, [...new Set([...payerIds, String(reservation.userId), ...memberIds])])
      // Everyone on the booking, so an invited teammate can see who booked and who they're playing with.
      // Models of the guns players picked themselves, for "Gets".
      const gunIds = Object.values(reservation.playerGuns || {}).flat().map(String)
      const gunModels = new Map(gunIds.length
        ? (await db.collection('weapons').find({ id: { $in: gunIds } }, { projection: { id: 1, name: 1, model: 1 } }).toArray())
          .map((w) => [String(w.id), w.model || String(w.name || '').replace(/\s+#\d+$/, '')])
        : [])
      // What each payer's share of the online amount is: their own (uneven) share when players get
      // different things, else an even split. Minors don't pay (null).
      const online = Math.max(0, Number(reservation.depositAmount) || 0)
      const evenShare = payerIds.length ? Math.round((online / payerIds.length) * 100) / 100 : 0
      const shareOf = (id) => {
        if (!payerIds.includes(id)) return null
        const recorded = Number(reservation.splitShares?.[id])
        return Number.isFinite(recorded) ? recorded : evenShare
      }
      const players = [String(reservation.userId), ...memberIds]
        .filter((id, index, all) => id && all.indexOf(id) === index)
        .map((id) => ({
          id,
          name: accounts.get(id)?.name || (reservation.teamMembers || []).find((m) => String(m?.id) === id)?.name || 'Player',
          isCaptain: id === String(reservation.userId),
          isMe: id === me,
          // What the person who booked chose for them: the package, own gun, or own gun and gear.
          loadout: String(reservation.selectionMode || '').toLowerCase() === 'package' ? loadoutOf(reservation, id) : null,
          // Not taking the package: the single pieces they rent (gun, mask, vest), if any.
          rentOnly: rentOnlyOf(reservation, id),
          pickedGuns: playerGunsOf(reservation, id).map((gunId) => gunModels.get(gunId) || 'Gun'),
          // Everyone on the team sees what each player pays online (who has paid stays captain-only).
          share: shareOf(id),
          // A minor doesn't pay; their parent or guardian on the team does.
          paidBy: (() => {
            const member = (reservation.teamMembers || []).find((m) => String(m?.id) === id)
            if (!member?.isMinor) return null
            const guardianId = String(member.guardianId || '')
            return payerIds.includes(guardianId) ? (accounts.get(guardianId)?.name || 'Their guardian') : null
          })(),
        }))
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
        players,
        myShareDue,
        iHavePaid,
        progress: {
          target: progress.target,
          submitted: progress.submitted,
          remaining: progress.remaining,
          state: progress.state,
          // Everyone sees how many shares are in; only the captain sees who paid.
          paidCount: progress.paidPayerIds.length,
          payerCount: payerIds.length,
        },
        // Captains see who has paid; teammates only see their own share.
        members: isCaptain
          ? payerIds.map((id) => ({
            id,
            name: accounts.get(id)?.name || id,
            isCaptain: id === String(reservation.userId),
            // Paid in full: their whole share (a top-up still due means not yet).
            paid: progress.paidPayerIds.includes(id),
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

async function findById(db, collection, id) {
  const key = String(id || '').trim()
  if (!key) return null
  const byId = await db.collection(collection).findOne({ id: key })
  if (byId) return byId
  return ObjectId.isValid(key) ? db.collection(collection).findOne({ _id: new ObjectId(key) }) : null
}

const sendError = (res, err) => res.status(err?.statusCode || 500).json({ ok: false, error: err?.message || String(err) })

// GET /api/invitations/mine — game invites waiting for this player's answer, and (as the one who
// booked) spots on their bookings that a teammate left open.
router.get('/invitations/mine', requireAuth, requireRole('user'), async (req, res) => {
  try {
    const db = await getDb()
    const me = String(req.user.id)
    const reservations = await db.collection('reservations').find({
      reservationStatus: { $in: ACTIVE_BOOKING_STATUSES },
      reservationDate: { $gte: manilaDateISO() },
      $or: [
        { invites: { $elemMatch: { playerId: me, status: 'pending' } } },
        { userId: me, openSlots: { $elemMatch: { status: { $in: ['open', 'covering'] } } } },
      ],
    }).limit(50).toArray()
    const accounts = await namesById(db, [...new Set(reservations.map((r) => String(r.userId)))])
    const invites = []
    const openSlots = []
    for (const reservation of reservations) {
      const mine = latestInvite(reservation, me)
      if (mine?.status === 'pending' && String(reservation.userId) !== me) {
        const split = String(reservation.paymentMode || 'self').toLowerCase() === 'split'
        const recorded = Number(reservation.splitShares?.[me])
        const share = split
          ? (Number.isFinite(recorded) ? recorded : Math.round((Number(reservation.depositAmount || 0) / Math.max(1, Number(reservation.teamSize) || 1)) * 100) / 100)
          : 0
        invites.push({
          reservation: summarize(reservation),
          captainName: accounts.get(String(reservation.userId))?.name || 'Team captain',
          invitedAtISO: mine.invitedAtISO,
          deadlineISO: mine.deadlineISO,
          myShare: share,
          split,
        })
      }
      if (String(reservation.userId) === me) {
        for (const slot of (reservation.openSlots || []).filter((s) => ['open', 'covering'].includes(s.status))) {
          openSlots.push({
            reservation: summarize(reservation),
            slot: { id: slot.id, playerId: slot.playerId, name: slot.name, amount: Number(slot.amount) || 0, status: slot.status, reason: slot.reason, deadlineISO: slot.deadlineISO },
          })
        }
      }
    }
    return res.json({ ok: true, data: { invites, openSlots } })
  } catch (err) {
    return sendError(res, err)
  }
})

// POST /api/reservations/:id/accept — the invited player says yes. Their other invites for the same
// date and time slot are turned down, and those captains are told.
router.post('/reservations/:id/accept', requireAuth, requireRole('user'), async (req, res) => {
  try {
    const db = await getDb()
    const reservation = await findById(db, 'reservations', req.params.id)
    if (!reservation) return res.status(404).json({ ok: false, error: 'Reservation not found' })
    await acceptInvite(db, reservation, req.user.id)
    return res.json({ ok: true })
  } catch (err) {
    return sendError(res, err)
  }
})

// POST /api/reservations/:id/decline — the invited player says no, before paying. In a private game
// the spot stays and the captain pays for it, fills it, or re-invites; in a public game still being
// paid the booking drops a player, is re-priced, and the other shares re-split.
router.post('/reservations/:id/decline', requireAuth, requireRole('user'), async (req, res) => {
  try {
    const db = await getDb()
    const reservation = await findById(db, 'reservations', req.params.id)
    if (!reservation) return res.status(404).json({ ok: false, error: 'Reservation not found' })
    const result = await declineInvite(db, reservation, req.user.id)
    const updated = await db.collection('reservations').findOne({ _id: reservation._id })
    return res.json({ ok: true, data: { mode: result.mode, numberOfPlayers: updated?.numberOfPlayers, totalAmount: updated?.totalAmount } })
  } catch (err) {
    return sendError(res, err)
  }
})

// POST /api/reservations/:id/open-slots/:slotId/invite { playerId } — the captain fills a spot a
// teammate left: another player, or the same one again. They get 24 hours to accept.
router.post('/reservations/:id/open-slots/:slotId/invite', requireAuth, requireRole('user'), async (req, res) => {
  try {
    const db = await getDb()
    const reservation = await findById(db, 'reservations', req.params.id)
    if (!reservation) return res.status(404).json({ ok: false, error: 'Reservation not found' })
    await fillOpenSlot(db, reservation, String(req.params.slotId), String(req.body?.playerId || ''), req.user.id)
    return res.json({ ok: true })
  } catch (err) {
    return sendError(res, err)
  }
})

// POST /api/reservations/:id/open-slots/:slotId/cover — the captain pays for a spot online; its
// share is added to what they pay now (the page then opens the payment).
router.post('/reservations/:id/open-slots/:slotId/cover', requireAuth, requireRole('user'), async (req, res) => {
  try {
    const db = await getDb()
    const reservation = await findById(db, 'reservations', req.params.id)
    if (!reservation) return res.status(404).json({ ok: false, error: 'Reservation not found' })
    await coverOpenSlot(db, reservation, String(req.params.slotId), req.user.id)
    return res.json({ ok: true })
  } catch (err) {
    return sendError(res, err)
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
        .filter((payment) => !['failed', 'rejected', 'cancelled'].includes(String(payment.paymentStatus || payment.status || '').toLowerCase()))
      const memberIds = [String(reservation.userId), ...(reservation.teamMembers || []).map((member) => String(member.id))]
      const accounts = await namesById(db, memberIds)
      const waivers = await db.collection('waivers').find(
        { userId: { $in: memberIds }, archived: { $ne: true } },
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
