import { modelOf } from './inventoryPieces.js'
import { nextShortId } from './shortIds.js'
import { packageRentOnlyItems, playerGunsOf, rentOnlyOf } from './ownGearRentals.js'

// When a player checks in, they are handed the rental pieces their booking reserved for them. Each
// one is recorded as a rental, the same record as a handout at Rentals, so every piece in a game is
// tied to the player who has it: damage reports name them automatically, and the game's details
// show who has what. Staff can still swap pieces at Rentals (check one in, hand out another).
//
// Package bookings: exactly what the player booked, as pieces per model: the package's items (no
// rental gun for a player bringing their own), or only the single pieces they rent when they don't
// take the package, plus the guns they picked themselves.
// Other bookings (custom picks): one piece of each reserved model that no one on the booking has yet.
// Checking a player out again takes back the pieces given automatically, while they are still out.

const COLLECTIONS = ['weapons', 'equipments']

const sameItemFilter = (ids) => ({ id: { $in: ids } })
const keyOf = (collection, item) => `${collection}:${modelOf(item)}`

// Pieces per model ("weapons:M4 Rifle" -> 1) this player should end up with, or null when the
// booking isn't a package booking.
async function playerQuota(db, reservation, player, { notTakingPackage, singles, bringsOwnGun }) {
  if (String(reservation.selectionMode || '').toLowerCase() !== 'package' || !reservation.selectedPackageId) return null
  const pkg = await db.collection('packages').findOne({ id: String(reservation.selectedPackageId) })
  if (!pkg) return null
  const find = (_db, collection, id) => db.collection(collection).findOne({ id: String(id) })
  const quota = new Map()
  const add = (key, count = 1) => quota.set(key, (quota.get(key) || 0) + count)

  if (notTakingPackage) {
    // Just the package's mask, vest (or, on older bookings, its gun).
    const items = await packageRentOnlyItems(db, pkg, find)
    for (const piece of singles) {
      if (items[piece]) add(keyOf(piece === 'gun' ? 'weapons' : 'equipments', items[piece]))
    }
  } else {
    for (const [index, id] of (pkg.weaponIds || []).map(String).entries()) {
      if (index === 0 && bringsOwnGun) continue
      const item = await find(db, 'weapons', id)
      if (item) add(keyOf('weapons', item))
    }
    for (const id of (pkg.equipmentIds || []).map(String)) {
      const item = await find(db, 'equipments', id)
      if (item && String(item.category || '').toLowerCase() !== 'ammo') add(keyOf('equipments', item))
    }
  }
  // Guns the player picked (one piece per pick).
  for (const id of playerGunsOf(reservation, player.id)) {
    const item = await find(db, 'weapons', id)
    if (item) add(keyOf('weapons', item))
  }
  return quota
}

export async function assignGearOnCheckIn(db, { reservationId, player, actor, nowISO = new Date().toISOString() }) {
  const reservation = await db.collection('reservations').findOne({ id: String(reservationId) })
  if (!reservation) return []
  // Not taking the package: they get only the pieces they rent, or nothing when they bring everything.
  const notTakingPackage = Boolean(player.id) && (reservation.ownGearPlayerIds || []).map(String).includes(String(player.id))
  const singles = notTakingPackage ? rentOnlyOf(reservation, player.id) : []
  if (notTakingPackage && singles.length === 0 && playerGunsOf(reservation, player.id).length === 0) return []

  const [holds, rentals] = await Promise.all([
    db.collection('inventory_holds').find({ reservationId: String(reservationId), status: 'held', collection: { $in: COLLECTIONS }, kind: { $ne: 'ammo_grams' } }).toArray(),
    db.collection('rentals').find({ reservationId: String(reservationId) }).toArray(),
  ])
  if (!holds.length) return []

  // Pieces already handed to someone on this booking, and what this player already has, per model.
  const handedOut = new Set(rentals.map((r) => String(r.itemId)))
  const isThisPlayer = (rental) => rental.playerKey === player.key || (player.id && String(rental.playerId) === String(player.id))
  const mine = rentals.filter((r) => isThisPlayer(r) && r.status === 'out')

  const pieces = []
  for (const collection of COLLECTIONS) {
    const ids = holds.filter((h) => h.collection === collection && !handedOut.has(String(h.itemId))).map((h) => String(h.itemId))
    if (!ids.length) continue
    const docs = await db.collection(collection).find(sameItemFilter(ids), { projection: { id: 1, name: 1, model: 1, unitNumber: 1, category: 1 } }).toArray()
    for (const doc of docs) pieces.push({ collection, doc, model: keyOf(collection, doc) })
  }
  const myCounts = new Map()
  if (mine.length) {
    for (const collection of COLLECTIONS) {
      const ids = mine.filter((r) => r.itemCollection === collection).map((r) => String(r.itemId))
      if (!ids.length) continue
      const docs = await db.collection(collection).find(sameItemFilter(ids), { projection: { id: 1, name: 1, model: 1 } }).toArray()
      for (const doc of docs) myCounts.set(keyOf(collection, doc), (myCounts.get(keyOf(collection, doc)) || 0) + 1)
    }
  }

  const bringsOwnGun = Boolean(player.id) && (reservation.ownWeaponBringerIds || []).map(String).includes(String(player.id))
  // Lowest unit number first within each model, so pieces go out in order.
  pieces.sort((a, b) => a.model.localeCompare(b.model) || (Number(a.doc.unitNumber) || 0) - (Number(b.doc.unitNumber) || 0))

  const quota = await playerQuota(db, reservation, player, { notTakingPackage, singles, bringsOwnGun })
  // How many more of a model this player gets.
  const stillDue = (model) => (quota ? (quota.get(model) || 0) : 1) - (myCounts.get(model) || 0)

  const assigned = []
  for (const piece of pieces) {
    if (stillDue(piece.model) <= 0) continue
    if (!quota && piece.collection === 'weapons' && bringsOwnGun) continue
    const itemId = String(piece.doc.id)
    // Another check-in may have taken it a moment ago.
    if (await db.collection('rentals').findOne({ itemId, status: 'out' })) continue
    const rental = {
      id: await nextShortId(db, 'rentals', 'RNT'),
      reservationId: String(reservation.id),
      reservationDate: reservation.reservationDate,
      playerName: player.name,
      playerId: String(player.id || ''),
      playerKey: player.key,
      itemCollection: piece.collection,
      itemId,
      itemName: piece.doc.name || itemId,
      itemCategory: piece.doc.category || '',
      unitLabel: '',
      status: 'out',
      autoAssigned: true,
      issuedAtISO: nowISO,
      issuedBy: actor,
    }
    await db.collection('rentals').insertOne(rental)
    myCounts.set(piece.model, (myCounts.get(piece.model) || 0) + 1)
    assigned.push({ id: rental.id, itemCollection: rental.itemCollection, itemName: rental.itemName })
  }
  return assigned
}

// Checked out again (ticked by mistake, or they left before the game): the pieces given to them
// automatically go back to the booking's pool. Pieces staff handed out by hand stay as they are.
export async function releaseAutoGear(db, { reservationId, player }) {
  const result = await db.collection('rentals').deleteMany({
    reservationId: String(reservationId),
    playerKey: player.key,
    autoAssigned: true,
    status: 'out',
  })
  return result.deletedCount || 0
}
