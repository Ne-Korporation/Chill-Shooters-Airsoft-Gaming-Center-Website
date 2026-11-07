import express from 'express'
import { randomUUID } from 'crypto'
import { ObjectId } from 'mongodb'
import { getDb, startDbSession } from '../db/mongo.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { nextShortId } from '../utils/shortIds.js'
import { getReservationPayments, syncReservationPaymentState } from '../utils/paymentProgress.js'
import { emailDamageCharge } from '../services/notificationEmails.js'
import { getExperienceLevel, getAgeGroup, suggestBalancedTeams } from '../utils/teamBalancing.js'
import { createPieces, modelFilter } from '../utils/inventoryPieces.js'
import { computePenalty, getPenaltyRules, resolvePenaltyCharge } from '../utils/penaltyRules.js'
import { fpsBlockReason, gameFpsStatus } from '../utils/fpsChecks.js'

// Field-side operations from the manuscript scope that sit outside the booking flow:
// player experience and balanced team grouping, onsite/balance payments and extra
// charges, per-player rental check-out/return, and the gunsmith repair log.
const router = express.Router()

const STAFF = ['admin', 'registrar', 'marshal']
// Who does what at the field: registrars take every payment, marshals hand out and check in guns,
// gear and ammo, and both run players (check-in, teams, starting and finishing games).
const GEAR = ['admin', 'marshal']
const ACTIVE_RESERVATION_STATUSES = ['pending', 'needs review', 'confirmed', 'approved']
// Status each inventory page treats as its maintenance queue.
const MAINTENANCE_STATUS = { weapons: 'needs-check', equipments: 'maintenance' }

function money(value) {
  const amount = Math.round(Number(value) * 100) / 100
  return Number.isFinite(amount) ? amount : NaN
}

function actorOf(req) {
  return { actorId: String(req.user?.id || ''), actorEmail: req.user?.email || '', actorRole: req.user?.role || '' }
}

function idFilter(rawId) {
  const id = String(rawId || '').trim()
  return { $or: [{ id }, ...(ObjectId.isValid(id) ? [{ _id: new ObjectId(id) }] : [])] }
}

async function findById(db, collection, rawId) {
  if (!String(rawId || '').trim()) return null
  return db.collection(collection).findOne(idFilter(rawId))
}

function keyOf(doc) {
  return String(doc?.id || doc?._id || '')
}

function sendError(res, err) {
  if (err?.statusCode) return res.status(err.statusCode).json({ ok: false, error: err.message })
  return res.status(500).json({ ok: false, error: String(err) })
}

// ---------------------------------------------------------------------------
// Player experience: total games played. That is the games completed at the field, plus games
// played before the system existed (stored as experienceAdjustment, set by an admin).
// ---------------------------------------------------------------------------

// Counts completed games per player: the captain and every registered teammate of each
// reservation whose game was completed or archived.
async function getGamesAtField(db, userIds) {
  const games = await db.collection('gameplay').find(
    { $or: [{ Status: { $in: ['Completed', 'Archived'] } }, { status: { $in: ['completed', 'archived'] } }] },
    { projection: { reservationId: 1 } },
  ).toArray()
  const reservationIds = [...new Set(games.map((game) => String(game.reservationId || '')).filter(Boolean))]
  const objectIds = reservationIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id))
  const reservations = reservationIds.length
    ? await db.collection('reservations').find(
      { $or: [{ id: { $in: reservationIds } }, ...(objectIds.length ? [{ _id: { $in: objectIds } }] : [])] },
      { projection: { userId: 1, teamMembers: 1 } },
    ).toArray()
    : []

  const wanted = new Set(userIds.map(String))
  const counts = new Map()
  for (const reservation of reservations) {
    const players = new Set([reservation.userId, ...(reservation.teamMembers || []).map((member) => member.id)].map(String))
    for (const id of players) {
      if (!id || !wanted.has(id)) continue
      counts.set(id, (counts.get(id) || 0) + 1)
    }
  }
  return counts
}

// Latest age on file per player: from their waiver, falling back to the account.
async function getAges(db, accounts) {
  const ids = accounts.map(keyOf)
  const waivers = await db.collection('waivers').find(
    { userId: { $in: ids } },
    { projection: { userId: 1, age: 1, createdAtISO: 1 } },
  ).toArray()
  const ages = new Map()
  for (const account of accounts) {
    const waiver = waivers
      .filter((item) => String(item.userId) === keyOf(account) && Number(item.age) > 0)
      .sort((a, b) => String(b.createdAtISO || '').localeCompare(String(a.createdAtISO || '')))[0]
    const age = Number(waiver?.age || account.age || 0)
    ages.set(keyOf(account), age > 0 ? age : null)
  }
  return ages
}

async function getPlayerProfiles(db, userIds) {
  const ids = [...new Set(userIds.map(String).filter(Boolean))]
  if (!ids.length) return new Map()
  const objectIds = ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id))
  const accounts = await db.collection('user_accounts').find(
    { $or: [{ id: { $in: ids } }, ...(objectIds.length ? [{ _id: { $in: objectIds } }] : [])] },
    { projection: { id: 1, name: 1, email: 1, age: 1, experienceAdjustment: 1 } },
  ).toArray()
  const [atField, ages] = await Promise.all([getGamesAtField(db, ids), getAges(db, accounts)])
  return new Map(accounts.map((account) => {
    const id = keyOf(account)
    const gamesAtField = atField.get(id) || 0
    const gamesPlayed = Math.max(0, gamesAtField + Math.round(Number(account.experienceAdjustment) || 0))
    const age = ages.get(id) ?? null
    return [id, {
      id,
      name: account.name || account.email || id,
      gamesPlayed,
      gamesAtField,
      experience: gamesPlayed,
      experienceLevel: getExperienceLevel(gamesPlayed),
      age,
      ageGroup: getAgeGroup(age),
    }]
  }))
}

// GET /api/players/levels — live experience level of every player, for staff player lists.
router.get('/players/levels', requireAuth, requireRole(...STAFF), async (req, res) => {
  try {
    const db = await getDb()
    const players = await db.collection('user_accounts').find(
      { $or: [{ role: 'user' }, { role: { $exists: false } }] },
      { projection: { id: 1 } },
    ).limit(2000).toArray()
    const profiles = await getPlayerProfiles(db, players.map(keyOf))
    const data = Object.fromEntries([...profiles].map(([id, profile]) => [id, {
      gamesPlayed: profile.gamesPlayed,
      experience: profile.experience,
      experienceLevel: profile.experienceLevel,
    }]))
    return res.json({ ok: true, data })
  } catch (err) {
    return sendError(res, err)
  }
})

// GET /api/players/:id/stats — the player's own profile numbers, or any player's for staff.
router.get('/players/:id/stats', requireAuth, async (req, res) => {
  const id = String(req.params.id || '')
  try {
    const db = await getDb()
    // Players see their own progress, and parents their children's.
    if (req.user.role === 'user' && String(req.user.id) !== id) {
      const child = await db.collection('user_accounts').findOne({ id, guardianId: String(req.user.id), isChildProfile: true, removedByGuardianAtISO: { $exists: false } }, { projection: { _id: 1 } })
      if (!child) return res.status(404).json({ ok: false, error: 'not found' })
    }
    const profile = (await getPlayerProfiles(db, [id])).get(id)
    if (!profile) return res.status(404).json({ ok: false, error: 'Player not found' })

    const reservations = await db.collection('reservations').find(
      { $or: [{ userId: id }, { 'teamMembers.id': id }] },
      { projection: { id: 1, reservationDate: 1, reservationTime: 1, reservationStatus: 1, locationName: 1, packageName: 1, userId: 1, sessionType: 1 } },
    ).sort({ reservationDate: -1 }).limit(200).toArray()
    const today = new Date().toISOString().slice(0, 10)
    const status = (r) => String(r.reservationStatus || '').toLowerCase()

    const [weapons, equipment] = await Promise.all([
      db.collection('weapons').find({ submittedBy: id, approvalStatus: { $ne: 'rejected' } }, { projection: { id: 1, name: 1, category: 1 } }).toArray(),
      db.collection('equipments').find({ submittedBy: id, approvalStatus: { $ne: 'rejected' } }, { projection: { id: 1, name: 1, category: 1 } }).toArray(),
    ])

    return res.json({
      ok: true,
      data: {
        ...profile,
        reservations: {
          total: reservations.length,
          upcoming: reservations.filter((r) => r.reservationDate >= today && status(r) !== 'cancelled').length,
          cancelled: reservations.filter((r) => status(r) === 'cancelled').length,
          recent: reservations.slice(0, 5).map((r) => ({
            id: r.id,
            reservationDate: r.reservationDate,
            reservationTime: r.reservationTime,
            reservationStatus: r.reservationStatus,
            locationName: r.locationName,
            packageName: r.packageName,
            asCaptain: String(r.userId) === id,
            sessionType: r.sessionType || 'public',
          })),
        },
        ownedGear: [
          ...weapons.map((item) => ({ id: keyOf(item), name: item.name, kind: 'weapon', category: item.category })),
          ...equipment.map((item) => ({ id: keyOf(item), name: item.name, kind: 'equipment', category: item.category })),
        ],
      },
    })
  } catch (err) {
    return sendError(res, err)
  }
})

