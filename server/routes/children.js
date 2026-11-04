import express from 'express'
import { hasValidIdentity } from '../utils/identityValidity.js'
import { randomBytes } from 'crypto'
import { getDb } from '../db/mongo.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { nextShortId } from '../utils/shortIds.js'
import { ageFromBirthDate } from '../utils/age.js'
import { emailGuardianConfirmation } from '../services/notificationEmails.js'
import { appUrlFrom } from './guardianApprovals.js'

// Minors can't have their own accounts. A parent adds each child as a profile under their account:
// a player record with no login, linked by guardianId. The parent confirms by email that they are
// the child's guardian, then submits the child's waiver (the minor waiver). The child then plays
// under their own profile, so their games, stats and progress are their own.
const router = express.Router()
const ACCOUNTS = 'user_accounts'

function sendError(res, err) {
  if (err?.statusCode) return res.status(err.statusCode).json({ ok: false, error: err.message })
  console.error('Children route error', err)
  return res.status(500).json({ ok: false, error: String(err?.message || err) })
}

function fail(statusCode, message) {
  return Object.assign(new Error(message), { statusCode })
}

const cleanName = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 60)

// A minor the parent removed stays on record (staff still see the archived waiver), but is no
// longer on the parent's account, even if staff unarchive the waiver later.
const ON_ACCOUNT = { removedByGuardianAtISO: { $exists: false } }

async function latestWaivers(db, userIds) {
  const waivers = await db.collection('waivers').find(
    { userId: { $in: userIds }, archived: { $ne: true } },
    { projection: { id: 1, userId: 1, status: 1, submittedAtISO: 1, createdAtISO: 1, approvedAtISO: 1 } },
  ).toArray()
  const latest = new Map()
  for (const waiver of waivers) {
    const key = String(waiver.userId)
    const when = (w) => String(w.approvedAtISO || w.submittedAtISO || w.createdAtISO || '')
    if (!latest.has(key) || when(waiver) > when(latest.get(key))) latest.set(key, waiver)
  }
  return latest
}

function childView(child, waiver) {
  const status = String(waiver?.status || '').toLowerCase()
  return {
    id: String(child.id),
    name: child.name || '',
    firstName: child.firstName || '',
    lastName: child.lastName || '',
    birthDate: child.birthDate || '',
    age: ageFromBirthDate(child.birthDate),
    guardianId: String(child.guardianId),
    guardianConfirmed: Boolean(child.guardianConfirmedAtISO),
    waiverStatus: status || 'none',
    waiverApproved: status === 'approved',
  }
}

export async function hasApprovedWaiver(db, userId) {
  return Boolean(await db.collection('waivers').findOne({
    userId: String(userId),
    archived: { $ne: true },
    status: { $regex: '^approved$', $options: 'i' },
  }))
}

// A parent's own child, or null.
export async function findOwnChild(db, parentId, childId) {
  return db.collection(ACCOUNTS).findOne({ id: String(childId), guardianId: String(parentId), isChildProfile: true, ...ON_ACCOUNT })
}

async function sendConfirmation(db, req, parent, child) {
  const link = `${appUrlFrom(req)}/guardian-confirm/${child.guardianConfirmToken}`
  await emailGuardianConfirmation(db, {
    parentId: parent.id,
    childId: child.id,
    childName: child.name,
    link,
    sentOn: new Date().toISOString(),
  })
}

// GET /api/children — the signed-in parent's children, with guardian confirmation and waiver status.
router.get('/children', requireAuth, requireRole('user'), async (req, res) => {
  try {
    const db = await getDb()
    const children = await db.collection(ACCOUNTS).find({ guardianId: String(req.user.id), isChildProfile: true, ...ON_ACCOUNT }).sort({ createdAtISO: 1 }).toArray()
    const waivers = await latestWaivers(db, children.map((child) => String(child.id)))
    return res.json({ ok: true, data: children.map((child) => childView(child, waivers.get(String(child.id)))) })
  } catch (err) {
    return sendError(res, err)
  }
})

// POST /api/children { firstName, middleInitial, lastName, birthDate } — adds a child profile once
// the parent's ID is verified, and emails the parent to confirm they are the guardian. The child's
// waiver is then answered on the Waivers page (it needs the parent's own approved waiver).
router.post('/children', requireAuth, requireRole('user'), async (req, res) => {
  try {
    const db = await getDb()
    const parent = await db.collection(ACCOUNTS).findOne({ id: String(req.user.id) })
    if (!parent || parent.isChildProfile) throw fail(403, 'Only a parent account can add a minor.')
    if (!hasValidIdentity(parent)) throw fail(409, 'Verify your ID on your profile before you can add a minor.')

    const firstName = cleanName(req.body?.firstName)
    const lastName = cleanName(req.body?.lastName)
    const middleInitial = cleanName(req.body?.middleInitial).slice(0, 2)
    const birthDate = String(req.body?.birthDate || '').trim()
    if (!firstName || !lastName) throw fail(400, "Enter the child's first and last name.")
    const age = ageFromBirthDate(birthDate)
    if (age === null || age < 1) throw fail(400, "Enter the child's birthday.")
    if (age >= 18) throw fail(400, 'Players 18 and older make their own account.')

    const name = [firstName, middleInitial ? `${middleInitial.replace(/\.$/, '')}.` : '', lastName].filter(Boolean).join(' ')
    const duplicate = await db.collection(ACCOUNTS).findOne({ guardianId: String(parent.id), isChildProfile: true, ...ON_ACCOUNT, name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } })
    if (duplicate) throw fail(409, `${name} is already on your account.`)

    const nowISO = new Date().toISOString()
    const child = {
      id: await nextShortId(db, ACCOUNTS, 'P'),
      role: 'user',
      name,
      firstName,
      lastName,
      middleInitial,
      birthDate,
      age,
      isMinor: true,
      isChildProfile: true,
      guardianId: String(parent.id),
      guardianName: parent.name || '',
      guardianConfirmToken: randomBytes(24).toString('hex'),
      guardianConfirmedAtISO: null,
      status: 'Active',
      createdAtISO: nowISO,
    }
    await db.collection(ACCOUNTS).insertOne(child)
    await sendConfirmation(db, req, parent, child)
    return res.status(201).json({ ok: true, data: childView(child, null), emailedTo: parent.email || '' })
  } catch (err) {
    return sendError(res, err)
  }
})

