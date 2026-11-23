import test from 'node:test'
import assert from 'node:assert/strict'
import { computeSplitShares, loadoutOf } from '../utils/splitShares.js'
import { getGcashAmountDue } from '../utils/paymentRules.js'

// A package costing ₱1,000 per player (entrance ₱200 of it, main gun ₱300), 50% online.
const costs = { package: 1000, own_gun: 700, own_gear: 200 }
const booking = (overrides = {}) => ({
  userId: 'P1',
  paymentMode: 'split',
  splitPayerIds: ['P2', 'P3'],
  teamSize: 3,
  numberOfPlayers: 3,
  depositAmount: 1100, // (1000 + 1000 + 200) / 2
  loadoutUnitCosts: costs,
  ownGearPlayerIds: ['P3'],
  ownWeaponBringers: [],
  ...overrides,
})

test('each player is charged for what they get: package vs own gear (entrance only)', () => {
  const shares = computeSplitShares(booking())
  assert.deepEqual(shares, { P1: 500, P2: 500, P3: 100 })
})

test('an own-gun player pays less than a package player', () => {
  const shares = computeSplitShares(booking({ ownGearPlayerIds: [], ownWeaponBringers: [{ userId: 'P2', verified: true }], depositAmount: 1350 }))
  assert.deepEqual(shares, { P1: 500, P2: 350, P3: 500 })
})

test('a player renting just the gun pays the entrance fee plus the gun', () => {
  // P3 rents only the gun (₱200 + ₱300 = ₱500): half of a package player.
  const shares = computeSplitShares(booking({
    loadoutUnitCosts: { ...costs, rent_gun: 300, rent_mask: 50 },
    ownGearRentals: { P3: ['gun'] },
    depositAmount: 1250, // (1000 + 1000 + 500) / 2
  }))
  assert.deepEqual(shares, { P1: 500, P2: 500, P3: 250 })
})

test("a minor's guardian pays for the minor, on top of their own share", () => {
  // P1, P2, P3 all take the package (₱1,000 each); P1's child K also does. Online 2,000 = 4 × 500.
  const shares = computeSplitShares(booking({
    ownGearPlayerIds: [],
    teamMembers: [{ id: 'P2' }, { id: 'P3' }, { id: 'K', isMinor: true, guardianId: 'P1' }],
    numberOfPlayers: 4,
    depositAmount: 2000,
  }))
  assert.deepEqual(shares, { P1: 1000, P2: 500, P3: 500 })
})

test('a payer whose share went up pays the difference, and only then counts as paid', async () => {
  const { getPaymentProgress } = await import('../utils/paymentRules.js')
  // P1 paid ₱100 before their share became ₱1,000 (they now also pay for their child).
  const reservation = booking({ depositAmount: 2000, splitShares: { P1: 1000, P2: 500, P3: 500 } })
  const payments = [{ userId: 'P1', amount: 100, paymentStatus: 'paid' }]
  assert.equal(getGcashAmountDue(reservation, payments, 'P1'), 900)
  assert.equal(getGcashAmountDue(reservation, payments, 'P2'), 500)
  assert.deepEqual(getPaymentProgress(reservation, payments).paidPayerIds, [])
  assert.deepEqual(getPaymentProgress(reservation, [...payments, { userId: 'P1', amount: 900, paymentStatus: 'paid' }]).paidPayerIds, ['P1'])
})

test('the shares always add up to the online amount', () => {
  const shares = computeSplitShares(booking({ depositAmount: 1099.99 }))
  const sum = Object.values(shares).reduce((a, b) => a + b, 0)
  assert.equal(Math.round(sum * 100) / 100, 1099.99)
})

test('everyone getting the same thing keeps the even split', () => {
  assert.equal(computeSplitShares(booking({ ownGearPlayerIds: [] })), null)
})

test('loadoutOf reads the choice made for each player', () => {
  const r = booking({ ownWeaponBringers: [{ userId: 'P2', verified: true }] })
  assert.equal(loadoutOf(r, 'P1'), 'package')
  assert.equal(loadoutOf(r, 'P2'), 'own_gun')
  assert.equal(loadoutOf(r, 'P3'), 'own_gear')
})

test('a payer is asked for their own share', () => {
  const r = { ...booking(), splitShares: computeSplitShares(booking()) }
  assert.equal(getGcashAmountDue(r, [], 'P3'), 100)
  assert.equal(getGcashAmountDue(r, [], 'P2'), 500)
})
