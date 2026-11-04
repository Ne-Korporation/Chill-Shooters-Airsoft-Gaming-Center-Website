import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getBookingInventoryRequirements,
  holdBookingInventory,
  releaseBookingInventory,
} from '../utils/inventoryHolds.js'

// Every rental piece is its own record with a model.
const records = {
  packages: [
    { id: 'package', weaponIds: ['RF-1'], equipmentIds: ['VS-1'], weaponCount: 2 },
  ],
  weapons: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: `RF-${n}`, name: `Rifle #${n}`, model: 'Rifle', unitNumber: n, quantity: 1, status: 'available' })),
  equipments: [1, 2, 3, 4].map((n) => ({ id: `VS-${n}`, name: `Vest #${n}`, model: 'Vest', unitNumber: n, qty: 1, status: 'available' })),
}

async function findDocumentById(_db, collection, id) {
  return records[collection]?.find((record) => record.id === id) || null
}

async function listPieces(_db, collection, model) {
  return records[collection].filter((record) => record.model === model)
}

const ids = (requirements) => requirements.map((r) => r.itemId)

test('packages reserve one piece per player for equipment and weaponCount per player for weapons', async () => {
  const requirements = await getBookingInventoryRequirements({
    db: {},
    payload: { selectionMode: 'package', selectedPackageId: 'package', ownWeapons: 999 },
    players: 3,
    findDocumentById,
    listPieces,
  })

  assert.deepEqual(ids(requirements), ['VS-1', 'VS-2', 'VS-3', 'RF-1', 'RF-2', 'RF-3', 'RF-4', 'RF-5', 'RF-6'])
  assert.ok(requirements.every((r) => r.quantity === 1 && r.capacity === 1))
})

test('packages use the pieces the player picked first, skip held pieces, and deduct own weapons', async () => {
  const requirements = await getBookingInventoryRequirements({
    db: {},
    payload: { selectionMode: 'package', selectedPackageId: 'package', selectedUnitIds: ['RF-8', 'VS-4'], verifiedOwnWeaponCount: 3 },
    players: 2,
    findDocumentById,
    listPieces,
    heldQuantities: new Map([['weapons:RF-1', 1]]),
  })

  // 2 players × 2 weapons − 3 own = 1 rifle, the chosen RF-8; vests: chosen VS-4, then VS-1
  assert.deepEqual(ids(requirements), ['VS-4', 'VS-1', 'RF-8'])
})

test('custom selections reserve exactly the chosen pieces, once each', async () => {
  const requirements = await getBookingInventoryRequirements({
    db: {},
    payload: { selectionMode: 'custom', customWeaponIds: ['RF-2', 'RF-2', 'RF-3'], customEquipmentIds: ['VS-1'] },
    players: 5,
    findDocumentById,
    listPieces,
  })

  assert.deepEqual(ids(requirements), ['VS-1', 'RF-2', 'RF-3'])
})

test('unavailable, already-reserved, or too few pieces are rejected', async () => {
  records.weapons.push({ id: 'RF-X', name: 'Rifle #9', model: 'Rifle', quantity: 1, status: 'maintenance' })

  await assert.rejects(
    getBookingInventoryRequirements({
      db: {},
      payload: { selectionMode: 'custom', customWeaponIds: ['RF-X'], customEquipmentIds: [] },
      players: 1,
      findDocumentById,
      listPieces,
    }),
    /unavailable/,
  )
  await assert.rejects(
    getBookingInventoryRequirements({
      db: {},
      payload: { selectionMode: 'custom', customWeaponIds: ['RF-1'], customEquipmentIds: [] },
      players: 1,
      findDocumentById,
      listPieces,
      heldQuantities: new Map([['weapons:RF-1', 1]]),
    }),
    /already reserved/,
  )
  await assert.rejects(
    getBookingInventoryRequirements({
      db: {},
      payload: { selectionMode: 'package', selectedPackageId: 'package' },
      players: 5,
      findDocumentById,
      listPieces,
    }),
    /Vest has only 4 piece/,
  )
})

