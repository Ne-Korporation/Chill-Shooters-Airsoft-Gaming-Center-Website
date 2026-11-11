import test from 'node:test'
import assert from 'node:assert/strict'
import { closePastGames, gameDateOf } from '../utils/pastGames.js'

// A tiny in-memory stand-in for the two collections closePastGames reads and updates.
function fakeDb({ games, reservations }) {
  const statusOpen = (game) => /^(sched|ongo)/i.test(String(game.Status || ''))
  return {
    collection(name) {
      if (name === 'gameplay') {
        return {
          find: () => ({ toArray: async () => games.filter(statusOpen) }),
          updateMany: async (filter, update) => {
            const ids = new Set(filter._id.$in)
            let modifiedCount = 0
            for (const game of games) {
              if (ids.has(game._id) && statusOpen(game)) {
                Object.assign(game, update.$set)
                modifiedCount += 1
              }
            }
            return { modifiedCount }
          },
        }
      }
      if (name === 'reservations') return { find: () => ({ toArray: async () => reservations }) }
      throw new Error(`unexpected collection ${name}`)
    },
  }
}

test('the game day is read from the Schedule', () => {
  assert.equal(gameDateOf({ Schedule: '2026-11-07 • afternoon' }), '2026-11-07')
  assert.equal(gameDateOf({ Schedule: '' }), '')
  assert.equal(gameDateOf({}), '')
})

test('games from past days are closed; today, future and already-closed games are left alone', async () => {
  const games = [
    { _id: 'g1', Schedule: '2026-11-07 • afternoon', Status: 'Scheduled', reservationId: 'R1' },
    { _id: 'g2', Schedule: '2026-11-07 • morning', Status: 'Ongoing', reservationId: 'R2' },
    { _id: 'g3', Schedule: '2026-11-07 • evening', Status: 'Scheduled', reservationId: 'R3' }, // booking cancelled
    { _id: 'g4', Schedule: '2026-11-11 • morning', Status: 'Scheduled', reservationId: 'R4' }, // today
    { _id: 'g5', Schedule: '2026-11-14 • morning', Status: 'Scheduled', reservationId: 'R5' }, // future
    { _id: 'g6', Schedule: '2026-11-07 • morning', Status: 'Completed', reservationId: 'R6' },
    { _id: 'g7', Schedule: '', Status: 'Scheduled', reservationId: 'R7' }, // no date: unknown, left alone
  ]
  const reservations = [{ _id: 'x3', id: 'R3', reservationStatus: 'cancelled' }]
  const result = await closePastGames(fakeDb({ games, reservations }), { todayISO: '2026-11-11', now: new Date('2026-11-11T02:00:00Z') })

  assert.deepEqual(result, { completed: 2, cancelled: 1 })
  const statusOf = (id) => games.find((game) => game._id === id).Status
  assert.equal(statusOf('g1'), 'Completed')
  assert.equal(statusOf('g2'), 'Completed')
  assert.equal(statusOf('g3'), 'Cancelled')
  assert.equal(statusOf('g4'), 'Scheduled')
  assert.equal(statusOf('g5'), 'Scheduled')
  assert.equal(statusOf('g7'), 'Scheduled')
  assert.equal(games.find((game) => game._id === 'g1').autoCompletedBy, 'day passed')
})
