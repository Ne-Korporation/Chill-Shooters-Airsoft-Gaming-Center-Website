import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getBlockingSlotReservations,
  getSlotPlayerCount,
  normalizeLocationId,
} from '../utils/bookingSlots.js'

test('slot capacity counts pending and confirmed reservations but excludes cancelled or different locations', () => {
  assert.equal(normalizeLocationId('Biñan Field'), 'binan')
  const reservations = [
    { locationId: 'Biñan Field', reservationStatus: 'pending', numberOfPlayers: 12 },
    { location: 'binan', reservationStatus: 'confirmed', players: 8 },
    { locationId: 'binan', reservationStatus: 'cancelled', numberOfPlayers: 20 },
    { locationId: 'salawag', reservationStatus: 'approved', numberOfPlayers: 40 },
    { locationId: 'binan', reservationStatus: 'needs review', numberOfPlayers: 15 },
  ]

  const blocking = getBlockingSlotReservations({
    reservations,
    locationId: 'binan',
    normalizeLocationId,
  })

  assert.equal(blocking.length, 2)
  assert.equal(getSlotPlayerCount(blocking), 20)
})
