// Checks the seeded demo database for broken references and inconsistent records. Reads only.

import { getPaymentProgress } from '../../utils/paymentRules.js'
import { manilaDay } from './lib.js'

const PAID = ['paid', 'confirmed', 'verified', 'approved', 'succeeded']
const ACTIVE = (p) => !['failed', 'rejected', 'cancelled'].includes(String(p.paymentStatus || p.status || '').toLowerCase())
const FILE_LINK = /\/api\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi

export async function validateDemo(db, { now, todayISO, slotHours }) {
  const errors = []
  const warnings = []
  const err = (msg) => errors.push(msg)
  const all = async (name) => db.collection(name).find({}).toArray()

  const [accounts, waivers, reservations, payments, receipts, gameplay, rentals, holds, repairs, damage, fps, feedback, approvals, checkins, teams, files, weapons, equipments, ledger] = await Promise.all([
    'user_accounts', 'waivers', 'reservations', 'payments', 'receipts', 'gameplay', 'rentals', 'inventory_holds', 'repairs',
    'damage_reports', 'fps_logs', 'feedback', 'guardian_approvals', 'field_checkins', 'team_assignments', 'uploaded_files', 'weapons', 'equipments', 'reach_fund_ledger',
  ].map(all))

  const accountById = new Map(accounts.map((a) => [String(a.id), a]))
  const resById = new Map(reservations.map((r) => [r.id, r]))
  const payById = new Map(payments.map((p) => [p.id, p]))
  const gameById = new Map(gameplay.map((g) => [g.id, g]))
  const itemById = new Map([...weapons.map((w) => [`weapons:${w.id}`, w]), ...equipments.map((e) => [`equipments:${e.id}`, e])])

  // Accounts --------------------------------------------------------------------------------
  const emails = new Map()
  for (const a of accounts) {
    if (!a.emailCanonical) continue
    if (emails.has(a.emailCanonical)) err(`Duplicate email ${a.emailCanonical}`)
    emails.set(a.emailCanonical, a.id)
  }
  if (new Set(accounts.map((a) => String(a.id))).size !== accounts.length) err('Duplicate account ids')
  for (const a of accounts.filter((x) => x.isChildProfile)) {
    if (!accountById.has(String(a.guardianId))) err(`Child ${a.id} has no guardian account`)
  }
  for (const a of accounts.filter((x) => x.role === 'user' && !x.isChildProfile && x.demoSeed)) {
    if (!String(a.password || '').startsWith('$2')) err(`Account ${a.id} has no hashed password`)
  }

  // Waivers -----------------------------------------------------------------------------------
  for (const w of waivers) {
    if (!accountById.has(String(w.userId))) err(`Waiver ${w.id} belongs to a missing account`)
    if (w.status === 'approved' && Date.parse(w.validUntilISO) <= now) err(`Waiver ${w.id} is past its date but still approved`)
  }
  const waiverCovers = (userId, dateISO, createdISO) => waivers.some((w) => String(w.userId) === String(userId)
    && ['approved', 'expired'].includes(w.status) && w.approvedAtISO && w.approvedAtISO <= createdISO
    && manilaDay(Date.parse(w.validUntilISO)) > dateISO)

  // Reservations ------------------------------------------------------------------------------
  for (const r of reservations) {
    const live = r.reservationStatus !== 'cancelled'
    if (!r.walkIn && !accountById.has(String(r.userId))) err(`Reservation ${r.id}: booker ${r.userId} missing`)
    for (const m of r.teamMembers || []) if (!accountById.has(String(m.id))) err(`Reservation ${r.id}: teammate ${m.id} missing`)
    if (r.createdAtISO > new Date(Date.parse(`${r.reservationDate}T${slotHours[r.reservationTime]?.start || '07:00'}:00+08:00`)).toISOString()) err(`Reservation ${r.id} was made after its game started`)
    if (r.createdAtISO > new Date(now).toISOString()) err(`Reservation ${r.id} created in the future`)
    if (live && !r.walkIn) {
      for (const id of [r.userId, ...(r.teamMembers || []).map((m) => m.id)]) {
        if (!waiverCovers(id, r.reservationDate, r.createdAtISO)) err(`Reservation ${r.id}: player ${id} has no waiver covering ${r.reservationDate}`)
      }
      for (const m of (r.teamMembers || []).filter((x) => x.isMinor)) {
        const onTeam = [r.userId, ...(r.teamMembers || []).map((x) => x.id)].includes(m.guardianId)
        if (!onTeam) err(`Reservation ${r.id}: minor ${m.id} without their guardian`)
        const approval = approvals.find((g) => g.reservationId === r.id && g.userId === m.id)
        if (!approval) err(`Reservation ${r.id}: minor ${m.id} has no guardian approval request`)
        else if (r.reservationStatus === 'confirmed' && approval.status !== 'approved') err(`Reservation ${r.id} is confirmed but guardian approval for ${m.id} is ${approval.status}`)
      }
    }
    const mine = payments.filter((p) => p.reservationId === r.id)
    const progress = getPaymentProgress(r, mine)
    if (!r.walkIn && r.paymentState !== progress.state) err(`Reservation ${r.id}: stored payment state ${r.paymentState} but payments say ${progress.state}`)
    const paid = mine.filter((p) => ACTIVE(p) && PAID.includes(String(p.paymentStatus).toLowerCase())).reduce((s, p) => s + p.amount, 0)
    if (paid > Number(r.totalAmount) + 0.01) err(`Reservation ${r.id}: paid ₱${paid} is more than its total ₱${r.totalAmount}`)
    if (r.reservationStatus === 'cancelled') {
      if (progress.state === 'finalized') err(`Reservation ${r.id} is cancelled although fully paid`)
      if (holds.some((h) => h.reservationId === r.id && h.status === 'held')) err(`Reservation ${r.id} is cancelled but still holds inventory`)
      if (mine.some((p) => PAID.includes(String(p.paymentStatus).toLowerCase()))) err(`Reservation ${r.id} is cancelled with a verified payment`)
    }
    if (['pending', 'needs review'].includes(r.reservationStatus) && progress.state !== 'finalized') {
      if (!(r.paymentMode === 'split' && mine.some((p) => String(p.userId) === String(r.userId) && ACTIVE(p))) && Date.parse(r.paymentDueAtISO) < now) {
        err(`Reservation ${r.id} would expire right away (payment window passed)`)
      }
    }
    if (r.reservationStatus === 'confirmed' && progress.state !== 'finalized') err(`Reservation ${r.id} confirmed without its online payment`)
    const games = gameplay.filter((g) => g.reservationId === r.id)
    if (r.reservationStatus === 'confirmed' && games.length !== 1) err(`Reservation ${r.id} is confirmed with ${games.length} game records`)
    if (r.reservationStatus !== 'confirmed' && games.length) err(`Reservation ${r.id} (${r.reservationStatus}) has a game record`)
    const game = games[0]
    if (game?.Status === 'Completed') {
      if (r.reservationDate > todayISO) err(`Game ${game.id} completed before its date`)
      if (Math.abs(paid - Number(r.totalAmount)) > 0.01) err(`Reservation ${r.id}: game completed but paid ₱${paid} of ₱${r.totalAmount}`)
      const session = checkins.find((c) => c._id === `${r.locationId}:${r.reservationDate}:${r.reservationTime}`)
      const keys = r.walkIn ? [`guest:${r.id}:1`] : [r.userId, ...(r.teamMembers || []).map((m) => m.id)].map((id) => `user:${id}`)
      for (const key of keys) if (!session?.players?.[key]) err(`Completed game ${game.id}: ${key} not checked in`)
      if (rentals.some((x) => x.reservationId === r.id && x.status === 'out')) err(`Completed game ${game.id} still has rentals out`)
    }
    if (game?.Status === 'Ongoing' && r.reservationDate !== todayISO) err(`Game ${game.id} ongoing on another day`)
    if (game && game.Status === 'Scheduled' && r.reservationDate < todayISO) err(`Game ${game.id} still scheduled in the past`)
    if (r.paymentMode === 'split' && progress.state === 'finalized' && r.splitShares) {
      for (const [payerId, share] of Object.entries(r.splitShares)) {
        const theirs = mine.filter((p) => ACTIVE(p) && String(p.userId) === payerId && p.kind !== 'onsite').reduce((s, p) => s + p.amount, 0)
        if (Math.abs(theirs - share) > 0.01) err(`Reservation ${r.id}: ${payerId} paid ₱${theirs} online, share is ₱${share}`)
      }
    }
    const captain = accountById.get(String(r.userId))
    const cvsu = captain?.partnershipEligibilityStatus === 'verified'
    const hasDiscount = (r.pricingBreakdown || []).some((l) => /discount \(\d+%\)/i.test(l.label) && /Verified/.test(l.label))
    if (!r.walkIn && r.selectionMode && !(r.rentMode === 'own_all') && cvsu !== hasDiscount) err(`Reservation ${r.id}: CvSU discount ${hasDiscount ? 'applied to a non-verified booker' : 'missing for a verified booker'}`)
  }

  // Payments ------------------------------------------------------------------------------------
  const refs = new Map()
  for (const p of payments) {
    if (!resById.has(p.reservationId)) err(`Payment ${p.id} points to missing reservation ${p.reservationId}`)
    if (p.userId !== 'walk-in' && !accountById.has(String(p.userId))) err(`Payment ${p.id} payer ${p.userId} missing`)
    if (!(p.amount > 0)) err(`Payment ${p.id} has amount ${p.amount}`)
    if (p.transactionReference) {
      const ref = String(p.transactionReference).toLowerCase()
      if (refs.has(ref)) err(`Duplicate payment reference ${ref} (${refs.get(ref)} and ${p.id})`)
      refs.set(ref, p.id)
    }
    if (p.verifiedAtISO && p.verifiedAtISO < p.createdAtISO) err(`Payment ${p.id} verified before it was made`)
    if (p.createdAtISO > new Date(now).toISOString()) err(`Payment ${p.id} is in the future`)
    const r = resById.get(p.reservationId)
    if (r && p.createdAtISO < r.createdAtISO) err(`Payment ${p.id} made before its reservation`)
  }
  if (new Set(payments.map((p) => p.id)).size !== payments.length) err('Duplicate payment ids')

  // Receipts --------------------------------------------------------------------------------------
  for (const rc of receipts) {
    const list = rc.paymentIds.map((id) => payById.get(id))
    if (list.some((p) => !p)) err(`Receipt ${rc.receiptNo} lists a missing payment`)
    if (list.some((p) => p && !PAID.includes(String(p.paymentStatus).toLowerCase()))) err(`Receipt ${rc.receiptNo} covers an unverified payment`)
    const total = list.reduce((s, p) => s + (p?.amount || 0), 0)
    if (Math.abs(total - rc.totalPaid) > 0.01) err(`Receipt ${rc.receiptNo} total ₱${rc.totalPaid} does not match its payments (₱${total})`)
  }
  if (new Set(receipts.map((r) => r.receiptNo)).size !== receipts.length) err('Duplicate receipt numbers')

  // Games, field records ------------------------------------------------------------------------
  for (const g of gameplay) {
    if (!resById.has(g.reservationId)) err(`Game ${g.id} points to a missing reservation`)
    if (g.completedAtISO && g.completedAtISO > new Date(now).toISOString()) err(`Game ${g.id} completed in the future`)
  }
  const out = new Map()
  for (const x of rentals) {
    if (!resById.has(x.reservationId)) err(`Rental ${x.id} points to a missing reservation`)
    if (!itemById.has(`${x.itemCollection}:${x.itemId}`)) err(`Rental ${x.id} points to a missing item ${x.itemId}`)
    if (x.status === 'out') {
      if (out.has(x.itemId)) err(`Item ${x.itemId} is out twice (${out.get(x.itemId)} and ${x.id})`)
      out.set(x.itemId, x.id)
    }
  }
  const slotLoad = new Map()
  for (const h of holds.filter((x) => x.status === 'held' && x.kind !== 'ammo_grams')) {
    const key = `${h.collection}:${h.itemId}:${h.reservationDate}:${h.reservationTime}`
    slotLoad.set(key, (slotLoad.get(key) || 0) + Number(h.quantity || 0))
    if (!resById.has(h.reservationId)) err(`Inventory hold for missing reservation ${h.reservationId}`)
  }
  for (const [key, qty] of slotLoad) {
    const [collection, itemId] = key.split(':')
    const item = itemById.get(`${collection}:${itemId}`)
    const capacity = Number(item?.quantity ?? item?.qty ?? 1) || 1
    if (qty > capacity) err(`Double-booked: ${key} held ${qty} times`)
  }
  for (const rp of repairs) {
    const item = itemById.get(`${rp.itemCollection}:${rp.itemId}`)
    if (!item) err(`Repair ${rp.id} for a missing item`)
    if (rp.status === 'in_progress' && item && !['needs-check', 'maintenance'].includes(item.status)) err(`Repair ${rp.id} is open but ${rp.itemId} is ${item.status}`)
    if (rp.reservationId && !resById.has(rp.reservationId)) err(`Repair ${rp.id} points to a missing reservation`)
  }
  for (const item of [...weapons, ...equipments]) {
    if (['needs-check', 'maintenance'].includes(item.status) && !repairs.some((rp) => rp.itemId === item.id && rp.status === 'in_progress')) {
      warnings.push(`${item.id} is ${item.status} with no open repair`)
    }
  }
  for (const d of damage) {
    if (!resById.has(d.reservationId)) err(`Damage report ${d.id} points to a missing reservation`)
    if (d.repairId && !repairs.some((rp) => rp.id === d.repairId)) err(`Damage report ${d.id} points to a missing repair`)
  }
  for (const l of fps) if (l.gameplayId && !gameById.has(l.gameplayId)) err(`FPS log ${l.id} points to a missing game`)
  const feedbackKeys = new Set()
  for (const f of feedback) {
    if (!gameById.has(f.gameplayId)) err(`Feedback ${f.id} points to a missing game`)
    if (!accountById.has(String(f.userId))) err(`Feedback ${f.id} from a missing account`)
    const key = `${f.userId}:${f.gameplayId}`
    if (feedbackKeys.has(key)) err(`Duplicate feedback ${key}`)
    feedbackKeys.add(key)
  }
  for (const g of approvals) {
    if (!resById.has(g.reservationId)) err(`Guardian approval ${g.id} points to a missing reservation`)
    if (!accountById.get(String(g.userId))?.isChildProfile) err(`Guardian approval ${g.id} is not for a minor`)
  }
  for (const t of teams) {
    const present = new Set(t.presentPlayers.map((p) => p.key))
    for (const key of t.teams.flatMap((x) => x.playerKeys)) if (!present.has(key)) err(`Team assignment ${t._id}: ${key} not present`)
  }

  // Uploaded files referenced anywhere must exist ------------------------------------------------
  const fileIds = new Set(files.map((f) => String(f._id)))
  const collections = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((n) => n !== 'uploaded_files')
  for (const name of collections) {
    const docs = await db.collection(name).find({}).toArray()
    const text = JSON.stringify(docs)
    for (const match of text.matchAll(FILE_LINK)) if (!fileIds.has(match[1])) err(`${name} references a missing uploaded file ${match[1]}`)
  }

  // Money ---------------------------------------------------------------------------------------------
  const sum = (type) => ledger.filter((e) => e.type === type).reduce((s, e) => s + e.amount, 0)
  const reachBalance = sum('allocation') + sum('donation') - sum('expenditure')
  if (reachBalance < 0) err(`REACH fund balance is negative (₱${reachBalance})`)

  // Dashboards read at most 200 records of each.
  if (reservations.length > 200) err(`${reservations.length} reservations: dashboards only read 200`)
  if (payments.length > 200) err(`${payments.length} payments: dashboards only read 200`)

  return { errors, warnings, stats: { reachBalance } }
}
