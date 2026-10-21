function stockQuantity(item, collection) {
  const candidates = collection === 'weapons'
    ? [item.quantity, item.qty, item.stock]
    : [item.qty, item.quantity, item.stock]
  const value = candidates.find((candidate) => candidate !== undefined && candidate !== null && candidate !== '')
  if (value === undefined) return collection === 'weapons' ? 1 : 0
  const quantity = Number(value)
  return Number.isInteger(quantity) && quantity >= 0 ? quantity : 0
}

export async function getBookingInventoryRequirements({ db, payload, players, findDocumentById }) {
  const mode = String(payload.selectionMode || '').toLowerCase()
  let weaponIds = []
  let equipmentIds = []
  let weaponQuantity = players

  if (mode === 'package') {
    const pkg = await findDocumentById(db, 'packages', String(payload.selectedPackageId || '').trim())
    if (!pkg) throw new Error('The selected rental package is unavailable.')
    weaponIds = Array.isArray(pkg.weaponIds) ? [...new Set(pkg.weaponIds.map(String))] : []
    equipmentIds = Array.isArray(pkg.equipmentIds) ? [...new Set(pkg.equipmentIds.map(String))] : []
    weaponQuantity = Math.max(0, Math.round(Number(pkg.weaponCount || weaponIds.length)) * players)
  } else if (mode === 'custom') {
    weaponIds = Array.isArray(payload.customWeaponIds) ? [...new Set(payload.customWeaponIds.map(String))] : []
    equipmentIds = Array.isArray(payload.customEquipmentIds) ? [...new Set(payload.customEquipmentIds.map(String))] : []
  } else {
    throw new Error('Select a package or choose custom/own gear.')
  }

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
    if (players > stockQuantity(item, 'equipments')) {
      throw new Error(`${item.name || id} does not have enough available stock.`)
    }
  }

  let remainingWeaponQuantity = mode === 'custom' ? weaponIds.length * players : weaponQuantity
  for (const id of weaponIds) {
    const item = await findDocumentById(db, 'weapons', id)
    if (!item || String(item.status || 'available').toLowerCase() !== 'available') {
      throw new Error('One or more selected weapons are unavailable.')
    }
    const quantity = mode === 'custom'
      ? players
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
    throw new Error('There is not enough available weapon stock for this booking.')
  }
  if (requirements.some((requirement) =>
    requirement.collection === 'weapons' && requirement.quantity > requirement.capacity
  )) {
    throw new Error('There is not enough available weapon stock for this booking.')
  }

  return requirements
}

export async function holdBookingInventory({ db, session, reservationId, requirements }) {
  const inventoryHolds = db.collection('inventory_holds')
  for (const requirement of [...requirements].sort((a, b) => a.itemId.localeCompare(b.itemId))) {
    await db.collection('inventory_item_locks').updateOne(
      { _id: `${requirement.collection}:${requirement.itemId}` },
      { $inc: { version: 1 } },
      { upsert: true, session },
    )

    const existing = await inventoryHolds.aggregate(
      [
        { $match: { itemId: requirement.itemId, collection: requirement.collection, status: 'held' } },
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
