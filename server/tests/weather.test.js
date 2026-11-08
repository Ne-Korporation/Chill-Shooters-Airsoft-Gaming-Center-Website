import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeSlotForecast } from '../utils/weather.js'

const config = { rainChance: 0.7, rainMm: 2.5, windMs: 17 }

// A forecast entry starting at a Manila date and hour (UTC+8).
function entry(date, hour, { pop = 0, rain = 0, wind = 3, id = 800, description = 'clear sky', temp = 30 } = {}) {
  const dt = Date.parse(`${date}T${String(hour).padStart(2, '0')}:00:00+08:00`) / 1000
  return { dt, pop, rain: rain ? { '3h': rain } : undefined, wind: { speed: wind }, main: { temp }, weather: [{ id, description }] }
}

test('clear weather is not severe', () => {
  const result = summarizeSlotForecast([entry('2026-11-01', 8), entry('2026-11-01', 11)], '2026-11-01', 'morning', config)
  assert.equal(result.available, true)
  assert.equal(result.severe, false)
})

test('a thunderstorm in the slot is severe', () => {
  const result = summarizeSlotForecast([entry('2026-11-01', 14, { id: 211, description: 'thunderstorm' })], '2026-11-01', 'afternoon', config)
  assert.equal(result.severe, true)
  assert.deepEqual(result.reasons, ['thunderstorms forecast'])
})

test('heavy rain needs both a high chance and enough rain', () => {
  const likelyLight = summarizeSlotForecast([entry('2026-11-01', 8, { pop: 0.9, rain: 0.5 })], '2026-11-01', 'morning', config)
  assert.equal(likelyLight.severe, false)
  const likelyHeavy = summarizeSlotForecast([entry('2026-11-01', 8, { pop: 0.9, rain: 6 })], '2026-11-01', 'morning', config)
  assert.equal(likelyHeavy.severe, true)
  assert.match(likelyHeavy.reasons[0], /heavy rain likely \(90% chance/)
})

test('likely light rain is rainy but not severe', () => {
  const light = summarizeSlotForecast([entry('2026-11-01', 8, { pop: 0.8, rain: 0.5, id: 500, description: 'light rain' })], '2026-11-01', 'morning', config)
  assert.equal(light.severe, false)
  assert.equal(light.rainy, true)
  assert.deepEqual(light.reasons, ['rain likely (80% chance)'])
  const unlikely = summarizeSlotForecast([entry('2026-11-01', 8, { pop: 0.3, rain: 0.2, id: 500 })], '2026-11-01', 'morning', config)
  assert.equal(unlikely.rainy, false)
  const dry = summarizeSlotForecast([entry('2026-11-01', 8, { pop: 0.8 })], '2026-11-01', 'morning', config)
  assert.equal(dry.rainy, false)
})

test('strong wind is severe', () => {
  const result = summarizeSlotForecast([entry('2026-11-01', 20, { wind: 20 })], '2026-11-01', 'evening', config)
  assert.equal(result.severe, true)
  assert.match(result.reasons[0], /72 km\/h/)
})

test('only entries overlapping the slot count', () => {
  // A storm in the evening does not affect the morning slot; the 05:00 block (05–08) ends at 08.
  const entries = [entry('2026-11-01', 5, { id: 211 }), entry('2026-11-01', 20, { id: 211 }), entry('2026-11-01', 9)]
  assert.equal(summarizeSlotForecast(entries, '2026-11-01', 'morning', config).severe, false)
  // A storm block starting 07:00 overlaps the 08:00 start.
  assert.equal(summarizeSlotForecast([entry('2026-11-01', 7, { id: 211 })], '2026-11-01', 'morning', config).severe, true)
})

test('no forecast yet for the date', () => {
  const result = summarizeSlotForecast([entry('2026-11-01', 8)], '2026-11-09', 'morning', config)
  assert.equal(result.available, false)
  assert.equal(result.severe, false)
})
