import { manilaDateISO } from './reminders.js'
import { updateReservationStatusAtomically } from './reservationStatus.js'
import { notifyRole, notifyUser } from './paymentProgress.js'
import { expireInvoice } from './xendit.js'

// What happens to a player's bookings when their account is closed (or their personal data is
// erased on request). Bookings are records of real games and money, so they are never deleted:
// - past bookings stay as history, under the booker's saved name;
// - an upcoming booking they made passes to a teammate as the new captain, or is cancelled under
//   the normal rules when nobody can take over (a fully paid booking stands: no-cancellation policy);
// - on an upcoming booking where they are a teammate, they are taken off the team; their spot is
//   left open and any unpaid split share is covered by the rest of the team.

export const FORMER_PLAYER = 'Former player'
const CLOSED_STATUSES = ['cancelled', 'completed', 'archived']

const isUpcoming = (reservation, todayISO) => {
  const date = String(reservation.reservationDate || reservation.dateISO || '').slice(0, 10)
  const status = String(reservation.reservationStatus || '').toLowerCase()
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= todayISO && !CLOSED_STATUSES.includes(status)
}

const idOf = (value) => String(value ?? '').trim()

// Every booking the player is on: as the booker, a teammate, a split payer or an own-gun bringer.
export function accountBookingFilter(userId) {
  const id = idOf(userId)
  return {
    $or: [
      { userId: id },
      { 'teamMembers.id': id },
      { splitPayerIds: id },
      { selectedTeammateIds: id },
      { ownWeaponBringerIds: id },
    ],
  }
}

/**
 * Decides what to do with each booking (no database writes). `accounts` maps a teammate's id to
 * their account, so only an active, adult, registered teammate can become captain.
 */
export function planAccountClosure({ userId, reservations, accounts, todayISO = manilaDateISO() }) {
  const me = idOf(userId)
  const plan = { past: [], transfer: [], cancel: [], leaveTeam: [] }
  for (const reservation of reservations) {
    if (!isUpcoming(reservation, todayISO)) {
      plan.past.push({ reservation })
      continue
    }
    if (idOf(reservation.userId) !== me) {
      plan.leaveTeam.push({ reservation })
      continue
    }
    const newCaptain = (reservation.teamMembers || [])
      .filter((member) => member && !member.isMinor && idOf(member.id) && idOf(member.id) !== me)
      .map((member) => accounts.get(idOf(member.id)))
      .find((account) => account && String(account.role || 'user') === 'user' && !['suspended', 'closed'].includes(String(account.status || '').toLowerCase()))
    if (newCaptain) plan.transfer.push({ reservation, newCaptain })
    else plan.cancel.push({ reservation })
  }
  return plan
}

const reservationFilterOf = (reservation) => (reservation._id ? { _id: reservation._id } : { id: reservation.id })
const labelOf = (reservation) => `${reservation.reservationDate || ''} (${reservation.reservationTime || reservation.slot || ''})`

/** Loads the player's bookings and the teammates who could take over, and plans the closure. */
export async function previewAccountClosure(db, userId, { todayISO = manilaDateISO() } = {}) {
  const reservations = await db.collection('reservations').find(accountBookingFilter(userId)).toArray()
  const teammateIds = [...new Set(reservations.flatMap((r) => (r.teamMembers || []).map((m) => idOf(m?.id))).filter(Boolean))]
  const accounts = new Map(
    (teammateIds.length
      ? await db.collection('user_accounts').find({ id: { $in: teammateIds } }, { projection: { id: 1, name: 1, email: 1, role: 1, status: 1 } }).toArray()
      : []
    ).map((account) => [idOf(account.id), account]),
  )
  return { reservations, plan: planAccountClosure({ userId, reservations, accounts, todayISO }) }
}

// A short, safe summary of a plan for the admin's confirm pop-up.
export function summarizePlan(plan) {
  const row = ({ reservation, newCaptain }) => ({
    id: String(reservation.id || reservation._id),
    date: reservation.reservationDate || '',
    slot: reservation.reservationTime || '',
    location: reservation.locationName || reservation.locationId || '',
    ...(newCaptain ? { newCaptain: newCaptain.name || newCaptain.id } : {}),
  })
  return {
    past: plan.past.length,
    transfer: plan.transfer.map(row),
    cancel: plan.cancel.map(row),
    leaveTeam: plan.leaveTeam.map(row),
  }
}

/**
 * Closes the account: applies the plan to the upcoming bookings, keeps the booker's name on every
 * booking, and stops the account from logging in. With `erase`, also removes the player's personal
 * data (privacy request) while keeping the booking and payment records under "Former player".
 * Signed waivers are legal records and are kept.
 */
