// In-app notices for players about everything that concerns them: their bookings (and the ones a
// captain added them to), their payments, their waiver, damage charges, and their game starting
// and ending. Emails go out separately (services/notificationEmails.js); every email a player gets
// has an in-app notice here too.
import { notifyUser } from './paymentProgress.js'

const GONE_INVITE_STATUSES = ['declined', 'expired', 'unavailable', 'removed']

function latestInviteOf(reservation, playerId) {
  const mine = (reservation?.invites || []).filter((invite) => String(invite?.playerId) === String(playerId))
  return mine[mine.length - 1] || null
}

function labelOf(reservation) {
  return `${reservation?.reservationDate || ''} (${reservation?.reservationTime || ''})`
}

const peso = (amount) => `₱${Number(amount || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`

// Everyone with an account on a booking: the captain, and each teammate still on it (not one who
// declined, didn't answer in time, or was turned down). Minors play under their guardian, who is
// on the team and gets the notice. Walk-ins have no account.
export function playersOnBooking(reservation) {
  if (!reservation || reservation.walkIn) return []
  const captainId = String(reservation.userId || '')
  const teammates = (reservation.teamMembers || [])
    .filter((member) => member?.id && !member.isMinor)
    .map((member) => String(member.id))
    .filter((id) => !GONE_INVITE_STATUSES.includes(String(latestInviteOf(reservation, id)?.status || '')))
  return [...new Set([captainId, ...teammates])].filter((id) => id && id !== 'walk-in')
}

// One notice to everyone on a booking. `captain` and `teammates` are { title, message } for the
// one who booked and for the others; `except` skips whoever did it (they already know).
export async function notifyBookingPlayers(db, reservation, { type, captain, teammates, except = '' }) {
  const captainId = String(reservation?.userId || '')
  for (const userId of playersOnBooking(reservation)) {
    if (except && userId === String(except)) continue
    const notice = userId === captainId ? captain : (teammates || captain)
    if (!notice) continue
    await notifyUser(db, { userId, type, ...notice, linkedResourceId: String(reservation.id || '') })
  }
}

// The booking was confirmed: by staff, or automatically once the payment was verified.
export async function notifyBookingConfirmed(db, reservation, { by = '', balance = 0 } = {}) {
  const captainName = reservation?.bookerName || 'Your captain'
  await notifyBookingPlayers(db, reservation, {
    type: 'reservation_confirmed',
    captain: {
      title: 'Reservation confirmed',
      message: `Your reservation for ${labelOf(reservation)} is confirmed${by ? ` (approved by ${by})` : ''}.${balance > 0 ? ` Please pay the remaining ${peso(balance)} at the counter on game day by cash, GCash, or bank transfer.` : ''}`,
    },
    teammates: {
      title: 'Your game is confirmed',
      message: `${captainName}'s game on ${labelOf(reservation)} at ${reservation?.locationName || 'the field'} is confirmed. See you there!`,
    },
  })
}

// The booking was cancelled: by the captain, by staff, or because it wasn't paid in time.
export async function notifyBookingCancelled(db, reservation, { reason = 'staff', except = '' } = {}) {
  const captainName = reservation?.bookerName || 'The captain'
  const why = {
    captain: `${captainName} cancelled the reservation for ${labelOf(reservation)}. You don't need to pay anything for it.`,
    staff: `Staff cancelled the reservation for ${labelOf(reservation)}. Contact us if you have questions.`,
    expired: `The reservation for ${labelOf(reservation)} expired because payment was not completed in time. The slot is open for anyone to book again.`,
  }[reason] || `The reservation for ${labelOf(reservation)} was cancelled.`
  await notifyBookingPlayers(db, reservation, {
    type: 'reservation_status_update',
    captain: { title: reason === 'expired' ? 'Reservation released: payment window expired' : 'Reservation cancelled', message: why },
    teammates: { title: reason === 'expired' ? 'Game released: payment window expired' : 'Game cancelled', message: why },
    except,
  })
}

// The booking moved to another date or time slot.
export async function notifyBookingRescheduled(db, reservation, { fromLabel = '', except = '' } = {}) {
  const captainName = reservation?.bookerName || 'Your captain'
  await notifyBookingPlayers(db, reservation, {
    type: 'reservation_status_update',
    captain: {
      title: 'Reservation moved',
      message: `Your reservation${fromLabel ? ` for ${fromLabel}` : ''} is now on ${labelOf(reservation)}.`,
    },
    teammates: {
      title: 'Your game was moved',
      message: `${captainName}'s game${fromLabel ? ` on ${fromLabel}` : ''} is now on ${labelOf(reservation)}.`,
    },
    except,
  })
}

