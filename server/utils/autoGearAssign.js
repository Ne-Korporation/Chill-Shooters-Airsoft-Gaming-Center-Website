import { modelOf } from './inventoryPieces.js'
import { nextShortId } from './shortIds.js'

// When a player checks in, they are handed the rental pieces their booking reserved: one piece of
// each reserved model (e.g. M4 Rifle #51 and Mask #4) that no one on the booking has yet. Each one
// is recorded as a rental, the same record as a handout at Rentals, so every piece in a game is
// tied to the player who has it: damage reports name them automatically, and the game's details
// show who has what. Staff can still swap pieces at Rentals (check one in, hand out another).
//
// Players who said they'd bring their own gun get no rental gun.
// Checking a player out again takes back the pieces given automatically, while they are still out.

const COLLECTIONS = ['weapons', 'equipments']

const sameItemFilter = (ids) => ({ id: { $in: ids } })

export async function assignGearOnCheckIn(db, { reservationId, player, actor, nowISO = new Date().toISOString() }) {
  const reservation = await db.collection('reservations').findOne({ id: String(reservationId) })
  if (!reservation) return []
  // Bringing their own gun and gear: nothing from the package is handed to them.
  if (player.id && (reservation.ownGearPlayerIds || []).map(String).includes(String(player.id))) return []

  const [holds, rentals] = await Promise.all([
    db.collection('inventory_holds').find({ reservationId: String(reservationId), status: 'held', collection: { $in: COLLECTIONS }, kind: { $ne: 'ammo_grams' } }).toArray(),
    db.collection('rentals').find({ reservationId: String(reservationId) }).toArray(),
  ])
  if (!holds.length) return []

  // Pieces already handed to someone on this booking, and the models this player already has.
  const handedOut = new Set(rentals.map((r) => String(r.itemId)))
  const isThisPlayer = (rental) => rental.playerKey === player.key || (player.id && String(rental.playerId) === String(player.id))
  const mine = rentals.filter((r) => isThisPlayer(r) && r.status === 'out')

  const pieces = []
  for (const collection of COLLECTIONS) {
    const ids = holds.filter((h) => h.collection === collection && !handedOut.has(String(h.itemId))).map((h) => String(h.itemId))
    if (!ids.length) continue
    const docs = await db.collection(collection).find(sameItemFilter(ids), { projection: { id: 1, name: 1, model: 1, unitNumber: 1, category: 1 } }).toArray()
    for (const doc of docs) pieces.push({ collection, doc, model: `${collection}:${modelOf(doc)}` })
  }
  const myModels = new Set()
  if (mine.length) {
    for (const collection of COLLECTIONS) {
      const ids = mine.filter((r) => r.itemCollection === collection).map((r) => String(r.itemId))
      if (!ids.length) continue
      const docs = await db.collection(collection).find(sameItemFilter(ids), { projection: { id: 1, name: 1, model: 1 } }).toArray()
      for (const doc of docs) myModels.add(`${collection}:${modelOf(doc)}`)
    }
  }

  const bringsOwnGun = Boolean(player.id) && (reservation.ownWeaponBringerIds || []).map(String).includes(String(player.id))
  // Lowest unit number first within each model, so pieces go out in order.
  pieces.sort((a, b) => a.model.localeCompare(b.model) || (Number(a.doc.unitNumber) || 0) - (Number(b.doc.unitNumber) || 0))

  const assigned = []
  for (const piece of pieces) {
    if (myModels.has(piece.model)) continue
    if (piece.collection === 'weapons' && bringsOwnGun) continue
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
    myModels.add(piece.model)
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
