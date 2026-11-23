// What each payer owes in a split payment when the players don't all get the same thing.
//
// With a package, the person who booked chooses for each player: the full package, their own gun
// (rent the rest), or their own gun and gear (entrance fee only), and how many extra ammo reloads
// each one buys. Each payer's share of the online amount is in proportion to what they get, e.g.
// ₱550 for a package player and ₱200 for one who only pays the entrance fee, instead of the same
// amount for everyone.
//
// Children don't pay: their parent or guardian on the team pays for them. A child whose guardian
// isn't paying is spread over the payers in the same proportion.
// Returns { [payerId]: amount } (amounts add up to the online amount), or null when an even split
// is right: no per-player costs, or everyone gets the same.

import { rentOnlyOf } from './ownGearRentals.js'

const round2 = (value) => Math.round(value * 100) / 100

export function loadoutOf(reservation, playerId) {
  const id = String(playerId)
  if ((reservation.ownGearPlayerIds || []).map(String).includes(id)) return 'own_gear'
  const ownGun = (reservation.ownWeaponBringers || []).some((b) => String(b?.userId) === id && b?.verified)
  return ownGun ? 'own_gun' : 'package'
}

export function computeSplitShares(reservation) {
  const costs = reservation.loadoutUnitCosts
  if (String(reservation.paymentMode || 'self').toLowerCase() !== 'split' || !costs) return null
  const payers = [String(reservation.userId), ...(reservation.splitPayerIds || []).map(String)]
    .filter((id, index, all) => id && all.indexOf(id) === index)
  if (payers.length < 2) return null

  // What each payer gets, plus the extra ammo reloads they bought for themselves.
  const ammoOf = (id) => Math.max(0, Math.round(Number(reservation.extraAmmoByPlayer?.[id]) || 0)) * Math.max(0, Number(costs.ammo) || 0)
  // A player not taking the package also pays for the single pieces they rent (gun, mask, vest).
  const singlesOf = (id) => rentOnlyOf(reservation, id).reduce((sum, piece) => sum + Math.max(0, Number(costs[`rent_${piece}`]) || 0), 0)
  // And for the guns they picked themselves.
  const gunsOf = (id) => Math.max(0, Number(reservation.playerGunCosts?.[id]) || 0)
  const costOf = (id) => Math.max(0, Number(costs[loadoutOf(reservation, id)]) || 0) + singlesOf(id) + gunsOf(id) + ammoOf(id)
  // A minor doesn't pay: their parent or guardian on the team pays for them, on top of their own
  // share. A minor whose guardian isn't paying is spread over the payers, as before.
  const guardianExtra = new Map()
  for (const member of reservation.teamMembers || []) {
    if (!member?.isMinor) continue
    const guardian = String(member.guardianId || '')
    if (payers.includes(guardian)) guardianExtra.set(guardian, (guardianExtra.get(guardian) || 0) + costOf(String(member.id)))
  }
  const weights = payers.map((id) => costOf(id) + (guardianExtra.get(id) || 0))
  const sum = weights.reduce((a, b) => a + b, 0)
  if (sum <= 0 || weights.every((w) => Math.abs(w - weights[0]) < 0.005)) return null

  const online = Math.max(0, Number(reservation.depositAmount) || 0)
  const shares = {}
  let given = 0
  payers.forEach((id, index) => {
    // The last payer takes the rounding remainder, so the shares add up exactly.
    const amount = index === payers.length - 1 ? round2(online - given) : round2((online * weights[index]) / sum)
    shares[id] = amount
    given = round2(given + amount)
  })
  return shares
}

// What one player gets, priced the way the split weighs it (0 without per-player costs).
export function playerCost(reservation, playerId) {
  const costs = reservation.loadoutUnitCosts
  if (!costs) return 0
  const id = String(playerId)
  const ammo = Math.max(0, Math.round(Number(reservation.extraAmmoByPlayer?.[id]) || 0)) * Math.max(0, Number(costs.ammo) || 0)
  const singles = rentOnlyOf(reservation, id).reduce((sum, piece) => sum + Math.max(0, Number(costs[`rent_${piece}`]) || 0), 0)
  const guns = Math.max(0, Number(reservation.playerGunCosts?.[id]) || 0)
  return Math.max(0, Number(costs[loadoutOf(reservation, id)]) || 0) + singles + guns + ammo
}

// How a payer's recorded share is made up: their own part and each child's part they pay for,
// in the same proportion the split used. { own, children: [{ id, name, amount }] }.
export function shareBreakdown(reservation, payerId, share) {
  const id = String(payerId)
  const total = Math.max(0, Number(share) || 0)
  const children = (reservation.teamMembers || []).filter((member) => member?.isMinor && String(member.guardianId || '') === id)
  if (!children.length) return { own: total, children: [] }
  const evenWeight = !reservation.loadoutUnitCosts
  const weightOf = (playerId) => (evenWeight ? 1 : playerCost(reservation, playerId))
  const ownWeight = weightOf(id)
  const childWeights = children.map((child) => weightOf(child.id))
  const sum = ownWeight + childWeights.reduce((a, b) => a + b, 0)
  if (sum <= 0) return { own: total, children: children.map((child) => ({ id: String(child.id), name: child.name || 'Child', amount: 0 })) }
  const parts = children.map((child, index) => ({ id: String(child.id), name: child.name || 'Child', amount: round2((total * childWeights[index]) / sum) }))
  return { own: round2(total - parts.reduce((a, part) => a + part.amount, 0)), children: parts }
}

// Sets (or clears) reservation.splitShares from its current team and price.
export function withSplitShares(reservation) {
  const shares = computeSplitShares(reservation)
  return { splitShares: shares }
}
