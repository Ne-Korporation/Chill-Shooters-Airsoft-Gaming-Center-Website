// Team invitations: every adult teammate a captain adds to a booking is invited and has 24 hours
// to accept (and, in a split payment, to pay their share). The captain is told at 12 hours and again
// 3 hours before the deadline while someone still hasn't answered or paid. An invite nobody answers
// in time is void.
//
// A player can only play one game per date and time slot. Accepting one invite turns down their
// other invites for the same slot, and so does booking a game of their own; each of those captains
// is told the player is no longer available. Someone already playing in the slot can't be invited
// (their invite is turned down straight away).
//
// When an invite is declined, void, or turned down:
//   - Private game (or a booking already paid): the spot stays. The captain has 24 hours to pay for
//     it online, invite another player, or invite the same player again. Otherwise the player's
//     share goes onto the captain's balance at the field, due before the game starts, and the
//     registrars are told to collect it.
//   - Public game still being paid: the player is dropped, the booking re-priced, and the other
//     shares re-split.
//
// Data on the reservation:
//   invites:   [{ playerId, name, status, invitedAtISO, deadlineISO, answeredAtISO?, reason?, reminders? }]
//              status: pending | accepted | declined | expired | unavailable
//   openSlots: [{ id, playerId, name, amount, status, reason, openedAtISO, deadlineISO, ... }]
//              status: open | covering (captain paying online) | filled | onsite | lapsed

import { getPaymentProgress, getSplitPayerIds } from './paymentRules.js'
import { getReservationPayments, notifyRole, notifyUser, syncReservationPaymentState } from './paymentProgress.js'
import { DEFAULT_SLOT_HOURS, getSlotHours } from './slotHours.js'
import { manilaDateISO } from './reminders.js'

export const INVITE_ANSWER_HOURS = Math.max(1, Number(process.env.INVITE_ANSWER_HOURS) || 24)
export const CAPTAIN_ACTION_HOURS = Math.max(1, Number(process.env.CAPTAIN_ACTION_HOURS) || 24)
const HOUR = 3600_000
// Reminders to the captain (and the invited player) while an invite is still unanswered or unpaid.
const REMINDERS = [
  { stage: '12h', afterMs: 12 * HOUR },
  { stage: '3h_left', beforeDeadlineMs: 3 * HOUR },
]
export const ACTIVE_BOOKING_STATUSES = ['pending', 'needs review', 'confirmed', 'approved']
export const CLOSED_INVITE_STATUSES = ['declined', 'expired', 'unavailable']

const round2 = (value) => Math.round(value * 100) / 100
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode })
const isSplit = (reservation) => String(reservation?.paymentMode || 'self').toLowerCase() === 'split'
const isPrivate = (reservation) => String(reservation?.sessionType || '').toLowerCase() === 'private'
const labelOf = (reservation) => `${reservation.reservationDate} (${reservation.reservationTime})`
const peso = (amount) => `₱${Number(amount || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`
const isActivePayment = (payment) => !['failed', 'rejected', 'cancelled'].includes(String(payment.paymentStatus || payment.status || '').toLowerCase())

// When the game starts (Manila time), so no deadline runs past it.
export function gameStartMs(reservation, hours = DEFAULT_SLOT_HOURS) {
  const start = (hours[reservation.reservationTime] || DEFAULT_SLOT_HOURS[reservation.reservationTime])?.start || '08:00'
  const ms = Date.parse(`${reservation.reservationDate}T${start}:00+08:00`)
  return Number.isFinite(ms) ? ms : Infinity
}

function deadlineFrom(reservation, fromMs, hoursAhead, slotHours) {
  return new Date(Math.min(fromMs + hoursAhead * HOUR, gameStartMs(reservation, slotHours))).toISOString()
}

export function latestInvite(reservation, playerId) {
  const list = (reservation?.invites || []).filter((invite) => String(invite.playerId) === String(playerId))
  return list[list.length - 1] || null
}

function paidByPlayer(payments, playerId) {
  return round2(payments.filter(isActivePayment).filter((p) => String(p.userId || '') === String(playerId))
    .reduce((sum, p) => sum + Number(p.amount || 0), 0))
}

