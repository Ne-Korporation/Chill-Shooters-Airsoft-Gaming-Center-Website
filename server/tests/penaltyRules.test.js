import test from 'node:test'
import assert from 'node:assert/strict'
import { computePenalty, resolvePenaltyCharge } from '../utils/penaltyRules.js'

test('a lost item is charged its replacement value', () => {
  const result = computePenalty({ kind: 'loss', item: { replacementValue: 8500 } })
  assert.equal(result.amount, 8500)
  assert.deepEqual(result.lines, [{ label: 'Replacement value', amount: 8500 }])
})

test('a lost item without a replacement value cannot be computed', () => {
  const result = computePenalty({ kind: 'loss', item: { price: 500 } })
  assert.equal(result.amount, null)
  assert.match(result.missing, /replacement value/)
})

test('damage is the repair cost plus the handling fee', () => {
  const result = computePenalty({ kind: 'damage', repairCost: 1200, rules: { handlingFeePercent: 10 } })
  assert.equal(result.amount, 1320)
  assert.deepEqual(result.lines, [
    { label: 'Repair cost (parts + labor)', amount: 1200 },
    { label: 'Handling fee (10%)', amount: 120 },
  ])
})

test('damage with a 0% handling fee is just the repair cost', () => {
  const result = computePenalty({ kind: 'damage', repairCost: 450.5, rules: { handlingFeePercent: 0 } })
  assert.equal(result.amount, 450.5)
  assert.equal(result.lines.length, 1)
})

test('damage needs a completed repair cost', () => {
  assert.equal(computePenalty({ kind: 'damage', repairCost: undefined }).amount, null)
})

test('billing the rule amount needs no reason', () => {
  const computed = { amount: 1320 }
  assert.deepEqual(resolvePenaltyCharge(computed, {}), { amount: 1320, overridden: false })
  assert.deepEqual(resolvePenaltyCharge(computed, { requestedAmount: '1320' }), { amount: 1320, overridden: false })
})

test('billing a different amount needs a reason', () => {
  const computed = { amount: 1320 }
  assert.match(resolvePenaltyCharge(computed, { requestedAmount: 1000 }).error, /reason/)
  assert.deepEqual(
    resolvePenaltyCharge(computed, { requestedAmount: 1000, overrideReason: 'First offense, owner approved' }),
    { amount: 1000, overridden: true, overrideReason: 'First offense, owner approved' },
  )
})

test('when the rule cannot compute, a manual amount needs a reason', () => {
  const computed = { amount: null, missing: 'Set the replacement value.' }
  assert.match(resolvePenaltyCharge(computed, {}).error, /replacement value/)
  assert.match(resolvePenaltyCharge(computed, { requestedAmount: 500 }).error, /reason/)
  assert.equal(resolvePenaltyCharge(computed, { requestedAmount: 500, overrideReason: 'Supplier quote' }).amount, 500)
})

test('a zero or negative requested amount is rejected', () => {
  assert.match(resolvePenaltyCharge({ amount: 100 }, { requestedAmount: 0, overrideReason: 'x' }).error, /positive/)
})