// PUT /api/players/:id/experience { gamesPlayed, note } — admin sets the player's total games
// played (e.g. to count games from before the system). The total shown becomes exactly that
// number; games completed at the field from then on keep adding to it.
router.put('/players/:id/experience', requireAuth, requireRole('admin'), async (req, res) => {
  const gamesPlayed = Number(req.body?.gamesPlayed)
  if (!Number.isInteger(gamesPlayed) || gamesPlayed < 0 || gamesPlayed > 5000) {
    return res.status(400).json({ ok: false, error: 'Total games played must be a whole number from 0 to 5000.' })
  }
  const note = String(req.body?.note || '').trim().slice(0, 300)
  try {
    const db = await getDb()
    const account = await findById(db, 'user_accounts', req.params.id)
    if (!account || String(account.role || 'user') !== 'user') return res.status(404).json({ ok: false, error: 'Player not found' })
    const current = (await getPlayerProfiles(db, [keyOf(account)])).get(keyOf(account))
    const gamesAtField = current?.gamesAtField || 0
    if (gamesPlayed < gamesAtField) {
      return res.status(400).json({ ok: false, error: `This player has already completed ${gamesAtField} game(s) at the field, so the total can't be lower than that.` })
    }
    const nowISO = new Date().toISOString()
    await db.collection('user_accounts').updateOne(
      { _id: account._id },
      {
        $set: { experienceAdjustment: gamesPlayed - gamesAtField, updatedAtISO: nowISO },
        $push: { experienceHistory: { gamesPlayed, previous: current?.gamesPlayed ?? 0, note, atISO: nowISO, ...actorOf(req) } },
      },
    )
    const profile = (await getPlayerProfiles(db, [keyOf(account)])).get(keyOf(account))
    return res.json({ ok: true, data: profile })
  } catch (err) {
    return sendError(res, err)
  }
})

// ---------------------------------------------------------------------------
// Balanced team grouping for a session (location + date + time slot)
// ---------------------------------------------------------------------------

function sessionKey(location, date, slot) {
  return `${location}:${date}:${slot}`
}

function readSession(query) {
  const location = String(query.location || '').trim().toLowerCase()
  const date = String(query.date || '').trim()
  const slot = String(query.slot || '').trim().toLowerCase()
  if (!location || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !['morning', 'afternoon', 'evening'].includes(slot)) {
    const invalid = new Error('Choose a location, date, and time slot.')
    invalid.statusCode = 400
    throw invalid
  }
  return { location, date, slot }
}

// Everyone booked into the session: registered players with their experience and age, plus
// unnamed guests for walk-ins and spots not filled by registered teammates.
async function getSessionRoster(db, { location, date, slot }) {
  const reservations = await db.collection('reservations').find({
    reservationStatus: { $in: ACTIVE_RESERVATION_STATUSES },
    reservationDate: date,
    reservationTime: slot,
    locationId: location,
  }).toArray()

  const userIds = reservations.flatMap((r) => [r.userId, ...(r.teamMembers || []).map((m) => m.id)])
    .map(String).filter((id) => id && id !== 'walk-in')
  const profiles = await getPlayerProfiles(db, userIds)

  const roster = []
  for (const reservation of reservations) {
    const registered = [...new Set([reservation.userId, ...(reservation.teamMembers || []).map((m) => m.id)].map(String))]
      .filter((id) => profiles.has(id))
    for (const id of registered) {
      roster.push({ key: `user:${id}`, ...profiles.get(id), reservationId: reservation.id, guest: false })
    }
    const guests = Math.max(0, Number(reservation.numberOfPlayers || 0) - registered.length)
    for (let n = 1; n <= guests; n += 1) {
      const label = reservation.walkIn ? `${reservation.walkInName || 'Walk-in'}` : 'Guest'
      roster.push({
        key: `guest:${reservation.id}:${n}`,
        id: '',
        name: guests > 1 || reservation.walkIn ? `${label} #${n}` : label,
        gamesPlayed: 0,
        gamesAtField: 0,
        experience: 0,
        experienceLevel: getExperienceLevel(0),
        age: null,
        ageGroup: getAgeGroup(null),
        reservationId: reservation.id,
        guest: true,
      })
    }
  }
  return roster
}

// Players booked on the session who have been checked in at the field.
async function getPresentRoster(db, session) {
  const [roster, checkins] = await Promise.all([
    getSessionRoster(db, session),
    db.collection('field_checkins').findOne({ _id: sessionKey(session.location, session.date, session.slot) }),
  ])
  const checkedIn = checkins?.players || {}
  return { roster: roster.filter((player) => checkedIn[player.key]), booked: roster.length }
}

// GET /api/team-grouping?location&date&slot&teams=2 — the players present (checked in), a
// suggestion balanced on experience level, and the marshal's saved assignment if there is one.
router.get('/team-grouping', requireAuth, requireRole(...STAFF), async (req, res) => {
  try {
    const session = readSession(req.query)
    const teamCount = Math.min(Math.max(Number(req.query.teams) || 2, 2), 6)
    const db = await getDb()
    const { roster, booked } = await getPresentRoster(db, session)
    const saved = await db.collection('team_assignments').findOne({ _id: sessionKey(session.location, session.date, session.slot) })
    return res.json({
      ok: true,
      data: {
        roster,
        booked,
        suggestion: suggestBalancedTeams(roster, teamCount),
        saved: saved ? { teams: saved.teams, presentPlayers: saved.presentPlayers || [], savedAtISO: saved.savedAtISO, savedBy: saved.savedBy } : null,
      },
    })
  } catch (err) {
    return sendError(res, err)
  }
})

// POST /api/team-grouping { location, date, slot, teams: [{ name, playerKeys }] } — the marshal's final say.
router.post('/team-grouping', requireAuth, requireRole(...STAFF), async (req, res) => {
  try {
    const session = readSession(req.body || {})
    const teams = Array.isArray(req.body?.teams) ? req.body.teams : []
    if (teams.length < 2 || teams.length > 6) return res.status(400).json({ ok: false, error: 'Create between 2 and 6 teams.' })
    const cleaned = teams.map((team, index) => ({
      name: String(team?.name || `Team ${index + 1}`).trim().slice(0, 40),
      playerKeys: [...new Set((Array.isArray(team?.playerKeys) ? team.playerKeys : []).map(String))],
    }))
    const seen = new Set()
    for (const key of cleaned.flatMap((team) => team.playerKeys)) {
      if (seen.has(key)) return res.status(400).json({ ok: false, error: 'A player can only be on one team.' })
      seen.add(key)
    }
    const db = await getDb()
    // Only players checked in for this session can be put on a team.
    const { roster } = await getPresentRoster(db, session)
    const present = new Map(roster.map((player) => [player.key, player]))
    const absent = [...seen].filter((key) => !present.has(key))
    if (absent.length) return res.status(400).json({ ok: false, error: 'Only players checked in for this session can be put on a team. Reload the session.' })
    // The list of who was present is saved with the teams, so it stays on record after the day.
    const presentPlayers = roster.map((player) => ({
      key: player.key,
      id: player.id,
      name: player.name,
      guest: player.guest,
      gamesPlayed: player.gamesPlayed,
      experienceLevel: player.experienceLevel,
      ageGroup: player.ageGroup,
      reservationId: player.reservationId,
    }))
    const nowISO = new Date().toISOString()
    await db.collection('team_assignments').updateOne(
      { _id: sessionKey(session.location, session.date, session.slot) },
      { $set: { ...session, teams: cleaned, presentPlayers, savedAtISO: nowISO, savedBy: actorOf(req) } },
      { upsert: true },
    )
    return res.json({ ok: true, data: { teams: cleaned, presentPlayers, savedAtISO: nowISO } })
  } catch (err) {
    return sendError(res, err)
  }
})

