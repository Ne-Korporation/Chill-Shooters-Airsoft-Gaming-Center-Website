import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SLOT_HOURS, formatSlotTime, slotHasEnded } from '../utils/slotHours.js'

// Manila is UTC+8, so 07:29Z is 3:29 PM there.
const at = (manilaTime) => new Date(`2026-11-21T${manilaTime}:00+08:00`)
const today = '2026-11-21'

test('an afternoon game is not over at 3:29 PM, the slot runs until 5 PM', () => {
  assert.equal(slotHasEnded(DEFAULT_SLOT_HOURS, 'afternoon', today, today, at('15:29')), false)
  assert.equal(slotHasEnded(DEFAULT_SLOT_HOURS, 'afternoon', today, today, at('17:00')), true)
})

test('an evening game is not over in the afternoon', () => {
  assert.equal(slotHasEnded(DEFAULT_SLOT_HOURS, 'evening', today, today, at('15:31')), false)
  assert.equal(slotHasEnded(DEFAULT_SLOT_HOURS, 'evening', today, today, at('22:00')), true)
})

test('a game from an earlier day is over; a future one is not', () => {
  assert.equal(slotHasEnded(DEFAULT_SLOT_HOURS, 'evening', '2026-11-20', today, at('09:00')), true)
  assert.equal(slotHasEnded(DEFAULT_SLOT_HOURS, 'morning', '2026-11-22', today, at('23:00')), false)
})

test('slot end times read as clock times', () => {
  assert.equal(formatSlotTime('17:00'), '5:00 PM')
  assert.equal(formatSlotTime('12:00'), '12:00 PM')
  assert.equal(formatSlotTime('08:30'), '8:30 AM')
})
