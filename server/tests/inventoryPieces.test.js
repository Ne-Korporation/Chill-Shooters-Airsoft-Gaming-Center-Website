import test from 'node:test'
import assert from 'node:assert/strict'
import { createPieces, modelOf, splitStockIntoPieces } from '../utils/inventoryPieces.js'

// Just enough of a MongoDB collection for the filters inventoryPieces uses.
function matches(doc, filter) {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') return condition.some((sub) => matches(doc, sub))
    const value = doc[key]
    if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
      if ('$ne' in condition) return value !== condition.$ne
      if ('$exists' in condition) return (value !== undefined) === condition.$exists
      if ('$regex' in condition) return typeof value === 'string' && new RegExp(condition.$regex).test(value)
    }
    return value === condition
  })
}

function fakeDb(seed) {
  const data = Object.fromEntries(Object.entries(seed).map(([name, docs]) => [name, docs.map((doc, i) => ({ _id: `${name}-${i}`, ...doc }))]))
  let nextId = 1000
  return {
    data,
    collection(name) {
      data[name] ??= []
      return {
        find: (filter = {}) => {
          const rows = data[name].filter((doc) => matches(doc, filter))
          const cursor = { toArray: async () => rows.map((doc) => ({ ...doc })), sort: () => cursor }
          return cursor
        },
        updateOne: async ({ _id }, update) => {
          const doc = data[name].find((d) => d._id === _id)
          Object.assign(doc, update.$set)
        },
        insertMany: async (docs) => {
          for (const doc of docs) data[name].push({ _id: `new-${nextId++}`, ...doc })
        },
      }
    },
  }
}

test('model names drop the piece number', () => {
  assert.equal(modelOf({ name: 'Mask #3' }), 'Mask')
  assert.equal(modelOf({ name: 'M4 Rifle', model: 'M4 Rifle' }), 'M4 Rifle')
})

test('adding 5 masks creates 5 separate pieces with their own IDs', async () => {
  const db = fakeDb({ equipments: [{ id: 'EQ-M-001', name: 'Mask #1', model: 'Mask', unitNumber: 1, qty: 1 }] })
  const pieces = await createPieces(db, 'equipments', { model: 'Mask', count: 5, fields: { price: 50, category: 'masks', status: 'available' } })

  assert.deepEqual(pieces.map((p) => p.id), ['EQ-M-002', 'EQ-M-003', 'EQ-M-004', 'EQ-M-005', 'EQ-M-006'])
  assert.deepEqual(pieces.map((p) => p.name), ['Mask #2', 'Mask #3', 'Mask #4', 'Mask #5', 'Mask #6'])
  assert.ok(pieces.every((p) => p.qty === 1 && p.price === 50))
})

test('stock counts are split into pieces once, and player-owned gear is left alone', async () => {
  const db = fakeDb({
    equipments: [
      { id: 'EQ-M-001', name: 'Masks', category: 'masks', price: 50, qty: 3, status: 'available' },
      { id: 'EQ-PLAYER-1', name: 'My vest', qty: 1, source: 'player' },
    ],
    weapons: [{ id: 'W-R-001', name: 'rifle', price: 500, status: 'available' }],
  })

  const created = await splitStockIntoPieces(db)
  assert.equal(created.length, 2)
  const masks = db.data.equipments.filter((d) => d.model === 'Masks')
  assert.deepEqual(masks.map((d) => d.name).sort(), ['Masks #1', 'Masks #2', 'Masks #3'])
  assert.ok(masks.every((d) => d.qty === 1 && d.price === 50))
  assert.equal(db.data.equipments.find((d) => d.id === 'EQ-PLAYER-1').name, 'My vest')
  assert.equal(db.data.weapons[0].name, 'rifle #1')

  // Running again changes nothing.
  assert.equal((await splitStockIntoPieces(db)).length, 0)
  assert.equal(db.data.equipments.length, 4)
})
