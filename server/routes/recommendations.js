import express from 'express'
import { ObjectId } from 'mongodb'
import { getDb } from '../db/mongo.js'
import { requireAuth } from '../middleware/auth.js'
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
  if (fixedPlayers > 0 && fixedPlayers !== players) {
    return { ok: false, reason: `Priced for exactly ${fixedPlayers} players.` }
  }
  if (fixedPlayers <= 0 && players < minPlayers) {
    return { ok: false, reason: `Needs at least ${minPlayers} players.` }
  }
  const weaponCount = Math.max(0, wholeNumber(pkg.weaponCount, (pkg.weaponIds || []).length))
  // Settled packages give a fixed number of weapons for the whole group; others are per player.
  const totalWeapons = Number(pkg.settledAmount) > 0 ? weaponCount : weaponCount * players
  const rentalNeeded = Math.max(0, players - ownWeapons)
  if (totalWeapons < rentalNeeded) {
    return { ok: false, reason: `Includes ${totalWeapons} weapon(s); your group needs ${rentalNeeded}.` }
  }
  if (weaponsWanted > 0 && totalWeapons < weaponsWanted) {
    return { ok: false, reason: `Includes ${totalWeapons} weapon(s); you asked for ${weaponsWanted}.` }
  }
  const sizeReason = fixedPlayers > 0 ? `made for groups of ${fixedPlayers}` : `fits groups of ${minPlayers}+`
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

export default router
