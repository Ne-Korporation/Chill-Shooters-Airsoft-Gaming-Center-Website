import test from 'node:test'
import assert from 'node:assert/strict'
import { causeDayFigures } from '../utils/causeDayDonations.js'

const cause = { dateISO: '2026-11-21', donationPercent: 50 }

test('a cause day gives its share of what was collected, not of unpaid bookings', () => {
  const reservations = [
    { id: 'R-1', reservationStatus: 'confirmed', totalAmount: 1000, numberOfPlayers: 4 },
    { id: 'R-2', reservationStatus: 'pending', totalAmount: 600, numberOfPlayers: 2 },
  ]
  const payments = [
    { reservationId: 'R-1', paymentStatus: 'paid', amount: 1000 },
    { reservationId: 'R-2', paymentStatus: 'pending', amount: 600 },
  ]
  const figures = causeDayFigures(cause, reservations, payments)
  assert.equal(figures.collected, 1000)
  assert.equal(figures.donation, 500)
  assert.equal(figures.expected, 800)
  assert.equal(figures.bookings, 2)
  assert.equal(figures.players, 6)
})

test('a booking keeps the share it was made under, and cancelled bookings give nothing', () => {
  const reservations = [
    { id: 'R-1', reservationStatus: 'confirmed', totalAmount: 1000, causeDay: { donationPercent: 100 } },
    { id: 'R-2', reservationStatus: 'cancelled', totalAmount: 500 },
  ]
  const payments = [
    { reservationId: 'R-1', paymentStatus: 'verified', amount: 1000 },
    { reservationId: 'R-2', paymentStatus: 'paid', amount: 500 },
  ]
  const figures = causeDayFigures(cause, reservations, payments)
  assert.equal(figures.donation, 1000)
  assert.equal(figures.collected, 1000)
})
