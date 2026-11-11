import test from 'node:test'
import assert from 'node:assert/strict'
import { askGemini, buildPrompt, checkSuggestions, geminiConfig, summarizeBookings, summarizeRentalModels } from '../utils/packageSuggestions.js'
import { takeSuggestionCall } from '../routes/recommendations.js'

const weapons = [
  { id: 'W1', model: 'M4 Rifle', category: 'rifles', price: 500, status: 'available' },
  { id: 'W2', model: 'M4 Rifle', category: 'rifles', price: 500, status: 'rented' },
  { id: 'W3', model: 'Glock Pistol', category: 'pistols', price: 300, status: 'maintenance' },
  { id: 'W9', model: 'Own Gun', category: 'rifles', price: 0, status: 'available', source: 'player' },
]
const equipment = [
  { id: 'EQ1', name: 'Mask #1', category: 'gear', price: 50, status: 'available' },
  { id: 'EQ2', name: 'Vest #1', category: 'gear', price: 50, status: 'available' },
  { id: 'EQ3', name: 'BB Ammo', category: 'ammo', price: 100, stockGrams: 5000 },
]
const context = {
  entranceFee: 150,
  weaponModels: summarizeRentalModels(weapons),
  gearModels: summarizeRentalModels(equipment),
  currentPackages: [{ name: 'Normal', players: 1, minPlayers: 1, price: 750, includes: ['M4 Rifle', 'Mask', 'Vest', 'BB Ammo'] }],
  bookings: { total: 0 },
  lookbackDays: 90,
}
const good = { name: 'Squad of 5', description: 'Group deal', weapons: ['m4 rifle'], gear: [{ model: 'Mask', perPlayer: 1 }, { model: 'BB Ammo', perPlayer: 2 }], players: 5, minPlayers: 3, price: 4000, bbReloadGrams: 500, reason: 'Groups of 5 book often.' }

test('rental models group pieces, skip player-owned gear and count what is available', () => {
  const m4 = context.weaponModels.find((item) => item.model === 'M4 Rifle')
  assert.deepEqual([m4.total, m4.available, m4.pieceId], [2, 1, 'W1'])
  assert.equal(context.weaponModels.some((item) => item.model === 'Own Gun'), false)
  assert.equal(context.gearModels.find((item) => item.model === 'BB Ammo').ammo, true)
})

test('a valid suggestion maps to real piece ids and gets its list-price value', () => {
  const { suggestions, dropped } = checkSuggestions({ suggestions: [good] }, context)
  assert.equal(dropped.length, 0)
  const [s] = suggestions
  assert.deepEqual(s.weapons.map((w) => w.pieceId), ['W1'])
  assert.deepEqual(s.gear.map((g) => [g.pieceId, g.perPlayer]), [['EQ1', 1], ['EQ3', 2]])
  // (150 entrance + 500 rifle + 50 mask + 2 × 100 ammo) × 5 players
  assert.equal(s.itemValue, 4500)
  assert.equal(s.perPlayer, 800)
  assert.equal(s.minPlayers, 1, 'group-priced packages have no separate minimum')
})

test('suggestions with made-up items, taken names, no stock or no price are dropped with a reason', () => {
  const { suggestions, dropped } = checkSuggestions({
    suggestions: [
      { ...good, name: 'Laser Tag', weapons: ['Laser Gun'] },
      { ...good, name: 'normal' },
      { ...good, name: 'Pistol Duel', weapons: ['Glock Pistol'] },
      { ...good, name: 'Free', price: 0 },
      { ...good, name: 'No Guns', weapons: [] },
      { ...good, name: 'Normal Copy', players: 1, gear: [{ model: 'Mask', perPlayer: 1 }, { model: 'Vest', perPlayer: 1 }, { model: 'BB Ammo', perPlayer: 2 }] },
    ],
  }, context)
  assert.equal(suggestions.length, 0)
  assert.deepEqual(dropped.map((d) => d.why.split(' ').slice(0, 3).join(' ')), [
    'It used items',
    'A package with',
    'No pieces available:',
    'It had no',
    'It had no',
    'It has the',
  ])
})

test('ammo grams are dropped when the package has no ammo, and at most three are kept', () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ ...good, name: `Deal ${i}`, gear: [{ model: 'Mask', perPlayer: 1 }] }))
  const { suggestions } = checkSuggestions({ suggestions: many }, context)
  assert.equal(suggestions.length, 3)
  assert.equal(suggestions[0].bbReloadGrams, 0)
})