// ---------------------------------------------------------------------------
// Field check-in: who from each booked team has arrived at the field
// ---------------------------------------------------------------------------

// GET /api/field-checkin?location&date&slot — every booked team with its players and who has
// checked in. Registrars and marshals tick players off.
router.get('/field-checkin', requireAuth, requireRole(...STAFF), async (req, res) => {
  try {
    const session = readSession(req.query)
    const db = await getDb()
    const roster = await getSessionRoster(db, session)
    const saved = await db.collection('field_checkins').findOne({ _id: sessionKey(session.location, session.date, session.slot) })
    const checkedIn = saved?.players || {}

    const teams = new Map()
    for (const player of roster) {
      const team = teams.get(player.reservationId) || { reservationId: player.reservationId, players: [] }
      team.players.push({
        key: player.key,
        id: player.id,
        name: player.name,
        guest: player.guest,
        experienceLevel: player.experienceLevel,
        ageGroup: player.ageGroup,
        checkedIn: Boolean(checkedIn[player.key]),
        checkedInAtISO: checkedIn[player.key]?.atISO || null,
        checkedInBy: checkedIn[player.key]?.actorEmail || '',
      })
      teams.set(player.reservationId, team)
    }

    const reservations = await db.collection('reservations').find(
      { id: { $in: [...teams.keys()] } },
      { projection: { id: 1, userId: 1, walkIn: 1, walkInName: 1, teamName: 1, numberOfPlayers: 1, reservationStatus: 1, sessionType: 1 } },
    ).toArray()
    const captains = await getPlayerProfiles(db, reservations.map((r) => r.userId).filter(Boolean))
    for (const reservation of reservations) {
      const team = teams.get(reservation.id)
      if (!team) continue
      team.label = reservation.teamName
        || (reservation.walkIn ? `Walk-in: ${reservation.walkInName || 'Guest'}` : `${captains.get(String(reservation.userId))?.name || 'Player'}'s ${String(reservation.sessionType || '').toLowerCase() === 'private' ? 'team' : 'booking'}`)
      team.reservationStatus = reservation.reservationStatus
    }

    return res.json({ ok: true, data: { teams: [...teams.values()], updatedAtISO: saved?.updatedAtISO || null } })
  } catch (err) {
    return sendError(res, err)
  }
})

// PUT /api/field-checkin { location, date, slot, playerKey, checkedIn } — registrar marks a player in or out.
router.put('/field-checkin', requireAuth, requireRole('admin', 'registrar', 'marshal'), async (req, res) => {
  try {
    const session = readSession(req.body || {})
    const playerKey = String(req.body?.playerKey || '')
    if (!/^(user|guest):/.test(playerKey) || /[.$]/.test(playerKey)) {
      return res.status(400).json({ ok: false, error: 'Unknown player.' })
    }
    const db = await getDb()
    const roster = await getSessionRoster(db, session)
    if (!roster.some((player) => player.key === playerKey)) {
      return res.status(404).json({ ok: false, error: 'That player is not booked for this session.' })
    }
    const nowISO = new Date().toISOString()
    const update = req.body?.checkedIn === true
      ? { $set: { ...session, [`players.${playerKey}`]: { atISO: nowISO, ...actorOf(req) }, updatedAtISO: nowISO } }
      : { $set: { ...session, updatedAtISO: nowISO }, $unset: { [`players.${playerKey}`]: '' } }
    await db.collection('field_checkins').updateOne({ _id: sessionKey(session.location, session.date, session.slot) }, update, { upsert: true })
    return res.json({ ok: true, data: { playerKey, checkedIn: req.body?.checkedIn === true, atISO: nowISO } })
  } catch (err) {
    return sendError(res, err)
  }
})

// ---------------------------------------------------------------------------
// Reservation ledger, onsite/balance payments, and extra charges
// ---------------------------------------------------------------------------

const PAID_STATUSES = ['paid', 'confirmed', 'verified', 'approved', 'succeeded']
const ONSITE_METHODS = { cash: 'Cash', gcash: 'GCash', bank_transfer: 'Bank transfer' }

function readPrice(name, fallback) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

export function getChargeConfig() {
  return {
    ammo_reload: { label: 'Extra ammo reload', unitPrice: readPrice('AMMO_RELOAD_PRICE', 50) },
    field_modification: { label: 'Field modification fee', unitPrice: readPrice('FIELD_MODIFICATION_FEE', 500) },
    other: { label: 'Other charge', unitPrice: 0 },
  }
}

function buildLedger(reservation, payments) {
  const active = payments.filter((p) => !['failed', 'rejected'].includes(String(p.paymentStatus || p.status || '').toLowerCase()))
  const collected = Math.round(active.reduce((sum, p) => sum + Number(p.amount || 0), 0) * 100) / 100
  const verified = Math.round(active
    .filter((p) => PAID_STATUSES.includes(String(p.paymentStatus || p.status || '').toLowerCase()))
    .reduce((sum, p) => sum + Number(p.amount || 0), 0) * 100) / 100
  const total = Math.round(Number(reservation.totalAmount || 0) * 100) / 100
  const extraTotal = Math.round((reservation.extraCharges || []).reduce((sum, c) => sum + Number(c.amount || 0), 0) * 100) / 100
  return {
    reservation: {
      id: keyOf(reservation),
      userId: reservation.userId,
      walkIn: reservation.walkIn === true,
      walkInName: reservation.walkInName || '',
      reservationDate: reservation.reservationDate,
      reservationTime: reservation.reservationTime,
      locationId: reservation.locationId,
      locationName: reservation.locationName,
      numberOfPlayers: reservation.numberOfPlayers,
      packageName: reservation.packageName,
      reservationStatus: reservation.reservationStatus,
      teamMembers: reservation.teamMembers || [],
      // Players who said they'd bring their own gun (no rental gun for them).
      ownWeaponBringerIds: (reservation.ownWeaponBringerIds || []).map(String),
    },
    total,
    depositAmount: Number(reservation.depositAmount || 0),
    breakdown: reservation.pricingBreakdown || [],
    extraCharges: reservation.extraCharges || [],
    payments: payments.map((p) => ({
      id: p.id,
      amount: p.amount,
      paymentMethod: p.paymentMethod,
      paymentStatus: p.paymentStatus || p.status,
      kind: p.kind || 'online',
      transactionReference: p.transactionReference || '',
      createdAtISO: p.createdAtISO,
    })),
    collected,
    verified,
    balanceDue: Math.max(0, Math.round((total - collected) * 100) / 100),
    // The part of the balance that belongs to the booking itself; the rest is additional charges
    // added at the counter (payments count toward the booking first).
    additionalTotal: extraTotal,
    bookingBalanceDue: Math.max(0, Math.round((total - extraTotal - collected) * 100) / 100),
  }
}

router.get('/charge-config', requireAuth, requireRole(...STAFF), (_req, res) => {
  res.json({ ok: true, data: getChargeConfig() })
})

// GET /api/reservations/:id/ledger — everything charged and paid, and the balance still due.
router.get('/reservations/:id/ledger', requireAuth, async (req, res) => {
  try {
    const db = await getDb()
    const reservation = await findById(db, 'reservations', req.params.id)
    const ownsIt = reservation && (String(reservation.userId) === String(req.user.id) ||
      (reservation.teamMembers || []).some((m) => String(m.id) === String(req.user.id)))
    if (!reservation || (req.user.role === 'user' && !ownsIt)) return res.status(404).json({ ok: false, error: 'Reservation not found' })
    const payments = await getReservationPayments(db, reservation)
    const ledger = buildLedger(reservation, payments)
    const captain = reservation.walkIn ? null : await findById(db, 'user_accounts', reservation.userId)
    ledger.reservation.captainName = captain?.name || ''
    return res.json({ ok: true, data: ledger })
  } catch (err) {
    return sendError(res, err)
  }
})