test('held stock cannot be double-booked and cancellation releases the hold', async () => {
  const heldItems = []
  const db = {
    collection(name) {
      if (name === 'inventory_item_locks') return { updateOne: async () => ({}) }
      return {
        aggregate: (pipeline) => ({
          toArray: async () => {
            const match = pipeline[0].$match
            const quantity = heldItems
              .filter((hold) => hold.itemId === match.itemId && hold.collection === match.collection && hold.status === match.status)
              .reduce((sum, hold) => sum + hold.quantity, 0)
            return quantity ? [{ _id: null, quantity }] : []
          },
        }),
        insertOne: async (hold) => heldItems.push(hold),
        find: () => ({ toArray: async () => [] }),
        updateMany: async (filter, update) => {
          for (const hold of heldItems) {
            if (hold.reservationId === filter.reservationId && hold.status === filter.status) {
              Object.assign(hold, update.$set)
            }
          }
        },
      }
    },
  }
  const requirement = {
    itemId: 'rifle',
    collection: 'weapons',
    quantity: 1,
    capacity: 1,
    name: 'Rifle',
  }

  await holdBookingInventory({ db, session: {}, reservationId: 'R-1', requirements: [requirement] })
  await assert.rejects(
    holdBookingInventory({ db, session: {}, reservationId: 'R-2', requirements: [requirement] }),
    (error) => error.statusCode === 409,
  )

  await releaseBookingInventory(db, 'R-1')
  await holdBookingInventory({ db, session: {}, reservationId: 'R-2', requirements: [requirement] })
  assert.equal(heldItems.filter((hold) => hold.status === 'held').length, 1)
})

test('package bookings use up BB grams and cancelling gives them back', async () => {
  const ammo = { id: 'BB-1', name: 'BBs 0.20g', model: 'BBs 0.20g', category: 'ammo', status: 'available', stockGrams: 1000 }
  records.equipments.push(ammo)
  records.packages.push({ id: 'bb-package', weaponIds: [], equipmentIds: ['VS-1', 'BB-1'], equipmentQuantities: { 'BB-1': 2 }, bbReloadGrams: 100 })

  // 3 players × 2 refills × 100 g = 600 g; ammo is not reserved as a piece
  const requirements = await getBookingInventoryRequirements({
    db: {},
    payload: { selectionMode: 'package', selectedPackageId: 'bb-package' },
    players: 3,
    findDocumentById,
    listPieces,
  })
  assert.deepEqual(ids(requirements), ['BB-1', 'VS-1', 'VS-2', 'VS-3'])
  assert.equal(requirements[0].grams, 600)

  await assert.rejects(
    getBookingInventoryRequirements({ db: {}, payload: { selectionMode: 'package', selectedPackageId: 'bb-package' }, players: 6, findDocumentById, listPieces }),
    /Not enough BBs/,
  )

  const holds = []
  const db = {
    collection(name) {
      if (name === 'equipments') {
        return {
          updateOne: async (filter, update) => {
            if (filter.id !== ammo.id || (filter.stockGrams && ammo.stockGrams < filter.stockGrams.$gte)) return { matchedCount: 0 }
            ammo.stockGrams += update.$inc.stockGrams
            return { matchedCount: 1 }
          },
        }
      }
      return {
        insertOne: async (hold) => holds.push(hold),
        find: (filter) => ({ toArray: async () => holds.filter((h) => h.reservationId === filter.reservationId && h.status === filter.status && h.kind === filter.kind) }),
        updateMany: async (filter, update) => holds.filter((h) => h.reservationId === filter.reservationId).forEach((h) => Object.assign(h, update.$set)),
      }
    },
  }
  const [bbRequirement] = requirements
  await holdBookingInventory({ db, session: {}, reservationId: 'R-BB', requirements: [bbRequirement] })
  assert.equal(ammo.stockGrams, 400)
  await assert.rejects(
    holdBookingInventory({ db, session: {}, reservationId: 'R-BB-2', requirements: [bbRequirement] }),
    (error) => error.statusCode === 409,
  )
  await releaseBookingInventory(db, 'R-BB')
  assert.equal(ammo.stockGrams, 1000)
})