// POST /api/children/:id/confirmation-email — sends the guardian confirmation email again.
router.post('/children/:id/confirmation-email', requireAuth, requireRole('user'), async (req, res) => {
  try {
    const db = await getDb()
    const child = await findOwnChild(db, req.user.id, req.params.id)
    if (!child) throw fail(404, 'Child not found.')
    if (child.guardianConfirmedAtISO) return res.json({ ok: true, data: { alreadyConfirmed: true } })
    const parent = await db.collection(ACCOUNTS).findOne({ id: String(req.user.id) })
    await sendConfirmation(db, req, parent, child)
    return res.json({ ok: true, data: { emailedTo: parent?.email || '' } })
  } catch (err) {
    return sendError(res, err)
  }
})

// DELETE /api/children/:id — the parent removes a minor and their waiver from their account.
// Nothing is deleted: the minor is marked removed and their waivers are archived, so staff keep
// the signed record. Unarchiving it later doesn't put the minor back on the parent's account.
router.delete('/children/:id', requireAuth, requireRole('user'), async (req, res) => {
  try {
    const db = await getDb()
    const child = await findOwnChild(db, req.user.id, req.params.id)
    if (!child) throw fail(404, 'Child not found.')
    const nowISO = new Date().toISOString()
    await db.collection(ACCOUNTS).updateOne({ _id: child._id }, { $set: { removedByGuardianAtISO: nowISO, updatedAtISO: nowISO } })
    const archived = await db.collection('waivers').updateMany(
      { userId: String(child.id), archived: { $ne: true } },
      {
        $set: {
          archived: true,
          archivedAtISO: nowISO,
          archivedReason: 'removed_by_guardian',
          removedByGuardian: true,
          archivedBy: { id: String(req.user.id), role: 'user', name: 'Guardian' },
        },
      },
    )
    await db.collection('audit_logs').insertOne({
      action: 'minor_removed_by_guardian',
      resourceType: 'user_accounts',
      resourceId: String(child.id),
      actorId: String(req.user.id),
      actorRole: 'user',
      details: { childName: child.name || '', waiversArchived: archived.modifiedCount },
      createdAtISO: nowISO,
    }).catch(() => null)
    return res.json({ ok: true, data: { id: String(child.id), waiversArchived: archived.modifiedCount } })
  } catch (err) {
    return sendError(res, err)
  }
})

// GET /api/children/of-team?ids=P-1,P-2 — children of the booker and the given teammates, for
// "A minor will join this game". Only names, ages and whether they can play are returned.
router.get('/children/of-team', requireAuth, requireRole('user'), async (req, res) => {
  try {
    const db = await getDb()
    const parentIds = [...new Set([String(req.user.id), ...String(req.query.ids || '').split(',').map((id) => id.trim()).filter(Boolean)])].slice(0, 100)
    const children = await db.collection(ACCOUNTS).find({ guardianId: { $in: parentIds }, isChildProfile: true, ...ON_ACCOUNT }).toArray()
    const waivers = await latestWaivers(db, children.map((child) => String(child.id)))
    const parents = await db.collection(ACCOUNTS).find({ id: { $in: parentIds } }, { projection: { id: 1, name: 1 } }).toArray()
    const parentName = new Map(parents.map((parent) => [String(parent.id), parent.name || '']))
    return res.json({
      ok: true,
      data: children.map((child) => {
        const view = childView(child, waivers.get(String(child.id)))
        return {
          id: view.id,
          name: view.name,
          age: view.age,
          guardianId: view.guardianId,
          guardianName: parentName.get(view.guardianId) || '',
          canPlay: view.guardianConfirmed && view.waiverApproved,
        }
      }),
    })
  } catch (err) {
    return sendError(res, err)
  }
})

// GET /api/guardian-confirmations/:token — public: who the confirmation is for.
router.get('/guardian-confirmations/:token', async (req, res) => {
  try {
    const db = await getDb()
    const child = await db.collection(ACCOUNTS).findOne({ guardianConfirmToken: String(req.params.token || ''), isChildProfile: true })
    if (!child) throw fail(404, 'This confirmation link is not valid.')
    return res.json({ ok: true, data: { childName: child.name, guardianName: child.guardianName || '', confirmed: Boolean(child.guardianConfirmedAtISO) } })
  } catch (err) {
    return sendError(res, err)
  }
})

// POST /api/guardian-confirmations/:token — public: the parent confirms they are the guardian.
router.post('/guardian-confirmations/:token', async (req, res) => {
  try {
    const db = await getDb()
    const filter = { guardianConfirmToken: String(req.params.token || ''), isChildProfile: true }
    const child = await db.collection(ACCOUNTS).findOne(filter)
    if (!child) throw fail(404, 'This confirmation link is not valid.')
    if (!child.guardianConfirmedAtISO) {
      await db.collection(ACCOUNTS).updateOne(filter, { $set: { guardianConfirmedAtISO: new Date().toISOString() } })
    }
    return res.json({ ok: true, data: { childName: child.name, confirmed: true } })
  } catch (err) {
    return sendError(res, err)
  }
})

export default router
