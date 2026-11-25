import express from 'express'
import { randomUUID } from 'crypto'
import { getDb } from '../db/mongo.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { validIdentityFilter } from '../utils/identityValidity.js'

// Saved team rosters: a player keeps named teams of the people they usually play with, so a new
// booking can be filled from one instead of looking each teammate up again.
//
// A team stores only its members' account ids (with the name they had when added, for display if
// an account later disappears). Whether each member can be booked right now (ID verified, waiver
// approved, account open) is worked out every time the teams are read, so a saved team never
// lets anyone onto a booking the booking form itself wouldn't accept.

const router = express.Router()
const COLLECTION = 'saved_teams'
export const MAX_TEAMS = 20
export const MAX_MEMBERS = 49
const NAME_MAX = 60

const isPlayer = { role: { $in: ['user', null] }, isChildProfile: { $ne: true } }

// "juan.delacruz@gmail.com" -> "ju***@gmail.com" (same as the teammate lookup).
function maskEmail(email) {
  const [local = '', domain = ''] = String(email || '').split('@')
  return domain ? `${local.slice(0, 2)}***@${domain}` : ''
}

export function cleanTeamName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX)
}

// The member ids sent by the app: unique, not the owner, at most MAX_MEMBERS.
export function cleanMemberIds(value, ownerId) {
  const ids = Array.isArray(value) ? value.map((id) => String(id || '').trim()).filter(Boolean) : []
  return [...new Set(ids)].filter((id) => id !== String(ownerId))
}

// Each member as the app shows it, with whether they can be put on a booking right now.
async function withMemberStatus(db, teams) {
  const ids = [...new Set(teams.flatMap((team) => team.members.map((member) => member.id)))]
  if (!ids.length) return teams.map((team) => ({ ...team, members: [] }))
  const [accounts, eligible, approved] = await Promise.all([
    db.collection('user_accounts').find({ id: { $in: ids } }, { projection: { id: 1, name: 1, email: 1, status: 1 } }).toArray(),
    db.collection('user_accounts').find({ id: { $in: ids }, ...isPlayer, ...validIdentityFilter(), emailVerified: { $ne: false }, status: { $nin: ['suspended', 'closed'] } }, { projection: { id: 1 } }).toArray(),
    db.collection('waivers').find(
      { status: { $regex: '^approved$', $options: 'i' }, archived: { $ne: true }, userId: { $in: ids } },
      { projection: { userId: 1 } },
    ).toArray(),
  ])
  const byId = new Map(accounts.map((account) => [String(account.id), account]))
  const canJoin = new Set(eligible.map((account) => String(account.id)))
  const waiverOk = new Set(approved.map((waiver) => String(waiver.userId)))
  return teams.map((team) => ({
    ...team,
    members: team.members.map((member) => {
      const account = byId.get(member.id)
      const closed = !account || ['closed'].includes(String(account.status || '').toLowerCase())
      const idVerified = canJoin.has(member.id)
      const waiverApproved = waiverOk.has(member.id)
      return {
        id: member.id,
        name: account?.name || member.name || 'Former player',
        email: maskEmail(account?.email),
        idVerified,
        waiverApproved,
        // Why they can't be booked right now, or '' when they can.
        blockedReason: closed ? 'Account closed'
          : !idVerified ? 'ID not verified'
          : !waiverApproved ? 'Waiver not approved'
          : '',
      }
    }),
  }))
}

const publicTeam = ({ _id, ownerId, ...team }) => team

// The members to save: real, open player accounts. Returns { members } or { error }.
async function resolveMembers(db, memberIds) {
  if (memberIds.length > MAX_MEMBERS) return { error: `A team can have up to ${MAX_MEMBERS} teammates.` }
  if (!memberIds.length) return { members: [] }
  const accounts = await db.collection('user_accounts')
    .find({ id: { $in: memberIds }, ...isPlayer }, { projection: { id: 1, name: 1, status: 1 } })
    .toArray()
  const byId = new Map(accounts.map((account) => [String(account.id), account]))
  const unknown = memberIds.filter((id) => !byId.has(id))
  if (unknown.length) return { error: 'Some teammates are no longer registered players. Remove them and try again.' }
  return { members: memberIds.map((id) => ({ id, name: String(byId.get(id).name || '') })) }
}

