import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateBookingPrice } from '../utils/bookingPricing.js'

const records = {
  packages: [
    { id: 'full-rental', name: 'Full Rental', status: 'active', settledAmount: 750, players: 1 },
    {
      id: 'computed-rental',
      name: 'Computed Rental',
      status: 'active',
      settledAmount: 0,
      basePrice: 100,
      weaponIds: ['rifle'],
      equipmentIds: ['vest'],
      weaponCount: 1,
    },
  ],
  weapons: [
    { id: 'rifle', name: 'Rifle', price: 500, status: 'available' },
  ],
  equipments: [
    { id: 'vest', name: 'Vest', price: 50, qty: 10, status: 'available' },
  ],
  user_accounts: [
    { id: 'verified-cvsu', partnershipInstitution: 'Cavite State University', partnershipEligibilityStatus: 'verified' },
  ],
}

async function findDocumentById(_db, collection, id) {
  return records[collection]?.find((record) => record.id === id) || null
}

test('standard rental package charges the 50 percent deposit', async () => {
  const result = await calculateBookingPrice({
    db: {},
    payload: { selectionMode: 'package', selectedPackageId: 'full-rental', sessionType: 'public', totalAmount: 1, ownWeapons: 999 },
    players: 1,
    findDocumentById,
    userId: 'player',
  })

  test('computed package pricing ignores client totals and claimed own-weapon counts', async () => {
    const result = await calculateBookingPrice({
      db: {},
      payload: {
        selectionMode: 'package',
        selectedPackageId: 'computed-rental',
        sessionType: 'public',
        totalAmount: 1,
        ownWeapons: 999,
      },
      players: 2,
      findDocumentById,
      userId: 'player',
    })

    assert.equal(result.totalAmount, 1600)
    assert.equal(result.depositAmount, 800)
    assert.equal(result.balanceAmount, 800)
  })

  assert.equal(result.totalAmount, 750)
  assert.equal(result.depositAmount, 375)
  assert.equal(result.balanceAmount, 375)
})

test('custom rentals calculate item prices on the server and charge half as deposit', async () => {
  const result = await calculateBookingPrice({
    db: {},
    payload: { selectionMode: 'custom', customWeaponIds: ['rifle'], customEquipmentIds: ['vest'], sessionType: 'public' },
    players: 2,
    findDocumentById,
    userId: 'player',
  })

  assert.equal(result.totalAmount, 1400)
  assert.equal(result.depositAmount, 700)
  assert.equal(result.balanceAmount, 700)
})

test('own-gear bookings charge entrance fees and cap the fixed deposit at the total', async () => {
  const singlePlayer = await calculateBookingPrice({
    db: {},
    payload: { selectionMode: 'custom', customWeaponIds: [], customEquipmentIds: [], sessionType: 'public' },
    players: 1,
    findDocumentById,
    userId: 'player',
  })
  const group = await calculateBookingPrice({
    db: {},
    payload: { selectionMode: 'custom', customWeaponIds: [], customEquipmentIds: [], sessionType: 'public' },
    players: 4,
    findDocumentById,
    userId: 'player',
  })

  assert.equal(singlePlayer.totalAmount, 150)
  assert.equal(singlePlayer.depositAmount, 150)
  assert.equal(group.totalAmount, 600)
  assert.equal(group.depositAmount, 350)
})

test('verified CvSU eligibility applies the configured discount from server profile data', async () => {
  const result = await calculateBookingPrice({
    db: {},
    payload: { selectionMode: 'package', selectedPackageId: 'full-rental', sessionType: 'public' },
    players: 1,
    findDocumentById,
    userId: 'verified-cvsu',
  })

  assert.equal(result.totalAmount, 675)
  assert.equal(result.depositAmount, 338)
})

test('verified own weapons replace rental weapons in package and custom pricing', async () => {
  const base = { sessionType: 'public', verifiedOwnWeaponCount: 2 }
  const packaged = await calculateBookingPrice({
    db: {},
    payload: { ...base, selectionMode: 'package', selectedPackageId: 'computed-rental' },
    players: 3,
    findDocumentById,
    userId: 'player',
  })
  // base 300 + 1 rented rifle 500 + vests 150 + entrance 450
  assert.equal(packaged.totalAmount, 1400)

  const custom = await calculateBookingPrice({
    db: {},
    payload: { ...base, selectionMode: 'custom', customWeaponIds: ['rifle'], customEquipmentIds: [] },
    players: 3,
    findDocumentById,
    userId: 'player',
  })
  // 1 rented rifle 500 + entrance 450
  assert.equal(custom.totalAmount, 950)

  const unverified = await calculateBookingPrice({
    db: {},
    payload: { selectionMode: 'package', selectedPackageId: 'computed-rental', sessionType: 'public', ownWeapons: 2 },
    players: 3,
    findDocumentById,
    userId: 'player',
  })
  assert.equal(unverified.totalAmount, 2400)
})
