import test from 'node:test'
import assert from 'node:assert/strict'
import { fieldCountMinimum } from '../routes/crud.js'

test('private-game minimum depends on how many fields are booked', () => {
  assert.equal(fieldCountMinimum(0), 0)
  assert.equal(fieldCountMinimum(1), 10)
  assert.equal(fieldCountMinimum(2), 20)
  assert.equal(fieldCountMinimum(3), 50)
})

test('every private booking starts with Upper Ground', async () => {
  const { isAllowedFieldCombination } = await import('../routes/crud.js')
  assert.equal(isAllowedFieldCombination('salawag', ['salawag-field-1']), true)
  assert.equal(isAllowedFieldCombination('salawag', ['salawag-field-1', 'salawag-field-2']), true)
  assert.equal(isAllowedFieldCombination('salawag', ['salawag-field-3', 'salawag-field-2', 'salawag-field-1']), true)
  assert.equal(isAllowedFieldCombination('salawag', ['salawag-field-2']), false)
  assert.equal(isAllowedFieldCombination('salawag', ['salawag-field-3']), false)
  assert.equal(isAllowedFieldCombination('salawag', ['salawag-field-1', 'salawag-field-3']), false)
  assert.equal(isAllowedFieldCombination('salawag', ['salawag-field-2', 'salawag-field-3']), false)
  assert.equal(isAllowedFieldCombination('salawag', []), false)
})