// GET /api/my-teams — the player's saved teams, most recently used or changed first.
router.get('/my-teams', requireAuth, requireRole('user'), async (req, res) => {
  try {
    const db = await getDb()
    const teams = await db.collection(COLLECTION).find({ ownerId: String(req.user.id) }).sort({ lastUsedAtISO: -1, updatedAtISO: -1 }).toArray()
    return res.json({ ok: true, data: (await withMemberStatus(db, teams)).map(publicTeam) })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) })
  }
})

// POST /api/my-teams { name, memberIds } — save a new team.
router.post('/my-teams', requireAuth, requireRole('user'), async (req, res) => {
  const ownerId = String(req.user.id)
  const name = cleanTeamName(req.body?.name)
  if (!name) return res.status(400).json({ ok: false, error: 'Give the team a name.' })
  try {
    const db = await getDb()
    const teams = db.collection(COLLECTION)
    if (await teams.countDocuments({ ownerId }) >= MAX_TEAMS) {
      return res.status(400).json({ ok: false, error: `You can save up to ${MAX_TEAMS} teams. Delete one you no longer use first.` })
    }
    if (await teams.findOne({ ownerId, nameKey: name.toLowerCase() })) {
      return res.status(409).json({ ok: false, error: `You already have a team called "${name}".` })
    }
    const { members, error } = await resolveMembers(db, cleanMemberIds(req.body?.memberIds, ownerId))
    if (error) return res.status(400).json({ ok: false, error })
    const nowISO = new Date().toISOString()
    const team = { id: `TEAM-${randomUUID().slice(0, 8).toUpperCase()}`, ownerId, name, nameKey: name.toLowerCase(), members, createdAtISO: nowISO, updatedAtISO: nowISO }
    await teams.insertOne(team)
    const [shown] = await withMemberStatus(db, [team])
    return res.status(201).json({ ok: true, data: publicTeam(shown) })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) })
  }
})

// PUT /api/my-teams/:id { name?, memberIds? } — rename the team or change who's on it.
// { used: true } just marks it as used for a booking (it moves to the top of the list).
router.put('/my-teams/:id', requireAuth, requireRole('user'), async (req, res) => {
  const ownerId = String(req.user.id)
  try {
    const db = await getDb()
    const teams = db.collection(COLLECTION)
    const team = await teams.findOne({ id: String(req.params.id), ownerId })
    if (!team) return res.status(404).json({ ok: false, error: 'Team not found.' })
    const nowISO = new Date().toISOString()
    const set = {}
    if (req.body?.used === true) set.lastUsedAtISO = nowISO
    if (req.body?.name !== undefined) {
      const name = cleanTeamName(req.body.name)
      if (!name) return res.status(400).json({ ok: false, error: 'Give the team a name.' })
      if (await teams.findOne({ ownerId, nameKey: name.toLowerCase(), id: { $ne: team.id } })) {
        return res.status(409).json({ ok: false, error: `You already have a team called "${name}".` })
      }
      Object.assign(set, { name, nameKey: name.toLowerCase() })
    }
    if (req.body?.memberIds !== undefined) {
      const { members, error } = await resolveMembers(db, cleanMemberIds(req.body.memberIds, ownerId))
      if (error) return res.status(400).json({ ok: false, error })
      set.members = members
    }
    if (set.name || set.members) set.updatedAtISO = nowISO
    if (!Object.keys(set).length) return res.status(400).json({ ok: false, error: 'Nothing to change.' })
    await teams.updateOne({ _id: team._id }, { $set: set })
    const [shown] = await withMemberStatus(db, [{ ...team, ...set }])
    return res.json({ ok: true, data: publicTeam(shown) })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) })
  }
})

// DELETE /api/my-teams/:id
router.delete('/my-teams/:id', requireAuth, requireRole('user'), async (req, res) => {
  try {
    const db = await getDb()
    const result = await db.collection(COLLECTION).deleteOne({ id: String(req.params.id), ownerId: String(req.user.id) })
    if (!result.deletedCount) return res.status(404).json({ ok: false, error: 'Team not found.' })
    return res.json({ ok: true })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) })
  }
})

export default router
