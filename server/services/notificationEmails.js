import { ObjectId } from 'mongodb'
import transporter from './mailService.js'

// Event emails for reservations and payments. Each send is called only after
// the database change it describes has succeeded, is recorded in `email_log`
// with its delivery result, and is de-duplicated by an event key so retries
// don't email the player twice. A failed send never fails the request.

const EMAIL_LOG = 'email_log'
let indexReady = null

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
}

function formatPHP(value) {
  return `PHP ${Number(value || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`
}

async function findAccount(db, userId) {
  const id = String(userId || '').trim()
  if (!id) return null
  const byId = await db.collection('user_accounts').findOne({ id }, { projection: { email: 1, name: 1 } })
  if (byId) return byId
  return ObjectId.isValid(id)
    ? db.collection('user_accounts').findOne({ _id: new ObjectId(id) }, { projection: { email: 1, name: 1 } })
    : null
}

function layout(title, name, lines) {
  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
      <h2 style="margin-bottom: 8px;">${escapeHtml(title)}</h2>
      <p>Hello ${escapeHtml(name || 'there')},</p>
      ${lines.map((line) => `<p>${line}</p>`).join('')}
      <p style="color: #6b7280; font-size: 12px;">Chill Shooters Airsoft Gaming Center</p>
    </div>
  `
}

async function sendLogged(db, { key, userId, subject, title, lines }) {
  try {
    const log = db.collection(EMAIL_LOG)
    indexReady ??= log.createIndex({ key: 1 }, { unique: true }).catch(() => null)
    await indexReady

    const account = await findAccount(db, userId)
    if (!account?.email) return { skipped: 'no recipient' }

    try {
      await log.insertOne({ key, to: account.email, subject, status: 'sending', createdAtISO: new Date().toISOString() })
    } catch (err) {
      if (err?.code === 11000) return { skipped: 'duplicate' }
      throw err
    }

    try {
      const from = process.env.EMAIL_USER ? `Chill Shooters <${process.env.EMAIL_USER}>` : 'Chill Shooters <no-reply@chillshooters.local>'
      const info = await transporter.sendMail({ from, to: account.email, subject, html: layout(title, account.name, lines) })
      await log.updateOne({ key }, { $set: { status: 'sent', messageId: info?.messageId || '', sentAtISO: new Date().toISOString() } })
      return { sent: true }
    } catch (err) {
      console.error('Notification email failed', key, err?.message || err)
      await log.updateOne({ key }, { $set: { status: 'failed', error: String(err?.message || err), failedAtISO: new Date().toISOString() } })
      return { failed: true }
    }
  } catch (err) {
    console.error('Notification email logging failed', key, err?.message || err)
    return { failed: true }
  }
}

function reservationLabel(reservation) {
  const date = reservation.reservationDate || reservation.dateISO || ''
  const slot = reservation.reservationTime || reservation.slot || ''
  const location = reservation.locationName || reservation.locationId || ''
  return `${escapeHtml(date)} (${escapeHtml(slot)})${location ? ` at ${escapeHtml(location)}` : ''}`
}

const RESERVATION_MESSAGES = {
  received: {
    subject: 'We received your Chill Shooters reservation',
    title: 'Reservation received',
    line: (r) => `Your reservation for ${reservationLabel(r)} for ${Number(r.numberOfPlayers || 0)} players was received and is waiting for staff review. Total: ${formatPHP(r.totalAmount)}, deposit: ${formatPHP(r.depositAmount)}.`,
  },
  confirmed: {
    subject: 'Your Chill Shooters reservation is confirmed',
    title: 'Reservation confirmed',
    line: (r) => `Your reservation for ${reservationLabel(r)} is confirmed. Please arrive 30 minutes early for the safety briefing and chronograph check.`,
  },
  'needs review': {
    subject: 'Your Chill Shooters reservation needs attention',
    title: 'Reservation needs review',
    line: (r) => `Staff need more information about your reservation for ${reservationLabel(r)}. Please check your account or contact us.`,
  },
  cancelled: {
    subject: 'Your Chill Shooters reservation was cancelled',
    title: 'Reservation cancelled',
    line: (r) => `Your reservation for ${reservationLabel(r)} was cancelled.`,
  },
  rescheduled: {
    subject: 'Your Chill Shooters reservation was rescheduled',
    title: 'Reservation rescheduled',
    line: (r) => `Your reservation is now on ${reservationLabel(r)}. Any deposit you paid carries over to the new date.`,
  },
}

// event: received | confirmed | needs review | cancelled | rescheduled
export function emailReservationEvent(db, reservation, event, keySuffix = '') {
  const message = RESERVATION_MESSAGES[event]
  if (!message || !reservation) return Promise.resolve({ skipped: 'unknown event' })
  const id = String(reservation.id || reservation._id)
  return sendLogged(db, {
    key: `reservation:${id}:${event}${keySuffix ? `:${keySuffix}` : ''}`,
    userId: reservation.userId,
    subject: message.subject,
    title: message.title,
    lines: [message.line(reservation), `Reservation ID: ${escapeHtml(id)}`],
  })
}

export function emailPaymentEvent(db, payment, status, reason = '') {
  if (!payment) return Promise.resolve({ skipped: 'no payment' })
  const id = String(payment.id || payment._id)
  const normalized = String(status || '').toLowerCase()
  const approved = ['paid', 'confirmed', 'verified', 'approved'].includes(normalized)
  const rejected = ['rejected', 'failed'].includes(normalized)
  if (!approved && !rejected) return Promise.resolve({ skipped: 'status not notified' })
  return sendLogged(db, {
    key: `payment:${id}:${normalized}`,
    userId: payment.userId,
    subject: approved ? 'Your Chill Shooters payment was verified' : 'Your Chill Shooters payment was not accepted',
    title: approved ? 'Payment verified' : 'Payment not accepted',
    lines: [
      approved
        ? `We verified your payment of ${formatPHP(payment.amount)} for reservation ${escapeHtml(payment.reservationId)}.`
        : `We could not accept your payment of ${formatPHP(payment.amount)} for reservation ${escapeHtml(payment.reservationId)}.${reason ? ` Reason: ${escapeHtml(reason)}` : ''} Please submit a new payment or contact us.`,
      `Payment reference: ${escapeHtml(payment.transactionReference || id)}`,
    ],
  })
}

export function emailDamageCharge(db, reservation, report) {
  if (!reservation || !report) return Promise.resolve({ skipped: 'missing data' })
  return sendLogged(db, {
    key: `damage:${report.id}`,
    userId: reservation.userId,
    subject: 'A damage charge was added to your Chill Shooters reservation',
    title: 'Damage charge added',
    lines: [
      `A charge of ${formatPHP(report.chargeAmount)} for damage to ${escapeHtml(report.itemName)} was added to your reservation for ${reservationLabel(reservation)}.`,
      report.reviewNote ? `Note: ${escapeHtml(report.reviewNote)}` : '',
    ].filter(Boolean),
  })
}

// status: approved | rejected — tells the owner how staff reviewed their submitted gear
export function emailGearReviewEvent(db, item, kind, status) {
  if (!item?.submittedBy || !['approved', 'rejected'].includes(status)) return Promise.resolve({ skipped: 'not notified' })
  const id = String(item.id || item._id)
  const label = kind === 'weapon' ? 'weapon' : 'equipment'
  const approved = status === 'approved'
  return sendLogged(db, {
    key: `gear:${id}:${status}:${item.updatedAtISO || ''}`,
    userId: item.submittedBy,
    subject: approved ? `Your ${label} was approved` : `Your ${label} was not approved`,
    title: approved ? `${label[0].toUpperCase()}${label.slice(1)} approved` : `${label[0].toUpperCase()}${label.slice(1)} not approved`,
    lines: [
      approved
        ? `Staff reviewed and approved your ${label} "${escapeHtml(item.name || id)}". You can now bring it to your games.`
        : `Staff reviewed your ${label} "${escapeHtml(item.name || id)}" and did not approve it.${item.rejectionReason ? ` Reason: ${escapeHtml(item.rejectionReason)}` : ''}`,
    ],
  })
}

export function emailSplitShareRequest(db, reservation, userId, share, captainName, dueLabel) {
  if (!reservation || !userId) return Promise.resolve({ skipped: 'missing data' })
  const id = String(reservation.id || reservation._id)
  return sendLogged(db, {
    key: `split-share:${id}:${userId}`,
    userId,
    subject: 'Your share of a Chill Shooters reservation is due',
    title: 'Split payment requested',
    lines: [
      `${escapeHtml(captainName)} added you to the reservation for ${reservationLabel(reservation)} and split the payment with the team.`,
      `Your share is <b>${formatPHP(share)}</b>. Log in and open <b>Split Payment</b> in the menu to pay with GCash and upload your proof.`,
      `Please pay before ${escapeHtml(dueLabel)}. If the team doesn't finish paying by then, the slot is released.`,
      `Reservation ID: ${escapeHtml(id)}`,
    ],
  })
}
