// Demo bookings: reservations from August up to the coming weeks, with their payments, games,
// check-ins, teams, rentals, FPS checks, damage reports, repairs, receipts and feedback.
//
// Prices, split shares, inventory picks and holds come from the server's own functions
// (utils/bookingPricing.js, utils/splitShares.js, utils/inventoryHolds.js), so every booking
// adds up exactly as one made through the app would.

import { ObjectId } from 'mongodb'
import { calculateBookingPrice } from '../../utils/bookingPricing.js'
import { withSplitShares } from '../../utils/splitShares.js'
import {
  assignCustomPieces, getBookingInventoryRequirements, getHeldQuantities, holdBookingInventory, releaseBookingInventory,
} from '../../utils/inventoryHolds.js'
import { getPaymentProgress } from '../../utils/paymentRules.js'
import { listActiveCauseDays } from '../../utils/causeDays.js'
import { groundIdsForPlayers } from '../../utils/bookingSlots.js'
import { computePenalty, getPenaltyRules } from '../../utils/penaltyRules.js'
import { getExperienceLevel, getAgeGroup, suggestBalancedTeams } from '../../utils/teamBalancing.js'
import { waiverCovers } from './people.js'
import {
  DAY, DEMO_FLAG, HOUR, actor, addDays, ageOn, atManila, counter, dayOfWeek, fieldPlanSvg,
  hhmmToMinutes, isWeekend, manilaDay, minutesToHHMM, reservationIdFrom, round2, uuidFrom,
} from './lib.js'

const LOCATIONS = {
  salawag: { name: 'Chill Shooters (Salawag)', fields: ['salawag-field-1', 'salawag-field-2', 'salawag-field-3'] },
  langkaan: { name: 'Chill Shooters (Langkaan)', fields: ['langkaan-field-1', 'langkaan-field-2', 'langkaan-field-3'] },
  binan: { name: 'BBC Airsoft Binan Laguna', fields: ['binan-field-1', 'binan-field-2'] },
}
const GAME_MODES = ['Team Deathmatch', 'Capture the Flag', 'Search & Destroy (bomb defusal)', 'Domination / King of the Hill', 'VIP Escort', 'Attack & Defend']
const PRICE_CHECK_NOTE = 'Seeded demo booking'

// Who usually plays together. The first is the usual captain.
const GROUPS = [
  { name: 'Bravo Six', members: ['marco', 'juan', 'nathaniel', 'gabriel', 'aaron', 'joshua'], weight: 5 },
  { name: 'CvSU Airsoft Club', members: ['miguel', 'alyssa', 'renz', 'trisha', 'kenneth'], weight: 4 },
  { name: 'Ghost Recon PH', members: ['paolo', 'rafael', 'jerome', 'louie', 'carlo'], weight: 3 },
  { name: 'Tan Family', members: ['vincent', 'lucas', 'mia'], weight: 2 },
  { name: 'Weekend Warriors', members: ['andrea', 'carlo', 'patricia', 'erika', 'camille'], weight: 3 },
  { name: '', members: ['bea', 'kyla'], weight: 2, duo: true },
  { name: '', members: ['camille', 'jerome'], weight: 1, duo: true },
  { name: '', members: ['ivan', 'rhea'], weight: 2, duo: true },
  { name: '', members: ['grace', 'ethan'], weight: 1 },
  { name: '', members: ['hannah'], weight: 2 },
  { name: '', members: ['tomas', 'joshua'], weight: 1 },
  { name: '', members: ['juan'], weight: 2 },
  { name: '', members: ['kenneth', 'renz'], weight: 1 },
]
// Registered guns: these players often bring their own gun and gear (Hybrid).
const OWN_GEAR_PLAYERS = new Set(['paolo', 'rafael', 'jerome', 'louie'])

async function findDocumentById(db, collection, id) {
  const normalized = String(id || '').trim()
  if (!normalized) return null
  const byId = await db.collection(collection).findOne({ id: normalized })
  if (byId) return byId
  return ObjectId.isValid(normalized) ? db.collection(collection).findOne({ _id: new ObjectId(normalized) }) : null
}