// Whether this teammate still has to do something: answer, or (in a split payment) pay their share.
function needsToPay(reservation, playerId) {
  return isSplit(reservation) && getSplitPayerIds(reservation).includes(String(playerId)) && String(playerId) !== String(reservation.userId)
}
export function inviteOutstanding(reservation, invite, payments) {
  if (!invite) return false
  if (invite.status === 'pending') return true
  return invite.status === 'accepted' && needsToPay(reservation, invite.playerId) && paidByPlayer(payments, invite.playerId) <= 0
}

// Invites for a new booking: every adult teammate (minors play under their guardian's answer).
export function buildInvites(reservation, now = Date.now(), slotHours = DEFAULT_SLOT_HOURS) {
  const invitedAtISO = new Date(now).toISOString()
  const deadlineISO = deadlineFrom(reservation, now, INVITE_ANSWER_HOURS, slotHours)
  return (reservation.teamMembers || [])
    .filter((member) => !member.isMinor && String(member.id) !== String(reservation.userId))
    .map((member) => ({ playerId: String(member.id), name: member.name || '', status: 'pending', invitedAtISO, deadlineISO }))
}

// Matches bookings where this player holds a place: as the one who booked, as an accepted
// teammate, or as a teammate on an older booking made before invites existed.
export function playingFilter(playerId) {
  const id = String(playerId)
  return {
    $or: [
      { userId: id },
      { invites: { $elemMatch: { playerId: id, status: 'accepted' } } },
      { 'teamMembers.id': id, 'invites.playerId': { $ne: id } },
    ],
  }
}

// Another active booking in the same date and time slot where this player is already playing.
export async function findSlotConflict(db, playerId, reservation) {
  return db.collection('reservations').findOne({
    reservationDate: reservation.reservationDate,
    reservationTime: reservation.reservationTime,
    reservationStatus: { $in: ACTIVE_BOOKING_STATUSES },
    id: { $ne: String(reservation.id) },
    ...playingFilter(playerId),
  }, { projection: { id: 1, userId: 1, locationName: 1, locationId: 1 } })
}

async function nameOf(db, userId, fallback = 'A player') {
  const account = await db.collection('user_accounts').findOne({ id: String(userId) }, { projection: { name: 1 } })
  return account?.name || fallback
}

async function findDocumentById(db, collection, id) {
  const key = String(id || '').trim()
  if (!key) return null
  return db.collection(collection).findOne({ id: key })
}

// Each payer's share as recorded amounts, so taking one payer out doesn't change the others'.
function recordedShares(reservation) {
  if (reservation.splitShares) return { ...reservation.splitShares }
  const payers = getSplitPayerIds(reservation)
  const online = Math.max(0, Number(reservation.depositAmount) || 0)
  const openHold = (reservation.openSlots || []).filter((slot) => ['open', 'covering'].includes(slot.status))
    .reduce((sum, slot) => sum + Number(slot.amount || 0), 0)
  const toShare = Math.max(0, online - openHold)
  const teamSize = Math.max(1, Number(reservation.teamSize) || payers.length)
  const even = round2(toShare / teamSize)
  const shares = {}
  let given = 0
  payers.forEach((id, index) => {
    shares[id] = index === payers.length - 1 ? round2(toShare - given) : even
    given = round2(given + shares[id])
  })
  return shares
}

// The player and any of their children on the team, off every team list on the booking.
function withoutPlayers(reservation, ids) {
  const leaving = new Set(ids.map(String))
  const members = (reservation.teamMembers || []).filter((member) => !leaving.has(String(member.id)))
  const payers = (reservation.splitPayerIds || []).map(String).filter((id) => !leaving.has(id))
  const bringers = (reservation.ownWeaponBringers || []).filter((b) => !leaving.has(String(b?.userId)))
  return {
    teamMembers: members,
    selectedTeammateIds: members.map((member) => String(member.id)),
    splitPayerIds: payers,
    ownWeaponBringerIds: (reservation.ownWeaponBringerIds || []).map(String).filter((id) => !leaving.has(id)),
    ownWeaponBringers: bringers,
    ownGearPlayerIds: (reservation.ownGearPlayerIds || []).map(String).filter((id) => !leaving.has(id)),
    ownGearRentals: Object.fromEntries(Object.entries(reservation.ownGearRentals || {}).filter(([id]) => !leaving.has(String(id)))),
    playerGuns: Object.fromEntries(Object.entries(reservation.playerGuns || {}).filter(([id]) => !leaving.has(String(id)))),
    selectedOwnWeaponIds: reservation.selectedOwnWeaponIds || [],
  }
}

