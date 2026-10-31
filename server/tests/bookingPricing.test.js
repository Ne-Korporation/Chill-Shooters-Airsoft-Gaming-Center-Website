import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateBookingPrice } from '../utils/bookingPricing.js'

const records = {
  packages: [
    // Manuscript full package: ₱150 entrance + ₱500 rifle (2 mags, 600 BBs) + ₱50 mask + ₱50 vest = ₱750
    { id: 'full-package', name: 'Full Package', status: 'active', settledAmount: 0, basePrice: 0, weaponIds: ['M4-1'], weaponCount: 1, equipmentIds: ['MASK-1', 'VEST-1'] },
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
    // Two gloves per player, one mask (the default)
    { id: 'gloves-pack', name: 'Gloves Pack', status: 'active', settledAmount: 0, basePrice: 0, weaponIds: [], equipmentIds: ['MASK-1', 'VEST-1'], equipmentQuantities: { 'VEST-1': 2 } },
  ],
  weapons: [
    { id: 'rifle', name: 'Rifle', price: 500, status: 'available' },
    { id: 'M4-1', name: 'M4 Rifle #1', model: 'M4 Rifle', price: 500, status: 'available' },
  ],
  equipments: [
    { id: 'vest', name: 'Vest', price: 50, qty: 10, status: 'available' },
    { id: 'MASK-1', name: 'Mask #1', model: 'Mask', price: 50, status: 'available' },
    { id: 'VEST-1', name: 'Vest #1', model: 'Vest', price: 50, status: 'available' },
  ],
  user_accounts: [
    { id: 'verified-cvsu', partnershipInstitution: 'Cavite State University', partnershipEligibilityStatus: 'verified' },
    { id: 'verified-scouts', partnershipInstitution: 'Scouts Council', partnershipEligibilityStatus: 'verified' },
    { id: 'verified-former', partnershipInstitution: 'Former Partner', partnershipEligibilityStatus: 'verified' },
    { id: 'pending-scouts', partnershipInstitution: 'Scouts Council', partnershipEligibilityStatus: 'pending' },
  ],
}

async function findDocumentById(_db, collection, id) {
  return records[collection]?.find((record) => record.id === id) || null
}

// Minimal partnerships collection: case-insensitive exact name lookup.
function dbWithPartners(partners) {
  return {
    collection: (name) => ({
      findOne: async (query) => {
        if (name !== 'partnerships') return null
        const pattern = new RegExp(query.name.$regex, query.name.$options)
        return partners.find((partner) => pattern.test(partner.name)) || null
      },
    }),
  }
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

test('custom rentals charge each chosen piece once plus entrance, and half as deposit', async () => {
  const result = await calculateBookingPrice({
    db: {},
    payload: { selectionMode: 'custom', customWeaponIds: ['rifle'], customEquipmentIds: ['vest'], sessionType: 'public' },
    players: 2,
    findDocumentById,
    userId: 'player',
  })

  // one rifle 500 + one vest 50 + entrance 2 × 150
  assert.equal(result.totalAmount, 850)
  assert.equal(result.depositAmount, 425)
  assert.equal(result.balanceAmount, 425)
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
    db: dbWithPartners([]),
    payload: { selectionMode: 'package', selectedPackageId: 'full-rental', sessionType: 'public' },
    players: 1,
    findDocumentById,
    userId: 'verified-cvsu',
  })

  assert.equal(result.totalAmount, 675)
  assert.equal(result.depositAmount, 338)
})

test("a verified member gets the active partner organization's discount rate", async () => {
  const db = dbWithPartners([
    { name: 'Scouts Council', status: 'active', discountPercent: 20 },
    { name: 'Cavite State University', status: 'active', discountPercent: 15 },
  ])
  const price = (userId) => calculateBookingPrice({
    db,
    payload: { selectionMode: 'package', selectedPackageId: 'full-rental', sessionType: 'public' },
    players: 1,
    findDocumentById,
    userId,
  })
  const scouts = await price('verified-scouts')
  assert.equal(scouts.totalAmount, 600)
  assert.deepEqual(scouts.pricingBreakdown.at(-1), { label: 'Verified Scouts Council discount (20%)', amount: -150 })
  // A CvSU partnership record overrides the CVSU_DISCOUNT_PERCENT fallback.
  assert.equal((await price('verified-cvsu')).totalAmount, 637)
  // Not yet verified: no discount.
  assert.equal((await price('pending-scouts')).totalAmount, 750)
})

test('no discount when the partnership is inactive or has no record', async () => {
  const db = dbWithPartners([{ name: 'Former Partner', status: 'inactive', discountPercent: 30 }])
  const result = await calculateBookingPrice({
    db,
    payload: { selectionMode: 'package', selectedPackageId: 'full-rental', sessionType: 'public' },
    players: 1,
    findDocumentById,
    userId: 'verified-former',
  })
  assert.equal(result.totalAmount, 750)
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

test('the full package is ₱750 per player with a 50% deposit', async () => {
  const one = await calculateBookingPrice({
    db: {},
    payload: { selectionMode: 'package', selectedPackageId: 'full-package', sessionType: 'public' },
    players: 1,
    findDocumentById,
    userId: 'player',
  })
  assert.equal(one.totalAmount, 750)
  assert.equal(one.depositAmount, 375)

  const ten = await calculateBookingPrice({
    db: {},
    payload: { selectionMode: 'package', selectedPackageId: 'full-package', sessionType: 'private' },
    players: 10,
    findDocumentById,
    userId: 'player',
  })
  assert.equal(ten.totalAmount, 7500)
})

test('package equipment is charged per piece: players x quantity per player', async () => {
  const result = await calculateBookingPrice({
    db: {},
    payload: { selectionMode: 'package', selectedPackageId: 'gloves-pack', sessionType: 'public' },
    players: 2,
    findDocumentById,
    userId: 'player',
  })
  // 2 x 150 entrance + 2 x 1 x 50 mask + 2 x 2 x 50 vest
  assert.equal(result.totalAmount, 300 + 100 + 200)
})