export async function closeAccount(db, account, { actor, reason = '', erase = false, startSession, todayISO = manilaDateISO() }) {
  const me = idOf(account.id)
  const name = String(account.name || '').trim() || 'A player'
  const nowISO = new Date().toISOString()
  const { reservations, plan } = await previewAccountClosure(db, me, { todayISO })
  const result = { past: plan.past.length, transferred: [], cancelled: [], keptPaid: [], leftTeam: [] }

  // Every booking they made keeps their name and email, so it still shows who booked.
  await db.collection('reservations').updateMany(
    { userId: me, $or: [{ bookerName: { $exists: false } }, { bookerName: '' }] },
    { $set: { bookerName: String(account.name || '').trim(), bookerEmail: String(account.email || '').trim() } },
  )

  for (const { reservation, newCaptain } of plan.transfer) {
    const captainId = idOf(newCaptain.id)
    await db.collection('reservations').updateOne(reservationFilterOf(reservation), {
      $set: {
        userId: captainId,
        bookerName: String(newCaptain.name || '').trim(),
        bookerEmail: String(newCaptain.email || '').trim(),
        teamMembers: (reservation.teamMembers || []).filter((member) => ![me, captainId].includes(idOf(member?.id))),
        selectedTeammateIds: (reservation.selectedTeammateIds || []).map(idOf).filter((id) => ![me, captainId].includes(id)),
        splitPayerIds: (reservation.splitPayerIds || []).map(idOf).filter((id) => ![me, captainId].includes(id)),
        ownWeaponBringerIds: (reservation.ownWeaponBringerIds || []).map(idOf).filter((id) => id !== me),
        ownWeaponBringers: (reservation.ownWeaponBringers || []).filter((bringer) => idOf(bringer?.userId) !== me),
        updatedAtISO: nowISO,
      },
      $push: { captainHistory: { from: me, fromName: name, to: captainId, reason: 'account_closed', atISO: nowISO } },
    })
    await notifyUser(db, {
      userId: captainId,
      type: 'reservation_status_update',
      title: "You're now the captain",
      message: `${name} closed their account, so you're now the captain of the booking for ${labelOf(reservation)}.`,
      linkedResourceId: reservation.id,
    })
    result.transferred.push(String(reservation.id))
  }

  for (const { reservation } of plan.cancel) {
    const reservationId = String(reservation.id || reservation._id)
    try {
      // Close any payment page still open for it, so nobody pays a cancelled booking.
      const checkouts = await db.collection('xendit_checkouts').find({
        $or: [{ reservationId }, { reservationIds: reservationId }],
        status: 'open',
      }).toArray()
      for (const checkout of checkouts) {
        await expireInvoice(checkout.invoiceId).catch(() => null)
        await db.collection('xendit_checkouts').updateOne({ _id: checkout._id }, { $set: { status: 'cancelled' } })
      }
      await updateReservationStatusAtomically({
        db,
        startSession,
        reservationFilter: reservationFilterOf(reservation),
        reservationId,
        nextStatus: 'cancelled',
        actor,
        reason: 'account_closed',
      })
      result.cancelled.push(reservationId)
      // Money already verified on it is kept on record; staff decide the refund under the usual rules.
      const verified = await db.collection('payments').countDocuments({
        reservationId: { $in: [reservation.id, String(reservation._id)].filter(Boolean).map(String) },
        paymentStatus: { $in: ['paid', 'confirmed', 'verified', 'approved'] },
      })
      if (verified) {
        await notifyRole(db, {
          role: 'admin',
          type: 'refund_review',
          title: 'Refund to review',
          message: `The booking for ${labelOf(reservation)} was cancelled because ${name} closed their account. It has verified payments: check if a refund is due.`,
          linkedResourceId: reservation.id,
        })
      }
      for (const payerId of (reservation.splitPayerIds || []).map(idOf).filter((id) => id && id !== me)) {
        await notifyUser(db, {
          userId: payerId,
          type: 'reservation_status_update',
          title: 'Reservation cancelled',
          message: `The booking for ${labelOf(reservation)} was cancelled because its captain closed their account. You don't need to pay your share.`,
          linkedResourceId: reservation.id,
        })
      }
    } catch (err) {
      // Fully paid: the booking stands (no-cancellation policy), under the booker's saved name.
      if (err?.statusCode === 409) result.keptPaid.push(reservationId)
      else throw err
    }
  }

  for (const { reservation } of plan.leaveTeam) {
    await db.collection('reservations').updateOne(reservationFilterOf(reservation), {
      $pull: {
        teamMembers: { id: me },
        selectedTeammateIds: me,
        splitPayerIds: me,
        ownWeaponBringerIds: me,
        ownWeaponBringers: { userId: me },
      },
      $set: { updatedAtISO: nowISO },
    })
    await notifyUser(db, {
      userId: idOf(reservation.userId),
      type: 'reservation_status_update',
      title: 'A teammate left',
      message: `${name} closed their account and was taken off your team for ${labelOf(reservation)}. Their spot is open; any share they hadn't paid is covered by the rest of the team.`,
      linkedResourceId: reservation.id,
    })
    result.leftTeam.push(String(reservation.id))
  }

  // The account stops working: no logins, and open sessions end.
  const closing = {
    status: 'closed',
    closedAtISO: nowISO,
    closedReason: String(reason || '').slice(0, 300),
    closedBy: idOf(actor?.id),
    updatedAtISO: nowISO,
  }
  if (!erase) {
    await db.collection('user_accounts').updateOne({ _id: account._id }, { $set: closing })
    return { ...result, erased: false, bookings: reservations.length }
  }

  // Erase: personal data goes; records stay under "Former player".
  const files = [
    account.profileImageUrl, account.identityDocumentUrl, account.identityDocumentBackUrl,
    account.identityPreviousDocumentUrl, account.identityPreviousDocumentBackUrl,
  ]
    .map((url) => String(url || '').match(/\/api\/files\/([\w-]+)/)?.[1])
    .filter(Boolean)
  if (files.length) await db.collection('uploaded_files').deleteMany({ _id: { $in: files }, uploadedBy: me })
  await deleteCloudinaryFiles([
    account.profileImageUrl, account.identityDocumentUrl, account.identityDocumentBackUrl,
    account.identityPreviousDocumentUrl, account.identityPreviousDocumentBackUrl,
  ])
  const erasedEmail = `erased-${me.toLowerCase()}@erased.invalid`
  await db.collection('user_accounts').updateOne({ _id: account._id }, {
    $set: {
      ...closing,
      name: FORMER_PLAYER,
      firstName: '',
      middleInitial: '',
      lastName: '',
      nickname: '',
      email: erasedEmail,
      emailCanonical: erasedEmail,
      birthDate: '',
      age: null,
      experience: '',
      profileImageUrl: '',
      identityDocumentUrl: '',
      identityDocumentBackUrl: '',
      identityPreviousDocumentUrl: '',
      identityPreviousDocumentBackUrl: '',
      identityScanText: '',
      identityScanSummary: '',
      erasedAtISO: nowISO,
    },
    $unset: { password: '', googleLinkedAtISO: '', otpSentAtISO: '', resetCodeSentAtISO: '', phone: '', contactNumber: '', address: '' },
  })
  await db.collection('reservations').updateMany({ userId: me }, { $set: { bookerName: FORMER_PLAYER, bookerEmail: '' } })
  await db.collection('reservations').updateMany(
    { 'teamMembers.id': me },
    { $set: { 'teamMembers.$[member].name': FORMER_PLAYER, 'teamMembers.$[member].email': '' } },
    { arrayFilters: [{ 'member.id': me }] },
  )
  await db.collection('reservations').updateMany(
    { 'captainHistory.from': me },
    { $set: { 'captainHistory.$[entry].fromName': FORMER_PLAYER } },
    { arrayFilters: [{ 'entry.from': me }] },
  )
  await db.collection('notifications').deleteMany({ userId: me })
  if (account.email) await db.collection('auth_attempts').deleteMany({ account: String(account.email).toLowerCase() }).catch(() => null)
  return { ...result, erased: true, bookings: reservations.length }
}

