import express from 'express'
import { randomUUID } from 'crypto'
import { ObjectId } from 'mongodb'
import { getDb } from '../db/mongo.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { askGemini, buildPrompt, checkSuggestions, gatherSuggestionContext } from '../utils/packageSuggestions.js'
import { calculateBookingPrice } from '../utils/bookingPricing.js'
import { getBookingInventoryRequirements, getHeldQuantities } from '../utils/inventoryHolds.js'

// Budget-based package recommendations. Every quote comes from the same server
// calculator the booking uses (package and item prices, discounts, deposit), and
// each package is checked against current stock — for the chosen date and slot
// when given, so pieces already held by other bookings count as taken.
const router = express.Router()

const SLOT_NAMES = ['morning', 'afternoon', 'evening']
const PRIVATE_MIN_PLAYERS = 10
const MAX_PLAYERS = 400

async function findDocumentById(db, collection, rawId) {
  const id = String(rawId || '').trim()
  if (!id) return null
  const byId = await db.collection(collection).findOne({ id })
  if (byId) return byId
  return ObjectId.isValid(id) ? db.collection(collection).findOne({ _id: new ObjectId(id) }) : null
}

function wholeNumber(value, fallback = 0) {
  const number = Math.round(Number(value))
  return Number.isFinite(number) ? number : fallback
}

// Whether a package suits the group, with the reason either way.
export function packageGroupFit(pkg, { players, ownWeapons, weaponsWanted }) {
  const fixedPlayers = wholeNumber(pkg.players)
  const minPlayers = Math.max(1, wholeNumber(pkg.minPlayers, 1))
  // A set price for 1 player is per player and fits any group; a group price fits exactly N.
  if (fixedPlayers > 1 && fixedPlayers !== players) {
    return { ok: false, reason: `Priced for exactly ${fixedPlayers} players.` }
  }
  if (fixedPlayers <= 1 && players < minPlayers) {
    return { ok: false, reason: `Needs at least ${minPlayers} players.` }
  }
  const weaponCount = Math.max(0, wholeNumber(pkg.weaponCount, (pkg.weaponIds || []).length))
  // Group-priced packages (set for N > 1 players) give a fixed number of weapons for the whole
  // group; everything else, including a per-player set price, is per player.
  const totalWeapons = Number(pkg.settledAmount) > 0 && fixedPlayers > 1 ? weaponCount : weaponCount * players
  const rentalNeeded = Math.max(0, players - ownWeapons)
  if (totalWeapons < rentalNeeded) {
    return { ok: false, reason: `Includes ${totalWeapons} weapon(s); your group needs ${rentalNeeded}.` }
  }
  if (weaponsWanted > 0 && totalWeapons < weaponsWanted) {
    return { ok: false, reason: `Includes ${totalWeapons} weapon(s); you asked for ${weaponsWanted}.` }
  }
  const sizeReason = fixedPlayers > 1 ? `made for groups of ${fixedPlayers}` : `fits groups of ${minPlayers}+`
  return { ok: true, reason: `${totalWeapons} weapon(s) for ${players} player(s); ${sizeReason}.` }
}

