import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanClosedDay, closedDayError, closedDayView } from '../utils/closedDays.js'

test('cleanClosedDay trims and caps the reason', () => {
  assert.deepEqual(cleanClosedDay({ reason: '  Field   maintenance ' }), { value: { reason: 'Field maintenance' } })
  assert.deepEqual(cleanClosedDay({}), { value: { reason: '' } })
  assert.equal(cleanClosedDay({ reason: 'x'.repeat(300) }).value.reason.length, 200)
})

test('closedDayView exposes only the date and reason', () => {
  assert.deepEqual(closedDayView({ dateISO: '2026-12-25', reason: 'Christmas', history: [], active: true }), { dateISO: '2026-12-25', reason: 'Christmas' })
})

test('closedDayError names the date and reason', () => {
  assert.match(closedDayError({ dateISO: '2026-12-25', reason: 'Christmas' }), /2026-12-25 \(Christmas\)/)
  assert.doesNotMatch(closedDayError({ dateISO: '2026-12-25', reason: '' }), /\(/)
})
