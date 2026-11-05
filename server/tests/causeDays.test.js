import assert from 'node:assert/strict'
import { cleanCauseDay, isDateISO, weekendDatesInMonth } from '../utils/causeDays.js'

// November 2026: Saturdays 7, 14, 21, 28 and Sundays 1, 8, 15, 22, 29.
assert.deepEqual(weekendDatesInMonth('2026-11'), [
  '2026-11-01', '2026-11-07', '2026-11-08', '2026-11-14', '2026-11-15',
  '2026-11-21', '2026-11-22', '2026-11-28', '2026-11-29',
])

assert.equal(isDateISO('2026-11-07'), true)
assert.equal(isDateISO('2026-13-07'), false)
assert.equal(isDateISO('nope'), false)

assert.equal(cleanCauseDay({}).error, 'Give the cause a name.')
assert.ok(cleanCauseDay({ title: 'Relief', donationPercent: 0 }).error)
assert.ok(cleanCauseDay({ title: 'Relief', donationPercent: 120 }).error)
assert.deepEqual(cleanCauseDay({ title: '  Typhoon   relief ', donationPercent: '25' }).value, {
  title: 'Typhoon relief', description: '', beneficiary: '', donationPercent: 25,
})
// No share given: the whole day's bookings go to the cause.
assert.equal(cleanCauseDay({ title: 'Relief' }).value.donationPercent, 100)

console.log('cause day checks passed')