// Public booking still being paid: drop the player and re-price, as when they decline. Returns the
// updated reservation, or null when the booking can't shrink (then the spot is kept instead).
async function shrinkBooking(db, reservation, leavingIds) {
  const { startDbSession } = await import('../db/mongo.js')
  const { calculateBookingPrice } = await import('./bookingPricing.js')
  const { getBookingInventoryRequirements, getHeldQuantities, holdBookingInventory, releaseBookingInventory } = await import('./inventoryHolds.js')
  const { syncPublicGrounds } = await import('./bookingSlots.js')
  const { withSplitShares } = await import('./splitShares.js')

  const team = withoutPlayers(reservation, leavingIds)
  const numberOfPlayers = Math.max(1, Number(reservation.numberOfPlayers || 1) - leavingIds.length)
  const split = isSplit(reservation) && team.splitPayerIds.length > 0
  const changes = {
    ...team,
    numberOfPlayers,
    paymentMode: split ? 'split' : 'self',
    teamSize: split ? team.splitPayerIds.length + 1 : 1,
    splitPayerIds: split ? team.splitPayerIds : [],
    verifiedOwnWeaponCount: Math.min(numberOfPlayers, team.ownWeaponBringers.filter((b) => b?.verified).length),
    verifiedOwnGearCount: Math.min(numberOfPlayers, team.ownGearPlayerIds.length),
  }
  const next = { ...reservation, ...changes }
  let pricing
  try {
    pricing = await calculateBookingPrice({ db, payload: next, players: numberOfPlayers, findDocumentById: (d, c, i) => findDocumentById(d, c, i), userId: reservation.userId })
  } catch {
    return null
  }
  Object.assign(next, pricing)
  if (String(next.paymentPlan || '') === 'full') {
    next.depositAmount = next.totalAmount
    next.balanceAmount = 0
  }
  Object.assign(next, withSplitShares(next))
  const slot = { reservationDate: reservation.reservationDate, reservationTime: reservation.reservationTime }
  const session = startDbSession()
  try {
    await session.withTransaction(async () => {
      await db.collection('reservation_slot_locks').updateOne(
        { _id: `${reservation.locationId}:${reservation.reservationDate}:${reservation.reservationTime}` },
        { $inc: { version: 1 } },
        { upsert: true, session },
      )
      await releaseBookingInventory(db, reservation.id, session)
      const requirements = await getBookingInventoryRequirements({
        db, payload: next, players: numberOfPlayers, findDocumentById: (d, c, i) => findDocumentById(d, c, i),
        heldQuantities: await getHeldQuantities(db, slot, session),
      })
      await holdBookingInventory({ db, session, reservationId: reservation.id, requirements, ...slot })
      await db.collection('reservations').updateOne(
        { _id: reservation._id },
        { $set: { ...changes, ...pricing, depositAmount: next.depositAmount, balanceAmount: next.balanceAmount, splitShares: next.splitShares, inventoryRequirements: requirements, updatedAtISO: new Date().toISOString() } },
        { session },
      )
      if (!isPrivate(reservation)) await syncPublicGrounds(db, { locationId: reservation.locationId, ...slot }, session)
    })
  } catch {
    return null
  } finally {
    await session.endSession()
  }
  return db.collection('reservations').findOne({ _id: reservation._id })
}

const REASON_TEXT = {
  declined: (name) => `${name} declined`,
  expired: (name) => `${name} didn't answer within ${INVITE_ANSWER_HOURS} hours, so the invite is void`,
  expired_unpaid: (name) => `${name} didn't pay their share within ${INVITE_ANSWER_HOURS} hours, so the invite is void`,
  unavailable: (name) => `${name} is no longer available for that slot (they're already playing another game then)`,
}

