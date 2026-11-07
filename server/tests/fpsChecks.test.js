import test from 'node:test'
import assert from 'node:assert/strict'
import { fpsBlockReason, gameFpsStatus, manilaDayStartISO } from '../utils/fpsChecks.js'

// In-memory rentals, weapons and fps_logs with just the queries gameFpsStatus makes.
function fakeDb({ rentals = [], weapons = [], logs = [] }) {
  const cursor = (rows) => ({ sort: () => cursor(rows), toArray: async () => rows })
  return {
    collection(name) {
      if (name === 'rentals') return { find: (q) => cursor(rentals.filter((r) => r.reservationId === q.reservationId && r.status === 'out' && r.itemCollection === 'weapons')) }
      if (name === 'weapons') return { find: (q) => cursor(weapons.filter((w) => w.source === 'player' && q.submittedBy.$in.includes(w.submittedBy))) }
      return {
        find: (q) => cursor(logs
          .filter((l) => q.weaponId.$in.includes(l.weaponId) && l.testedAtISO >= q.testedAtISO.$gte)
          .sort((a, b) => b.testedAtISO.localeCompare(a.testedAtISO))),
      }
    },
  }
}

const now = new Date('2026-11-08T03:00:00Z') // 11 AM in Manila
const today = (hour) => new Date(`2026-11-08T${String(hour).padStart(2, '0')}:00:00+08:00`).toISOString()
const reservation = { id: 'R-1', userId: 'P1', teamMembers: [{ id: 'P2', name: 'Juan' }], ownWeaponBringerIds: ['P2'], selectedOwnWeaponIds: [] }
const rentals = [
  { reservationId: 'R-1', itemCollection: 'weapons', status: 'out', itemId: 'W-1', itemName: 'M4 Rifle', unitLabel: '#1', itemCategory: 'rifles', playerName: 'Nick' },
  { reservationId: 'R-1', itemCollection: 'weapons', status: 'out', itemId: 'W-G', itemName: 'Grenades', unitLabel: '#1', itemCategory: 'grenades', playerName: 'Nick' },
]
const weapons = [{ id: 'W-OWN', name: 'MG', category: 'mg', source: 'player', submittedBy: 'P2', approvalStatus: 'approved' }]

test("Manila's day starts at 4 PM UTC the day before", () => {
  assert.equal(manilaDayStartISO(now), '2026-11-07T16:00:00.000Z')
})

test('the game needs a passing reading today for every rental and own gun (not grenades)', async () => {
  const none = await gameFpsStatus(fakeDb({ rentals, weapons }), reservation, { now })
  assert.deepEqual(none.items.map((i) => i.weaponId), ['W-1', 'W-OWN'])
  assert.equal(none.pending, 2)
  assert.match(fpsBlockReason(none), /2 not tested yet/)

  // Yesterday's pass doesn't count; a failed own gun blocks the start.
  const mixed = await gameFpsStatus(fakeDb({ rentals, weapons, logs: [
    { weaponId: 'W-1', result: 'pass', fps: 410, limit: 450, testedAtISO: '2026-11-07T05:00:00.000Z' },
    { weaponId: 'W-OWN', result: 'fail', fps: 480, limit: 450, testedAtISO: today(9) },
  ] }), reservation, { now })
  assert.equal(mixed.pending, 1)
  assert.equal(mixed.failed, 1)
  assert.match(fpsBlockReason(mixed), /1 failed/)

  // The latest reading wins: a retest after a fix passes.
  const passed = await gameFpsStatus(fakeDb({ rentals, weapons, logs: [
    { weaponId: 'W-1', result: 'pass', fps: 410, limit: 450, testedAtISO: today(9) },
    { weaponId: 'W-OWN', result: 'fail', fps: 480, limit: 450, testedAtISO: today(9) },
    { weaponId: 'W-OWN', result: 'pass', fps: 440, limit: 450, testedAtISO: today(10) },
  ] }), reservation, { now })
  assert.equal(passed.allPassed, true)
  assert.equal(fpsBlockReason(passed), '')
})
