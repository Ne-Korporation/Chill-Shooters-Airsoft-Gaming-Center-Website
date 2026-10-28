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

export async function getBookingInventoryRequirements({ db, payload, players, findDocumentById, heldQuantities = new Map() }) {
  const mode = String(payload.selectionMode || '').toLowerCase()
  const ownWeaponCount = Math.max(0, Math.round(Number(payload.verifiedOwnWeaponCount) || 0))
  let weaponIds = []
  let equipmentIds = []
  let weaponQuantity = players

  if (mode === 'package') {
    const pkg = await findDocumentById(db, 'packages', String(payload.selectedPackageId || '').trim())
    if (!pkg) throw new Error('The selected rental package is unavailable.')
    weaponIds = Array.isArray(pkg.weaponIds) ? [...new Set(pkg.weaponIds.map(String))] : []
    equipmentIds = Array.isArray(pkg.equipmentIds) ? [...new Set(pkg.equipmentIds.map(String))] : []
    weaponQuantity = Math.max(0, Math.round(Number(pkg.weaponCount || weaponIds.length)) * players - ownWeaponCount)
  } else if (mode === 'custom') {
    weaponIds = Array.isArray(payload.customWeaponIds) ? [...new Set(payload.customWeaponIds.map(String))] : []
    equipmentIds = Array.isArray(payload.customEquipmentIds) ? [...new Set(payload.customEquipmentIds.map(String))] : []
  } else {
    throw new Error('Select a package or choose custom/own gear.')
  }

  const availableUnits = (item, collection, id) =>
    Math.max(0, stockQuantity(item, collection) - Number(heldQuantities.get(holdKey(collection, id)) || 0))

  const requirements = []
  for (const id of equipmentIds) {
    const item = await findDocumentById(db, 'equipments', id)
    if (!item || String(item.status || 'available').toLowerCase() !== 'available') {
      throw new Error('One or more selected equipment items are unavailable.')
    }
    requirements.push({
      itemId: id,
      collection: 'equipments',
      quantity: players,
      capacity: stockQuantity(item, 'equipments'),
      name: item.name || id,
    })
    const available = availableUnits(item, 'equipments', id)
    if (players > available) {
      throw new Error(`${item.name || id} has only ${available} unit(s) available for this slot, but ${players} players need one each.`)
    }
  }

  let remainingWeaponQuantity = mode === 'custom'
    ? Math.max(0, weaponIds.length * players - ownWeaponCount)
    : weaponQuantity
  // Own weapons reduce custom rentals evenly, starting with the first selected weapon.
  const ownPerWeapon = weaponIds.length ? Math.floor(Math.min(ownWeaponCount, weaponIds.length * players) / weaponIds.length) : 0
  let ownExtra = weaponIds.length ? Math.min(ownWeaponCount, weaponIds.length * players) % weaponIds.length : 0
  for (const id of weaponIds) {
    const item = await findDocumentById(db, 'weapons', id)
    if (!item || String(item.status || 'available').toLowerCase() !== 'available') {
      throw new Error('One or more selected weapons are unavailable.')
    }
    let customQuantity = players - ownPerWeapon
    if (ownExtra > 0) {
      customQuantity -= 1
      ownExtra -= 1
    }
    const quantity = mode === 'custom'
      ? Math.max(0, customQuantity)
      : Math.min(remainingWeaponQuantity, stockQuantity(item, 'weapons'))
    if (quantity > 0) {
      requirements.push({
        itemId: id,
        collection: 'weapons',
        quantity,
        capacity: stockQuantity(item, 'weapons'),
        name: item.name || id,
      })
      remainingWeaponQuantity -= quantity
    }
  }

  if (remainingWeaponQuantity > 0) {
    throw new Error(`There is not enough available weapon stock for this booking: it needs ${neededWeapons} rental weapon(s) but only ${availableWeapons} are available for this slot. Reduce the number of players or choose another package or slot.`)
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