// Closes one invite (declined / expired / unavailable) and frees or keeps the spot. The invite only
// closes if it is still open, so two sweeps or a sweep and a click can't both handle it.
// Returns { handled, mode: 'kept' | 'dropped' } or { handled: false }.
export async function closeInvite(db, reservation, playerId, status, { reason = status, slotHours } = {}) {
  const id = String(playerId)
  const invite = latestInvite(reservation, id)
  if (!invite || !['pending', 'accepted'].includes(invite.status)) return { handled: false }
  const nowISO = new Date().toISOString()
  const closed = await db.collection('reservations').updateOne(
    { _id: reservation._id, invites: { $elemMatch: { playerId: id, invitedAtISO: invite.invitedAtISO, status: invite.status } } },
    { $set: { 'invites.$.status': status, 'invites.$.answeredAtISO': nowISO, 'invites.$.reason': reason } },
  )
  if (closed.modifiedCount !== 1) return { handled: false }

  const fresh = await db.collection('reservations').findOne({ _id: reservation._id })
  const leaving = [id, ...(fresh.teamMembers || []).filter((m) => m.isMinor && String(m.guardianId) === id).map((m) => String(m.id))]
  const name = invite.name || await nameOf(db, id)
  const payments = await getReservationPayments(db, fresh)
  const progress = getPaymentProgress(fresh, payments)
  const label = labelOf(fresh)
  const why = (REASON_TEXT[reason] || REASON_TEXT[status] || REASON_TEXT.declined)(name)
  const stillBeingPaid = ['pending', 'needs review'].includes(String(fresh.reservationStatus || '').toLowerCase()) && progress.state !== 'finalized'

  // Public game still being paid: drop the player (falls back to keeping the spot if it can't shrink).
  if (!isPrivate(fresh) && stillBeingPaid) {
    const updated = await shrinkBooking(db, fresh, leaving)
    if (updated) {
      await db.collection('reservations').updateOne({ _id: fresh._id }, { $push: { declinedPlayers: { id, name, reason, atISO: nowISO } } })
      await syncReservationPaymentState(db, updated)
      await notifyUser(db, {
        userId: fresh.userId,
        type: 'split_payment_updated',
        title: status === 'declined' ? `${name} declined your booking` : `${name} is off your booking`,
        message: `${why} for ${label}. The booking is now ${updated.numberOfPlayers} player${updated.numberOfPlayers === 1 ? '' : 's'} at ${peso(updated.totalAmount)}${isSplit(updated) ? ', and the remaining shares were re-split' : ''}.`,
        linkedResourceId: fresh.id,
      })
      const fresherPayments = await getReservationPayments(db, updated)
      for (const userId of getSplitPayerIds(updated).filter((pid) => pid !== String(updated.userId) && paidByPlayer(fresherPayments, pid) <= 0)) {
        await notifyUser(db, {
          userId,
          type: 'split_payment_updated',
          title: 'Your share changed',
          message: `${name} left the booking for ${label}. It's now ${updated.numberOfPlayers} players at ${peso(updated.totalAmount)}; check your new share in My Reservations.`,
          linkedResourceId: fresh.id,
        })
      }
      return { handled: true, mode: 'dropped' }
    }
  }

  // Keep the spot: the player's share (if any is still owed online) waits on the captain.
  const shares = isSplit(fresh) ? recordedShares(fresh) : null
  const owesOnline = Boolean(shares) && paidByPlayer(payments, id) <= 0 && progress.state !== 'finalized'
  const amount = owesOnline ? round2(Number(shares[id]) || 0) : 0
  if (shares) delete shares[id]
  const team = withoutPlayers(fresh, leaving)
  const payersLeft = team.splitPayerIds.length
  const hours = slotHours || (await getSlotHours(db)).hours
  const slotDeadlineISO = deadlineFrom(fresh, Date.now(), CAPTAIN_ACTION_HOURS, hours)
  const openSlots = leaving.map((pid, index) => ({
    id: `S-${Date.now().toString(36)}-${index}`,
    playerId: pid,
    name: pid === id ? name : ((fresh.teamMembers || []).find((m) => String(m.id) === pid)?.name || 'Child'),
    amount: pid === id ? amount : 0,
    status: 'open',
    reason,
    openedAtISO: nowISO,
    deadlineISO: slotDeadlineISO,
  }))
  await db.collection('reservations').updateOne(
    { _id: fresh._id },
    {
      $set: {
        ...team,
        ...(shares ? { splitShares: shares, teamSize: payersLeft + 1 } : {}),
        updatedAtISO: nowISO,
      },
      $push: { openSlots: { $each: openSlots }, declinedPlayers: { id, name, reason, atISO: nowISO } },
      // The booking stays open for payment until the captain has dealt with the spot.
      ...(amount > 0 ? { $max: { paymentDueAtISO: slotDeadlineISO } } : {}),
    },
  )
  const deadlineLabel = new Date(slotDeadlineISO).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })
  const message = amount > 0
    ? `${why} for ${label}. Pay for their spot (${peso(amount)}), invite another player, or invite ${name} again from My Reservations before ${deadlineLabel}. If you don't, ${peso(amount)} is added to what you pay at the field, due before the game starts.`
    : `${why} for ${label}. Their spot is still yours: invite another player or invite ${name} again from My Reservations.`
  await notifyUser(db, {
    userId: fresh.userId,
    type: 'team_spot_open',
    title: status === 'declined' ? `${name} declined your invite` : status === 'unavailable' ? `${name} is no longer available` : `${name}'s invite is void`,
    message,
    linkedResourceId: fresh.id,
  })
  return { handled: true, mode: 'kept' }
}

