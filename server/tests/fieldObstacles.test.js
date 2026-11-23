import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultObstaclesFor, getFieldObstacles, validateObstacleCounts } from '../utils/fieldObstacles.js'

test('each field has its own default obstacles (the Forest has no containers)', () => {
  assert.equal(defaultObstaclesFor('salawag-field-1').tower, 2)
  assert.equal(defaultObstaclesFor('binan-field-3').container, 0)
  assert.notDeepEqual(defaultObstaclesFor('langkaan-field-1'), defaultObstaclesFor('langkaan-field-2'))
})

test('an admin can only save whole numbers 0–99 for every obstacle', () => {
  const ok = { wall: 5, bunker: 0, barrel: 3, tires: 2, tower: 1, container: 0 }
  assert.deepEqual(validateObstacleCounts(ok).counts, ok)
  assert.ok(validateObstacleCounts({ ...ok, wall: -1 }).error)
  assert.ok(validateObstacleCounts({ ...ok, tower: 1.5 }).error)
  assert.ok(validateObstacleCounts({ wall: 5 }).error)
})

test("saved counts replace a field's defaults; other fields keep theirs", async () => {
  const db = { collection: () => ({ findOne: async () => ({ fields: { 'salawag-field-1': { tower: 0, wall: 3 } } }) }) }
  const counts = await getFieldObstacles(db, ['salawag-field-1', 'salawag-field-2'])
  assert.equal(counts['salawag-field-1'].tower, 0)
  assert.equal(counts['salawag-field-1'].wall, 3)
  assert.equal(counts['salawag-field-1'].bunker, defaultObstaclesFor('salawag-field-1').bunker)
  assert.deepEqual(counts['salawag-field-2'], defaultObstaclesFor('salawag-field-2'))
})

test('a custom layout is priced by tier, by how many props are placed (markers are free)', async () => {
  const { countLayoutPieces, layoutFeeFor } = await import('../utils/fieldObstacles.js')
  const props = (n) => Array.from({ length: n }, (_, i) => ({ type: 'barrel', x: i, y: 0 }))
  assert.equal(countLayoutPieces([...props(3), { type: 'spawnA' }, { type: 'flag' }]), 3)
  assert.equal(layoutFeeFor(0), null)
  assert.equal(layoutFeeFor(1).label, 'Simple')
  assert.equal(layoutFeeFor(10).price, 300)
  assert.equal(layoutFeeFor(11).label, 'Standard')
  assert.equal(layoutFeeFor(26).label, 'Complex')
  assert.equal(layoutFeeFor(200).price, 1000)
})

test('layout tiers an admin saves must grow, and the last has no piece limit', async () => {
  const { validateLayoutFees } = await import('../utils/fieldObstacles.js')
  assert.deepEqual(validateLayoutFees([{ maxPieces: 8, price: 250 }, { maxPieces: 20, price: 500 }, { price: 900 }]).tiers.map((t) => t.maxPieces), [8, 20, null])
  assert.ok(validateLayoutFees([{ maxPieces: 20, price: 250 }, { maxPieces: 10, price: 500 }, { price: 900 }]).error)
  assert.ok(validateLayoutFees([{ maxPieces: 8, price: -1 }, { maxPieces: 20, price: 500 }, { price: 900 }]).error)
})

test('the booking price adds the layout tier for private games only; an uploaded plan is Standard', async () => {
  const { calculateBookingPrice } = await import('../utils/bookingPricing.js')
  const base = { selectionMode: 'custom', customWeaponIds: [], customEquipmentIds: [] }
  const price = (payload) => calculateBookingPrice({ db: null, payload: { ...base, ...payload }, players: 10, findDocumentById: async () => null, userId: null })
  const plain = await price({ sessionType: 'private' })
  const designed = await price({ sessionType: 'private', fieldLayoutItems: Array.from({ length: 12 }, () => ({ type: 'wall' })) })
  assert.equal(designed.totalAmount - plain.totalAmount, 600)
  assert.ok(designed.pricingBreakdown.some((line) => /Custom field layout \(Standard, 12 pieces\)/.test(line.label)))
  const uploaded = await price({ sessionType: 'private', layoutBlueprintUrl: 'https://example.com/plan.png' })
  assert.equal(uploaded.totalAmount - plain.totalAmount, 600)
  const publicGame = await price({ sessionType: 'public', fieldLayoutItems: [{ type: 'wall' }] })
  assert.equal(publicGame.layoutFeeAmount, 0)
})

test("a layout can't use more of a piece than the booked fields have", async () => {
  const { assertLayoutFitsFields } = await import('../utils/fieldObstacles.js')
  const db = { collection: () => ({ findOne: async () => null }) }
  // The Forest (field-3) has no containers by default.
  await assert.rejects(assertLayoutFitsFields(db, [{ type: 'container' }], ['salawag-field-3']), /field has 0/)
  await assertLayoutFitsFields(db, [{ type: 'container' }], ['salawag-field-1'])
  await assert.rejects(assertLayoutFitsFields(db, [{ type: 'spawnA' }, { type: 'spawnA' }], ['salawag-field-1']), /at most 1/)
})
