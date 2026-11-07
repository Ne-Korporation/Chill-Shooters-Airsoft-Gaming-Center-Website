import test from 'node:test'
import assert from 'node:assert/strict'
import { checkAmmoStock, isLowOnAmmo, lowStockLevel } from '../utils/ammoStock.js'

test('ammo is low below its own level, the env level, or 2,000 g', () => {
  assert.equal(lowStockLevel({}, {}), 2000)
  assert.equal(lowStockLevel({}, { AMMO_LOW_STOCK_GRAMS: '3000' }), 3000)
  assert.equal(lowStockLevel({ lowStockGrams: 1500 }, { AMMO_LOW_STOCK_GRAMS: '3000' }), 1500)
  assert.equal(isLowOnAmmo({ category: 'ammo', stockGrams: 8000 }, {}), false)
  assert.equal(isLowOnAmmo({ category: 'ammo', stockGrams: 1999 }, {}), true)
  assert.equal(isLowOnAmmo({ category: 'vests', stockGrams: 0 }, {}), false)
})

// In-memory equipments and notifications.
function fakeDb(items) {
  const notes = []
  const byId = new Map(items.map((i) => [i._id, i]))
  return {
    notes,
    items: byId,
    collection(name) {
      if (name === 'equipments') {
        return {
          find: () => ({ toArray: async () => [...byId.values()] }),
          async updateOne({ _id }, update) {
            const item = byId.get(_id)
            Object.assign(item, update.$set || {})
            for (const key of Object.keys(update.$unset || {})) delete item[key]
          },
        }
      }
      // notifications: nextShortId reads the latest id and a count, then the notice is inserted.
      return {
        find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }),
        countDocuments: async () => notes.length,
        insertOne: async (doc) => { notes.push(doc) },
      }
    },
  }
}

test('staff are told once when ammo runs low, and again after a restock and a new drop', async () => {
  const db = fakeDb([{ _id: 'a', id: 'EQ-A-001', name: 'BB Ammo', category: 'ammo', stockGrams: 1500 }])
  await checkAmmoStock(db, { env: {} })
  assert.equal(db.notes.length, 2) // admins and marshals
  assert.match(db.notes[0].message, /1,500 g left/)

  await checkAmmoStock(db, { env: {} })
  assert.equal(db.notes.length, 2, 'not repeated while still low')

  db.items.get('a').stockGrams = 8000
  await checkAmmoStock(db, { env: {} })
  db.items.get('a').stockGrams = 900
  await checkAmmoStock(db, { env: {} })
  assert.equal(db.notes.length, 4, 'told again after restocking and running low again')
})