// POST /api/package-recommendations
// { budget, players, sessionType: 'public'|'private', ownWeapons, weaponsWanted, date?, slot? }
router.post('/package-recommendations', requireAuth, async (req, res) => {
  const body = req.body || {}
  const budget = Number(body.budget)
  const players = wholeNumber(body.players)
  const sessionType = String(body.sessionType || 'public').toLowerCase() === 'private' ? 'private' : 'public'
  const ownWeapons = Math.max(0, wholeNumber(body.ownWeapons))
  const weaponsWanted = Math.max(0, wholeNumber(body.weaponsWanted))
  const date = String(body.date || '').trim()
  const slot = String(body.slot || '').trim().toLowerCase()

  if (!Number.isFinite(budget) || budget <= 0) return res.status(400).json({ ok: false, error: 'Enter a budget.' })
  if (players < 1 || players > MAX_PLAYERS) return res.status(400).json({ ok: false, error: `Players must be 1 to ${MAX_PLAYERS}.` })
  if (sessionType === 'private' && players < PRIVATE_MIN_PLAYERS) {
    return res.status(400).json({ ok: false, error: `Private sessions need at least ${PRIVATE_MIN_PLAYERS} players.` })
  }
  const slotGiven = Boolean(date || slot)
  if (slotGiven && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !SLOT_NAMES.includes(slot))) {
    return res.status(400).json({ ok: false, error: 'Give both a date (YYYY-MM-DD) and a time slot, or neither.' })
  }

  try {
    const db = await getDb()
    const packages = (await db.collection('packages').find({}).toArray())
      .filter((pkg) => !pkg.status || String(pkg.status).toLowerCase() === 'active')
    const heldQuantities = slotGiven ? await getHeldQuantities(db, { reservationDate: date, reservationTime: slot }) : new Map()
    const userId = req.user.role === 'user' ? String(req.user.id) : null

    const results = []
    for (const pkg of packages) {
      const packageId = String(pkg.id || pkg._id)
      const fit = packageGroupFit(pkg, { players, ownWeapons, weaponsWanted })
      const payload = {
        selectionMode: 'package',
        selectedPackageId: packageId,
        sessionType,
        verifiedOwnWeaponCount: ownWeapons,
      }

      let pricing = null
      let pricingError = ''
      try {
        pricing = await calculateBookingPrice({ db, payload, players, findDocumentById, userId })
        if (!pricing?.pricingVerified) pricingError = pricing?.reason || 'This package cannot be priced.'
      } catch (err) {
        pricingError = err?.message || 'This package cannot be priced.'
      }

      let stock = { ok: true, reason: slotGiven ? `Enough gear is free on ${date} (${slot}).` : 'Enough gear in stock (pick a date and slot to check bookings).' }
      if (!pricingError) {
        try {
          await getBookingInventoryRequirements({ db, payload, players, findDocumentById, heldQuantities })
        } catch (err) {
          stock = { ok: false, reason: err?.message || 'Not enough gear is available.' }
        }
      }

      const total = pricing?.pricingVerified ? pricing.totalAmount : null
      const withinBudget = total !== null && total <= budget
      const reasons = [fit.reason]
      if (total !== null) {
        reasons.push(withinBudget
          ? `₱${total.toLocaleString()} total leaves ₱${Math.round(budget - total).toLocaleString()} of your budget.`
          : `₱${total.toLocaleString()} total is ₱${Math.round(total - budget).toLocaleString()} over your budget.`)
      }
      reasons.push(pricingError || stock.reason)

      results.push({
        packageId,
        name: pkg.name || 'Package',
        fitsGroup: fit.ok,
        withinBudget,
        inStock: !pricingError && stock.ok,
        recommended: fit.ok && withinBudget && !pricingError && stock.ok,
        total,
        perPlayer: total !== null ? Math.round(total / players) : null,
        depositAmount: pricing?.depositAmount ?? null,
        breakdown: pricing?.pricingBreakdown || [],
        reasons,
        unavailableReason: pricingError || (stock.ok ? '' : stock.reason),
      })
    }

    results.sort((a, b) => Number(b.recommended) - Number(a.recommended) || (a.total ?? Infinity) - (b.total ?? Infinity))
    return res.json({
      ok: true,
      data: results,
      query: { budget, players, sessionType, ownWeapons, weaponsWanted, date: slotGiven ? date : null, slot: slotGiven ? slot : null },
    })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// Each Gemini call costs quota, so each admin gets a limited number per hour.
const SUGGESTION_LIMIT_PER_HOUR = 10
const suggestionCalls = new Map()
export function takeSuggestionCall(userId, now = Date.now(), calls = suggestionCalls) {
  const recent = (calls.get(userId) || []).filter((at) => now - at < 3_600_000)
  if (recent.length >= SUGGESTION_LIMIT_PER_HOUR) {
    calls.set(userId, recent)
    return { ok: false, retryInMinutes: Math.max(1, Math.ceil((recent[0] + 3_600_000 - now) / 60_000)) }
  }
  recent.push(now)
  calls.set(userId, recent)
  return { ok: true }
}

// Gemini can take a minute or more, longer than tunnels and proxies keep a request open, so the
// work runs in the background as a job: POST starts it and answers at once, the page checks on it
// with short GETs, and can leave and come back (it keeps the job id) or stop it. Jobs live in
// memory for JOB_TTL_MS; a server restart drops them and the page says to try again.
const JOB_TTL_MS = 30 * 60_000
const suggestionJobs = new Map()

function dropOldJobs(now = Date.now()) {
  for (const [id, job] of suggestionJobs) {
    if (now - job.startedAt > JOB_TTL_MS) {
      job.controller.abort()
      suggestionJobs.delete(id)
    }
  }
}

// What the page sees of a job.
function jobView(id, job) {
  return {
    ok: true,
    jobId: id,
    status: job.status, // running | done | failed | stopped
    startedAt: new Date(job.startedAt).toISOString(),
    ...(job.status === 'done' ? job.result : {}),
    ...(job.status === 'failed' ? { error: job.error } : {}),
  }
}

// The admin's own job, or null.
function ownJob(req) {
  dropOldJobs()
  const job = suggestionJobs.get(String(req.params.jobId || ''))
  return job && job.userId === String(req.user.id) ? job : null
}

export async function runSuggestionJob(job, focus, { db, ask = askGemini, gather = gatherSuggestionContext } = {}) {
  try {
    const context = await gather(db)
    if (!context.weaponModels.length) throw new Error('Add rental weapons to inventory first; the AI builds packages from them.')
    const raw = await ask(buildPrompt(context, { focus }), { signal: job.controller.signal })
    if (job.status !== 'running') return
    const { suggestions, dropped } = checkSuggestions(raw, context)
    job.result = { data: suggestions, dropped, bookingsConsidered: context.bookings.total }
    job.status = 'done'
  } catch (err) {
    if (job.status !== 'running') return
    job.status = job.controller.signal.aborted ? 'stopped' : 'failed'
    job.error = err?.message || String(err)
  }
}

// POST /api/admin/package-suggestions  { focus? }
// Starts finding new package ideas from Gemini, checked against current inventory. Nothing is
// saved: the admin accepts a suggestion on the packages page, which creates a normal package.
// An admin already waiting on a job gets that job back instead of starting (and paying for) another.
router.post('/admin/package-suggestions', requireAuth, requireRole('admin'), async (req, res) => {
  dropOldJobs()
  const userId = String(req.user.id)
  for (const [id, job] of suggestionJobs) {
    if (job.userId === userId && job.status === 'running') return res.status(202).json(jobView(id, job))
  }
  const focus = String(req.body?.focus || '').replace(/\s+/g, ' ').trim().slice(0, 200)
  const allowed = takeSuggestionCall(userId)
  if (!allowed.ok) {
    return res.status(429).json({ ok: false, error: `Too many AI requests. Try again in ${allowed.retryInMinutes} minute(s).` })
  }
  try {
    const db = await getDb()
    const id = randomUUID()
    const job = { userId, status: 'running', startedAt: Date.now(), controller: new AbortController(), result: null, error: '' }
    suggestionJobs.set(id, job)
    void runSuggestionJob(job, focus, { db })
    return res.status(202).json(jobView(id, job))
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) })
  }
})

// GET /api/admin/package-suggestions/:jobId  → the job's status, and its suggestions once done.
router.get('/admin/package-suggestions/:jobId', requireAuth, requireRole('admin'), (req, res) => {
  const job = ownJob(req)
  if (!job) return res.status(404).json({ ok: false, error: 'That suggestion request is gone (the server may have restarted). Try again.' })
  return res.json(jobView(req.params.jobId, job))
})

// POST /api/admin/package-suggestions/:jobId/stop  → stops the job and the Gemini call.
router.post('/admin/package-suggestions/:jobId/stop', requireAuth, requireRole('admin'), (req, res) => {
  const job = ownJob(req)
  if (!job) return res.json({ ok: true })
  if (job.status === 'running') {
    job.status = 'stopped'
    job.controller.abort()
  }
  return res.json(jobView(req.params.jobId, job))
})

export default router
