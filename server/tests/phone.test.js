import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizePhPhone } from '../utils/phone.js'

test('PH mobile numbers are stored as 09XXXXXXXXX whatever way they are typed', () => {
  for (const typed of ['09171234567', '9171234567', '+639171234567', '+63-917-123-4567', '0917 123 4567', '63 917 123 4567']) {
    assert.equal(normalizePhPhone(typed), '09171234567', typed)
  }
})

test('non-mobile or incomplete numbers are rejected', () => {
  for (const typed of ['', '123', '0917123456', '08171234567', '091712345678', 'abc']) {
    assert.equal(normalizePhPhone(typed), null, typed)
  }
})