// Turns down this player's other open invites for the same date and time slot (they accepted
// another game or booked one themselves). Each of those captains is told.
export async function withdrawOtherInvites(db, playerId, reservation) {
  const others = await db.collection('reservations').find({
    reservationDate: reservation.reservationDate,
    reservationTime: reservation.reservationTime,
    reservationStatus: { $in: ACTIVE_BOOKING_STATUSES },
    id: { $ne: String(reservation.id) },
    invites: { $elemMatch: { playerId: String(playerId), status: { $in: ['pending', 'accepted'] } } },
  }).limit(20).toArray()
  for (const other of others) {
    const invite = latestInvite(other, playerId)
    if (!invite || !['pending', 'accepted'].includes(invite.status)) continue
    // An accepted invite elsewhere is a real place in that game, so it stays (it can't happen
    // anyway: accepting checks for a clash first).
    if (invite.status === 'accepted') continue
    await closeInvite(db, other, playerId, 'unavailable')
  }
  return others.length
}

// New booking (its invites were saved with it): turn down any invitee already playing in the slot,
// and the booker's own invites to other games in the same slot.
export async function resolveNewBookingConflicts(db, reservation) {
  const { hours } = await getSlotHours(db)
  for (const invite of reservation.invites || []) {
    const conflict = await findSlotConflict(db, invite.playerId, reservation)
    if (!conflict) continue
    const current = await db.collection('reservations').findOne({ id: String(reservation.id) })
    await closeInvite(db, current, invite.playerId, 'unavailable', { slotHours: hours })
  }
  await withdrawOtherInvites(db, reservation.userId, reservation)
}

// The invited player says yes.
export async function acceptInvite(db, reservation, playerId) {
  const id = String(playerId)
  const invite = latestInvite(reservation, id)
  if (!invite) throw fail('You were not invited to this game.', 404)
  if (invite.status === 'accepted') return reservation
  if (invite.status !== 'pending') throw fail('This invite is closed.', 409)
  if (Date.parse(invite.deadlineISO) <= Date.now()) throw fail('The 24 hours to answer this invite have passed.', 409)
  if (!ACTIVE_BOOKING_STATUSES.includes(String(reservation.reservationStatus || '').toLowerCase())) throw fail('This booking is no longer active.', 409)
  const conflict = await findSlotConflict(db, id, reservation)
  if (conflict) throw fail(`You already have a game on ${labelOf(reservation)} (${conflict.id}). Decline this invite instead.`, 409)
  const accepted = await db.collection('reservations').updateOne(
    { _id: reservation._id, invites: { $elemMatch: { playerId: id, invitedAtISO: invite.invitedAtISO, status: 'pending' } } },
    { $set: { 'invites.$.status': 'accepted', 'invites.$.answeredAtISO': new Date().toISOString() } },
  )
  if (accepted.modifiedCount !== 1) throw fail('This invite was already answered.', 409)
  await withdrawOtherInvites(db, id, reservation)
  const name = invite.name || await nameOf(db, id)
  const payNext = needsToPay(reservation, id)
  await notifyUser(db, {
    userId: reservation.userId,
    type: 'team_invite_accepted',
    title: `${name} accepted your invite`,
    message: `${name} is playing on ${labelOf(reservation)}.${payNext ? ' They still need to pay their share.' : ''}`,
    linkedResourceId: reservation.id,
  })
  return db.collection('reservations').findOne({ _id: reservation._id })
}

