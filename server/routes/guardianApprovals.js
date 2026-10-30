import express from 'express'
import { randomBytes, randomUUID } from 'crypto'
import { getDb } from '../db/mongo.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { notifyRole, notifyUser } from '../utils/paymentProgress.js'
import { emailGuardianApprovalRequest, emailGuardianDecision } from '../services/notificationEmails.js'

// Players under 18 need their guardian to approve every booking they are part of. Each booking
// creates one approval per minor; the guardian answers through an emailed link (no account),
// and staff can't confirm the booking until every guardian has approved.
const router = express.Router()
const APPROVALS = 'guardian_approvals'
const STAFF = ['admin', 'registrar', 'marshal']

let indexReady = null
function approvals(db) {
  const collection = db.collection(APPROVALS)
  indexReady ??= Promise.all([
    collection.createIndex({ token: 1 }, { unique: true }),
    collection.createIndex({ reservationId: 1 }),
  ]).catch(() => null)
  return collection
}

function playerIdsOf(reservation) {
  return [...new Set([reservation.userId, ...(reservation.teamMembers || []).map((member) => member.id)]
    .map((id) => String(id || ''))
    .filter((id) => id && id !== 'walk-in'))]
}

// Where guardian links point: the deployed site, or the origin the booking came from.
export function appUrlFrom(req) {
  const configured = String(process.env.PUBLIC_APP_URL || '').trim().replace(/\/+$/, '')
  if (configured) return configured
  const origin = String(req?.get?.('origin') || '').trim().replace(/\/+$/, '')
  return /^https?:\/\//.test(origin) ? origin : 'http://localhost:5173'
}

// Rolls the approvals up onto the reservation so booking lists can show them without a lookup.
async function syncReservationSummary(db, reservationId) {
  const items = await approvals(db).find({ reservationId }).toArray()
  const count = (status) => items.filter((item) => item.status === status).length
  const summary = {
    required: items.length,
    approved: count('approved'),
    declined: count('declined'),
    pending: items.length - count('approved') - count('declined'),
    status: !items.length ? 'none' : count('declined') ? 'declined' : count('approved') === items.length ? 'approved' : 'pending',
  }
  await db.collection('reservations').updateOne({ id: reservationId }, { $set: { guardianApproval: summary } })
  return summary
}

// Called after a booking is created: one approval request per minor on the booking.
export async function requestGuardianApprovals(db, reservation, appUrl) {
  try {
    const reservationId = String(reservation.id || '')
    const ids = playerIdsOf(reservation)
    if (!reservationId || !ids.length) return
    await indexReady

    const waivers = await db.collection('waivers').find(
      { userId: { $in: ids }, status: { $regex: '^approved$', $options: 'i' } },
    ).toArray()
    const latestWaiver = (userId) => waivers
      .filter((waiver) => String(waiver.userId) === userId)
      .sort((a, b) => String(b.approvedAtISO || b.submittedAtISO || '').localeCompare(String(a.approvedAtISO || a.submittedAtISO || '')))[0]

    const nowISO = new Date().toISOString()
    for (const userId of ids) {
      const waiver = latestWaiver(userId)
      if (!waiver || !(waiver.isMinor || Number(waiver.age) < 18)) continue
      if (await approvals(db).findOne({ reservationId, userId })) continue

      const approval = {
        id: `GA-${randomUUID()}`,
        token: randomBytes(24).toString('hex'),
        reservationId,
        userId,
        waiverId: String(waiver.id || waiver._id),
        minorName: waiver.fullName || '',
        minorAge: waiver.age ?? null,
        guardianName: waiver.guardianName || '',
        guardianEmail: String(waiver.guardianEmail || '').toLowerCase(),
        status: 'pending',
        createdAtISO: nowISO,
      }
      await approvals(db).insertOne(approval)

      if (approval.guardianEmail) {
        void emailGuardianApprovalRequest(db, { approval, reservation, link: `${appUrl}/guardian-approval/${approval.token}` })
      } else {
        // Waivers from before guardian emails were collected: staff confirm with the guardian in person.
        await notifyRole(db, {
          role: 'registrar',
          type: 'reservation_status_update',
          title: 'Guardian approval needed in person',
          message: `${approval.minorName || 'A minor'} on reservation ${reservationId} has no guardian email on file. Confirm with their guardian at the counter.`,
          linkedResourceId: reservationId,
        })
      }
      await notifyUser(db, {
        userId,
        type: 'reservation_status_update',
        title: 'Waiting for your guardian',
        message: approval.guardianEmail
          ? `We emailed ${approval.guardianEmail} to approve your booking for ${reservation.reservationDate}.`
          : `Your guardian needs to approve your booking for ${reservation.reservationDate} at the counter.`,
        linkedResourceId: reservationId,
      })
    }
    await syncReservationSummary(db, reservationId)
  } catch (err) {
    console.error('Guardian approval request failed', err?.message || err)
  }
}