// POST /api/payments/onsite { reservationId, amount, method, reference, note } — staff record the
// balance (or any amount) collected at the field. Recorded as paid since staff took it in person.
router.post('/payments/onsite', requireAuth, requireRole('admin', 'registrar'), async (req, res) => {
  const body = req.body || {}
  const method = String(body.method || '').toLowerCase()
  const amount = money(body.amount)
  const reference = String(body.reference || '').trim().slice(0, 120)
  if (!ONSITE_METHODS[method]) return res.status(400).json({ ok: false, error: 'Choose cash, GCash, or bank transfer.' })
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ ok: false, error: 'Enter the amount received.' })
  if (method !== 'cash' && reference.length < 4) return res.status(400).json({ ok: false, error: 'Enter the transaction reference number.' })

  const db = await getDb()
  const session = startDbSession()
  try {
    let payment
    let reservation
    let settlesGame = false
    await session.withTransaction(async () => {
      reservation = await db.collection('reservations').findOne(idFilter(body.reservationId), { session })
      if (!reservation) throw Object.assign(new Error('Reservation not found'), { statusCode: 404 })
      if (String(reservation.reservationStatus || '').toLowerCase() === 'cancelled') {
        throw Object.assign(new Error('This reservation is cancelled.'), { statusCode: 409 })
      }
      const reservationId = keyOf(reservation)
      // The booking's own balance can be collected any time (usually at check-in). Additional
      // charges added at the counter (extra ammo, extra guns) are collected after the game, once
      // every rented gun and piece of gear is back: a damaged or missing item adds a penalty, so
      // the final amount isn't known until then.
      const stillOut = await db.collection('rentals')
        .find({ reservationId, status: 'out' }, { session, projection: { itemName: 1, unitLabel: 1, playerName: 1 } })
        .toArray()
      await db.collection('payment_deposit_locks').updateOne({ _id: reservationId }, { $inc: { version: 1 } }, { upsert: true, session })
      if (reference) {
        const reused = await db.collection('payments').findOne(
          { $expr: { $eq: [{ $toLower: '$transactionReference' }, reference.toLowerCase()] } },
          { session },
        )
        if (reused) throw Object.assign(new Error('This reference number was already recorded.'), { statusCode: 409 })
      }
      const payments = await db.collection('payments').find({ reservationId: { $in: [reservation.id, String(reservation._id)].filter(Boolean) } }, { session }).toArray()
      const { balanceDue, bookingBalanceDue } = buildLedger(reservation, payments)
      // This payment settles the additional charges with every rental back: the game is over.
      settlesGame = !stillOut.length && balanceDue - bookingBalanceDue > 0.01 && amount >= balanceDue - 0.01
      if (amount > balanceDue + 0.01) {
        throw Object.assign(new Error(`Only ₱${balanceDue.toLocaleString()} is still due.`), { statusCode: 400 })
      }
      if (stillOut.length && amount > bookingBalanceDue + 0.01) {
        const list = stillOut.map((r) => `${r.itemName}${r.unitLabel && !String(r.itemName).includes(r.unitLabel) ? ` ${r.unitLabel}` : ''} (${r.playerName})`).join(', ')
        throw Object.assign(new Error(bookingBalanceDue > 0
          ? `Only the booking balance (₱${bookingBalanceDue.toLocaleString()}) can be collected now. Collect the additional charges after every rental is checked in. Still out: ${list}.`
          : `The booking is paid. Collect the additional charges after every rental is checked in. Still out: ${list}.`), { statusCode: 409 })
      }

      const nowISO = new Date().toISOString()
      payment = {
        id: `PMT-${randomUUID()}`,
        reservationId,
        userId: String(reservation.userId || ''),
        amount,
        paymentMethod: ONSITE_METHODS[method],
        paymentStatus: 'paid',
        status: 'paid',
        kind: 'onsite',
        ...(reference ? { transactionReference: reference.toLowerCase() } : {}),
        note: String(body.note || '').trim().slice(0, 300),
        recordedBy: actorOf(req),
        verifiedBy: String(req.user.id),
        verifiedByRole: req.user.role,
        verifiedAtISO: nowISO,
        createdAtISO: nowISO,
      }
      await db.collection('payments').insertOne(payment, { session })
    })
    await syncReservationPaymentState(db, reservation)
    // Paying off the additional charges after every rental is back is the end of the game, so
    // its gameplay record is marked Completed (unless staff already completed or cancelled it).
    let gameCompleted = false
    if (settlesGame) {
      const nowISO = new Date().toISOString()
      const result = await db.collection('gameplay').updateMany(
        { reservationId: { $in: [reservation.id, String(reservation._id)].filter(Boolean) }, Status: { $regex: '^(sched|ongo)', $options: 'i' } },
        { $set: { Status: 'Completed', completedAtISO: nowISO, completedBy: actorOf(req), autoCompletedBy: 'final payment', updatedAtISO: nowISO } },
      )
      gameCompleted = result.modifiedCount > 0
    }
    const payments = await getReservationPayments(db, reservation)
    return res.status(201).json({ ok: true, data: payment, gameCompleted, ledger: buildLedger(reservation, payments) })
  } catch (err) {
    return sendError(res, err)
  } finally {
    await session.endSession()
  }
})

// Gear charges (ammo, gun rentals) belong to the marshals who hand the gear out; the rest of the
// bill belongs to the registrar. Admins can do both.
const GEAR_CHARGE_TYPES = ['ammo_reload', 'gun_rental']
export function canAddChargeType(role, type) {
  if (role === 'admin') return true
  return GEAR_CHARGE_TYPES.includes(type) ? role === 'marshal' : role === 'registrar'
}
// Taking a charge off: the registrar fixes any line of the bill; a marshal only the ammo or gun
// lines (one added by mistake).
export function canRemoveChargeType(role, type) {
  if (role === 'admin' || role === 'registrar') return true
  return role === 'marshal' && GEAR_CHARGE_TYPES.includes(type)
}

// POST /api/reservations/:id/charges { type, quantity, unitPrice, note } — ammo reloads, field
// modification fees, or other charges added to the bill. There is no cancellation fee.
router.post('/reservations/:id/charges', requireAuth, requireRole(...STAFF), async (req, res) => {
  const body = req.body || {}
  const config = getChargeConfig()
  const type = String(body.type || '')
  if (!config[type]) return res.status(400).json({ ok: false, error: 'Choose a charge type.' })
  // Ammo is handed out by the marshals; field fees and other charges are the registrar's.
  if (!canAddChargeType(req.user.role, type)) {
    return res.status(403).json({ ok: false, error: type === 'ammo_reload' ? 'Marshals hand out and add extra ammo.' : 'The registrar adds this charge.' })
  }
  const quantity = Number(body.quantity ?? 1)
  const unitPrice = money(body.unitPrice ?? config[type].unitPrice)
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) return res.status(400).json({ ok: false, error: 'Quantity must be a whole number from 1 to 500.' })
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return res.status(400).json({ ok: false, error: 'Enter the price for this charge.' })
  const note = String(body.note || '').trim().slice(0, 300)
  if (type === 'other' && !note) return res.status(400).json({ ok: false, error: 'Describe the charge.' })

  try {
    const db = await getDb()
    const reservation = await findById(db, 'reservations', req.params.id)
    if (!reservation) return res.status(404).json({ ok: false, error: 'Reservation not found' })
    const amount = Math.round(quantity * unitPrice * 100) / 100
    const label = `${type === 'other' ? note : config[type].label}${quantity > 1 ? ` × ${quantity}` : ''}`
    const nowISO = new Date().toISOString()
    const charge = {
      id: `CHG-${new ObjectId().toHexString().slice(-8).toUpperCase()}`,
      type,
      label,
      quantity,
      unitPrice,
      amount,
      note,
      addedBy: actorOf(req),
      atISO: nowISO,
    }
    await db.collection('reservations').updateOne(
      { _id: reservation._id },
      {
        $inc: { totalAmount: amount, balanceAmount: amount, extraChargesTotal: amount },
        $push: { pricingBreakdown: { label, amount }, extraCharges: charge },
        $set: { updatedAtISO: nowISO },
      },
    )
    const updated = await db.collection('reservations').findOne({ _id: reservation._id })
    const payments = await getReservationPayments(db, updated)
    return res.status(201).json({ ok: true, data: charge, ledger: buildLedger(updated, payments) })
  } catch (err) {
    return sendError(res, err)
  }
})

