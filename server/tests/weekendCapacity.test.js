import assert from 'node:assert/strict'
import { summarizeWeekendCapacity, weekendDatesOf } from '../utils/weekendCapacity.js'
import { normalizeLocationId } from '../utils/bookingSlots.js'

// Week runs Monday to Sunday.
assert.deepEqual(weekendDatesOf('2026-11-04'), ['2026-11-07', '2026-11-08']) // Wednesday
assert.deepEqual(weekendDatesOf('2026-11-02'), ['2026-11-07', '2026-11-08']) // Monday
assert.deepEqual(weekendDatesOf('2026-11-07'), ['2026-11-07', '2026-11-08']) // Saturday
assert.deepEqual(weekendDatesOf('2026-11-08'), ['2026-11-07', '2026-11-08']) // Sunday
assert.deepEqual(weekendDatesOf('2026-12-30'), ['2027-01-02', '2027-01-03']) // across a year

const summary = summarizeWeekendCapacity({
  dates: ['2026-11-07', '2026-11-08'],
  todayISO: '2026-11-08',
  capacities: { salawag: { morning: 200, afternoon: 190 } },
  locationNames: { salawag: 'Delta Stronghold (Salawag)' },
  reservations: [
    { reservationDate: '2026-11-08', reservationTime: 'morning', locationId: 'salawag', reservationStatus: 'confirmed', numberOfPlayers: 12 },
    { reservationDate: '2026-11-08', reservationTime: 'morning', location: 'Delta Stronghold (Salawag)', reservationStatus: 'pending', players: 3 },
    // Cancelled bookings and other dates don't count.
    { reservationDate: '2026-11-08', reservationTime: 'morning', locationId: 'salawag', reservationStatus: 'cancelled', numberOfPlayers: 50 },
    { reservationDate: '2026-11-15', reservationTime: 'morning', locationId: 'salawag', reservationStatus: 'confirmed', numberOfPlayers: 50 },
  ],
  holds: [{ reservationDate: '2026-11-08', reservationTime: 'afternoon', locationId: 'salawag', players: 4 }],
  normalizeLocationId,
})

assert.equal(summary[0].past, true)
assert.equal(summary[0].booked, 0)
const sunday = summary[1]
assert.equal(sunday.past, false)
assert.equal(sunday.capacity, 390)
assert.equal(sunday.booked, 19)
assert.deepEqual(sunday.locations[0].slots, [
  { slot: 'morning', capacity: 200, booked: 15, remaining: 185, groups: 2 },
  { slot: 'afternoon', capacity: 190, booked: 4, remaining: 186, groups: 0 },
])
assert.equal(sunday.groups, 2)

console.log('weekend capacity checks passed')
