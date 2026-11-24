import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateBookingPrice } from '../utils/bookingPricing.js'
import { computeSplitShares } from '../utils/splitShares.js'

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
    // Every player gets one of each listed weapon: a rifle AND grenades
    { id: 'grenadier', name: 'Grenadier', status: 'active', settledAmount: 0, basePrice: 0, weaponIds: ['M4-1', 'GRENADE-1'], weaponCount: 1, equipmentIds: [] },
    { id: 'gloves-pack', name: 'Gloves Pack', status: 'active', settledAmount: 0, basePrice: 0, weaponIds: [], equipmentIds: ['MASK-1', 'VEST-1'], equipmentQuantities: { 'VEST-1': 2 } },
  ],
  weapons: [
    { id: 'rifle', name: 'Rifle', price: 500, status: 'available' },
    { id: 'M4-1', name: 'M4 Rifle #1', model: 'M4 Rifle', price: 500, status: 'available' },
    { id: 'GRENADE-1', name: 'Grenades #1', model: 'Grenades', category: 'grenades', price: 200, status: 'available' },
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

test('extra ammo reloads are added at the reload price and capped', async () => {
  const base = { selectionMode: 'package', selectedPackageId: 'full-rental', sessionType: 'public' }
  const without = await calculateBookingPrice({ db: {}, payload: base, players: 1, findDocumentById, userId: 'player' })
  const withAmmo = await calculateBookingPrice({ db: {}, payload: { ...base, extraAmmoReloads: 3 }, players: 1, findDocumentById, userId: 'player' })
  assert.equal(withAmmo.totalAmount, without.totalAmount + 150)
  assert.ok(withAmmo.pricingBreakdown.some((line) => line.label === 'Extra ammo reloads (3)' && line.amount === 150))

  const bogus = await calculateBookingPrice({ db: {}, payload: { ...base, extraAmmoReloads: -4 }, players: 1, findDocumentById, userId: 'player' })
  assert.equal(bogus.totalAmount, without.totalAmount)
  const huge = await calculateBookingPrice({ db: {}, payload: { ...base, extraAmmoReloads: 9999 }, players: 1, findDocumentById, userId: 'player' })
  assert.equal(huge.totalAmount, without.totalAmount + 50 * 50)
  assert.ok(without.pricingBreakdown.some((line) => line.label === 'BB reloads included (2) — free' && line.amount === 0))
})

test('extra ammo bought per player is billed to that player even without per-player prices', async () => {
  // Everyone brings their own (custom, nothing picked): 2 x 150 entrance, P1 buys 4 reloads.
  const payload = { selectionMode: 'custom', sessionType: 'public', extraAmmoReloads: 4, extraAmmoByPlayer: { P1: 4 } }
  const result = await calculateBookingPrice({ db: {}, payload, players: 2, findDocumentById, userId: 'player' })
  assert.equal(result.totalAmount, 300 + 200)
  const shares = computeSplitShares({
    userId: 'P1', paymentMode: 'split', splitPayerIds: ['P2'], depositAmount: result.totalAmount,
    loadoutUnitCosts: result.loadoutUnitCosts, extraAmmoByPlayer: { P1: 4 },
  })
  assert.deepEqual(shares, { P1: 350, P2: 150 })

  // Without anyone's reloads named, a custom booking still splits evenly.
  const plain = await calculateBookingPrice({ db: {}, payload: { ...payload, extraAmmoByPlayer: undefined }, players: 2, findDocumentById, userId: 'player' })
  assert.equal(plain.loadoutUnitCosts, null)
})

test('an all-weapons package charges every listed weapon per player; own guns replace the main one', async () => {
  const price = (players, verifiedOwnWeaponCount = 0) => calculateBookingPrice({
    db: {},
    payload: { selectionMode: 'package', selectedPackageId: 'grenadier', sessionType: 'public', verifiedOwnWeaponCount },
    players,
    findDocumentById,
    userId: 'player',
  })
  // rifle 500 + grenades 200 + entrance 150, per player
  assert.equal((await price(1)).totalAmount, 850)
  assert.equal((await price(10)).totalAmount, 8500)
  // 2 players bring their own gun: they still rent grenades
  assert.equal((await price(3, 2)).totalAmount, 3 * 850 - 2 * 500)
})

test('a package player and an own-gun-and-gear player: the second pays the entrance fee only', async () => {
  // Full Package for 2: one gets the rifle, mask and vest (₱750); the other brings their own gun
  // and gear and pays the ₱150 entrance only.
  const result = await calculateBookingPrice({
    db: {},
    payload: { selectionMode: 'package', selectedPackageId: 'full-package', sessionType: 'public', verifiedOwnGearCount: 1 },
    players: 2,
    findDocumentById,
    userId: 'player',
  })
  assert.equal(result.totalAmount, 900)
  assert.deepEqual(result.loadoutUnitCosts, { package: 750, own_gun: 250, own_gear: 150, ammo: 50 })
  assert.ok(result.pricingBreakdown.some((line) => /Not taking the package \(1\)/.test(line.label)))
})

test('players not taking the package can rent just the gun, mask or vest at its rental price', async () => {
  // Full Package for 4: one takes the package (₱750); A rents just the gun (₱150 + ₱500);
  // B rents the mask and vest (₱150 + ₱50 + ₱50); C brings everything (₱150).
  const result = await calculateBookingPrice({
    db: {},
    payload: {
      selectionMode: 'package',
      selectedPackageId: 'full-package',
      sessionType: 'public',
      ownGearPlayerIds: ['A', 'B', 'C'],
      verifiedOwnGearCount: 3,
      ownGearRentals: { A: ['gun'], B: ['vest', 'mask', 'bogus'], X: ['gun'] },
    },
    players: 4,
    findDocumentById,
    userId: 'player',
  })
  assert.equal(result.totalAmount, 750 + 650 + 250 + 150)
  assert.equal(result.loadoutUnitCosts.rent_gun, 500)
  assert.equal(result.loadoutUnitCosts.rent_mask, 50)
  assert.ok(result.pricingBreakdown.some((line) => /M4 Rifle rental only \(1\)/.test(line.label)))
  // The package player and the gun renter get the included BBs.
  assert.ok(result.pricingBreakdown.some((line) => /BB reloads included \(4\)/.test(line.label)))
})

test('players can pick their own rental guns, and a package player can add another gun', async () => {
  // Full Package for 2: P1 takes the package and adds a second M4 (₱500); P2 doesn't take the
  // package and rents a picked M4 (₱150 + ₱500). Grenades can't be picked: they aren't a gun.
  const result = await calculateBookingPrice({
    db: {},
    payload: {
      selectionMode: 'package',
      selectedPackageId: 'full-package',
      sessionType: 'public',
      ownGearPlayerIds: ['P2'],
      verifiedOwnGearCount: 1,
      playerGuns: { P1: ['M4-1'], P2: ['M4-1'] },
    },
    players: 2,
    findDocumentById,
    userId: 'player',
  })
  assert.equal(result.totalAmount, 750 + 500 + 150 + 500)
  assert.deepEqual(result.playerGunCosts, { P1: 500, P2: 500 })
  assert.ok(result.pricingBreakdown.some((line) => /M4 Rifle rental, picked by players \(2\)/.test(line.label)))
  // P2 rents a gun, so they get the included BBs too.
  assert.ok(result.pricingBreakdown.some((line) => /BB reloads included \(4\)/.test(line.label)))
  await assert.rejects(calculateBookingPrice({
    db: {},
    payload: { selectionMode: 'package', selectedPackageId: 'full-package', sessionType: 'public', playerGuns: { P1: ['GRENADE-1'] } },
    players: 1,
    findDocumentById,
    userId: 'player',
  }), /can't be rented/)
})

test('renting a piece the package does not include is refused', async () => {
  await assert.rejects(calculateBookingPrice({
    db: {},
    payload: { selectionMode: 'package', selectedPackageId: 'gloves-pack', sessionType: 'public', ownGearPlayerIds: ['A'], verifiedOwnGearCount: 1, ownGearRentals: { A: ['gun'] } },
    players: 2,
    findDocumentById,
    userId: 'player',
  }), /no gun/)
})

test('a per-player set price leaves out a player bringing their own gear: they pay the entrance fee instead', async () => {
  // Full Rental is ₱750 per player. Two players: one gets it, one brings their own (₱150 entrance).
  const result = await calculateBookingPrice({
    db: {},
    payload: { selectionMode: 'package', selectedPackageId: 'full-rental', sessionType: 'public', verifiedOwnGearCount: 1 },
    players: 2,
    findDocumentById,
    userId: 'player',
  })
  assert.equal(result.totalAmount, 900)
  assert.equal(result.loadoutUnitCosts.own_gear, 150)
})

test('a price for a whole group cannot leave out a player bringing their own gear', async () => {
  records.packages.push({ id: 'duo-squad', name: 'Duo Squad', status: 'active', settledAmount: 1400, players: 2 })
  await assert.rejects(calculateBookingPrice({
    db: {},
    payload: { selectionMode: 'package', selectedPackageId: 'duo-squad', sessionType: 'public', verifiedOwnGearCount: 1 },
    players: 2,
    findDocumentById,
    userId: 'player',
  }), /group of 2/)
})
test('a private game under 10 players is billed as 10; the captain pays the empty spots', async () => {
  const price = (payload, players) => calculateBookingPrice({ db: {}, payload: { selectionMode: 'package', selectedPackageId: 'full-rental', ...payload }, players, findDocumentById, userId: 'player' })
  const five = await price({ sessionType: 'private' }, 5)
  // 5 players x ₱750 + 5 empty spots x ₱750 = the price of 10.
  assert.equal(five.privateEmptySpots, 5)
  assert.equal(five.privateMinimumCharge, 3750)
  assert.equal(five.totalAmount, 7500)
  assert.ok(five.pricingBreakdown.some((line) => /Private game minimum: 5 empty spots/.test(line.label) && line.amount === 3750))
  // 10 or more players, and public games, have no empty spots.
  assert.equal((await price({ sessionType: 'private' }, 12)).privateMinimumCharge, 0)
  assert.equal((await price({ sessionType: 'public' }, 3)).totalAmount, 2250)

  // Split between the captain and 4 teammates: the captain's share includes the empty spots.
  const booking = { ...five, userId: 'P1', paymentMode: 'split', splitPayerIds: ['P2', 'P3', 'P4', 'P5'], numberOfPlayers: 5, teamMembers: [], ownGearPlayerIds: [], ownWeaponBringers: [] }
  const shares = computeSplitShares(booking)
  // Online now: 50% of ₱7,500. Teammates pay their own ₱375; the captain ₱375 + ₱1,875 for the spots.
  assert.deepEqual(shares, { P1: 2250, P2: 375, P3: 375, P4: 375, P5: 375 })
})

test('private fields follow the headcount, empty spots included', async () => {
  const { fieldCountForPlayers, billedPlayers } = await import('../utils/privateGames.js')
  assert.equal(billedPlayers('private', 5), 10)
  assert.equal(billedPlayers('public', 5), 5)
  assert.deepEqual([5, 10, 19, 20, 29, 30, 60].map(fieldCountForPlayers), [1, 1, 1, 2, 2, 3, 3])
})