export async function seedBookings(ctx) {
  const { db, rng, now, todayISO, slotHours, people, staff, files, historyStart } = ctx
  const { player, byKey, waivers } = people
  // Nothing happens after "now": a time that would fall in the future is moved to a few minutes
  // ago (staggered by `order`, so a team's payments keep their order).
  const past = (ms, order = 1) => Math.min(ms, now - (2 + order * 3) * 60_000)
  const out = {
    reservations: [], payments: [], gameplay: [], receipts: [], rentals: [], fpsLogs: [], damageReports: [],
    repairs: [], feedback: [], guardianApprovals: [], checkins: [], teamAssignments: [], auditLogs: [], notes: [],
  }
  const nextPaymentNo = (() => { let n = 0; return () => { n += 1; return n } })()
  const nextGameplay = counter('GP')
  const nextRental = counter('RNT')
  const nextFps = counter('FPS')
  const nextDamage = counter('DMG')
  const nextRepair = counter('RPR')
  const nextReceipt = counter('OR')
  const nextFeedback = counter('FB')
  const busy = new Map() // `${date}:${slot}` -> Set(player keys)
  const privateTaken = new Set() // `${loc}:${date}:${slot}`
  const publicTaken = new Set()
  const registrars = [staff.registrar, staff.registrar2]
  const marshals = [staff.marshal, staff.marshal2, staff.marshal3]
  const hoursOf = (slot) => slotHours[slot]
  const slotStartMs = (date, slot) => atManila(date, hoursOf(slot).start)
  const slotEndMs = (date, slot) => atManila(date, hoursOf(slot).end)

  const pistols = await db.collection('weapons').find({ source: { $ne: 'player' }, locationId: 'salawag', category: 'pistols', status: 'available' }).sort({ unitNumber: 1 }).toArray()
  const snipers = await db.collection('weapons').find({ source: { $ne: 'player' }, locationId: 'salawag', category: 'snipers', status: 'available' }).sort({ unitNumber: 1 }).toArray()
  const salawagMasks = await db.collection('equipments').find({ locationId: 'salawag', category: 'masks' }).sort({ unitNumber: 1 }).limit(1).toArray()
  const salawagRifles = await db.collection('weapons').find({ source: { $ne: 'player' }, locationId: 'salawag', category: 'rifles', status: 'available' }).sort({ unitNumber: 1 }).limit(1).toArray()

  // ---------------------------------------------------------------------------
  // Who can play when
  // ---------------------------------------------------------------------------
  const eligible = (key, dateISO, createdMs) => {
    const entry = byKey.get(key)
    if (!entry) return false
    const a = entry.account
    if (Date.parse(a.createdAtISO) > createdMs) return false
    if (a.status === 'suspended' && Date.parse(a.suspendedAtISO) <= createdMs) return false
    if (!entry.isChild && !(a.identityVerifiedAtISO && Date.parse(a.identityVerifiedAtISO) <= createdMs)) return false
    const w = waivers.find((x) => x.userId === a.id && x.approvedAtISO && Date.parse(x.approvedAtISO) <= createdMs)
    if (!w) return false
    return waiverCovers(waivers, a.id, dateISO)
  }
  const free = (key, date, slot) => !(busy.get(`${date}:${slot}`)?.has(key))
  const markBusy = (keys, date, slot) => {
    const k = `${date}:${slot}`
    if (!busy.has(k)) busy.set(k, new Set())
    for (const key of keys) busy.get(k).add(key)
  }

  // ---------------------------------------------------------------------------
  // Plan
  // ---------------------------------------------------------------------------
  const specs = []
  const pickGroup = () => {
    const total = GROUPS.reduce((s, g) => s + g.weight, 0)
    let r = rng.next() * total
    for (const g of GROUPS) { r -= g.weight; if (r <= 0) return g }
    return GROUPS[0]
  }
  const planBooking = ({ date, slot, loc, sessionType, group, outcome, createdMs, size, overrides = {} }) => {
    const members = group.members.filter((k) => eligible(k, date, createdMs) && free(k, date, slot))
    // A child plays only with their guardian.
    const keys = members.filter((k) => {
      const e = byKey.get(k)
      return !e.isChild || members.includes([...byKey.entries()].find(([, v]) => v.account.id === e.account.guardianId)?.[0])
    })
    if (!keys.length || byKey.get(keys[0]).isChild) return null
    let chosen = keys
    if (size && keys.length > size) chosen = [keys[0], ...rng.shuffle(keys.slice(1)).slice(0, size - 1)]
    // Children stay with their guardian.
    chosen = chosen.filter((k) => {
      const e = byKey.get(k)
      if (!e.isChild) return true
      const g = [...byKey.entries()].find(([, v]) => v.account.id === e.account.guardianId)?.[0]
      return chosen.includes(g)
    })
    if (group.duo && chosen.length !== 2) return null
    const spec = { date, slot, loc, sessionType, captain: chosen[0], mates: chosen.slice(1), outcome, createdMs, teamName: group.name, duo: group.duo, ...overrides }
    markBusy(chosen, date, slot)
    if (sessionType === 'private') privateTaken.add(`${loc}:${date}:${slot}`)
    else publicTaken.add(`${loc}:${date}:${slot}`)
    specs.push(spec)
    return spec
  }

  // History: August up to yesterday. Weekends are public games, weekdays private bookings.
  const monthFactor = { '08': 0.55, '09': 0.7, '10': 0.85, '11': 0.95 }
  let historyCount = 0
  let staffCancelDone = false
  for (let date = historyStart; date < todayISO; date = addDays(date, 1)) {
    const factor = monthFactor[date.slice(5, 7)] ?? 0.8
    const createdFor = () => atManila(addDays(date, -rng.int(2, 12)), minutesToHHMM(rng.int(8 * 60, 22 * 60)))
    if (isWeekend(date)) {
      const slots = [['salawag', 'morning'], ['salawag', 'afternoon'], ['langkaan', 'afternoon'], ['binan', 'morning'], ['salawag', 'evening']]
      const chances = [0.8, 0.5, 0.32, 0.2, 0.15]
      slots.forEach(([loc, slot], i) => {
        if (!rng.chance(chances[i] * factor)) return
        const roll = rng.next()
        // At least one booking staff cancelled (a duplicate) once the season is under way.
        const staffCancel = !staffCancelDone && date > addDays(historyStart, 45)
        if (staffCancel) staffCancelDone = true
        const outcome = staffCancel ? 'cancelled_staff' : roll < 0.06 ? 'expired' : roll < 0.08 ? 'cancelled_staff' : 'completed'
        const spec = planBooking({ date, slot, loc, sessionType: 'public', group: pickGroup(), outcome, createdMs: createdFor(), size: rng.int(2, 5) })
        if (spec) historyCount += 1
      })
    } else if ([2, 3, 4, 5].includes(dayOfWeek(date)) && rng.chance(0.2 * factor)) {
      const loc = rng.pick(['salawag', 'salawag', 'langkaan'])
      const slot = rng.pick(['afternoon', 'evening'])
      const group = rng.pick(GROUPS.filter((g) => g.members.length >= 3))
      if (!privateTaken.has(`${loc}:${date}:${slot}`)) {
        const spec = planBooking({ date, slot, loc, sessionType: 'private', group, outcome: 'completed', createdMs: createdFor(), size: group.members.length })
        if (spec) historyCount += 1
      }
    }
  }

  // Two walk-ins on past weekends (own gear, paid at the counter).
  const walkIns = []
  {
    let found = 0
    for (let date = addDays(todayISO, -40); date < todayISO && found < 2; date = addDays(date, 1)) {
      if (dayOfWeek(date) !== 6) continue
      walkIns.push({ date, slot: found === 0 ? 'morning' : 'afternoon', loc: 'salawag', name: found === 0 ? 'Rommel Santiago' : 'Jayson Lacson', contact: found === 0 ? '09171234567' : '09281234567' })
      found += 1
    }
  }

  // Today: private games (it's a weekday) whose state follows the clock: done, playing, or later.
  const todayIsWeekend = isWeekend(todayISO)
  const todaySessionType = todayIsWeekend ? 'public' : 'private'
  const todayPlan = [
    { loc: 'salawag', slot: 'morning', group: GROUPS[0], size: 5 },
    { loc: 'langkaan', slot: 'afternoon', group: GROUPS[4], size: 4 },
    { loc: 'salawag', slot: 'evening', group: GROUPS[2], size: 4 },
  ]
  for (const p of todayPlan) {
    const created = atManila(addDays(todayISO, -rng.int(3, 7)), '19:30')
    const start = slotStartMs(todayISO, p.slot)
    const end = slotEndMs(todayISO, p.slot)
    const state = now >= end ? 'completed' : now >= start ? 'ongoing' : 'today_scheduled'
    planBooking({ date: todayISO, slot: p.slot, loc: p.loc, sessionType: todaySessionType, group: p.group, outcome: state, createdMs: created, size: p.size })
  }

  // Upcoming: the next three and a half weeks.
  const upcomingWeekends = []
  for (let date = addDays(todayISO, 1); date <= addDays(todayISO, 26); date = addDays(date, 1)) if (isWeekend(date)) upcomingWeekends.push(date)
  const recent = (hoursAgo) => now - hoursAgo * HOUR
  const firstSat = upcomingWeekends.find((d) => dayOfWeek(d) === 6)
  const firstSun = upcomingWeekends.find((d) => dayOfWeek(d) === 0)
  const special = [
    // A team splitting the payment, still collecting shares (24-hour window, opened 3 hours ago).
    { date: firstSun, slot: 'morning', loc: 'salawag', group: GROUPS[1], outcome: 'pending_split', createdMs: recent(3), size: 5, overrides: { forceSplit: true, invitePending: 'trisha', unpaid: ['renz'] } },
    // A new player's first booking, paid online a few hours ago.
    { date: upcomingWeekends[2] || firstSat, slot: 'afternoon', loc: 'salawag', group: { name: '', members: ['nicole'] }, outcome: 'upcoming', createdMs: recent(5), size: 1 },
    // Paid, waiting for the guardian's approval of a minor.
    { date: firstSat, slot: 'afternoon', loc: 'salawag', group: GROUPS[8], outcome: 'pending_guardian', createdMs: recent(28), size: 2 },
  ]
  for (const s of special) planBooking(s)

  for (const date of upcomingWeekends) {
    const plans = [['salawag', 'morning', 0.9], ['salawag', 'afternoon', 0.7], ['langkaan', 'morning', 0.45], ['binan', 'afternoon', 0.3]]
    for (const [loc, slot, chance] of plans) {
      if (!rng.chance(chance)) continue
      const created = Math.min(now - 2 * HOUR, atManila(addDays(date, -rng.int(3, 18)), minutesToHHMM(rng.int(9 * 60, 21 * 60))))
      planBooking({ date, slot, loc, sessionType: 'public', group: pickGroup(), outcome: 'upcoming', createdMs: Math.max(created, now - 20 * DAY), size: rng.int(2, 5) })
    }
  }
  // Private weekday bookings ahead: one with a custom field plan, one sent back by staff.
  const weekdaysAhead = []
  for (let date = addDays(todayISO, 2); date <= addDays(todayISO, 20); date = addDays(date, 1)) if ([2, 3, 4, 5].includes(dayOfWeek(date))) weekdaysAhead.push(date)
  planBooking({ date: weekdaysAhead[1], slot: 'evening', loc: 'salawag', sessionType: 'private', group: GROUPS[0], outcome: 'upcoming', createdMs: recent(50), size: 6, overrides: { blueprint: true, paymentPlan: 'full' } })
  planBooking({ date: weekdaysAhead[4], slot: 'afternoon', loc: 'langkaan', sessionType: 'private', group: GROUPS[4], outcome: 'needs_review', createdMs: recent(40), size: 4 })
  planBooking({ date: weekdaysAhead[7], slot: 'evening', loc: 'salawag', sessionType: 'private', group: GROUPS[3], outcome: 'upcoming', createdMs: recent(30), size: 3 })

  specs.sort((a, b) => a.createdMs - b.createdMs)

  // ---------------------------------------------------------------------------
  // Build each booking
  // ---------------------------------------------------------------------------
  const causeDays = await listActiveCauseDays(db, {})
  const packages = await db.collection('packages').find({ status: 'active' }).toArray()
  const pkgById = Object.fromEntries(packages.map((p) => [p.id, p]))
  const PKG = { normal: 'PKG-0001', gel: 'PKG-0004', grenadier: 'PKG-0005', duo: 'PKG-0006' }

  const reservationsById = new Map()


  let hybridPickDone = false
  let customDone = 0
  let ownAllDone = false

  for (const spec of specs) {
    const { date, slot, loc, sessionType } = spec
    const captain = player(spec.captain)
    const mates = spec.mates.map(player)
    const playersCount = 1 + mates.length
    const id = reservationIdFrom(`${date}:${slot}:${loc}:${spec.captain}`)
    const createdISO = new Date(spec.createdMs).toISOString()
    const minorMates = mates.filter((m) => m.isChildProfile)
    const adultMates = mates.filter((m) => !m.isChildProfile)

    // What they rent.
    let selectionMode = 'package'
    let rentMode = 'package_all'
    let selectedPackageId = PKG.normal
    let ownGearPlayerIds = []
    let ownGearRentals = {}
    let playerGuns = {}
    let customWeaponIds = []
    let customEquipmentIds = []
    if (spec.duo && playersCount === 2 && rng.chance(0.7)) selectedPackageId = PKG.duo
    else if (loc === 'salawag') selectedPackageId = rng.pick([PKG.normal, PKG.normal, PKG.normal, PKG.gel, PKG.grenadier])
    if (minorMates.length && loc === 'salawag') selectedPackageId = PKG.gel
    const teamKeys = [spec.captain, ...spec.mates]
    const owners = teamKeys.filter((k) => OWN_GEAR_PLAYERS.has(k))
    if (selectedPackageId !== PKG.duo && owners.length && rng.chance(0.7) && ['completed', 'upcoming'].includes(spec.outcome)) {
      rentMode = 'hybrid'
      ownGearPlayerIds = owners.map((k) => player(k).id)
      if (owners.includes('rafael')) ownGearRentals = { [player('rafael').id]: ['mask'] }
      if (!hybridPickDone && loc === 'salawag' && pistols.length && owners.includes('jerome')) {
        // Jerome brings his own sniper but rents a pistol as a sidearm.
        playerGuns = { [player('jerome').id]: [pistols[0].id] }
        hybridPickDone = true
      }
    }
    if (spec.outcome === 'completed' && loc === 'salawag' && customDone < 2 && playersCount <= 3 && !minorMates.length && selectedPackageId === PKG.normal && rng.chance(0.25)) {
      selectionMode = 'custom'
      rentMode = 'custom'
      selectedPackageId = ''
      customWeaponIds = [snipers[0]?.id, salawagRifles[0]?.id].filter(Boolean).slice(0, playersCount)
      customEquipmentIds = playersCount > 1 ? [salawagMasks[0]?.id].filter(Boolean) : []
      customDone += 1
    } else if (!ownAllDone && spec.outcome === 'completed' && teamKeys.every((k) => OWN_GEAR_PLAYERS.has(k)) && playersCount >= 2) {
      selectionMode = 'custom'
      rentMode = 'own_all'
      selectedPackageId = ''
      ownAllDone = true
    }

    const split = spec.forceSplit || (adultMates.length >= 2 && rng.chance(0.38))
    const paymentPlan = spec.paymentPlan || (split ? 'cash_balance' : rng.chance(0.42) ? 'full' : 'cash_balance')

    // Extra reloads, bought per player (a split bills each player's own).
    const extraAmmoByPlayer = {}
    if (rng.chance(0.35)) {
      for (const p of [captain, ...adultMates]) if (rng.chance(0.5)) extraAmmoByPlayer[p.id] = rng.int(1, 3)
    }
    const extraAmmoReloads = Object.values(extraAmmoByPlayer).reduce((s, n) => s + n, 0)

    const doc = {
      userId: captain.id,
      fieldIds: sessionType === 'private' ? LOCATIONS[loc].fields.slice(0, rng.int(1, 2)) : groundIdsForPlayers(loc, playersCount),
      locationId: loc,
      locationName: LOCATIONS[loc].name,
      reservationDate: date,
      reservationTime: slot,
      sessionType,
      numberOfPlayers: playersCount,
      notes: rng.chance(0.15) ? rng.pick(['First time for two of us, please brief us on safety.', 'Birthday game for our captain!', 'We will arrive 30 minutes early.', 'Bringing our own BB loader.']) : '',
      teamName: spec.teamName || null,
      gameModePreference: sessionType === 'public' ? "Marshal's choice" : rng.pick(GAME_MODES),
      layoutRequest: sessionType === 'private' && rng.chance(0.4) ? 'Add more cover near the center and two bunkers per spawn.' : null,
      ...(extraAmmoReloads ? { extraAmmoReloads, extraAmmoByPlayer } : {}),
      reservationStatus: 'pending',
      packageName: selectionMode === 'package' ? pkgById[selectedPackageId].name : rentMode === 'own_all' ? 'Own gear (everyone)' : 'Custom rental',
      selectionMode,
      ...(selectionMode === 'custom' ? { customWeaponIds, customEquipmentIds } : {}),
      teamMembers: mates.map((m) => ({ id: m.id, name: m.name, email: m.email || '', ...(m.isChildProfile ? { isMinor: true, guardianId: m.guardianId } : {}) })),
      selectedTeammateIds: mates.map((m) => m.id),
      paymentMode: split ? 'split' : 'self',
      paymentPlan,
      ownWeaponTarget: 0,
      ownWeaponBringerIds: [],
      ownGearPlayerIds,
      ownGearRentals,
      playerGuns,
      rentMode,
      selectedPackageId: selectedPackageId || undefined,
      selectedGameplayName: selectionMode === 'package' ? pkgById[selectedPackageId].name : undefined,
      fieldId: '',
      bookerName: captain.name,
      bookerEmail: captain.email,
      id,
      createdAtISO: createdISO,
      updatedAtISO: createdISO,
      paymentState: 'awaiting',
      teamSize: split ? 1 + adultMates.length : 1,
      splitPayerIds: split ? adultMates.map((m) => m.id) : [],
      ownWeaponBringers: [],
      verifiedOwnWeaponCount: 0,
      verifiedOwnGearCount: ownGearPlayerIds.length,
      selectedOwnWeaponIds: [],
      ...DEMO_FLAG,
    }
    doc.fieldId = doc.fieldIds[0]
    if (!doc.selectedPackageId) delete doc.selectedPackageId
    if (!doc.selectedGameplayName) delete doc.selectedGameplayName
    if (spec.blueprint) {
      doc.layoutBlueprintUrl = files.add({ key: `plan-${id}`, filename: 'field-plan.svg', svg: fieldPlanSvg({ title: `${spec.teamName || 'Team'} custom layout` }), uploadedBy: captain.id, createdAtISO: createdISO })
      doc.layoutRequest = 'Custom layout attached: two bunkers per spawn, wall line across the middle.'
    }
    const [causeDay] = causeDays.filter((c) => c.dateISO === date)
    if (causeDay) doc.causeDay = { title: causeDay.title, donationPercent: causeDay.donationPercent }

    // Invites: every adult teammate answered (or, for the team still collecting, one hasn't yet).
    doc.invites = adultMates.map((m) => {
      const pending = spec.invitePending && m.id === player(spec.invitePending).id
      return {
        playerId: m.id,
        name: m.name,
        status: pending ? 'pending' : 'accepted',
        invitedAtISO: createdISO,
        deadlineISO: new Date(Math.min(spec.createdMs + 24 * HOUR, slotStartMs(date, slot))).toISOString(),
        ...(pending ? {} : { answeredAtISO: new Date(past(spec.createdMs + rng.int(10, 240) * 60_000)).toISOString() }),
      }
    })

    // Custom picks: the server picks the actual pieces.
    if (selectionMode === 'custom' && rentMode === 'custom') {
      Object.assign(doc, await assignCustomPieces({ db, payload: doc, findDocumentById, heldQuantities: await getHeldQuantities(db, { reservationDate: date, reservationTime: slot }) }))
    }

    // Price, deposit and split shares, exactly as the server works them out.
    Object.assign(doc, await calculateBookingPrice({ db, payload: doc, players: playersCount, findDocumentById, userId: doc.userId }))
    if (doc.paymentPlan === 'full') {
      doc.depositAmount = doc.totalAmount
      doc.balanceAmount = 0
    }
    Object.assign(doc, withSplitShares(doc))
    doc.inventoryRequirements = await getBookingInventoryRequirements({
      db, payload: doc, players: playersCount, findDocumentById,
      heldQuantities: await getHeldQuantities(db, { reservationDate: date, reservationTime: slot }),
    })
    await holdBookingInventory({ db, reservationId: id, requirements: doc.inventoryRequirements, reservationDate: date, reservationTime: slot })

    // ------------------------------------------------------------------ payments
    const payments = []
    const shareOf = (payerId) => {
      const recorded = Number(doc.splitShares?.[payerId])
      if (Number.isFinite(recorded)) return recorded
      return round2(doc.depositAmount / Math.max(1, doc.teamSize))
    }
    const payers = split ? [captain.id, ...doc.splitPayerIds] : [captain.id]
    const paymentKey = (suffix) => uuidFrom(`payment:${id}:${suffix}`)
    const registrar = () => rng.pick(registrars)

    // Online payments go through the payment gateway (GCash or QR Ph on the demo payment page,
    // as in routes/xendit.js): verified by the gateway itself, so no staff review.
    const onlinePayment = ({ payerId, amount, atMs, suffix }) => {
      const channel = rng.pick(['GCash', 'QR Ph', 'GCash'])
      const txn = `DEMO-TXN-${uuidFrom(`txn:${id}:${suffix}`).slice(0, 8).toUpperCase()}`
      return {
        id: `PMT-${paymentKey(suffix)}`, reservationId: id, userId: payerId, amount: round2(amount),
        paymentMethod: `${channel} (demo)`, paymentStatus: 'paid', status: 'paid', kind: 'online',
        xenditInvoiceId: `demo-inv-${uuidFrom(`inv:${id}:${suffix}`)}`, xenditPaymentId: txn, transactionReference: txn,
        verifiedBy: 'demo', demo: true, verifiedAtISO: new Date(atMs).toISOString(), createdAtISO: new Date(atMs).toISOString(), ...DEMO_FLAG,
      }
    }
    const onsitePayment = ({ amount, atMs, suffix, payerId = captain.id, note = '' }) => {
      const by = registrar()
      const cash = rng.chance(0.72)
      const n = nextPaymentNo()
      return {
        id: `PMT-${paymentKey(suffix)}`, reservationId: id, userId: payerId, amount: round2(amount),
        paymentMethod: cash ? 'Cash' : 'GCash', paymentStatus: 'paid', status: 'paid', kind: 'onsite',
        ...(cash ? {} : { transactionReference: `${5000 + (n * 31) % 4000}${String(200000000 + (n * 7193) % 700000000)}` }),
        note, recordedBy: actor(by), verifiedBy: String(by.id), verifiedByRole: by.role,
        verifiedAtISO: new Date(atMs).toISOString(), createdAtISO: new Date(atMs).toISOString(), ...DEMO_FLAG,
      }
    }

    // The online part (deposit, or everything on the "pay in full" plan): each payer pays their share.
    const payDeposits = ({ skip = [] }) => {
      let paidSoFar = 0
      let lastMs = spec.createdMs
      payers.forEach((payerId, index) => {
        const isLast = index === payers.length - 1
        const amount = isLast ? round2(doc.depositAmount - paidSoFar) : shareOf(payerId)
        paidSoFar = round2(paidSoFar + amount)
        if (skip.includes(payerId)) return
        const atMs = past(spec.createdMs + (index === 0 ? rng.int(3, 20) * 60_000 : rng.int(30, 600) * 60_000), payers.length - index)
        const payment = onlinePayment({ payerId, amount, atMs, suffix: `dep-${payerId}` })
        payments.push(payment)
        lastMs = Math.max(lastMs, Date.parse(payment.verifiedAtISO))
      })
      return lastMs
    }

    let confirmedMs = null
    let status = 'pending'
    const statusHistory = []
    const outcome = spec.outcome

    if (outcome === 'expired' || outcome === 'cancelled_staff') {
      // Never fully paid: the slot was released (expired window) or staff cancelled it before payment.
      let cancelMs = spec.createdMs + (split ? 24 : 0.5) * HOUR
      if (outcome === 'cancelled_staff') cancelMs = spec.createdMs + rng.int(1, 6) * HOUR
      const by = outcome === 'cancelled_staff' ? registrar() : null
      const reason = outcome === 'cancelled_staff' ? 'Duplicate booking: the captain booked the same slot twice by mistake.' : 'payment_window_expired'
      status = 'cancelled'
      statusHistory.push({ status: 'cancelled', changedBy: by ? String(by.id) : 'system', changedByRole: by ? by.role : 'system', ...(by ? { changedByName: by.name } : {}), changedAtISO: new Date(cancelMs).toISOString(), reason })
      doc.cancellationReason = reason
      doc.lastStatusChange = { status: 'cancelled', byId: by ? String(by.id) : 'system', byRole: by ? by.role : 'system', byName: by?.name || '', atISO: new Date(cancelMs).toISOString() }
      doc.updatedAtISO = new Date(cancelMs).toISOString()
      if (doc.invites.length && outcome === 'expired') doc.invites = doc.invites.map((inv) => ({ ...inv }))
    } else if (outcome === 'pending_split') {
      payDeposits({ skip: [...(spec.unpaid || []).map((k) => player(k).id), ...(spec.invitePending ? [player(spec.invitePending).id] : [])] })
      doc.paymentDueAtISO = new Date(spec.createdMs + 24 * HOUR).toISOString()
    } else {
      // Paid online and (usually) confirmed.
      const lastPaidMs = payDeposits({})
      doc.paymentDueAtISO = new Date(spec.createdMs + (split ? 24 : 0.5) * HOUR).toISOString()
      if (outcome === 'pending_guardian') {
        status = 'pending'
      } else if (outcome === 'needs_review') {
        confirmedMs = null
        status = 'needs review'
        const by = staff.registrar2
        const atMs = lastPaidMs + 2 * HOUR
        statusHistory.push({ status: 'needs review', changedBy: String(by.id), changedByRole: by.role, changedByName: by.name, changedAtISO: new Date(atMs).toISOString(), reason: 'Sent back to the player' })
        doc.sentBack = { note: 'The Forest field is closed that afternoon for replanting. Please pick Upper or Lower Ground, or another date.', atISO: new Date(atMs).toISOString(), byId: String(by.id), byRole: by.role }
        doc.lastStatusChange = { status: 'needs review', byId: String(by.id), byRole: by.role, byName: by.name, atISO: new Date(atMs).toISOString() }
      } else {
        confirmedMs = lastPaidMs
        status = 'confirmed'
        const gatewayOnly = payments.filter((p) => p.paymentStatus === 'paid').every((p) => p.demo)
        statusHistory.push({ status: 'confirmed', changedBy: 'system', changedByRole: 'system', changedAtISO: new Date(confirmedMs).toISOString(), reason: gatewayOnly ? 'Paid online and verified by the payment gateway' : 'Payments verified by staff' })
        doc.lastStatusChange = { status: 'confirmed', byId: 'system', byRole: 'system', byName: '', atISO: new Date(confirmedMs).toISOString() }
        doc.autoConfirmedAtISO = new Date(confirmedMs).toISOString()
        if (doc.totalAmount - doc.depositAmount > 0) doc.onsiteNoticeSentAtISO = new Date(confirmedMs).toISOString()
      }
    }
    doc.reservationStatus = status
    if (statusHistory.length) doc.statusHistory = statusHistory
    if (split) doc.splitPaidAnnouncedIds = [...new Set(payments.filter((p) => !['rejected'].includes(p.paymentStatus)).map((p) => p.userId))]

    // Guardian approval for each minor on the booking (requested once the booking is made).
    if (minorMates.length) {
      const decided = outcome !== 'pending_guardian' && status !== 'cancelled'
      for (const minor of minorMates) {
        const w = waivers.find((x) => x.userId === minor.id && x.status === 'approved')
        const guardian = byKey.get([...byKey.keys()].find((k) => byKey.get(k).account.id === minor.guardianId)).account
        const decidedISO = new Date(past(spec.createdMs + rng.int(20, 300) * 60_000)).toISOString()
        out.guardianApprovals.push({
          id: `GA-${uuidFrom(`ga:${id}:${minor.id}`)}`,
          token: uuidFrom(`ga-token:${id}:${minor.id}`).replace(/-/g, '') + uuidFrom(`ga-token2:${id}`).replace(/-/g, '').slice(0, 16),
          reservationId: id, userId: minor.id, waiverId: w?.id || '', minorName: minor.name, minorAge: ageOn(minor.birthDate, date),
          guardianName: guardian.name, guardianEmail: guardian.email, status: decided ? 'approved' : 'pending',
          createdAtISO: createdISO,
          ...(decided ? { decidedAtISO: decidedISO, note: 'Approved from the emailed link.', decidedBy: { id: guardian.id, email: guardian.email, role: 'guardian' } } : {}),
          ...DEMO_FLAG,
        })
        if (decided && confirmedMs) confirmedMs = Math.max(confirmedMs, Date.parse(decidedISO))
      }
      const approvals = out.guardianApprovals.filter((g) => g.reservationId === id)
      const approved = approvals.filter((g) => g.status === 'approved').length
      doc.guardianApproval = { required: approvals.length, approved, declined: 0, pending: approvals.length - approved, status: approved === approvals.length ? 'approved' : 'pending' }
      if (status === 'confirmed') {
        doc.statusHistory[doc.statusHistory.length - 1].changedAtISO = new Date(confirmedMs).toISOString()
        doc.lastStatusChange.atISO = new Date(confirmedMs).toISOString()
        doc.autoConfirmedAtISO = new Date(confirmedMs).toISOString()
      }
    }

    // ------------------------------------------------------------------ the game
    let gameplay = null
    if (status === 'confirmed') {
      const confirmedISO = new Date(confirmedMs).toISOString()
      gameplay = {
        Game: doc.packageName, Schedule: `${date} • ${slot}`, Mode: doc.gameModePreference, Group: sessionType,
        Package: doc.packageName, LocationId: loc, Location: LOCATIONS[loc].name, LayoutRequest: doc.layoutRequest || '',
        LayoutBlueprintUrl: doc.layoutBlueprintUrl || '', Notes: doc.notes || '', Status: 'Scheduled',
        Actions: { canStart: true, canComplete: false, canDelete: false }, userId: captain.id, reservationId: id,
        createdAtISO: confirmedISO, updatedAtISO: confirmedISO, id: nextGameplay(), ...DEMO_FLAG,
      }
      out.gameplay.push(gameplay)
    }

    const played = ['completed', 'ongoing'].includes(outcome) && status === 'confirmed'
    if (played) {
      const startMs = slotStartMs(date, slot)
      const endMs = slotEndMs(date, slot)
      const marshal = rng.pick(marshals)
      const checkInMs = startMs - rng.int(15, 40) * 60_000
      // The rest of the bill is paid at the counter at check-in.
      const balance = round2(doc.totalAmount - doc.depositAmount)
      if (balance > 0) payments.push(onsitePayment({ amount: balance, atMs: checkInMs + 5 * 60_000, suffix: 'balance', note: 'Balance paid at check-in' }))
      // Rental pieces handed out per player (package pieces, picked guns, single pieces).
      const roster = [captain, ...mates]
      const pieces = [...doc.inventoryRequirements].filter((r) => r.kind !== 'ammo_grams')
      const issued = []
      for (const r of pieces) {
        const holder = roster[issued.length % roster.length]
        const item = await findDocumentById(db, r.collection, r.itemId)
        issued.push({ r, holder, item })
      }
      const gameOver = outcome === 'completed'
      for (const { r, holder, item } of issued) {
        const rental = {
          id: nextRental(), reservationId: id, reservationDate: date, playerName: holder.name, playerId: holder.id, playerKey: `user:${holder.id}`,
          itemCollection: r.collection, itemId: r.itemId, itemName: item?.name || r.name, itemCategory: item?.category || '', unitLabel: '',
          status: gameOver ? 'returned' : 'out', autoAssigned: true, issuedAtISO: new Date(checkInMs + 2 * 60_000).toISOString(),
          issuedBy: actor(marshal), ...DEMO_FLAG,
        }
        if (gameOver) Object.assign(rental, { condition: 'ok', returnNote: '', returnedAtISO: new Date(endMs - 12 * 60_000).toISOString(), returnedBy: actor(marshal) })
        out.rentals.push(rental)
        // Every gun is chronographed before the game.
        if (r.collection === 'weapons' && item && String(item.category) !== 'grenades') {
          const cls = String(item.fpsClass || '').toLowerCase() === 'sniper' || String(item.category).startsWith('sniper') ? 'sniper' : 'aeg'
          const limit = cls === 'sniper' ? 550 : 450
          out.fpsLogs.push({
            id: nextFps(), weaponId: r.itemId, weaponName: item.name, weaponClass: cls, fps: rng.int(limit - 70, limit - 8), limit, result: 'pass',
            playerName: holder.name, gameplayId: gameplay.id, notes: '', testedAtISO: new Date(checkInMs + 8 * 60_000).toISOString(), testedBy: actor(marshal), ...DEMO_FLAG,
          })
        }
      }
      // Players' own guns are chronographed too.
      for (const ownerId of doc.ownGearPlayerIds) {
        if ((doc.playerGuns?.[ownerId] || []).length) continue
        const owner = roster.find((p) => p.id === ownerId)
        const registered = people.ownWeapons.find((w) => w.submittedBy === ownerId)
        const cls = registered && registered.category === 'snipers' ? 'sniper' : 'aeg'
        const limit = cls === 'sniper' ? 550 : 450
        out.fpsLogs.push({
          id: nextFps(), weaponId: `own:${id}:${ownerId}`, weaponName: registered?.name || 'Own gun', weaponClass: cls, fps: rng.int(limit - 60, limit - 5), limit, result: 'pass',
          playerName: owner?.name || '', gameplayId: gameplay.id, notes: 'Player-owned', testedAtISO: new Date(checkInMs + 10 * 60_000).toISOString(), testedBy: actor(marshal), ...DEMO_FLAG,
        })
      }
      const startedMs = startMs + rng.int(2, 12) * 60_000
      Object.assign(gameplay, {
        Status: gameOver ? 'Completed' : 'Ongoing', startedAtISO: new Date(startedMs).toISOString(), startedBy: actor(marshal),
        Actions: { canStart: false, canComplete: !gameOver, canDelete: false }, updatedAtISO: new Date(gameOver ? endMs - 10 * 60_000 : startedMs).toISOString(),
        ...(gameOver ? { completedAtISO: new Date(endMs - 10 * 60_000).toISOString(), completedBy: actor(marshal) } : {}),
      })
      // Extra reloads bought at the field, paid after the game.
      if (gameOver && rng.chance(0.18)) {
        const qty = rng.int(1, 3)
        const amount = qty * 50
        const atISO = new Date(startMs + 90 * 60_000).toISOString()
        doc.extraCharges = [{ id: `CHG-${uuidFrom(`chg:${id}`).slice(0, 8).toUpperCase()}`, type: 'ammo_reload', label: `Extra ammo reload${qty > 1 ? ` × ${qty}` : ''}`, quantity: qty, unitPrice: 50, amount, note: '', addedBy: actor(marshal), atISO }]
        doc.totalAmount = round2(doc.totalAmount + amount)
        doc.balanceAmount = round2(doc.balanceAmount + amount)
        doc.extraChargesTotal = amount
        doc.pricingBreakdown = [...(doc.pricingBreakdown || []), { label: doc.extraCharges[0].label, amount }]
        payments.push(onsitePayment({ amount, atMs: endMs - 5 * 60_000, suffix: 'extras', note: 'Additional charges after the game' }))
      }
      out.sessions = out.sessions || []
      out.sessions.push({ loc, date, slot, reservation: doc, roster, marshal, checkInMs, gameOver })
    }

    // Upcoming and today's not-yet-started games: deposit in; balance at the field.
    const progress = getPaymentProgress(doc, payments)
    doc.paymentState = progress.state
    doc.paymentSubmittedAmount = progress.submitted
    doc.paymentVerifiedAmount = progress.verified

    if (status === 'cancelled') await releaseBookingInventory(db, id)

    out.reservations.push(doc)
    out.payments.push(...payments)
    reservationsById.set(id, { doc, spec, payments, gameplay })
  }

  // ---------------------------------------------------------------------------
  // Walk-ins (own gear, paid in cash at the counter)
  // ---------------------------------------------------------------------------
  for (const w of walkIns) {
    const id = reservationIdFrom(`walkin:${w.date}:${w.name}`)
    const atMs = slotStartMs(w.date, w.slot) - 25 * 60_000
    const by = staff.registrar
    const doc = {
      id, userId: 'walk-in', walkIn: true, walkInName: w.name, walkInContact: w.contact,
      locationId: w.loc, locationName: LOCATIONS[w.loc].name, reservationDate: w.date, reservationTime: w.slot,
      sessionType: 'public', numberOfPlayers: 1, fieldIds: groundIdsForPlayers(w.loc, 1), fieldId: `${w.loc}-field-1`,
      selectionMode: 'custom', customWeaponIds: [], customEquipmentIds: [], packageName: 'Walk-in (own gear)',
      paymentMode: 'self', teamSize: 1, teamMembers: [], notes: '', reservationStatus: 'confirmed',
      createdAtISO: new Date(atMs).toISOString(), updatedAtISO: new Date(atMs).toISOString(), createdBy: { id: String(by.id), role: by.role },
      statusHistory: [{ status: 'confirmed', changedBy: String(by.id), changedByRole: by.role, changedAtISO: new Date(atMs).toISOString(), reason: 'walk_in' }],
      ...DEMO_FLAG,
    }
    Object.assign(doc, await calculateBookingPrice({ db, payload: doc, players: 1, findDocumentById, userId: null }))
    const payment = {
      id: `PMT-${uuidFrom(`payment:${id}:walkin`)}`, reservationId: id, userId: 'walk-in', amount: doc.totalAmount,
      paymentMethod: 'Cash', paymentStatus: 'paid', status: 'paid', kind: 'onsite',
      recordedBy: { actorId: String(by.id), actorRole: by.role }, verifiedBy: String(by.id), verifiedByRole: by.role,
      verifiedAtISO: new Date(atMs).toISOString(), createdAtISO: new Date(atMs).toISOString(), ...DEMO_FLAG,
    }
    const progress = getPaymentProgress(doc, [payment])
    Object.assign(doc, { paymentState: progress.state, paymentSubmittedAmount: progress.submitted, paymentVerifiedAmount: progress.verified })
    const marshal = rng.pick(marshals)
    const endMs = slotEndMs(w.date, w.slot)
    const gp = {
      id: nextGameplay(), Game: doc.packageName, Schedule: `${w.date} • ${w.slot}`, Mode: "Marshal's choice", Group: '1 players (walk-in)',
      Package: doc.packageName, LayoutRequest: '', Notes: '', Status: 'Completed', Actions: { canStart: false, canComplete: false, canDelete: false },
      userId: 'walk-in', reservationId: id, createdAtISO: doc.createdAtISO, updatedAtISO: new Date(endMs - 10 * 60_000).toISOString(),
      startedAtISO: new Date(slotStartMs(w.date, w.slot) + 5 * 60_000).toISOString(), completedAtISO: new Date(endMs - 10 * 60_000).toISOString(), completedBy: actor(marshal), ...DEMO_FLAG,
    }
    out.fpsLogs.push({ id: nextFps(), weaponId: `own:${id}:walk-in`, weaponName: 'Own gun', weaponClass: 'aeg', fps: rng.int(380, 440), limit: 450, result: 'pass', playerName: w.name, gameplayId: gp.id, notes: 'Walk-in, own gear', testedAtISO: new Date(atMs + 10 * 60_000).toISOString(), testedBy: actor(marshal), ...DEMO_FLAG })
    out.reservations.push(doc)
    out.payments.push(payment)
    out.gameplay.push(gp)
    out.sessions = out.sessions || []
    out.sessions.push({ loc: w.loc, date: w.date, slot: w.slot, reservation: doc, roster: [], marshal, checkInMs: atMs, gameOver: true, walkIn: w })
  }

  // ---------------------------------------------------------------------------
  // Game day records per session: check-ins and teams (public games share a session)
  // ---------------------------------------------------------------------------
  const sessionMap = new Map()
  for (const s of out.sessions || []) {
    const key = `${s.loc}:${s.date}:${s.slot}`
    if (!sessionMap.has(key)) sessionMap.set(key, [])
    sessionMap.get(key).push(s)
  }
  const gamesPlayed = new Map()
  const gameDates = [...sessionMap.keys()].sort((a, b) => a.split(':')[1].localeCompare(b.split(':')[1]))
  for (const key of gameDates) {
    const group = sessionMap.get(key)
    const [loc, date, slot] = key.split(':')
    const players = {}
    const present = []
    for (const s of group) {
      const by = rng.pick(registrars)
      const entries = s.walkIn
        ? [{ key: `guest:${s.reservation.id}:1`, id: '', name: s.walkIn.name, guest: true, age: null, games: 0 }]
        : s.roster.map((p) => ({ key: `user:${p.id}`, id: p.id, name: p.name, guest: false, age: ageOn(p.birthDate, date), games: (gamesPlayed.get(p.id) || 0) + Number(p.experienceAdjustment || 0) }))
      entries.forEach((e, i) => {
        players[e.key] = { atISO: new Date(s.checkInMs + i * 60_000).toISOString(), ...actor(by) }
        present.push({ key: e.key, id: e.id, name: e.name, guest: e.guest, gamesPlayed: e.games, experienceLevel: getExperienceLevel(e.games), ageGroup: getAgeGroup(e.age), reservationId: s.reservation.id })
      })
    }
    const lastCheckIn = Math.max(...Object.values(players).map((p) => Date.parse(p.atISO)))
    out.checkins.push({ _id: key, date, location: loc, slot, players, updatedAtISO: new Date(lastCheckIn).toISOString(), ...DEMO_FLAG })
    if (present.length >= 4) {
      const teams = suggestBalancedTeams(present.map((p) => ({ ...p, experience: p.gamesPlayed })), 2)
        .map((t) => ({ name: t.name, color: t.color, playerKeys: t.playerKeys }))
      const marshal = group[0].marshal
      out.teamAssignments.push({ _id: key, date, location: loc, slot, presentPlayers: present, teams, savedAtISO: new Date(lastCheckIn + 4 * 60_000).toISOString(), savedBy: actor(marshal), ...DEMO_FLAG })
    }
    for (const s of group) if (s.gameOver) for (const p of s.roster) gamesPlayed.set(p.id, (gamesPlayed.get(p.id) || 0) + 1)
  }

  // ---------------------------------------------------------------------------
  // Damage: one repair finished and billed, one still at the gunsmith
  // ---------------------------------------------------------------------------
  const completedSessions = (out.sessions || []).filter((s) => s.gameOver && !s.walkIn).sort((a, b) => a.date.localeCompare(b.date))
  const rules = await getPenaltyRules(db)
  const damageCase = async (session, { finished }) => {
    const res = session.reservation
    const rental = out.rentals.find((r) => r.reservationId === res.id && r.itemCollection === 'weapons')
    if (!rental) return
    const marshal = session.marshal
    const returnedISO = rental.returnedAtISO
    const report = {
      id: nextDamage(), itemType: 'weapon', itemId: rental.itemId, itemName: rental.itemName, reservationId: res.id,
      playerId: rental.playerId, playerName: rental.playerName, rentalId: rental.id,
      description: finished ? 'Returned damaged. Hop-up unit cracked after a fall.' : 'Returned damaged. Gearbox jams after a few shots.',
      evidenceUrl: '', status: 'reported', chargeAmount: 0, reportedAtISO: returnedISO, reportedBy: actor(marshal), ...DEMO_FLAG,
    }
    const repair = {
      id: nextRepair(), itemCollection: 'weapons', itemId: rental.itemId, itemName: rental.itemName, itemCategory: '',
      damage: report.description, gunsmith: finished ? 'Mang Ben (Dasmariñas)' : 'In-house tech', damageReportId: report.id,
      playerInduced: true, reservationId: res.id, playerId: rental.playerId, status: 'in_progress', openedAtISO: returnedISO, openedBy: actor(marshal), ...DEMO_FLAG,
    }
    report.repairId = repair.id
    Object.assign(rental, { condition: 'damaged', returnNote: finished ? 'Hop-up cracked' : 'Gearbox jams', damageReportId: report.id })
    if (finished) {
      const partsCost = 450
      const laborCost = 300
      const repairDate = addDays(session.date, 6)
      const doneISO = new Date(atManila(repairDate, '16:00')).toISOString()
      const computed = computePenalty({ kind: 'damage', repairCost: partsCost + laborCost, rules })
      const penalty = { basis: 'damage', computedAmount: computed.amount, lines: computed.lines, overridden: false, overrideReason: '' }
      Object.assign(repair, {
        status: 'completed', partsReplaced: 'Hop-up unit, bucking', partsCost, laborCost, totalCost: partsCost + laborCost, repairDate,
        completionNote: 'Tested at 420 FPS after repair.', completedAtISO: doneISO, completedBy: actor(staff.marshal2), penaltyAmount: computed.amount, penalty,
      })
      report.status = 'charged'
      report.chargeAmount = computed.amount
      res.totalAmount = round2(res.totalAmount + computed.amount)
      res.balanceAmount = round2(res.balanceAmount + computed.amount)
      res.damageChargesTotal = computed.amount
      res.pricingBreakdown = [...(res.pricingBreakdown || []), { label: `Repair penalty: ${repair.itemName}`, amount: computed.amount }]
      res.damageCharges = [{ repairId: repair.id, reportId: report.id, kind: 'damage', itemName: repair.itemName, amount: computed.amount, penalty, approvedBy: actor(staff.marshal2), atISO: doneISO }]
      // The player settled the penalty on their next visit.
      const payMs = atManila(addDays(repairDate, 2), '10:30')
      const payment = {
        id: `PMT-${uuidFrom(`payment:${res.id}:penalty`)}`, reservationId: res.id, userId: res.userId, amount: computed.amount,
        paymentMethod: 'Cash', paymentStatus: 'paid', status: 'paid', kind: 'onsite', note: 'Repair penalty',
        recordedBy: actor(staff.registrar), verifiedBy: String(staff.registrar.id), verifiedByRole: 'registrar',
        verifiedAtISO: new Date(payMs).toISOString(), createdAtISO: new Date(payMs).toISOString(), ...DEMO_FLAG,
      }
      out.payments.push(payment)
      out.expenseHints = [...(out.expenseHints || []), { dateISO: repairDate, amount: partsCost + laborCost, description: `Repair ${repair.id}: ${repair.itemName}` }]
    } else {
      await db.collection('weapons').updateOne({ id: rental.itemId }, { $set: { status: 'needs-check', maintenanceReason: `Under repair (${repair.id}) after rental ${rental.id}`, updatedAtISO: returnedISO } })
    }
    out.damageReports.push(report)
    out.repairs.push(repair)
  }
  const finishedCase = completedSessions.find((s) => s.date < addDays(todayISO, -25) && s.date > addDays(todayISO, -60))
  const openCase = [...completedSessions].reverse().find((s) => s.date < todayISO && s.date > addDays(todayISO, -10) && s !== finishedCase)
  if (finishedCase) await damageCase(finishedCase, { finished: true })
  if (openCase) await damageCase(openCase, { finished: false })

  // An FPS failure: a rental rifle tested hot, was pulled, fixed and passed the next week.
  const hot = out.fpsLogs.find((l) => l.weaponClass === 'aeg' && !String(l.weaponId).startsWith('own:') && Date.parse(l.testedAtISO) < now - 30 * DAY)
  if (hot) {
    const failedISO = new Date(Date.parse(hot.testedAtISO) - 3 * 60_000).toISOString()
    out.fpsLogs.push({ ...hot, id: nextFps(), fps: 472, result: 'fail', notes: 'Over the AEG limit; swapped for another unit before the game.', testedAtISO: failedISO })
    out.repairs.push({
      id: nextRepair(), itemCollection: 'weapons', itemId: hot.weaponId, itemName: hot.weaponName, itemCategory: 'rifles',
      damage: 'Shooting over the 450 FPS limit (472 FPS).', gunsmith: 'In-house tech', damageReportId: '', playerInduced: false,
      reservationId: '', playerId: '', status: 'completed', openedAtISO: failedISO, openedBy: hot.testedBy,
      partsReplaced: 'Spring downgraded to M100', partsCost: 180, laborCost: 0, totalCost: 180, repairDate: manilaDay(Date.parse(failedISO) + 2 * DAY),
      completionNote: 'Re-tested at 418 FPS.', completedAtISO: new Date(Date.parse(failedISO) + 2 * DAY).toISOString(), completedBy: actor(staff.marshal2), penaltyAmount: 0, ...DEMO_FLAG,
    })
    out.expenseHints = [...(out.expenseHints || []), { dateISO: manilaDay(Date.parse(failedISO) + 2 * DAY), amount: 180, description: `FPS fix: ${hot.weaponName}` }]
  }

  // ---------------------------------------------------------------------------
  // Receipts (players asked for one) and feedback after games
  // ---------------------------------------------------------------------------
  for (const r of out.reservations) {
    if (r.walkIn || r.reservationStatus !== 'confirmed') continue
    const game = out.gameplay.find((g) => g.reservationId === r.id)
    if (game?.Status !== 'Completed') continue
    const paid = out.payments.filter((p) => p.reservationId === r.id && p.paymentStatus === 'paid')
    if (rng.chance(0.45)) {
      const payerIds = [...new Set(paid.map((p) => p.userId))]
      for (const payerId of payerIds) {
        const mine = paid.filter((p) => p.userId === payerId)
        const paymentIds = mine.map((p) => p.id).sort()
        const receiptNo = nextReceipt()
        const issued = new Date(past(Date.parse(game.completedAtISO) + rng.int(1, 30) * HOUR)).toISOString()
        out.receipts.push({
          receiptNo, id: receiptNo, reservationId: r.id, payerId, paymentIds, paymentKey: paymentIds.join(','),
          totalPaid: round2(mine.reduce((s, p) => s + p.amount, 0)), reservationTotal: r.totalAmount, issuedAtISO: issued,
          issuedBy: { actorId: payerId, actorRole: 'user' }, ...DEMO_FLAG,
        })
        for (const p of mine) p.receiptNos = [...(p.receiptNos || []), receiptNo]
      }
    }
    const raters = [r.userId, ...(r.teamMembers || []).filter((m) => !m.isMinor).map((m) => m.id)].filter(() => rng.chance(0.3))
    for (const userId of raters) {
      const good = rng.chance(0.8)
      const rate = () => (good ? rng.int(4, 5) : rng.int(2, 4))
      out.feedback.push({
        id: nextFeedback(), gameplayId: game.id, reservationRating: rate(), cleanlinessRating: rate(), equipmentRating: rate(),
        layoutRating: rate(), staffRating: good ? 5 : rng.int(3, 4),
        comment: good
          ? rng.pick(['Super fun game, marshals were very helpful!', 'Well-maintained guns and masks. Will come back with the barkada.', 'Great field layout, the forest area is the best.', 'Smooth check-in and fair teams.', 'Sulit! The package had everything we needed.'])
          : rng.pick(['Mask fogged a lot, maybe add anti-fog spray.', 'Game started 15 minutes late.', 'Comfort room near the field needs cleaning.']),
        userId, status: 'submitted', createdAtISO: new Date(past(Date.parse(game.completedAtISO) + rng.int(1, 20) * HOUR)).toISOString(), ...DEMO_FLAG,
      })
    }
  }

  // A booking moved by the player (shown in its history and the audit log).
  const movable = out.reservations.find((r) => r.reservationStatus === 'confirmed' && r.reservationDate > addDays(todayISO, 6) && !r.walkIn && r.sessionType === 'public')
  if (movable) {
    const fromDate = addDays(movable.reservationDate, -7)
    const atISO = new Date(now - 3 * DAY).toISOString()
    const event = { fromDate, fromTime: movable.reservationTime, toDate: movable.reservationDate, toTime: movable.reservationTime, fieldIds: movable.fieldIds, reason: 'Out of town that weekend', actorId: movable.userId, actorRole: 'user', atISO }
    movable.rescheduleHistory = [event]
    out.auditLogs.push({ action: 'reservation_rescheduled', resourceType: 'reservations', resourceId: movable.id, actorId: movable.userId, actorRole: 'user', details: event, createdAtISO: atISO, ...DEMO_FLAG })
  }

  delete out.sessions
  return out
}

export { findDocumentById, LOCATIONS, PRICE_CHECK_NOTE }
