import test from 'node:test'
import assert from 'node:assert/strict'
import { getBookingInventoryRequirements, holdBookingInventory } from '../utils/inventoryHolds.js'

// Rental gear is one record per piece: Rifle A has 6 pieces, Rifle B has 4.
const piece = (model, prefix, n) => ({ id: `${prefix}-${n}`, name: `${model} #${n}`, model, unitNumber: n, quantity: 1, status: 'available' })
const records = {
  packages: [{ id: 'pkg', weaponIds: ['A-1', 'B-1'], equipmentIds: [], weaponCount: 1 }],
  weapons: [
    ...[1, 2, 3, 4, 5, 6].map((n) => piece('Rifle A', 'A', n)),
    ...[1, 2, 3, 4].map((n) => piece('Rifle B', 'B', n)),
  ],
  equipments: [],
}

async function findDocumentById(_db, collection, id) {
  return records[collection]?.find((record) => record.id === id) || null
}

async function listPieces(_db, collection, model) {
  return records[collection].filter((record) => record.model === model)
}

test('package weapons are drawn across models and skip pieces already held in the slot', async () => {
  const held = new Map([['weapons:A-1', 1], ['weapons:A-2', 1]])
  const requirements = await getBookingInventoryRequirements({
    db: {},
    payload: { selectionMode: 'package', selectedPackageId: 'pkg' },
    players: 8,
    findDocumentById,
    listPieces,
    heldQuantities: held,
  })
  assert.deepEqual(requirements.map(({ itemId }) => itemId), ['A-3', 'A-4', 'A-5', 'A-6', 'B-1', 'B-2', 'B-3', 'B-4'])

  await assert.rejects(
    getBookingInventoryRequirements({
      db: {},
      payload: { selectionMode: 'package', selectedPackageId: 'pkg' },
      players: 9,
      findDocumentById,
      listPieces,
      heldQuantities: held,
    }),
    /needs 9 rental weapon\(s\) but only 8 are free/,
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
