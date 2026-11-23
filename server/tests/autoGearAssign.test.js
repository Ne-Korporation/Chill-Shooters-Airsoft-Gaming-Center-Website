import test from 'node:test'
import assert from 'node:assert/strict'
import { assignGearOnCheckIn, releaseAutoGear } from '../utils/autoGearAssign.js'

// In-memory stand-in for the collections the auto-assignment reads and writes.
function fakeDb({ reservation, holds, weapons, equipments }) {
  const rentals = []
  const matches = (doc, filter) => Object.entries(filter).every(([key, rule]) => {
    if (rule && typeof rule === 'object') {
      if ('$in' in rule) return rule.$in.map(String).includes(String(doc[key]))
      if ('$ne' in rule) return doc[key] !== rule.$ne
    }
    return doc[key] === rule
  })
  const list = (docs) => ({
    find: (filter = {}) => {
      const found = docs.filter((d) => matches(d, filter))
      const cursor = { sort: () => cursor, limit: () => cursor, toArray: async () => found }
      return cursor
    },
    findOne: async (filter) => docs.find((d) => matches(d, filter)) || null,
  })
  return {
    rentals,
    collection(name) {
      if (name === 'reservations') return list([reservation])
      if (name === 'inventory_holds') return list(holds)
      if (name === 'weapons') return list(weapons)
      if (name === 'equipments') return list(equipments)
      if (name === 'rentals') {
        return {
          ...list(rentals),
          insertOne: async (doc) => { rentals.push(doc) },
          deleteMany: async (filter) => {
            const gone = rentals.filter((r) => matches(r, filter))
            for (const r of gone) rentals.splice(rentals.indexOf(r), 1)
            return { deletedCount: gone.length }
          },
          countDocuments: async () => rentals.length,
        }
      }
      // Short-id counters.
      return { findOneAndUpdate: async () => ({ value: { seq: rentals.length + 1 }, seq: rentals.length + 1 }), find: () => ({ sort() { return this }, limit() { return this }, toArray: async () => [] }), countDocuments: async () => 0, updateOne: async () => ({}) }
    },
  }
}

const setup = (overrides = {}) => fakeDb({
  reservation: { id: 'R-1', reservationDate: '2026-11-21', ownWeaponBringerIds: [], ...overrides.reservation },
  holds: [
    { reservationId: 'R-1', status: 'held', collection: 'weapons', itemId: 'W-51' },
    { reservationId: 'R-1', status: 'held', collection: 'weapons', itemId: 'W-52' },
    { reservationId: 'R-1', status: 'held', collection: 'equipments', itemId: 'E-4' },
    { reservationId: 'R-1', status: 'held', collection: 'equipments', itemId: 'E-5' },
  ],
  weapons: [
    { id: 'W-51', name: 'M4 Rifle #51', model: 'M4 Rifle', unitNumber: 51 },
    { id: 'W-52', name: 'M4 Rifle #52', model: 'M4 Rifle', unitNumber: 52 },
  ],
  equipments: [
    { id: 'E-4', name: 'Mask #4', model: 'Mask', unitNumber: 4 },
    { id: 'E-5', name: 'Mask #5', model: 'Mask', unitNumber: 5 },
  ],
})

const juan = { key: 'user:P1', id: 'P1', name: 'Juan', reservationId: 'R-1' }
const ana = { key: 'user:P2', id: 'P2', name: 'Ana', reservationId: 'R-1' }

test('each player who checks in gets one piece of each booked model, tied to them', async () => {
  const db = setup()
  const first = await assignGearOnCheckIn(db, { reservationId: 'R-1', player: juan, actor: {} })
  assert.deepEqual(first.map((g) => g.itemName).sort(), ['M4 Rifle #51', 'Mask #4'])
  const second = await assignGearOnCheckIn(db, { reservationId: 'R-1', player: ana, actor: {} })
  assert.deepEqual(second.map((g) => g.itemName).sort(), ['M4 Rifle #52', 'Mask #5'])
  assert.equal(db.rentals.find((r) => r.itemId === 'W-51').playerName, 'Juan')
  assert.equal(db.rentals.find((r) => r.itemId === 'E-5').playerName, 'Ana')
})

test('checking in twice does not hand out a second set', async () => {
  const db = setup()
  await assignGearOnCheckIn(db, { reservationId: 'R-1', player: juan, actor: {} })
  const again = await assignGearOnCheckIn(db, { reservationId: 'R-1', player: juan, actor: {} })
  assert.deepEqual(again, [])
  assert.equal(db.rentals.length, 2)
})

test('a player bringing their own gun gets gear but no rental gun', async () => {
  const db = setup({ reservation: { ownWeaponBringerIds: ['P1'] } })
  const gear = await assignGearOnCheckIn(db, { reservationId: 'R-1', player: juan, actor: {} })
  assert.deepEqual(gear.map((g) => g.itemName), ['Mask #4'])
})

test('checking a player out gives their automatic pieces back to the booking', async () => {
  const db = setup()
  await assignGearOnCheckIn(db, { reservationId: 'R-1', player: juan, actor: {} })
  assert.equal(await releaseAutoGear(db, { reservationId: 'R-1', player: juan }), 2)
  const gear = await assignGearOnCheckIn(db, { reservationId: 'R-1', player: ana, actor: {} })
  assert.deepEqual(gear.map((g) => g.itemName).sort(), ['M4 Rifle #51', 'Mask #4'])
})
