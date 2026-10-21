import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getBookingInventoryRequirements,
  holdBookingInventory,
  releaseBookingInventory,
} from '../utils/inventoryHolds.js'

const records = {
  packages: [
    { id: 'package', weaponIds: ['rifle'], equipmentIds: ['vest'], weaponCount: 2 },
  ],
  weapons: [
    { id: 'rifle', name: 'Rifle', quantity: 8, status: 'available' },
  ],
  equipments: [
    { id: 'vest', name: 'Vest', qty: 10, status: 'available' },
  ],
}

async function findDocumentById(_db, collection, id) {
  return records[collection]?.find((record) => record.id === id) || null
}

test('package requirements reserve the configured count for every player', async () => {
  const requirements = await getBookingInventoryRequirements({
    db: {},
    payload: {
      selectionMode: 'package',
      selectedPackageId: 'package',
      ownWeapons: 999,
    },
    players: 3,
    findDocumentById,
  })

  assert.deepEqual(requirements, [
    { itemId: 'vest', collection: 'equipments', quantity: 3, capacity: 10, name: 'Vest' },
    { itemId: 'rifle', collection: 'weapons', quantity: 6, capacity: 8, name: 'Rifle' },
  ])
})

test('custom selections are deduplicated and reserve one selected item per player', async () => {
  const requirements = await getBookingInventoryRequirements({
    db: {},
    payload: {
      selectionMode: 'custom',
      customWeaponIds: ['rifle', 'rifle'],
      customEquipmentIds: ['vest', 'vest'],
    },
    players: 2,
    findDocumentById,
  })

  assert.deepEqual(requirements, [
    { itemId: 'vest', collection: 'equipments', quantity: 2, capacity: 10, name: 'Vest' },
    { itemId: 'rifle', collection: 'weapons', quantity: 2, capacity: 8, name: 'Rifle' },
  ])
})

test('inventory requirement derivation rejects unavailable and insufficient stock', async () => {
  records.weapons.push({ id: 'maintenance-rifle', name: 'Maintenance Rifle', quantity: 5, status: 'maintenance' })
  records.weapons.push({ id: 'limited-rifle', name: 'Limited Rifle', quantity: 1, status: 'available' })

  await assert.rejects(
    getBookingInventoryRequirements({
      db: {},
      payload: { selectionMode: 'custom', customWeaponIds: ['maintenance-rifle'], customEquipmentIds: [] },
      players: 1,
      findDocumentById,
    }),
    /unavailable/,
  )
  await assert.rejects(
    getBookingInventoryRequirements({
      db: {},
      payload: { selectionMode: 'custom', customWeaponIds: ['limited-rifle'], customEquipmentIds: [] },
      players: 2,
      findDocumentById,
    }),
    /not enough available weapon stock/,
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