// POST /api/reservations/:id/add-gun { itemId, playerName, playerId? } — a player rents an extra
// gun at the counter: the gun is handed to them (a rental record, like the Rentals tab) and its
// rental price goes on the bill as an additional charge.
router.post('/reservations/:id/add-gun', requireAuth, requireRole(...GEAR), async (req, res) => {
  const body = req.body || {}
  const playerName = String(body.playerName || '').trim().slice(0, 120)
  if (!playerName) return res.status(400).json({ ok: false, error: 'Choose who gets the gun.' })
  try {
    const db = await getDb()
    const reservation = await findById(db, 'reservations', req.params.id)
    if (!reservation) return res.status(404).json({ ok: false, error: 'Reservation not found' })
    const gun = await findById(db, 'weapons', body.itemId)
    if (!gun || gun.source === 'player') return res.status(404).json({ ok: false, error: 'Gun not found' })
    if (String(gun.status || 'available').toLowerCase() !== 'available') return res.status(409).json({ ok: false, error: `${gun.name} is not available.` })
    const alreadyOut = await db.collection('rentals').findOne({ itemId: keyOf(gun), status: 'out' })
    if (alreadyOut) return res.status(409).json({ ok: false, error: `${gun.name} is already out with ${alreadyOut.playerName}.` })
    const price = money(gun.price)
    if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ ok: false, error: `${gun.name} has no rental price. Set one in the inventory first.` })

    const nowISO = new Date().toISOString()
    const unitLabel = Number(gun.unitNumber) ? `#${Number(gun.unitNumber)}` : ''
    const rental = {
      id: await nextShortId(db, 'rentals', 'RNT'),
      reservationId: keyOf(reservation),
      reservationDate: reservation.reservationDate,
      playerName,
      playerId: String(body.playerId || '').trim(),
      itemCollection: 'weapons',
      itemId: keyOf(gun),
      itemName: gun.name || keyOf(gun),
      itemCategory: gun.category || '',
      unitLabel,
      status: 'out',
      issuedAtISO: nowISO,
      issuedBy: actorOf(req),
      billed: true,
    }
    const label = `Gun rental: ${gun.name}${unitLabel && !String(gun.name).includes('#') ? ` ${unitLabel}` : ''} (${playerName})`
    const charge = {
      id: `CHG-${new ObjectId().toHexString().slice(-8).toUpperCase()}`,
      type: 'gun_rental',
      label,
      quantity: 1,
      unitPrice: price,
      amount: price,
      note: '',
      rentalId: rental.id,
      addedBy: actorOf(req),
      atISO: nowISO,
    }
    await db.collection('rentals').insertOne(rental)
    await db.collection('reservations').updateOne(
      { _id: reservation._id },
      {
        $inc: { totalAmount: price, balanceAmount: price, extraChargesTotal: price },
        $push: { pricingBreakdown: { label, amount: price }, extraCharges: charge },
        $set: { updatedAtISO: nowISO },
      },
    )
    const updated = await db.collection('reservations').findOne({ _id: reservation._id })
    return res.status(201).json({ ok: true, data: { rental, charge }, ledger: buildLedger(updated, await getReservationPayments(db, updated)) })
  } catch (err) {
    return sendError(res, err)
  }
})

// POST /api/reservations/:id/charges/:chargeId/remove { quantity? } — takes back a charge added at
// the counter (an ammo reload added by mistake or not used, for example). With `quantity`, only
// that many units come off (one reload of three); without it, the whole charge is removed. A
// charge can't be taken off once the money for it has been collected: refund it instead.
router.post('/reservations/:id/charges/:chargeId/remove', requireAuth, requireRole(...STAFF), async (req, res) => {
  try {
    const db = await getDb()
    const reservation = await findById(db, 'reservations', req.params.id)
    if (!reservation) return res.status(404).json({ ok: false, error: 'Reservation not found' })
    const charges = Array.isArray(reservation.extraCharges) ? reservation.extraCharges : []
    const charge = charges.find((c) => c.id === req.params.chargeId)
    if (!charge) return res.status(404).json({ ok: false, error: 'That charge is no longer on the bill.' })
    if (!canRemoveChargeType(req.user.role, charge.type)) return res.status(403).json({ ok: false, error: 'Only the registrar can take this charge off the bill.' })

    const quantity = Number(charge.quantity || 1)
    const asked = req.body?.quantity === undefined ? quantity : Number(req.body.quantity)
    if (!Number.isInteger(asked) || asked < 1) return res.status(400).json({ ok: false, error: 'Quantity must be a whole number of at least 1.' })
    const removeQty = Math.min(asked, quantity)
    const removedAmount = Math.round(removeQty * Number(charge.unitPrice || 0) * 100) / 100
    const amount = removeQty === quantity ? Number(charge.amount || 0) : removedAmount

    const payments = await getReservationPayments(db, reservation)
    const { total, collected } = buildLedger(reservation, payments)
    if (Math.round((total - amount) * 100) / 100 < collected - 0.01) {
      return res.status(409).json({ ok: false, error: 'This charge has already been paid, so it can’t be removed. Refund it instead.' })
    }

    // The matching bill line (same label and amount; the last one if there are several).
    const breakdown = [...(reservation.pricingBreakdown || [])]
    let lineIndex = -1
    for (let i = breakdown.length - 1; i >= 0; i -= 1) {
      if (breakdown[i]?.label === charge.label && Math.abs(Number(breakdown[i]?.amount) - Number(charge.amount)) < 0.01) { lineIndex = i; break }
    }

    const nowISO = new Date().toISOString()
    let nextCharges
    if (removeQty === quantity) {
      nextCharges = charges.filter((c) => c.id !== charge.id)
      if (lineIndex >= 0) breakdown.splice(lineIndex, 1)
    } else {
      const left = quantity - removeQty
      const baseLabel = String(charge.label).replace(/ × \d+$/, '')
      const updated = {
        ...charge,
        quantity: left,
        amount: Math.round((Number(charge.amount) - amount) * 100) / 100,
        label: `${baseLabel}${left > 1 ? ` × ${left}` : ''}`,
      }
      nextCharges = charges.map((c) => (c.id === charge.id ? updated : c))
      if (lineIndex >= 0) breakdown[lineIndex] = { label: updated.label, amount: updated.amount }
    }

    // Only applies if the bill hasn't changed since it was read (another charge added at the same time).
    const result = await db.collection('reservations').updateOne(
      { _id: reservation._id, extraCharges: charges },
      {
        $set: { extraCharges: nextCharges, pricingBreakdown: breakdown, updatedAtISO: nowISO },
        $inc: { totalAmount: -amount, balanceAmount: -amount, extraChargesTotal: -amount },
        $push: { removedCharges: { ...charge, removedQuantity: removeQty, removedAmount: amount, removedBy: actorOf(req), removedAtISO: nowISO } },
      },
    )
    if (!result.modifiedCount) return res.status(409).json({ ok: false, error: 'The bill just changed. Try again.' })
    // Taking a gun rental off the bill also takes the gun back, if it hasn't been returned yet.
    if (charge.rentalId && removeQty === quantity) {
      await db.collection('rentals').updateOne(
        { id: charge.rentalId, status: 'out' },
        { $set: { status: 'returned', condition: 'ok', returnNote: 'Rental removed from the bill', returnedAtISO: nowISO, returnedBy: actorOf(req) } },
      )
    }

    const updated = await db.collection('reservations').findOne({ _id: reservation._id })
    return res.json({ ok: true, ledger: buildLedger(updated, await getReservationPayments(db, updated)) })
  } catch (err) {
    return sendError(res, err)
  }
})

