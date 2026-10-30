import { isRentalPiece, modelFilter, modelOf } from './inventoryPieces.js'
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

function isUsable(item) {
  return Boolean(item) && String(item.status || 'available').toLowerCase() === 'available'
}

// Every rental piece of a model, in unit order. Injected in tests.
async function listModelPieces(db, collection, model) {
  return db.collection(collection).find(modelFilter(model)).sort({ unitNumber: 1, id: 1 }).toArray()
}

// Bookings reserve specific pieces (one unit each) for their date and slot.
// Custom selections name the exact pieces. Packages name models: each player gets one piece of
// every equipment model and `weaponCount` weapons (minus verified own weapons); the player's own
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
  const ownWeaponCount = Math.max(0, Math.round(Number(payload.verifiedOwnWeaponCount) || 0))
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
      .filter((piece) => isUsable(piece) && freeUnits(piece, collection) > 0 && !taken.has(String(piece.id)))
    return [...pieces.filter((p) => preferred.has(String(p.id))), ...pieces.filter((p) => !preferred.has(String(p.id)))]
  }
  const modelsOf = async (collection, ids) => {
    const models = []
    for (const id of [...new Set((Array.isArray(ids) ? ids : []).map(String))]) {
      const item = await findDocumentById(db, collection, id)
      if (!item) throw new Error('The selected package references inventory that is no longer available.')
      const model = modelOf(item)
      if (!models.includes(model)) models.push(model)
    }
    return models
  }

  // Pieces needed per equipment model: players × the package's per-player quantity.
  const equipmentNeeds = new Map()
  for (const id of [...new Set((Array.isArray(pkg.equipmentIds) ? pkg.equipmentIds : []).map(String))]) {
    const [model] = await modelsOf('equipments', [id])
    equipmentNeeds.set(model, Math.max(equipmentNeeds.get(model) || 0, packageEquipmentQty(pkg, id)))
  }

  const requirements = []
  for (const [model, perPlayer] of equipmentNeeds) {
    const needed = players * perPlayer
    const free = await freePiecesOf('equipments', model)
    if (free.length < needed) {
      throw new Error(`${model} has only ${free.length} piece(s) free for this slot, but ${players} players need ${perPlayer} each.`)
    }
    for (const piece of free.slice(0, needed)) {
      taken.add(String(piece.id))
      requirements.push(requirement(piece, 'equipments'))
    }
  }

  const weaponModels = await modelsOf('weapons', pkg.weaponIds)
  const neededWeapons = weaponModels.length
    ? Math.max(0, Math.round(Number(pkg.weaponCount || weaponModels.length)) * players - ownWeaponCount)
    : 0
  let remaining = neededWeapons
  let freeWeapons = 0
  for (const model of weaponModels) {
    const free = await freePiecesOf('weapons', model)
    freeWeapons += free.length
    for (const piece of free.slice(0, remaining)) {
      taken.add(String(piece.id))
      requirements.push(requirement(piece, 'weapons'))
      remaining -= 1
    }
  }
  if (remaining > 0) {
    throw new Error(`There is not enough available weapon stock for this booking: it needs ${neededWeapons} rental weapon(s) but only ${freeWeapons} are free for this slot. Reduce the number of players or choose another package or slot.`)
  }

  return requirements
}

export async function holdBookingInventory({ db, session, reservationId, requirements, reservationDate, reservationTime }) {
  const inventoryHolds = db.collection('inventory_holds')
  const slot = slotHoldMatch({ reservationDate, reservationTime })
  for (const requirement of [...requirements].sort((a, b) => a.itemId.localeCompare(b.itemId))) {
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