test('booking summary counts packages, custom rentals and group sizes, skipping cancelled ones', () => {
  const summary = summarizeBookings([
    { selectionMode: 'package', selectedPackageId: 'PKG-0001', numberOfPlayers: 1 },
    { selectionMode: 'package', selectedPackageId: 'PKG-0001', numberOfPlayers: 6, sessionType: 'private' },
    { selectionMode: 'custom', customWeaponIds: ['W3'], customEquipmentIds: ['EQ1'], numberOfPlayers: 3 },
    { selectionMode: 'package', selectedPackageId: 'PKG-0001', reservationStatus: 'cancelled' },
  ], { packages: [{ id: 'PKG-0001', name: 'Normal' }], weapons, equipment })
  assert.equal(summary.total, 3)
  assert.equal(summary.privateGames, 1)
  assert.deepEqual(summary.packages, [{ name: 'Normal', count: 2 }])
  assert.deepEqual(summary.customRentals.map((r) => r.name).sort(), ['Glock Pistol', 'Mask'])
  assert.deepEqual(summary.groupSizes, { solo: 1, '2-4': 1, '5-9': 1, '10+': 0 })
})

test('the prompt lists the inventory and the admin focus', () => {
  const prompt = buildPrompt(context, { focus: 'barkada groups' })
  assert.match(prompt, /M4 Rifle/)
  assert.match(prompt, /focus on: barkada groups/)
  assert.match(prompt, /₱150 entrance fee/)
})

test('Gemini is called with the key in a header and its JSON answer is parsed', async () => {
  let call
  const http = async (url, options) => {
    call = { url, options }
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"suggestions":[]}' }] } }] }) }
  }
  const result = await askGemini('hi', { env: { GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-test' }, http })
  assert.deepEqual(result, { suggestions: [] })
  assert.match(call.url, /models\/gemini-test:generateContent$/)
  assert.equal(call.options.headers['x-goog-api-key'], 'k')
  assert.doesNotMatch(call.url, /key=/)
})

test('a missing key or a Gemini error gives a clear message', async () => {
  await assert.rejects(askGemini('hi', { env: {}, http: async () => assert.fail('no call') }), /GEMINI_API_KEY/)
  const failing = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'Quota exceeded' } }) })
  await assert.rejects(askGemini('hi', { env: { GEMINI_API_KEY: 'k' }, http: failing }), (err) => err.statusCode === 502 && /Quota exceeded/.test(err.message))
})

test('the entrance fee follows ENTRANCE_FEE_PER_PLAYER, defaulting to 150', () => {
  assert.equal(geminiConfig({}).entranceFee, 150)
  assert.equal(geminiConfig({ ENTRANCE_FEE_PER_PLAYER: '200' }).entranceFee, 200)
  assert.equal(geminiConfig({ ENTRANCE_FEE_PER_PLAYER: '0' }).entranceFee, 0)
})

test('each admin gets 10 AI requests per hour', () => {
  const calls = new Map()
  for (let i = 0; i < 10; i += 1) assert.equal(takeSuggestionCall('a', 1000 + i, calls).ok, true)
  assert.equal(takeSuggestionCall('a', 2000, calls).ok, false)
  assert.equal(takeSuggestionCall('b', 2000, calls).ok, true)
  assert.equal(takeSuggestionCall('a', 1000 + 3_600_001, calls).ok, true)
})

test('Gemini is asked to think minimally, and asked again without it if the model refuses', async () => {
  const bodies = []
  const http = async (_url, options) => {
    const body = JSON.parse(options.body)
    bodies.push(body.generationConfig.thinkingConfig)
    if (body.generationConfig.thinkingConfig) {
      return { ok: false, status: 400, json: async () => ({ error: { message: 'Thinking level is not supported for this model.' } }) }
    }
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"suggestions":[]}' }] } }] }) }
  }
  assert.deepEqual(await askGemini('hi', { env: { GEMINI_API_KEY: 'k' }, http }), { suggestions: [] })
  assert.deepEqual(bodies, [{ thinkingLevel: 'minimal' }, undefined])
})

test('a Gemini timeout gives a "try again" message', async () => {
  const http = async () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }) }
  await assert.rejects(askGemini('hi', { env: { GEMINI_API_KEY: 'k' }, http }), (err) => err.statusCode === 504 && /too long/.test(err.message))
})