// A Cloudinary link's file: "https://res.cloudinary.com/<cloud>/image/upload/v123/cs-1-id.jpg"
// → { resourceType: 'image', publicId: 'cs-1-id' }. Anything else → null.
export function cloudinaryFileOf(url) {
  const match = String(url || '').match(/^https:\/\/res\.cloudinary\.com\/[^/]+\/(image|video|raw)\/upload\/(?:v\d+\/)?(.+)$/)
  if (!match) return null
  const [, resourceType, path] = match
  // Raw files keep their extension in the public id; images and videos don't.
  return { resourceType, publicId: resourceType === 'raw' ? path : path.replace(/\.[^./]+$/, '') }
}

// Best effort: the erase still goes ahead if Cloudinary is unreachable (the links are gone either way).
async function deleteCloudinaryFiles(urls) {
  const targets = urls.map(cloudinaryFileOf).filter(Boolean)
  if (!targets.length) return
  try {
    const { isCloudinaryConfigured, requireCloudinary } = await import('../routes/cloudinary.js')
    if (!isCloudinaryConfigured()) return
    const cloudinary = requireCloudinary()
    for (const { resourceType, publicId } of targets) {
      await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, invalidate: true })
        .catch((err) => console.warn('Could not delete an erased player\'s file from Cloudinary:', String(err?.message || err)))
    }
  } catch (err) {
    console.warn('Cloudinary cleanup skipped:', String(err?.message || err))
  }
}

// Used by the delete route: an account on any booking can only be closed or erased, not deleted.
export async function countAccountBookings(db, userId) {
  return db.collection('reservations').countDocuments(accountBookingFilter(userId))
}