// Throws when a booking still has guardian approvals outstanding; used before confirming it.
export async function assertGuardianApprovalsComplete(db, reservationId) {
  const open = await db.collection(APPROVALS).find({ reservationId: String(reservationId), status: { $ne: 'approved' } }).toArray()
  if (!open.length) return
  const names = open.map((item) => `${item.minorName || 'a minor'} (${item.status})`).join(', ')
  const blocked = new Error(`Guardian approval is still needed for ${names}.`)
  blocked.statusCode = 409
  throw blocked
}

async function findByToken(db, token) {
  if (!/^[a-f0-9]{48}$/.test(String(token || ''))) return null
  return approvals(db).findOne({ token: String(token) })
}

// GET /api/guardian-approvals/:token — public page data for the guardian: what the minor
// entered, the booking, and the signed waiver.
router.get('/guardian-approvals/:token', async (req, res) => {
  try {
    const db = await getDb()
    const approval = await findByToken(db, req.params.token)
    if (!approval) return res.status(404).json({ ok: false, error: 'This approval link is invalid or has expired.' })
    const [reservation, waiver, account] = await Promise.all([
      db.collection('reservations').findOne({ id: approval.reservationId }),
      db.collection('waivers').findOne({ id: approval.waiverId }),
      db.collection('user_accounts').findOne({ id: approval.userId }, { projection: { email: 1, name: 1 } }),
    ])
    return res.json({
      ok: true,
      data: {
        status: approval.status,
        decidedAtISO: approval.decidedAtISO || null,
        minor: {
          fullName: waiver?.fullName || approval.minorName,
          birthDate: waiver?.birthDate || '',
          age: waiver?.age ?? approval.minorAge,
          email: waiver?.email || account?.email || '',
        },
        guardian: {
          name: waiver?.guardianName || approval.guardianName,
          phone: waiver?.guardianPhone || '',
          email: waiver?.guardianEmail || approval.guardianEmail,
        },
        reservation: reservation ? {
          id: reservation.id,
          reservationDate: reservation.reservationDate,
          reservationTime: reservation.reservationTime,
          locationName: reservation.locationName || reservation.locationId,
          packageName: reservation.packageName || '',
          numberOfPlayers: reservation.numberOfPlayers,
          totalAmount: reservation.totalAmount,
          reservationStatus: reservation.reservationStatus,
        } : null,
        waiver: waiver ? {
          id: waiver.id,
          submittedAtISO: waiver.submittedAtISO,
          signatureImage: waiver.signatureImage || '',
          guardianSignatureImage: waiver.guardianSignatureImage || '',
          termsAccepted: Boolean(waiver.termsAccepted),
          guardianConsent: Boolean(waiver.guardianConsent),
          waiverText: waiver.waiverText || null,
        } : null,
      },
    })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

async function recordDecision(db, approval, { status, note, decidedBy }) {
  const nowISO = new Date().toISOString()
  await approvals(db).updateOne({ _id: approval._id }, { $set: { status, note, decidedAtISO: nowISO, decidedBy } })
  const updated = { ...approval, status, note }
  const summary = await syncReservationSummary(db, approval.reservationId)
  const reservation = await db.collection('reservations').findOne({ id: approval.reservationId })

  await notifyUser(db, {
    userId: approval.userId,
    type: 'reservation_status_update',
    title: status === 'approved' ? 'Guardian approved your booking' : 'Guardian declined your booking',
    message: `${status === 'approved' ? 'Approved' : 'Declined'} for ${reservation?.reservationDate || 'your booking'}.${note ? ` Note: ${note}` : ''}`,
    linkedResourceId: approval.reservationId,
  })
  for (const role of ['admin', 'registrar']) {
    await notifyRole(db, {
      role,
      type: 'reservation_status_update',
      title: status === 'approved' ? 'Guardian approved a booking' : 'Guardian declined a booking',
      message: `${approval.minorName || 'A minor'} on reservation ${approval.reservationId}: ${status}. ${summary.approved}/${summary.required} guardian approvals in.`,
      linkedResourceId: approval.reservationId,
    })
  }
  if (reservation) void emailGuardianDecision(db, updated, reservation)
  return summary
}

// POST /api/guardian-approvals/:token { decision: 'approved' | 'declined', note } — the guardian's answer.
router.post('/guardian-approvals/:token', async (req, res) => {
  const decision = String(req.body?.decision || '')
  if (!['approved', 'declined'].includes(decision)) return res.status(400).json({ ok: false, error: 'Choose approve or decline.' })
  const note = String(req.body?.note || '').trim().slice(0, 500)
  try {
    const db = await getDb()
    const approval = await findByToken(db, req.params.token)
    if (!approval) return res.status(404).json({ ok: false, error: 'This approval link is invalid or has expired.' })
    if (approval.status !== 'pending') return res.status(409).json({ ok: false, error: `You already ${approval.status} this booking.` })
    const reservation = await db.collection('reservations').findOne({ id: approval.reservationId }, { projection: { reservationStatus: 1 } })
    if (String(reservation?.reservationStatus || '').toLowerCase() === 'cancelled') {
      return res.status(409).json({ ok: false, error: 'This booking was cancelled, so there is nothing to approve.' })
    }
    await recordDecision(db, approval, { status: decision, note, decidedBy: 'guardian' })
    return res.json({ ok: true, data: { status: decision } })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// GET /api/reservations/:id/guardian-approvals — staff view of a booking's guardian approvals.
router.get('/reservations/:id/guardian-approvals', requireAuth, requireRole(...STAFF), async (req, res) => {
  try {
    const db = await getDb()
    const items = await approvals(db).find(
      { reservationId: String(req.params.id) },
      { projection: { token: 0 } },
    ).toArray()
    return res.json({ ok: true, data: items })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// PUT /api/guardian-approvals/:id/in-person { note } — the guardian approved at the counter.
router.put('/guardian-approvals/:id/in-person', requireAuth, requireRole('admin', 'registrar'), async (req, res) => {
  const note = String(req.body?.note || '').trim().slice(0, 500)
  if (!note) return res.status(400).json({ ok: false, error: 'Note how the guardian approved (e.g. who they are and the ID shown).' })
  try {
    const db = await getDb()
    const approval = await approvals(db).findOne({ id: String(req.params.id) })
    if (!approval) return res.status(404).json({ ok: false, error: 'Approval not found.' })
    if (approval.status === 'approved') return res.json({ ok: true, data: { status: 'approved' } })
    await recordDecision(db, approval, {
      status: 'approved',
      note: `In person: ${note}`,
      decidedBy: { id: String(req.user.id), email: req.user.email || '', role: req.user.role },
    })
    return res.json({ ok: true, data: { status: 'approved' } })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

export default router
