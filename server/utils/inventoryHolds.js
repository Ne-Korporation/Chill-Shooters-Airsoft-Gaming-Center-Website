import { isRentalPiece, modelFilter, modelOf } from './inventoryPieces.js'
import { normalizeLocationId } from './bookingSlots.js'
import { packageEquipmentQty } from './packageQuantities.js'

export function stockQuantity(item, collection) {
  const candidates = collection === 'weapons'
    ? [item.quantity, item.qty, item.stock]
    : [item.qty, item.quantity, item.stock]
  const value = candidates.find((candidate) => candidate !== undefined && candidate !== null && candidate !== '')
  if (value === undefined) return collection === 'weapons' ? 1 : 0
  const quantity = Number(value)
  return Number.isInteger(quantity) && quantity >= 0 ? quantity : 0
}

function holdKey(collection, itemId) {
  return `${collection}:${itemId}`
}

// Holds only block the same date and time slot: a rifle rented for Saturday
// morning is free again for Saturday afternoon or any other day.
function slotHoldMatch({ reservationDate, reservationTime }) {
  return { reservationDate: String(reservationDate || ''), reservationTime: String(reservationTime || '') }
}

// Returns a Map of "collection:itemId" -> units already held for that date/slot.
export async function getHeldQuantities(db, { reservationDate, reservationTime }, session) {
  const rows = await db.collection('inventory_holds').aggregate(
    [
      { $match: { status: 'held', ...slotHoldMatch({ reservationDate, reservationTime }) } },
      { $group: { _id: { collection: '$collection', itemId: '$itemId' }, quantity: { $sum: '$quantity' } } },
    ],
    session ? { session } : {},
  ).toArray()
  return new Map(rows.map((row) => [holdKey(row._id.collection, row._id.itemId), Number(row.quantity || 0)]))
}

// Ammo is tracked in grams, not pieces: a package booking uses up
// players × refills per player × the package's grams per refill (bbReloadGrams).
function isAmmo(item) {
  return String(item?.category || '').toLowerCase() === 'ammo'
}

function isUsable(item) {
  return Boolean(item) && String(item.status || 'available').toLowerCase() === 'available'
}

// Each branch rents out only its own pieces (`locationId` on the piece). A piece with no branch
// yet can go to any branch; it still can't be double-booked, because holds are per piece and slot.
export function pieceAtBranch(item, locationId) {
  const branch = normalizeLocationId(item?.locationId)
  return !branch || !locationId || branch === normalizeLocationId(locationId)
}

// Every rental piece of a model, in unit order. Injected in tests.
async function listModelPieces(db, collection, model) {
  return db.collection(collection).find(modelFilter(model)).sort({ unitNumber: 1, id: 1 }).toArray()
}