// The invited player says no (before paying).
export async function declineInvite(db, reservation, playerId) {
  const id = String(playerId)
  if (String(reservation.userId) === id) throw fail('You booked this game, so you can\'t decline it.', 409)
  const invite = latestInvite(reservation, id)
  if (!invite) throw fail('You are not on this booking.', 404)
  const payments = await getReservationPayments(db, reservation)
  if (paidByPlayer(payments, id) > 0) throw fail('You already paid your share, so you can no longer decline.', 409)
  if (invite.status === 'accepted' && !needsToPay(reservation, id)) throw fail('You already accepted this game. Ask the captain to take you off.', 409)
  if (!['pending', 'accepted'].includes(invite.status)) throw fail('This invite is already closed.', 409)
  const result = await closeInvite(db, reservation, id, 'declined')
  if (!result.handled) throw fail('This invite was already answered.', 409)
  return result
}

// Captain: invite a player into an open spot (another player, or the same one again).
export async function fillOpenSlot(db, reservation, slotId, playerId, captainId) {
  if (String(reservation.userId) !== String(captainId)) throw fail('Only the player who booked can fill this spot.', 403)
  const slot = (reservation.openSlots || []).find((s) => s.id === slotId)
  if (!slot || !['open', 'covering'].includes(slot.status)) throw fail('This spot is no longer open.', 409)
  const id = String(playerId)
  if (id === String(reservation.userId)) throw fail('You are already on this booking.', 400)
  if ((reservation.teamMembers || []).some((m) => String(m.id) === id)) throw fail('That player is already on this booking.', 409)
  const account = await db.collection('user_accounts').findOne({ id, role: { $in: ['user', null] }, isChildProfile: { $ne: true } }, { projection: { id: 1, name: 1, email: 1, status: 1 } })
  if (!account || account.status === 'suspended') throw fail('That player could not be found.', 404)
  const { hasApprovedWaiver } = await import('../routes/children.js')
  if (!(await hasApprovedWaiver(db, id))) throw fail(`${account.name || 'That player'} hasn't signed their waiver yet.`, 409)
  const conflict = await findSlotConflict(db, id, reservation)
  if (conflict) throw fail(`${account.name || 'That player'} is already playing another game on ${labelOf(reservation)}.`, 409)

  const { hours } = await getSlotHours(db)
  const now = Date.now()
  const invite = { playerId: id, name: account.name || '', status: 'pending', invitedAtISO: new Date(now).toISOString(), deadlineISO: deadlineFrom(reservation, now, INVITE_ANSWER_HOURS, hours) }
  if (Date.parse(invite.deadlineISO) <= now) throw fail('The game is about to start, so there is no time left to invite someone.', 409)
  const split = isSplit(reservation)
  const shares = split ? { ...recordedShares(reservation), [id]: round2(Number(slot.amount) || 0) } : null
  const payers = split ? [...(reservation.splitPayerIds || []).map(String), id] : reservation.splitPayerIds || []
  const updated = await db.collection('reservations').updateOne(
    { _id: reservation._id, openSlots: { $elemMatch: { id: slotId, status: slot.status } } },
    {
      $set: {
        'openSlots.$.status': 'filled',
        'openSlots.$.filledBy': id,
        'openSlots.$.filledAtISO': invite.invitedAtISO,
        teamMembers: [...(reservation.teamMembers || []), { id, name: account.name || '', email: account.email || '' }],
        selectedTeammateIds: [...(reservation.selectedTeammateIds || []).map(String), id],
        ...(split ? { splitPayerIds: payers, splitShares: shares, teamSize: payers.length + 1 } : {}),
        updatedAtISO: invite.invitedAtISO,
      },
      // A new invite replaces this player's earlier one on the booking.
      $max: { paymentDueAtISO: invite.deadlineISO },
    },
  )
  if (updated.modifiedCount !== 1) throw fail('This spot was just changed. Refresh and try again.', 409)
  await db.collection('reservations').updateOne({ _id: reservation._id }, { $pull: { invites: { playerId: id } } })
  await db.collection('reservations').updateOne({ _id: reservation._id }, { $push: { invites: invite } })
  const captainName = await nameOf(db, reservation.userId, 'Your captain')
  const due = new Date(invite.deadlineISO).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })
  await notifyUser(db, {
    userId: id,
    type: 'team_invite',
    title: `${captainName} invited you to a game`,
    message: `${captainName} invited you to play on ${labelOf(reservation)}${split && slot.amount > 0 ? ` (your share: ${peso(slot.amount)})` : ''}. Accept or decline in My Reservations before ${due}.`,
    linkedResourceId: reservation.id,
  })
  return db.collection('reservations').findOne({ _id: reservation._id })
}