// Staff sent the booking back to the captain to pick a new date: teammates hear it's on hold.
export async function notifyTeammatesSentBack(db, reservation) {
  await notifyBookingPlayers(db, reservation, {
    type: 'reservation_status_update',
    captain: null,
    teammates: {
      title: 'Your game is being rescheduled',
      message: `Staff asked ${reservation?.bookerName || 'your captain'} to choose a new date for the game on ${labelOf(reservation)}. You'll be told the new date.`,
    },
  })
}

// Staff started the game, or marked it done.
export async function notifyGameStatus(db, reservation, status) {
  const started = String(status || '').toLowerCase().startsWith('ongo')
  const done = String(status || '').toLowerCase().startsWith('complet')
  if (!started && !done) return
  const notice = started
    ? { title: 'Your game has started', message: `Your game on ${labelOf(reservation)} at ${reservation?.locationName || 'the field'} is under way. Have fun and play safe!` }
    : { title: 'Game complete: thanks for playing', message: `Your game on ${labelOf(reservation)} is done. Rate it in Game Evaluation; it helps us improve.` }
  await notifyBookingPlayers(db, reservation, { type: started ? 'reservation_game_started' : 'reservation_game_completed', captain: notice, teammates: notice })
}

// A payment came in through the payment gateway (or a card): the payer is told it's received.
export async function notifyPaymentReceived(db, payment, reservation) {
  if (!payment?.userId || String(payment.userId) === 'walk-in') return
  await notifyUser(db, {
    userId: String(payment.userId),
    type: 'reservation_payment_received',
    title: `Payment received: ${peso(payment.amount)}`,
    message: `We received your payment of ${peso(payment.amount)} for ${reservation ? labelOf(reservation) : `reservation ${payment.reservationId}`}. Your receipt is in My Reservations.`,
    linkedResourceId: String(payment.reservationId || ''),
  })
}

// Staff verified or rejected a payment the player submitted.
export async function notifyPaymentDecision(db, payment, status, reason = '') {
  if (!payment?.userId || String(payment.userId) === 'walk-in') return
  const normalized = String(status || '').toLowerCase()
  const approved = ['paid', 'confirmed', 'verified', 'approved'].includes(normalized)
  const rejected = ['rejected', 'failed'].includes(normalized)
  if (!approved && !rejected) return
  await notifyUser(db, {
    userId: String(payment.userId),
    type: approved ? 'reservation_payment_verified' : 'reservation_payment_rejected',
    title: approved ? 'Payment verified' : 'Payment not accepted',
    message: approved
      ? `Staff verified your payment of ${peso(payment.amount)} for reservation ${payment.reservationId}.`
      : `Staff could not accept your payment of ${peso(payment.amount)} for reservation ${payment.reservationId}.${reason ? ` Reason: ${reason}` : ''} Please submit a new payment or contact us.`,
    linkedResourceId: String(payment.reservationId || ''),
  })
}

// A damage charge was added to the booking: the captain pays it.
export async function notifyDamageCharge(db, reservation, report) {
  if (!reservation?.userId || reservation.walkIn || !report) return
  await notifyUser(db, {
    userId: String(reservation.userId),
    type: 'reservation_damage_charge',
    title: `Damage charge: ${peso(report.chargeAmount)}`,
    message: `A charge of ${peso(report.chargeAmount)} for damage to ${report.itemName || 'rental gear'} was added to your reservation for ${labelOf(reservation)}.${report.reviewNote ? ` Note: ${report.reviewNote}` : ''} Pay it at the counter.`,
    linkedResourceId: String(reservation.id || ''),
  })
}

// Staff approved or denied a waiver. A child's waiver goes to the parent who answered it.
export async function notifyWaiverDecision(db, waiver, status) {
  const forChild = waiver?.forChild === true && waiver.guardianId
  const userId = String(forChild ? waiver.guardianId : waiver?.userId || '')
  const normalized = String(status || '').toLowerCase()
  if (!userId || !['approved', 'denied'].includes(normalized)) return
  const approved = normalized === 'approved'
  const whose = forChild ? `${waiver.fullName || 'Your child'}'s waiver` : 'Your waiver'
  await notifyUser(db, {
    userId,
    type: approved ? 'waiver_approved' : 'waiver_denied',
    title: approved ? `${whose} is approved` : `${whose} was denied`,
    message: approved
      ? `${whose} was approved. ${forChild ? 'They are' : 'You are'} cleared to play.`
      : `${whose} was denied. Open Online Waiver, review it, and submit a new one.`,
    linkedResourceId: String(waiver.id || ''),
  })
}
