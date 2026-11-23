// What each payer owes in a split payment when the players don't all get the same thing.
//
// With a package, the person who booked chooses for each player: the full package, their own gun
// (rent the rest), or their own gun and gear (entrance fee only), and how many extra ammo reloads
// each one buys. Each payer's share of the online amount is in proportion to what they get, e.g.
// ₱550 for a package player and ₱200 for one who only pays the entrance fee, instead of the same
// amount for everyone.
//
// Children don't pay; what they cost is spread over the payers in the same proportion.
// Returns { [payerId]: amount } (amounts add up to the online amount), or null when an even split
// is right: no per-player costs, or everyone gets the same.

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
  const weights = payers.map((id) => Math.max(0, Number(costs[loadoutOf(reservation, id)]) || 0) + ammoOf(id))
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

// Sets (or clears) reservation.splitShares from its current team and price.
export function withSplitShares(reservation) {
  const shares = computeSplitShares(reservation)
  return { splitShares: shares }
}