// Captain: pay for an open spot online. Its amount is added to what the captain pays now.
export async function coverOpenSlot(db, reservation, slotId, captainId) {
  if (String(reservation.userId) !== String(captainId)) throw fail('Only the player who booked can pay for this spot.', 403)
  const slot = (reservation.openSlots || []).find((s) => s.id === slotId)
  if (!slot || slot.status !== 'open') throw fail('This spot is no longer open.', 409)
  if (!(Number(slot.amount) > 0)) throw fail('Nothing is owed for this spot.', 409)
  if (String(reservation.reservationStatus || '').toLowerCase() !== 'pending') throw fail('This booking is no longer waiting for payment.', 409)
  const updated = await db.collection('reservations').updateOne(
    { _id: reservation._id, openSlots: { $elemMatch: { id: slotId, status: 'open' } } },
    { $set: { 'openSlots.$.status': 'covering', 'openSlots.$.coverRequestedAtISO': new Date().toISOString() } },
  )
  if (updated.modifiedCount !== 1) throw fail('This spot was just changed. Refresh and try again.', 409)
  return db.collection('reservations').findOne({ _id: reservation._id })
}

// The captain didn't act in time: the spot's share moves to what they pay at the field.
async function moveSlotOnsite(db, reservation, slot) {
  const amount = round2(Number(slot.amount) || 0)
  const nowISO = new Date().toISOString()
  const status = amount > 0 ? 'onsite' : 'lapsed'
  const moved = await db.collection('reservations').updateOne(
    { _id: reservation._id, openSlots: { $elemMatch: { id: slot.id, status: slot.status } } },
    {
      $set: { 'openSlots.$.status': status, 'openSlots.$.closedAtISO': nowISO, updatedAtISO: nowISO },
      ...(amount > 0 ? { $inc: { depositAmount: -amount, balanceAmount: amount, captainOnsiteAmount: amount } } : {}),
    },
  )
  if (moved.modifiedCount !== 1 || amount <= 0) return false
  const updated = await db.collection('reservations').findOne({ _id: reservation._id })
  await syncReservationPaymentState(db, updated)
  const label = labelOf(reservation)
  const captainName = await nameOf(db, reservation.userId, 'The captain')
  await notifyUser(db, {
    userId: reservation.userId,
    type: 'team_spot_onsite',
    title: `${peso(amount)} added to your payment at the field`,
    message: `No one filled ${slot.name}'s spot for ${label} in time, so their share of ${peso(amount)} was added to what you pay at the field. Pay it at the counter before your game starts.`,
    linkedResourceId: reservation.id,
  })
  await notifyRole(db, {
    role: 'registrar',
    topic: 'payment',
    type: 'onsite_payment_due',
    title: `Collect ${peso(amount)} onsite for ${reservation.id}`,
    message: `${captainName} has to pay ${slot.name}'s share (${peso(amount)}) at the counter for ${label}, on top of the booking's balance. Collect it before the game starts.`,
    linkedResourceId: reservation.id,
  })
  return true
}

let lastSweep = 0

