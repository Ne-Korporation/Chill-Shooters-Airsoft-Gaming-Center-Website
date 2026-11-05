import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateBookingPrice } from '../utils/bookingPricing.js'

// A set price for 1 player is charged per player; a set price for a group of N fits exactly N.
const packages = [
  { id: 'normal', name: 'Normal', status: 'active', settledAmount: 750, players: 1, discountMode: 'settled', discountValue: 750 },
  { id: 'squad', name: 'Squad of 5', status: 'active', settledAmount: 3000, players: 5, discountMode: 'settled', discountValue: 3000 },
]
const findDocumentById = async (_db, collection, id) => (collection === 'packages' ? packages.find((pkg) => pkg.id === id) || null : null)
const price = (packageId, players) => calculateBookingPrice({
  db: {},
  payload: { selectionMode: 'package', selectedPackageId: packageId, sessionType: 'public' },
  players,
  findDocumentById,
  userId: 'player',
})

test('a set price for 1 player is charged once per player', async () => {
  assert.equal((await price('normal', 1)).totalAmount, 750)
  assert.equal((await price('normal', 4)).totalAmount, 3000)
})

test('a group set price fits only its group size', async () => {
  assert.equal((await price('squad', 5)).totalAmount, 3000)
  await assert.rejects(price('squad', 4), /group of 5 players/)
})
