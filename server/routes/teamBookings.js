import express from 'express'
import { ObjectId } from 'mongodb'
import { getDb, startDbSession } from '../db/mongo.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { getGcashAmountDue, getPaymentProgress, getSplitPayerIds } from '../utils/paymentRules.js'
import {
  expireOverdueReservations,
  getReservationPayments,
  notifyUser,
  syncReservationPaymentState,
} from '../utils/paymentProgress.js'
import { calculateBookingPrice } from '../utils/bookingPricing.js'
import { getBookingInventoryRequirements, getHeldQuantities, holdBookingInventory, releaseBookingInventory } from '../utils/inventoryHolds.js'
import { syncPublicGrounds } from '../utils/bookingSlots.js'
import { teamWithout } from '../utils/teamDecline.js'
import { loadoutOf, withSplitShares } from '../utils/splitShares.js'

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
      const players = [String(reservation.userId), ...memberIds]
        .filter((id, index, all) => id && all.indexOf(id) === index)
        .map((id) => ({
          id,
          name: accounts.get(id)?.name || (reservation.teamMembers || []).find((m) => String(m?.id) === id)?.name || 'Player',
          isCaptain: id === String(reservation.userId),
          isMe: id === me,
          // What the person who booked chose for them: the package, own gun, or own gun and gear.
          loadout: String(reservation.selectionMode || '').toLowerCase() === 'package' ? loadoutOf(reservation, id) : null,
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

async function findById(db, collection, id) {
  const key = String(id || '').trim()
  if (!key) return null
  const byId = await db.collection(collection).findOne({ id: key })
  if (byId) return byId
  return ObjectId.isValid(key) ? db.collection(collection).findOne({ _id: new ObjectId(key) }) : null
}

// POST /api/reservations/:id/decline — an invited player says no to a team booking, before paying
// their share. The booking drops to one fewer player: it is re-priced, its gear is re-reserved for
// the smaller group, and the remaining shares re-split. The person who booked (and anyone still to
// pay) is told the new amount.
router.post('/reservations/:id/decline', requireAuth, requireRole('user'), async (req, res) => {
  const me = String(req.user.id)
  let session
  try {
    const db = await getDb()
    const reservation = await findById(db, 'reservations', req.params.id)
    if (!reservation) return res.status(404).json({ ok: false, error: 'Reservation not found' })
    if (!['pending', 'needs review'].includes(String(reservation.reservationStatus || '').toLowerCase())) {
      return res.status(409).json({ ok: false, error: 'This booking is already confirmed, so it can no longer be declined.' })
    }
    const payments = await getReservationPayments(db, reservation)
    const paidAlready = payments.some((p) => String(p.userId) === me && !['failed', 'rejected'].includes(String(p.paymentStatus || p.status || '').toLowerCase()))
    if (paidAlready) return res.status(409).json({ ok: false, error: 'You already paid your share, so you can no longer decline.' })

    const { leaving, changes } = teamWithout(reservation, me)
    const next = { ...reservation, ...changes }
    let pricing
    try {
      pricing = await calculateBookingPrice({ db, payload: next, players: changes.numberOfPlayers, findDocumentById: findById, userId: reservation.userId })
    } catch (err) {
      return res.status(409).json({ ok: false, error: `The booking can't drop to ${changes.numberOfPlayers} player${changes.numberOfPlayers === 1 ? '' : 's'}: ${err.message} Ask the person who booked to change it.` })
    }
    Object.assign(next, pricing)
    if (String(next.paymentPlan || '') === 'full') {
      next.depositAmount = next.totalAmount
      next.balanceAmount = 0
    }
    // Re-work out who owes what for the smaller team (uneven when players get different things).
    Object.assign(next, withSplitShares(next))

    const nowISO = new Date().toISOString()
    const slot = { reservationDate: reservation.reservationDate, reservationTime: reservation.reservationTime }
    session = startDbSession()
    await session.withTransaction(async () => {
      await db.collection('reservation_slot_locks').updateOne(
        { _id: `${reservation.locationId}:${reservation.reservationDate}:${reservation.reservationTime}` },
        { $inc: { version: 1 } },
        { upsert: true, session },
      )
      // Give back what the bigger group had reserved, then reserve again for the smaller one.
      await releaseBookingInventory(db, reservation.id, session)
      const requirements = await getBookingInventoryRequirements({
        db, payload: next, players: changes.numberOfPlayers, findDocumentById: findById,
        heldQuantities: await getHeldQuantities(db, slot, session),
      })
      await holdBookingInventory({ db, session, reservationId: reservation.id, requirements, ...slot })
      await db.collection('reservations').updateOne(
        { _id: reservation._id },
        {
          $set: { ...changes, ...pricing, depositAmount: next.depositAmount, balanceAmount: next.balanceAmount, splitShares: next.splitShares, inventoryRequirements: requirements, updatedAtISO: nowISO },
          $push: { declinedPlayers: { ...leaving, atISO: nowISO } },
        },
        { session },
      )
      if (String(reservation.sessionType || '').toLowerCase() !== 'private') {
        await syncPublicGrounds(db, { locationId: reservation.locationId, ...slot }, session)
      }
    })

    const updated = await db.collection('reservations').findOne({ _id: reservation._id })
    await syncReservationPaymentState(db, updated)

    const label = `${reservation.reservationDate} (${reservation.reservationTime})`
    const total = `₱${Number(updated.totalAmount || 0).toLocaleString()}`
    await notifyUser(db, {
      userId: reservation.userId,
      type: 'split_payment_updated',
      title: `${leaving.name || 'A teammate'} declined your booking`,
      message: `${leaving.name || 'A teammate'} won't play on ${label}. The booking is now ${updated.numberOfPlayers} player${updated.numberOfPlayers === 1 ? '' : 's'} at ${total}, and the remaining shares were re-split.`,
      linkedResourceId: reservation.id,
    })
    const stillToPay = getSplitPayerIds(updated).filter((id) => id !== String(reservation.userId) && !payments.some((p) => String(p.userId) === id))
    for (const userId of stillToPay) {
      await notifyUser(db, {
        userId,
        type: 'split_payment_updated',
        title: 'Your share changed',
        message: `${leaving.name || 'A teammate'} left the booking for ${label}. It's now ${updated.numberOfPlayers} players at ${total}; check your new share in My Reservations.`,
        linkedResourceId: reservation.id,
      })
    }
    return res.json({ ok: true, data: { numberOfPlayers: updated.numberOfPlayers, totalAmount: updated.totalAmount } })
  } catch (err) {
    return res.status(err?.statusCode || 500).json({ ok: false, error: err?.message || String(err) })
  } finally {
    if (session) await session.endSession()
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
