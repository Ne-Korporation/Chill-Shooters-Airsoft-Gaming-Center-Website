// Hybrid bookings: a player who doesn't take the package can still rent single pieces from it:
// just the gun, just the mask, just the vest, or the mask and vest. They pay the entrance fee plus
// each piece's rental price (no package discount, no included BBs).
//
// Stored on the reservation as `ownGearRentals: { [playerId]: ['gun' | 'mask' | 'vest', ...] }`,
// only for players in `ownGearPlayerIds` (a player there with no pieces brings everything).
// The pieces come from the booked package: its first (main) weapon, and its mask and vest.

import { modelOf } from './inventoryPieces.js'

export const RENT_ONLY_PIECES = ['gun', 'mask', 'vest']

// Weapon categories that aren't a player's gun (thrown or consumable). Same as the Rentals page.
const NOT_GUNS = ['grenades']

// Which single piece an inventory item is: any weapon but grenades is a gun; masks and vests by
// category (or by model name for older records with no category).
export function pieceKindOf(item, collection) {
  if (!item) return null
  const category = String(item.category || '').toLowerCase()
  if (collection === 'weapons') return NOT_GUNS.includes(category) ? null : 'gun'
  const text = `${category} ${modelOf(item)}`.toLowerCase()
  if (text.includes('mask')) return 'mask'
  if (text.includes('vest')) return 'vest'
  return null
}

// The package's gun, mask and vest (inventory records), or null for the ones it doesn't include.
export async function packageRentOnlyItems(db, pkg, findDocumentById) {
  const result = { gun: null, mask: null, vest: null }
  if (!pkg) return result
  const weaponIds = Array.isArray(pkg.weaponIds) ? pkg.weaponIds.map(String) : []
  if (weaponIds[0]) {
    const gun = await findDocumentById(db, 'weapons', weaponIds[0])
    if (pieceKindOf(gun, 'weapons') === 'gun') result.gun = gun
  }
  for (const id of (Array.isArray(pkg.equipmentIds) ? pkg.equipmentIds.map(String) : [])) {
    const item = await findDocumentById(db, 'equipments', id)
    const kind = pieceKindOf(item, 'equipments')
    if (kind && !result[kind]) result[kind] = item
  }
  return result
}

// Clean picks for the players bringing their own: known pieces only, once each, in a fixed order.
export function normalizeOwnGearRentals(raw, ownGearPlayerIds) {
  const ids = new Set((ownGearPlayerIds || []).map(String))
  const result = {}
  if (!raw || typeof raw !== 'object') return result
  for (const [id, pieces] of Object.entries(raw)) {
    if (!ids.has(String(id)) || !Array.isArray(pieces)) continue
    const picked = RENT_ONLY_PIECES.filter((piece) => pieces.map(String).includes(piece))
    if (picked.length) result[String(id)] = picked
  }
  return result
}

// How many of each single piece the booking rents: { gun, mask, vest }.
// From the reservation's per-player picks, or from `rentOnlyCounts` (the stock check sends counts).
export function rentOnlyCounts(payload) {
  const counts = { gun: 0, mask: 0, vest: 0 }
  const ownGearIds = Array.isArray(payload?.ownGearPlayerIds) ? payload.ownGearPlayerIds.map(String) : null
  if (ownGearIds) {
    const picks = normalizeOwnGearRentals(payload.ownGearRentals, ownGearIds)
    for (const pieces of Object.values(picks)) for (const piece of pieces) counts[piece] += 1
    return counts
  }
  const ownGearCount = Math.max(0, Math.round(Number(payload?.verifiedOwnGearCount) || 0))
  for (const piece of RENT_ONLY_PIECES) {
    counts[piece] = Math.min(ownGearCount, Math.max(0, Math.round(Number(payload?.rentOnlyCounts?.[piece]) || 0)))
  }
  return counts
}

// ---------------------------------------------------------------------------------------------
// Guns each player rents by choice: `playerGuns: { [playerId]: [weaponId, ...] }`, one sample piece id
// per gun (the model is what counts; the server picks the actual free pieces). A player not taking
// the package rents these instead of the package's gun; a package player rents them on top of it.
// Each is charged at its own rental price.
export const MAX_GUNS_PER_PLAYER = 3

export function normalizePlayerGuns(raw, playerIds = null) {
  const allowed = playerIds ? new Set(playerIds.map(String)) : null
  const result = {}
  if (!raw || typeof raw !== 'object') return result
  for (const [id, guns] of Object.entries(raw)) {
    if ((allowed && !allowed.has(String(id))) || !Array.isArray(guns)) continue
    const list = guns.map((gun) => String(gun || '').trim()).filter(Boolean).slice(0, MAX_GUNS_PER_PLAYER)
    if (list.length) result[String(id)] = list
  }
  return result
}

// The rental gun records each player picked: { [playerId]: [weapon, ...] }. Throws for a gun that
// isn't a rental gun (a player's own, grenades, unknown or out of service).
export async function resolvePlayerGuns(db, payload, findDocumentById) {
  const byPlayer = {}
  for (const [id, weaponIds] of Object.entries(normalizePlayerGuns(payload?.playerGuns))) {
    for (const weaponId of weaponIds) {
      const item = await findDocumentById(db, 'weapons', weaponId)
      const usable = item && String(item.source || 'business') !== 'player'
        && String(item.status || 'available').toLowerCase() === 'available' && pieceKindOf(item, 'weapons') === 'gun'
      if (!usable) throw new Error(`${item?.name || 'One of the chosen guns'} can't be rented. Pick another gun.`)
      ;(byPlayer[id] ||= []).push(item)
    }
  }
  return byPlayer
}

// Players not taking the package who still rent a gun (picked, or the package's gun): they get the
// package's included BBs with it.
export function gunRentersNotTakingPackage(payload) {
  const ownGearIds = (payload?.ownGearPlayerIds || []).map(String)
  const picked = normalizePlayerGuns(payload?.playerGuns, ownGearIds)
  const legacy = normalizeOwnGearRentals(payload?.ownGearRentals, ownGearIds)
  return ownGearIds.filter((id) => picked[id] || (legacy[id] || []).includes('gun')).length
}

// A player's picked guns (sample piece ids), for hand-out.
export function playerGunsOf(reservation, playerId) {
  return normalizePlayerGuns(reservation?.playerGuns)[String(playerId)] || []
}

// A player's single pieces, for labels and gear hand-out.
export function rentOnlyOf(reservation, playerId) {
  const id = String(playerId)
  if (!(reservation?.ownGearPlayerIds || []).map(String).includes(id)) return []
  return normalizeOwnGearRentals(reservation.ownGearRentals, reservation.ownGearPlayerIds)[id] || []
}
