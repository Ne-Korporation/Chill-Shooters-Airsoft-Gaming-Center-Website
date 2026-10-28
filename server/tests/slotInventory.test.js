import test from 'node:test'
import assert from 'node:assert/strict'
import { getBookingInventoryRequirements, holdBookingInventory } from '../utils/inventoryHolds.js'

const records = {
  packages: [{ id: 'pkg', weaponIds: ['rifle-a', 'rifle-b'], equipmentIds: [], weaponCount: 1 }],
  weapons: [
    { id: 'rifle-a', name: 'Rifle A', quantity: 6, status: 'available' },
    { id: 'rifle-b', name: 'Rifle B', quantity: 4, status: 'available' },
  ],
  equipments: [],
}

async function findDocumentById(_db, collection, id) {
  return records[collection]?.find((record) => record.id === id) || null
}

test('package weapons are drawn across models and respect units already held in the slot', async () => {
  const requirements = await getBookingInventoryRequirements({
    db: {},
    payload: { selectionMode: 'package', selectedPackageId: 'pkg' },
    players: 8,
    findDocumentById,
    heldQuantities: new Map([['weapons:rifle-a', 2]]),
  })
  assert.deepEqual(
    requirements.map(({ itemId, quantity }) => ({ itemId, quantity })),
    [{ itemId: 'rifle-a', quantity: 4 }, { itemId: 'rifle-b', quantity: 4 }],
  )

  await assert.rejects(
    getBookingInventoryRequirements({
      db: {},
      payload: { selectionMode: 'package', selectedPackageId: 'pkg' },
      players: 9,
      findDocumentById,
      heldQuantities: new Map([['weapons:rifle-a', 2]]),
    }),
    /needs 9 rental weapon\(s\) but only 8 are available/,
  )
})

test('holds only block the same date and time slot', async () => {
  const holds = []
  const db = {
    collection(name) {
      if (name === 'inventory_item_locks') return { updateOne: async () => ({}) }
      return {
        aggregate: (pipeline) => ({
          toArray: async () => {
            const match = pipeline[0].$match
            const quantity = holds
              .filter((hold) => Object.entries(match).every(([key, value]) => hold[key] === value))
              .reduce((sum, hold) => sum + hold.quantity, 0)
            return quantity ? [{ _id: null, quantity }] : []
          },
        }),
        insertOne: async (hold) => holds.push(hold),
      }
    },
  }
  const requirement = { itemId: 'rifle-a', collection: 'weapons', quantity: 1, capacity: 1, name: 'Rifle A' }
  const book = (reservationId, reservationDate, reservationTime) =>
    holdBookingInventory({ db, session: {}, reservationId, requirements: [requirement], reservationDate, reservationTime })

  await book('R-1', '2026-11-07', 'morning')
  await book('R-2', '2026-11-07', 'afternoon')
  await book('R-3', '2026-11-08', 'morning')
  await assert.rejects(book('R-4', '2026-11-07', 'morning'), (error) => error.statusCode === 409)
  assert.equal(holds.length, 3)
})