// Every minute: reminders, void invites, and spots the captain left open past their deadline.
export async function sweepTeamInvites(db, { force = false } = {}) {
  const now = Date.now()
  if (!force && now - lastSweep < 60_000) return { skipped: true }
  lastSweep = now
  const { hours } = await getSlotHours(db)
  const reservations = await db.collection('reservations').find({
    reservationStatus: { $in: ACTIVE_BOOKING_STATUSES },
    reservationDate: { $gte: manilaDateISO(-1) },
    $or: [
      { invites: { $elemMatch: { status: { $in: ['pending', 'accepted'] } } } },
      { openSlots: { $elemMatch: { status: { $in: ['open', 'covering'] } } } },
    ],
  }).limit(300).toArray()

  let voided = 0
  let reminded = 0
  let movedOnsite = 0
  for (const reservation of reservations) {
    try {
      const payments = await getReservationPayments(db, reservation)
      const latest = new Map()
      for (const invite of reservation.invites || []) latest.set(String(invite.playerId), invite)
      const outstanding = [...latest.values()].filter((invite) => inviteOutstanding(reservation, invite, payments))

      // Void what wasn't answered (or paid) in time.
      for (const invite of outstanding.filter((inv) => Date.parse(inv.deadlineISO) <= now)) {
        const current = await db.collection('reservations').findOne({ _id: reservation._id })
        const result = await closeInvite(db, current, invite.playerId, 'expired', { reason: invite.status === 'accepted' ? 'expired_unpaid' : 'expired', slotHours: hours })
        if (result.handled) voided += 1
      }

      // Reminders at 12 hours after the invite and 3 hours before its deadline.
      const waiting = outstanding.filter((inv) => Date.parse(inv.deadlineISO) > now)
      for (const stage of REMINDERS) {
        const due = waiting.filter((inv) => !inv.reminders?.[stage.stage] && (stage.afterMs != null
          ? now - Date.parse(inv.invitedAtISO) >= stage.afterMs
          : Date.parse(inv.deadlineISO) - now <= stage.beforeDeadlineMs))
        if (!due.length) continue
        const claimed = []
        for (const invite of due) {
          const res = await db.collection('reservations').updateOne(
            { _id: reservation._id, invites: { $elemMatch: { playerId: invite.playerId, invitedAtISO: invite.invitedAtISO, [`reminders.${stage.stage}`]: { $exists: false } } } },
            { $set: { [`invites.$.reminders.${stage.stage}`]: new Date(now).toISOString() } },
          )
          if (res.modifiedCount === 1) claimed.push(invite)
        }
        if (!claimed.length) continue
        const leftLabel = (inv) => {
          const ms = Date.parse(inv.deadlineISO) - now
          return ms < HOUR ? `${Math.max(1, Math.round(ms / 60_000))} minutes` : `${Math.round(ms / HOUR)} hours`
        }
        const describe = (inv) => `${inv.name || 'A teammate'} (${inv.status === 'pending' ? 'hasn\'t accepted' : 'hasn\'t paid'})`
        await notifyUser(db, {
          userId: reservation.userId,
          type: 'team_invite_reminder',
          title: stage.stage === '12h'
            ? `${claimed.length === 1 ? `${claimed[0].name || 'A teammate'} hasn't` : `${claimed.length} teammates haven't`} answered in 12 hours`
            : `About 3 hours left for ${claimed.length === 1 ? claimed[0].name || 'a teammate' : `${claimed.length} teammates`}`,
          message: `For ${labelOf(reservation)}: ${claimed.map(describe).join(', ')}. Invites not accepted${isSplit(reservation) ? ' and paid' : ''} within ${INVITE_ANSWER_HOURS} hours are void${isPrivate(reservation) ? ', and you then pay for the spot or fill it' : ''}.`,
          linkedResourceId: reservation.id,
        })
        for (const invite of claimed) {
          await notifyUser(db, {
            userId: invite.playerId,
            type: 'team_invite_reminder',
            title: invite.status === 'pending' ? 'Answer your game invite' : 'Pay your share',
            message: `${invite.status === 'pending' ? 'Accept or decline' : 'Pay your share for'} the game on ${labelOf(reservation)} in My Reservations. About ${leftLabel(invite)} left before the invite is void.`,
            linkedResourceId: reservation.id,
          })
          reminded += 1
        }
      }

      // Spots the captain didn't fill or pay for in time go onto their bill at the field.
      const fresh = await db.collection('reservations').findOne({ _id: reservation._id })
      const freshPayments = await getReservationPayments(db, fresh)
      const finalized = getPaymentProgress(fresh, freshPayments).state === 'finalized'
      for (const slot of (fresh.openSlots || []).filter((s) => ['open', 'covering'].includes(s.status))) {
        // The captain paid for it: done.
        if (slot.status === 'covering' && finalized) {
          await db.collection('reservations').updateOne(
            { _id: fresh._id, openSlots: { $elemMatch: { id: slot.id, status: 'covering' } } },
            { $set: { 'openSlots.$.status': 'paid' } },
          )
          continue
        }
        if (Date.parse(slot.deadlineISO) > now) continue
        // A spot with nothing owed just closes; one with a share moves to the field.
        if (await moveSlotOnsite(db, fresh, slot)) movedOnsite += 1
      }
    } catch (err) {
      console.error('Team invite sweep failed', reservation.id, err?.message || err)
    }
  }
  return { voided, reminded, movedOnsite }
}