// ---------------------------------------------------------------------------
// Rental check-out and return, per player and per unit
// ---------------------------------------------------------------------------

const RENTAL_COLLECTIONS = ['weapons', 'equipments']

async function reportRentalProblem(db, rental, condition, note, req) {
  const nowISO = new Date().toISOString()
  const report = {
    id: await nextShortId(db, 'damage_reports', 'DMG'),
    itemType: rental.itemCollection === 'weapons' ? 'weapon' : 'equipment',
    itemId: rental.itemId,
    itemName: `${rental.itemName}${rental.unitLabel ? ` (${rental.unitLabel})` : ''}`,
    reservationId: rental.reservationId,
    playerId: rental.playerId || '',
    playerName: rental.playerName,
    rentalId: rental.id,
    description: condition === 'missing'
      ? `Not returned after the game.${note ? ` ${note}` : ''}`
      : `Returned damaged.${note ? ` ${note}` : ''}`,
    evidenceUrl: '',
    status: 'reported',
    chargeAmount: 0,
    reportedAtISO: nowISO,
    reportedBy: actorOf(req),
  }
  // A damaged return goes straight to the repair log, linked to the report and the booking, so
  // staff don't enter it again; completing the repair bills the booking and settles the report.
  let repair = null
  if (condition !== 'missing' && rental.itemId) {
    repair = {
      id: await nextShortId(db, 'repairs', 'RPR'),
      itemCollection: rental.itemCollection,
      itemId: String(rental.itemId),
      itemName: report.itemName,
      itemCategory: '',
      damage: report.description,
      gunsmith: '',
      damageReportId: report.id,
      playerInduced: Boolean(rental.reservationId),
      reservationId: rental.reservationId || '',
      playerId: report.playerId,
      status: 'in_progress',
      openedAtISO: nowISO,
      openedBy: actorOf(req),
    }
    report.repairId = repair.id
  }
  await db.collection('damage_reports').insertOne(report)
  if (repair) await db.collection('repairs').insertOne(repair)
  await db.collection(rental.itemCollection).updateOne(
    idFilter(rental.itemId),
    {
      $set: {
        status: MAINTENANCE_STATUS[rental.itemCollection],
        maintenanceReason: repair
          ? `Under repair (${repair.id}) after rental ${rental.id}`
          : `${condition === 'missing' ? 'Missing' : 'Damaged'} after rental ${rental.id} (${report.id})`,
        updatedAtISO: nowISO,
      },
    },
  )
  return report
}

// GET /api/rentals?reservationId=&status=out|returned|missing — rental records, newest first.
router.get('/rentals', requireAuth, requireRole(...STAFF), async (req, res) => {
  try {
    const db = await getDb()
    const filter = {}
    if (req.query.reservationId) filter.reservationId = String(req.query.reservationId)
    if (['out', 'returned', 'missing'].includes(String(req.query.status))) filter.status = String(req.query.status)
    const data = await db.collection('rentals').find(filter).sort({ issuedAtISO: -1 }).limit(500).toArray()
    const today = new Date().toISOString().slice(0, 10)
    return res.json({
      ok: true,
      data: data.map((rental) => ({ ...rental, overdue: rental.status === 'out' && String(rental.reservationDate || '') < today })),
    })
  } catch (err) {
    return sendError(res, err)
  }
})

// GET /api/reservations/:id/weapons — the weapons used in a game: rental pieces reserved for the
// booking, pieces checked out at Rentals, and players' own approved weapons, each with its
// current status so staff can mark it available again or flag it for a check.
router.get('/reservations/:id/weapons', requireAuth, requireRole(...STAFF), async (req, res) => {
  try {
    const db = await getDb()
    const reservation = await findById(db, 'reservations', req.params.id)
    if (!reservation) return res.status(404).json({ ok: false, error: 'Reservation not found' })
    const reservationId = keyOf(reservation)
    const [holds, rentals] = await Promise.all([
      db.collection('inventory_holds').find({ reservationId, collection: 'weapons' }).toArray(),
      db.collection('rentals').find({ reservationId, itemCollection: 'weapons' }).sort({ issuedAtISO: 1 }).toArray(),
    ])
    const sources = new Map()
    const add = (itemId, source) => {
      const key = String(itemId || '')
      if (key && !sources.has(key)) sources.set(key, source)
    }
    for (const rental of rentals) add(rental.itemId, 'rental')
    for (const hold of holds) add(hold.itemId, 'rental')
    for (const id of reservation.selectedOwnWeaponIds || []) add(id, 'own')

    const ids = [...sources.keys()]
    const weapons = ids.length
      ? await db.collection('weapons').find({ $or: [{ id: { $in: ids } }, { _id: { $in: ids.filter(ObjectId.isValid).map((id) => new ObjectId(id)) } }] }).toArray()
      : []
    const byKey = new Map(weapons.map((weapon) => [keyOf(weapon), weapon]))
    const data = ids.map((id) => {
      const weapon = byKey.get(id)
      const rental = [...rentals].reverse().find((r) => String(r.itemId) === id)
      return {
        id,
        name: weapon?.name || rental?.itemName || id,
        unitNumber: Number(weapon?.unitNumber) || 0,
        category: weapon?.category || rental?.itemCategory || '',
        status: weapon ? String(weapon.status || 'available') : 'removed',
        source: sources.get(id),
        rentedTo: rental?.playerName || '',
        rentalStatus: rental?.status || '',
      }
    })
    return res.json({ ok: true, data })
  } catch (err) {
    return sendError(res, err)
  }
})

// GET /api/reservations/:id/own-gear — the guns and gear players on this booking bring from home,
// by player: what the booking picked from their registered gear, plus the approved guns of
// anyone who said they'd bring their own gun. The counter leaves those slots out at handout.
// GET /api/reservations/:id/fps-checks — the guns in this game and today's chronograph result for
// each ('pass', 'fail' or 'pending'). The game can only start once every gun has passed.
router.get('/reservations/:id/fps-checks', requireAuth, requireRole(...STAFF), async (req, res) => {
  try {
    const db = await getDb()
    const reservation = await findById(db, 'reservations', req.params.id)
    if (!reservation) return res.status(404).json({ ok: false, error: 'Reservation not found' })
    const status = await gameFpsStatus(db, reservation)
    return res.json({ ok: true, data: { ...status, blockReason: fpsBlockReason(status) } })
  } catch (err) {
    return sendError(res, err)
  }
})

router.get('/reservations/:id/own-gear', requireAuth, requireRole(...STAFF), async (req, res) => {
  try {
    const db = await getDb()
    const reservation = await findById(db, 'reservations', req.params.id)
    if (!reservation) return res.status(404).json({ ok: false, error: 'Reservation not found' })
    const memberIds = [String(reservation.userId || ''), ...(reservation.teamMembers || []).map((m) => String(m.id || ''))].filter(Boolean)
    const bringers = new Set((reservation.ownWeaponBringerIds || []).map(String))
    const pickedIds = {
      weapons: (reservation.selectedOwnWeaponIds || []).map(String),
      equipments: (reservation.selectedOwnEquipmentIds || []).map(String),
    }
    const data = []
    for (const collection of ['weapons', 'equipments']) {
      const docs = memberIds.length
        ? await db.collection(collection).find(
          { source: 'player', submittedBy: { $in: memberIds }, approvalStatus: { $ne: 'rejected' } },
          { projection: { id: 1, name: 1, category: 1, submittedBy: 1, approvalStatus: 1 } },
        ).toArray()
        : []
      for (const doc of docs) {
        const owner = String(doc.submittedBy)
        const picked = pickedIds[collection].includes(String(doc.id))
        // A gun counts when the booking picked it, or when its owner said they'd bring their own
        // gun and it is approved.
        const brought = picked || (collection === 'weapons' && bringers.has(owner) && doc.approvalStatus === 'approved')
        if (!brought) continue
        data.push({ playerId: owner, collection, id: String(doc.id), name: doc.name || 'Own item', category: String(doc.category || '').toLowerCase() })
      }
    }
    return res.json({ ok: true, data, bringerIds: [...bringers] })
  } catch (err) {
    return sendError(res, err)
  }
})