// Bookings reserve specific pieces (one unit each) for their date and slot.
// Custom selections name the exact pieces. Packages name models: each player gets one piece of
// every equipment model and one of every weapon model (verified own guns replace the first); the player's own
// picks (payload.selectedUnitIds) are used first and the rest are assigned automatically.
export async function getBookingInventoryRequirements({
  db,
  payload,
  players,
  findDocumentById,
  heldQuantities = new Map(),
  listPieces = listModelPieces,
}) {
  const mode = String(payload.selectionMode || '').toLowerCase()
  const branch = normalizeLocationId(payload.locationId || payload.location || payload.locationName)
  const ownWeaponCount = Math.max(0, Math.round(Number(payload.verifiedOwnWeaponCount) || 0))
  // Players bringing their own gun and gear get nothing from a package, so nothing is reserved for them.
  players =Math.max(0, players - Math.min(players, Math.max(0, Math.round(Number(payload.verifiedOwnGearCount) || 0))))
  const freeUnits = (item, collection) =>
    Math.max(0, stockQuantity(item, collection) - Number(heldQuantities.get(holdKey(collection, String(item.id || item._id))) || 0))
  const requirement = (item, collection) => ({
    itemId: String(item.id || item._id),
    collection,
    quantity: 1,
    capacity: stockQuantity(item, collection),
    name: item.name || String(item.id),
  })

  if (mode === 'custom') {
    const requirements = []
    for (const [collection, ids] of [
      ['equipments', payload.customEquipmentIds],
      ['weapons', payload.customWeaponIds],
    ]) {
      for (const id of [...new Set((Array.isArray(ids) ? ids : []).map(String))]) {
        const item = await findDocumentById(db, collection, id)
        if (!isUsable(item) || !isRentalPiece(item)) {
          throw new Error(`${item?.name || 'One of the selected items'} is unavailable.`)
        }
        if (isAmmo(item)) continue
        if (!pieceAtBranch(item, branch)) {
          throw new Error(`${item.name || id} belongs to another branch. Choose a piece from this location.`)
        }
        if (freeUnits(item, collection) < 1) {
          throw new Error(`${item.name || id} is already reserved for this slot. Choose another piece.`)
        }
        requirements.push(requirement(item, collection))
      }
    }
    return requirements
  }

  if (mode !== 'package') throw new Error('Select a package or choose custom/own gear.')

  const pkg = await findDocumentById(db, 'packages', String(payload.selectedPackageId || '').trim())
  if (!pkg) throw new Error('The selected rental package is unavailable.')
  const preferred = new Set((Array.isArray(payload.selectedUnitIds) ? payload.selectedUnitIds : []).map(String))
  const taken = new Set()

  // Free pieces of a model, the player's own picks first.
  const freePiecesOf = async (collection, model) => {
    const pieces = (await listPieces(db, collection, model))
      .filter((piece) => isUsable(piece) && pieceAtBranch(piece, branch) && freeUnits(piece, collection) > 0 && !taken.has(String(piece.id)))
    return [...pieces.filter((p) => preferred.has(String(p.id))), ...pieces.filter((p) => !preferred.has(String(p.id)))]
  }
  const modelsOf = async (collection, ids) => {
    const models = []
    for (const id of [...new Set((Array.isArray(ids) ? ids : []).map(String))]) {
      const item = await findDocumentById(db, collection, id)
      if (!item) throw new Error('The selected package references inventory that is no longer available.')
      if (isAmmo(item)) continue
      const model = modelOf(item)
      if (!models.includes(model)) models.push(model)
    }
    return models
  }

  // Pieces needed per equipment model: players × the package's per-player quantity.
  const equipmentNeeds = new Map()
  const requirements = []
  const gramsPerRefill = Math.max(0, Math.round(Number(pkg.bbReloadGrams) || 0))
  for (const id of [...new Set((Array.isArray(pkg.equipmentIds) ? pkg.equipmentIds : []).map(String))]) {
    const item = await findDocumentById(db, 'equipments', id)
    if (isAmmo(item)) {
      const grams = players * packageEquipmentQty(pkg, id) * gramsPerRefill
      if (grams <= 0) continue
      const inStock = Math.max(0, Number(item.stockGrams) || 0)
      if (!isUsable(item) || inStock < grams) {
        throw new Error('Not enough BBs in stock for this booking. Choose fewer players or another package.')
      }
      requirements.push({ itemId: String(item.id || item._id), collection: 'equipments', kind: 'ammo_grams', grams, quantity: 0, capacity: 0, name: item.name || 'Ammo' })
      continue
    }
    const [model] = await modelsOf('equipments', [id])
    if (!model) continue
    equipmentNeeds.set(model, Math.max(equipmentNeeds.get(model) || 0, packageEquipmentQty(pkg, id)))
  }

  for (const [model, perPlayer] of equipmentNeeds) {
    const needed = players * perPlayer
    const free = await freePiecesOf('equipments', model)
    if (free.length < needed) {
      // No counts in the message: players only learn that there isn't enough, never how much is booked.
      throw new Error(`Not enough ${model} free for this slot for ${players} player${players === 1 ? '' : 's'}. Reduce the number of players or choose another package or slot.`)
    }
    for (const piece of free.slice(0, needed)) {
      taken.add(String(piece.id))
      requirements.push(requirement(piece, 'equipments'))
    }
  }

  const weaponModels = await modelsOf('weapons', pkg.weaponIds)
  // Every player gets one of each listed weapon (e.g. a rifle and grenades): a piece of every
  // model per player. An approved own gun replaces the first (main) one.
  for (const [index, model] of weaponModels.entries()) {
    const needed = Math.max(0, players - (index === 0 ? Math.min(ownWeaponCount, players) : 0))
    const free = await freePiecesOf('weapons', model)
    if (free.length < needed) {
      throw new Error(`Not enough ${model} free for this slot for ${players} player${players === 1 ? '' : 's'}. Reduce the number of players or choose another package or slot.`)
    }
    for (const piece of free.slice(0, needed)) {
      taken.add(String(piece.id))
      requirements.push(requirement(piece, 'weapons'))
    }
  }

  return requirements
}

