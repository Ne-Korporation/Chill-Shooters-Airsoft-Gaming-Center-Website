import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SLOT_HOURS, slotWindow, validateSlotHours } from '../utils/slotHours.js'
import { summarizeSlotForecast } from '../utils/weather.js'

test('the default slot hours are valid', () => {
  assert.deepEqual(validateSlotHours(DEFAULT_SLOT_HOURS).hours, DEFAULT_SLOT_HOURS)
})

test('slots must be HH:MM, end after start, and not overlap', () => {
  assert.match(validateSlotHours({ ...DEFAULT_SLOT_HOURS, morning: { start: '6am', end: '12:00' } }).error, /HH:MM/)
  assert.match(validateSlotHours({ ...DEFAULT_SLOT_HOURS, evening: { start: '23:00', end: '18:00' } }).error, /end after/)
  assert.match(validateSlotHours({ ...DEFAULT_SLOT_HOURS, afternoon: { start: '11:00', end: '17:00' } }).error, /before the previous/)
})

test('slotWindow converts to decimal hours', () => {
  assert.deepEqual(slotWindow({ ...DEFAULT_SLOT_HOURS, morning: { start: '07:30', end: '11:00' } }, 'morning'), [7.5, 11])
})

test('the weather check follows custom slot hours', () => {
  const storm = { dt: Date.parse('2026-11-01T05:00:00+08:00') / 1000, pop: 0, wind: { speed: 2 }, main: { temp: 28 }, weather: [{ id: 211 }] }
  const config = { rainChance: 0.7, rainMm: 2.5, windMs: 17 }
  // The 05:00–08:00 block overlaps a 06:00 morning but not a 08:00 morning.
  assert.equal(summarizeSlotForecast([storm], '2026-11-01', 'morning', config).severe, true)
  const late = { ...DEFAULT_SLOT_HOURS, morning: { start: '08:00', end: '12:00' } }
  assert.equal(summarizeSlotForecast([storm], '2026-11-01', 'morning', config, late).severe, false)
})