// POST /api/rentals/issue { reservationId, playerName, playerId?, itemCollection, itemId, unitLabel }
router.post('/rentals/issue', requireAuth, requireRole(...GEAR), async (req, res) => {
  const body = req.body || {}
  const itemCollection = String(body.itemCollection || '')
  const playerName = String(body.playerName || '').trim().slice(0, 120)
  if (!RENTAL_COLLECTIONS.includes(itemCollection)) return res.status(400).json({ ok: false, error: 'Choose a weapon or gear item.' })
  if (!playerName) return res.status(400).json({ ok: false, error: 'Enter who is receiving the item.' })
  try {
    const db = await getDb()
    const reservation = await findById(db, 'reservations', body.reservationId)
    if (!reservation) return res.status(404).json({ ok: false, error: 'Reservation not found' })
    const item = await findById(db, itemCollection, body.itemId)
    if (!item) return res.status(404).json({ ok: false, error: 'Item not found' })
    const unitLabel = String(body.unitLabel || '').trim().slice(0, 40)
    // Each piece is its own record, so a piece that is out can't be handed to a second player.
    const alreadyOut = await db.collection('rentals').findOne({ itemId: keyOf(item), status: 'out' })
    if (alreadyOut) return res.status(409).json({ ok: false, error: `${item.name}${alreadyOut.unitLabel ? ` ${alreadyOut.unitLabel}` : ''} is already out with ${alreadyOut.playerName}.` })
    const nowISO = new Date().toISOString()
    const rental = {
      id: await nextShortId(db, 'rentals', 'RNT'),
      reservationId: keyOf(reservation),
      reservationDate: reservation.reservationDate,
      playerName,
      playerId: String(body.playerId || '').trim(),
      itemCollection,
      itemId: keyOf(item),
      itemName: item.name || keyOf(item),
      itemCategory: item.category || '',
      unitLabel,
      status: 'out',
      issuedAtISO: nowISO,
      issuedBy: actorOf(req),
    }
    await db.collection('rentals').insertOne(rental)
    return res.status(201).json({ ok: true, data: rental })
  } catch (err) {
    return sendError(res, err)
  }
})

// PUT /api/rentals/:id/return { condition: 'ok' | 'damaged' | 'missing', note } — damaged or
// missing items open a damage report (for penalty billing) and leave the rental pool.
router.put('/rentals/:id/return', requireAuth, requireRole(...GEAR), async (req, res) => {
  const condition = String(req.body?.condition || '')
  if (!['ok', 'damaged', 'missing'].includes(condition)) return res.status(400).json({ ok: false, error: 'condition must be ok, damaged, or missing' })
  const note = String(req.body?.note || '').trim().slice(0, 300)
  try {
    const db = await getDb()
    const rental = await db.collection('rentals').findOne({ id: String(req.params.id) })
    if (!rental) return res.status(404).json({ ok: false, error: 'Rental not found' })
    if (rental.status !== 'out') return res.status(409).json({ ok: false, error: 'This item was already checked in.' })
    const report = condition === 'ok' ? null : await reportRentalProblem(db, rental, condition, note, req)
    const nowISO = new Date().toISOString()
    const update = {
      status: condition === 'missing' ? 'missing' : 'returned',
      condition,
      returnNote: note,
      returnedAtISO: nowISO,
      returnedBy: actorOf(req),
      ...(report ? { damageReportId: report.id } : {}),
    }
    await db.collection('rentals').updateOne({ _id: rental._id }, { $set: update })
    return res.json({ ok: true, data: { ...rental, ...update }, damageReport: report })
  } catch (err) {
    return sendError(res, err)
  }
})

// ---------------------------------------------------------------------------
// Rental inventory pieces: each physical item is its own record
// ---------------------------------------------------------------------------

// replacementValue is what a lost piece costs to replace; it is the loss penalty.
// stockGrams is the BB stock of an ammo record (ammo is tracked in grams, not pieces), and
// lowStockGrams the level below which staff are told to restock (utils/ammoStock.js).
const PIECE_FIELDS = ['category', 'price', 'replacementValue', 'description', 'note', 'status', 'partnerId', 'fpsClass', 'fpsLimit', 'stockGrams', 'lowStockGrams']
const NUMERIC_PIECE_FIELDS = ['price', 'replacementValue', 'fpsLimit', 'stockGrams', 'lowStockGrams']

function readPieceFields(body) {
  const fields = {}
  for (const key of PIECE_FIELDS) {
    if (body[key] === undefined) continue
    fields[key] = NUMERIC_PIECE_FIELDS.includes(key) ? Math.max(0, Number(body[key]) || 0) : String(body[key] ?? '').trim().slice(0, 500)
  }
  return fields
}

// POST /api/inventory/:collection/pieces { model, count, price, category, ... } — "Mask × 5" creates
// five separate masks, each with its own ID and number.
router.post('/inventory/:collection/pieces', requireAuth, requireRole('admin', 'marshal'), async (req, res) => {
  const collection = String(req.params.collection)
  if (!RENTAL_COLLECTIONS.includes(collection)) return res.status(400).json({ ok: false, error: 'collection must be weapons or equipments' })
  const model = String(req.body?.model || '').trim().slice(0, 80)
  const count = Number(req.body?.count)
  if (!model) return res.status(400).json({ ok: false, error: 'Enter the item name.' })
  if (!Number.isInteger(count) || count < 1 || count > 200) return res.status(400).json({ ok: false, error: 'Add between 1 and 200 pieces at a time.' })
  try {
    const db = await getDb()
    const pieces = await createPieces(db, collection, {
      model,
      count,
      fields: { status: 'available', ...readPieceFields(req.body || {}), createdBy: actorOf(req) },
    })
    return res.status(201).json({ ok: true, data: pieces })
  } catch (err) {
    return sendError(res, err)
  }
})

// PUT /api/inventory/:collection/models { model, price, category, ... } — change shared details
// (like the rental price) on every piece of a model at once. Status stays per piece.
router.put('/inventory/:collection/models', requireAuth, requireRole('admin', 'marshal'), async (req, res) => {
  const collection = String(req.params.collection)
  if (!RENTAL_COLLECTIONS.includes(collection)) return res.status(400).json({ ok: false, error: 'collection must be weapons or equipments' })
  const model = String(req.body?.model || '').trim()
  if (!model) return res.status(400).json({ ok: false, error: 'model is required' })
  const { status, ...fields } = readPieceFields(req.body || {})
  if (!Object.keys(fields).length) return res.status(400).json({ ok: false, error: 'Nothing to update.' })
  try {
    const db = await getDb()
    const result = await db.collection(collection).updateMany(modelFilter(model), { $set: { ...fields, updatedAtISO: new Date().toISOString() } })
    return res.json({ ok: true, updated: result.modifiedCount })
  } catch (err) {
    return sendError(res, err)
  }
})

// ---------------------------------------------------------------------------
// Gunsmith repair log
// ---------------------------------------------------------------------------

router.get('/repairs', requireAuth, requireRole('admin', 'marshal'), async (_req, res) => {
  try {
    const db = await getDb()
    const data = await db.collection('repairs').find({}).sort({ openedAtISO: -1 }).limit(500).toArray()
    return res.json({ ok: true, data })
  } catch (err) {
    return sendError(res, err)
  }
})

// GET /api/repairs/summary — repair counts and spend per item and per model/category.
router.get('/repairs/summary', requireAuth, requireRole('admin', 'marshal'), async (_req, res) => {
  try {
    const db = await getDb()
    const group = (field) => db.collection('repairs').aggregate([
      { $group: { _id: field, repairs: { $sum: 1 }, totalCost: { $sum: { $ifNull: ['$totalCost', 0] } }, open: { $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 1, 0] } } } },
      { $sort: { repairs: -1 } },
    ]).toArray()
    const [byItem, byCategory] = await Promise.all([group('$itemName'), group('$itemCategory')])
    return res.json({
      ok: true,
      data: {
        byItem: byItem.map((row) => ({ name: row._id || 'Unknown', repairs: row.repairs, totalCost: row.totalCost, open: row.open })),
        byCategory: byCategory.map((row) => ({ name: row._id || 'Uncategorized', repairs: row.repairs, totalCost: row.totalCost, open: row.open })),
      },
    })
  } catch (err) {
    return sendError(res, err)
  }
})