// Custom selections: players say how many of each model they want (the page sends sample piece
// ids only to name the models and counts). The server picks the actual free pieces at the
// booking's branch for the slot, so players never need to know which pieces are taken.
// Returns { customWeaponIds, customEquipmentIds }, or throws naming the models that are short.
export async function assignCustomPieces({
  db,
  payload,
  findDocumentById,
  heldQuantities = new Map(),
  listPieces = listModelPieces,
}) {
  const branch = normalizeLocationId(payload.locationId || payload.location || payload.locationName)
  const freeUnits = (item, collection) =>
    Math.max(0, stockQuantity(item, collection) - Number(heldQuantities.get(holdKey(collection, String(item.id || item._id))) || 0))
  const result = {}
  const short = []
  for (const [collection, field] of [['weapons', 'customWeaponIds'], ['equipments', 'customEquipmentIds']]) {
    // How many of each model was asked for (ammo isn't a piece; it's sold as reloads).
    const wanted = new Map()
    for (const id of [...new Set((Array.isArray(payload[field]) ? payload[field] : []).map(String))]) {
      const item = await findDocumentById(db, collection, id)
      if (!item || !isRentalPiece(item) || isAmmo(item)) continue
      const model = modelOf(item)
      wanted.set(model, (wanted.get(model) || 0) + 1)
    }
    const ids = []
    for (const [model, count] of wanted) {
      const free = (await listPieces(db, collection, model))
        .filter((piece) => isUsable(piece) && pieceAtBranch(piece, branch) && freeUnits(piece, collection) > 0)
      if (free.length < count) short.push(model)
      ids.push(...free.slice(0, count).map((piece) => String(piece.id)))
    }
    result[field] = ids
  }
  if (short.length) {
    const error = new Error(`Not enough ${short.join(' and ')} free for this slot. Choose fewer, other gear, or another slot.`)
    error.statusCode = 409
    error.shortModels = short
    throw error
  }
  return result
}

export async function holdBookingInventory({ db, session, reservationId, requirements, reservationDate, reservationTime }) {
  const inventoryHolds = db.collection('inventory_holds')
  const slot = slotHoldMatch({ reservationDate, reservationTime })
  for (const requirement of [...requirements].sort((a, b) => a.itemId.localeCompare(b.itemId))) {
    if (requirement.kind === 'ammo_grams') {
      // Take the grams out of stock now; cancelling the booking puts them back.
      const taken = await db.collection('equipments').updateOne(
        { id: requirement.itemId, stockGrams: { $gte: requirement.grams } },
        { $inc: { stockGrams: -requirement.grams } },
        { session },
      )
      if (!taken.matchedCount) {
        const short = new Error(`Not enough BBs left in ${requirement.name} for this booking (needs ${requirement.grams.toLocaleString()} g).`)
        short.statusCode = 409
        throw short
      }
      await inventoryHolds.insertOne({
        reservationId,
        itemId: requirement.itemId,
        collection: requirement.collection,
        kind: 'ammo_grams',
        grams: requirement.grams,
        quantity: 0,
        ...slot,
        status: 'held',
        createdAtISO: new Date().toISOString(),
      }, { session })
      continue
    }
    await db.collection('inventory_item_locks').updateOne(
      { _id: `${requirement.collection}:${requirement.itemId}` },
      { $inc: { version: 1 } },
      { upsert: true, session },
    )

    const existing = await inventoryHolds.aggregate(
      [
        { $match: { itemId: requirement.itemId, collection: requirement.collection, status: 'held', ...slot } },
        { $group: { _id: null, quantity: { $sum: '$quantity' } } },
      ],
      { session },
    ).toArray()
    const heldQuantity = Number(existing[0]?.quantity || 0)
    if (heldQuantity + requirement.quantity > requirement.capacity) {
      const unavailable = new Error(`${requirement.name} has only ${Math.max(0, requirement.capacity - heldQuantity)} units available.`)
      unavailable.statusCode = 409
      throw unavailable
    }

    await inventoryHolds.insertOne({
      reservationId,
      itemId: requirement.itemId,
      collection: requirement.collection,
      quantity: requirement.quantity,
      ...slot,
      status: 'held',
      createdAtISO: new Date().toISOString(),
    }, { session })
  }
}

export async function releaseBookingInventory(db, reservationId, session) {
  // Put the BB grams this booking used back into stock.
  const ammoHolds = await db.collection('inventory_holds')
    .find({ reservationId: String(reservationId), status: 'held', kind: 'ammo_grams' }, session ? { session } : {})
    .toArray()
  for (const hold of ammoHolds) {
    await db.collection('equipments').updateOne(
      { id: hold.itemId },
      { $inc: { stockGrams: Number(hold.grams) || 0 } },
      session ? { session } : {},
    )
  }
  return db.collection('inventory_holds').updateMany(
    { reservationId: String(reservationId), status: 'held' },
    {
      $set: {
        status: 'released',
        releasedAtISO: new Date().toISOString(),
      },
    },
    session ? { session } : {},
  )
}
