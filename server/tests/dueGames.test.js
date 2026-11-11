import test from 'node:test'
import assert from 'node:assert/strict'
import { startDueGames } from '../utils/dueGames.js'

const hours = {
  morning: { start: '07:00', end: '11:00' },
  afternoon: { start: '12:00', end: '17:00' },
  evening: { start: '18:00', end: '23:00' },
}

// A small in-memory stand-in for the collections startDueGames reads and writes. Notifications
// are recorded; anything else (e.g. short-id counters) quietly does nothing.
function fakeDb({ games, reservations }) {
  const notifications = []
  const matches = (doc, filter) => Object.entries(filter).every(([key, rule]) => {
    if (rule && typeof rule === 'object' && '$regex' in rule) return new RegExp(rule.$regex, rule.$options).test(String(doc[key] || ''))
    return doc[key] === rule
  })
  const apply = (doc, update) => {
    Object.assign(doc, update.$set || {})
    for (const key of Object.keys(update.$unset || {})) delete doc[key]
  }
  const db = {
    notifications,
    collection(name) {
      if (name === 'gameplay') {
        return {
          find: (filter) => ({ toArray: async () => games.filter((g) => matches(g, filter)) }),
          updateOne: async (filter, update) => {
            const doc = games.find((g) => matches(g, filter))
            if (doc) apply(doc, update)
            return { modifiedCount: doc ? 1 : 0 }
          },
        }
      }
      if (name === 'reservations') return { findOne: async (filter) => reservations.find((r) => matches(r, filter)) || null }
      if (name === 'notifications') {
        // nextShortId reads the latest id and the count before inserting.
        const cursor = { sort: () => cursor, limit: () => cursor, toArray: async () => [] }
        return {
          find: () => cursor,
          countDocuments: async () => notifications.length,
          insertOne: async (doc) => { notifications.push(doc) },
        }
      }
      return {
        findOne: async () => null,
        findOneAndUpdate: async () => ({ value: { seq: 1 }, seq: 1 }),
        updateOne: async () => ({}),
        insertOne: async () => ({}),
        countDocuments: async () => 0,
      }
    },
  }
  return db
}

// 07:30 in Manila on 2026-11-14 (Manila is UTC+8): morning has started, afternoon hasn't.
const now = new Date('2026-11-13T23:30:00Z')
const todayISO = '2026-11-14'

test('games whose slot began start on their own when every gun passed; others are held and marshals told once', async () => {
  const games = [
    { _id: 1, id: 'GP-1', Schedule: '2026-11-14 • morning', Status: 'Scheduled', reservationId: 'R-ok', Location: 'Salawag' },
    { _id: 2, id: 'GP-2', Schedule: '2026-11-14 • morning', Status: 'Scheduled', reservationId: 'R-untested' },
    { _id: 3, id: 'GP-3', Schedule: '2026-11-14 • afternoon', Status: 'Scheduled', reservationId: 'R-ok' }, // not yet
    { _id: 4, id: 'GP-4', Schedule: '2026-11-15 • morning', Status: 'Scheduled', reservationId: 'R-ok' }, // tomorrow
    { _id: 5, id: 'GP-5', Schedule: '2026-11-14 • morning', Status: 'Scheduled', reservationId: 'R-cancelled' },
    { _id: 6, id: 'GP-6', Schedule: '2026-11-14 • morning', Status: 'Completed', reservationId: 'R-ok' }, // staff done
  ]
  const reservations = [
    { id: 'R-ok', reservationStatus: 'confirmed' },
    { id: 'R-untested', reservationStatus: 'confirmed' },
    { id: 'R-cancelled', reservationStatus: 'cancelled' },
  ]
  const fpsStatusOf = async (reservation) => (reservation.id === 'R-untested'
    ? { allPassed: false, failed: 0, pending: 2 }
    : { allPassed: true, failed: 0, pending: 0 })
  const db = fakeDb({ games, reservations })

  const first = await startDueGames(db, { now, todayISO, hours, fpsStatusOf })
  assert.deepEqual(first, { started: ['GP-1'], blocked: ['GP-2'] })
  const byId = (id) => games.find((g) => g.id === id)
  assert.equal(byId('GP-1').Status, 'Ongoing')
  assert.equal(byId('GP-1').autoStartedBy, 'slot time')
  assert.equal(byId('GP-2').Status, 'Scheduled')
  assert.match(byId('GP-2').autoStartBlockedReason, /2 not tested yet/)
  assert.ok(byId('GP-2').dueToStartAtISO)
  for (const id of ['GP-3', 'GP-4', 'GP-5']) assert.equal(byId(id).Status, 'Scheduled')
  assert.equal(byId('GP-6').Status, 'Completed')
  assert.equal(db.notifications.length, 1)
  assert.equal(db.notifications[0].targetRole, 'marshal')

  // The next sweep doesn't notify the marshals again; once the guns pass, the game starts.
  await startDueGames(db, { now, todayISO, hours, fpsStatusOf })
  assert.equal(db.notifications.length, 1)
  const passed = await startDueGames(db, { now, todayISO, hours, fpsStatusOf: async () => ({ allPassed: true }) })
  assert.deepEqual(passed.started, ['GP-2'])
  assert.equal(byId('GP-2').Status, 'Ongoing')
  assert.equal(byId('GP-2').autoStartBlockedReason, undefined)
})