// The reservation a repair bills: given directly, or the one its damage report is linked to.
async function findRepairReservation(db, reservationId, damageReportId) {
  const directId = String(reservationId || '').trim()
  if (directId) {
    const reservation = await findById(db, 'reservations', directId)
    if (!reservation) throw Object.assign(new Error('Reservation not found.'), { statusCode: 404 })
    return reservation
  }
  const reportId = String(damageReportId || '').trim()
  if (!reportId) return null
  const report = await db.collection('damage_reports').findOne({ id: reportId })
  if (!report) throw Object.assign(new Error('Damage report not found.'), { statusCode: 404 })
  return report.reservationId ? findById(db, 'reservations', report.reservationId) : null
}

// POST /api/repairs { itemCollection, itemId, damage, gunsmith, damageReportId, reservationId, playerInduced }
// — opens a repair and pulls the item from rental. playerInduced repairs bill the player on completion.
router.post('/repairs', requireAuth, requireRole('admin', 'marshal'), async (req, res) => {
  const body = req.body || {}
  const itemCollection = String(body.itemCollection || '')
  const damage = String(body.damage || '').trim().slice(0, 1000)
  if (!RENTAL_COLLECTIONS.includes(itemCollection)) return res.status(400).json({ ok: false, error: 'Choose a weapon or gear item.' })
  if (!damage) return res.status(400).json({ ok: false, error: 'Describe the damage.' })
  try {
    const db = await getDb()
    const item = await findById(db, itemCollection, body.itemId)
    if (!item) return res.status(404).json({ ok: false, error: 'Item not found' })
    let reservation = null
    try {
      reservation = await findRepairReservation(db, body.reservationId, body.damageReportId)
    } catch (err) {
      return sendError(res, err)
    }
    const nowISO = new Date().toISOString()
    const repair = {
      id: await nextShortId(db, 'repairs', 'RPR'),
      itemCollection,
      itemId: keyOf(item),
      itemName: item.name || keyOf(item),
      itemCategory: item.category || '',
      damage,
      gunsmith: String(body.gunsmith || '').trim().slice(0, 120),
      damageReportId: String(body.damageReportId || '').trim(),
      playerInduced: body.playerInduced === true,
      reservationId: reservation ? keyOf(reservation) : '',
      playerId: reservation ? String(reservation.userId || '') : '',
      status: 'in_progress',
      openedAtISO: nowISO,
      openedBy: actorOf(req),
    }
    await db.collection('repairs').insertOne(repair)
    await db.collection(itemCollection).updateOne(
      { _id: item._id },
      { $set: { status: MAINTENANCE_STATUS[itemCollection], maintenanceReason: `Under repair (${repair.id})`, updatedAtISO: nowISO } },
    )
    return res.status(201).json({ ok: true, data: repair })
  } catch (err) {
    return sendError(res, err)
  }
})

// PUT /api/repairs/:id/complete { partsReplaced, partsCost, laborCost, repairDate, note, returnToService,
// playerInduced, reservationId, penaltyAmount?, overrideReason? } — when the damage was player-induced,
// the penalty rule (repair cost + handling fee) is added to that player's reservation balance.
// Billing a different amount needs an override reason.
router.put('/repairs/:id/complete', requireAuth, requireRole('admin', 'marshal'), async (req, res) => {
  const body = req.body || {}
  const partsCost = money(body.partsCost || 0)
  const laborCost = money(body.laborCost || 0)
  const repairDate = String(body.repairDate || '').trim()
  if (!Number.isFinite(partsCost) || partsCost < 0 || !Number.isFinite(laborCost) || laborCost < 0) {
    return res.status(400).json({ ok: false, error: 'Costs must be zero or more.' })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(repairDate)) return res.status(400).json({ ok: false, error: 'Enter the repair date.' })
  try {
    const db = await getDb()
    const repair = await db.collection('repairs').findOne({ id: String(req.params.id) })
    if (!repair) return res.status(404).json({ ok: false, error: 'Repair not found' })
    if (repair.status !== 'in_progress') return res.status(409).json({ ok: false, error: 'This repair is already closed.' })

    const totalCost = Math.round((partsCost + laborCost) * 100) / 100
    const playerInduced = typeof body.playerInduced === 'boolean' ? body.playerInduced : repair.playerInduced === true
    let reservation = null
    if (playerInduced) {
      reservation = await findRepairReservation(db, body.reservationId || repair.reservationId, repair.damageReportId)
      if (!reservation) {
        return res.status(400).json({ ok: false, error: 'Link the reservation of the player who caused the damage so the repair cost can be billed.' })
      }
    }
    let penaltyAmount = 0
    let penalty = null
    if (playerInduced) {
      const computed = computePenalty({ kind: 'damage', repairCost: totalCost, rules: await getPenaltyRules(db) })
      const resolved = resolvePenaltyCharge(computed, { requestedAmount: body.penaltyAmount, overrideReason: body.overrideReason })
      if (resolved.error) return res.status(400).json({ ok: false, error: resolved.error })
      penaltyAmount = resolved.amount
      penalty = {
        basis: 'damage',
        computedAmount: computed.amount,
        lines: computed.lines,
        overridden: resolved.overridden,
        overrideReason: resolved.overridden ? String(resolved.overrideReason).slice(0, 500) : '',
      }
    }

    const nowISO = new Date().toISOString()
    const update = {
      status: 'completed',
      partsReplaced: String(body.partsReplaced || '').trim().slice(0, 500),
      partsCost,
      laborCost,
      totalCost,
      repairDate,
      completionNote: String(body.note || '').trim().slice(0, 500),
      completedAtISO: nowISO,
      completedBy: actorOf(req),
      playerInduced,
      penaltyAmount,
      ...(penalty ? { penalty } : {}),
      ...(reservation ? { reservationId: keyOf(reservation), playerId: String(reservation.userId || '') } : {}),
    }

    const session = startDbSession()
    try {
      await session.withTransaction(async () => {
        const closed = await db.collection('repairs').updateOne({ _id: repair._id, status: 'in_progress' }, { $set: update }, { session })
        if (closed.modifiedCount === 0) throw Object.assign(new Error('This repair is already closed.'), { statusCode: 409 })
        if (penaltyAmount > 0) {
          await db.collection('reservations').updateOne(
            { _id: reservation._id },
            {
              $inc: { totalAmount: penaltyAmount, balanceAmount: penaltyAmount, damageChargesTotal: penaltyAmount },
              $push: {
                pricingBreakdown: { label: `Repair penalty: ${repair.itemName}`, amount: penaltyAmount },
                damageCharges: { repairId: repair.id, reportId: repair.damageReportId || '', kind: 'damage', itemName: repair.itemName, amount: penaltyAmount, penalty, approvedBy: actorOf(req), atISO: nowISO },
              },
              $set: { updatedAtISO: nowISO },
            },
            { session },
          )
          // The linked damage report is settled by this repair bill.
          if (repair.damageReportId) {
            await db.collection('damage_reports').updateOne(
              { id: repair.damageReportId, status: 'reported' },
              { $set: { status: 'billed', chargeAmount: penaltyAmount, penalty: { ...penalty, repairId: repair.id }, reviewNote: `Billed from repair ${repair.id}`, reviewedAtISO: nowISO, reviewedBy: actorOf(req) } },
              { session },
            )
          }
        }
      })
    } finally {
      await session.endSession()
    }
    if (penaltyAmount > 0) {
      void emailDamageCharge(db, reservation, {
        id: repair.id,
        itemName: repair.itemName,
        chargeAmount: penaltyAmount,
        reviewNote: update.partsReplaced ? `Repair: ${update.partsReplaced}` : '',
      })
    }
    if (body.returnToService !== false) {
      await db.collection(repair.itemCollection).updateOne(
        idFilter(repair.itemId),
        { $set: { status: 'available', updatedAtISO: nowISO }, $unset: { maintenanceReason: '' } },
      )
    }
    return res.json({ ok: true, data: { ...repair, ...update } })
  } catch (err) {
    return sendError(res, err)
  }
})

export default router
