import test from 'node:test'
import assert from 'node:assert/strict'
import { monthRange, summarizeNetRevenue } from '../utils/reachNetRevenue.js'

const base = {
  month: '2026-09',
  ratePercent: 5,
  payments: [
    { id: 'P1', amount: 10000, paymentStatus: 'paid', verifiedAtISO: '2026-09-05T03:00:00.000Z' },
    { id: 'P2', amount: 4000, paymentStatus: 'verified', createdAtISO: '2026-09-20T10:00:00.000Z' },
    // Not collected / outside the month
    { id: 'P3', amount: 9999, paymentStatus: 'pending', createdAtISO: '2026-09-10T10:00:00.000Z' },
    { id: 'P4', amount: 9999, paymentStatus: 'paid', createdAtISO: '2026-10-01T01:00:00.000Z' },
    // 2026-08-31 23:30 UTC is Sept 1 in Manila, so it counts for September.
    { id: 'P5', amount: 1000, paymentStatus: 'paid', createdAtISO: '2026-08-31T23:30:00.000Z' },
  ],
  reservations: [
    { damageCharges: [{ amount: 1500, atISO: '2026-09-12T05:00:00.000Z' }, { amount: 800, atISO: '2026-10-02T05:00:00.000Z' }] },
  ],
  partnerIncome: [{ partnerShare: 1000 }, { partnerShare: 500 }],
  expenses: [
    { dateISO: '2026-09-03', amount: 2000 },
    { dateISO: '2026-10-03', amount: 7777 },
  ],
}

test('monthRange gives the first and last day', () => {
  assert.deepEqual(monthRange('2026-02'), { start: '2026-02-01', end: '2026-02-28' })
  assert.deepEqual(monthRange('2028-02'), { start: '2028-02-01', end: '2028-02-29' })
  assert.equal(monthRange('2026-13'), null)
})

test('net revenue subtracts penalties, partner share, and expenses from collected payments', () => {
  const result = summarizeNetRevenue(base)
  assert.equal(result.collected, 15000)
  assert.equal(result.paymentCount, 3)
  assert.equal(result.penalties, 1500)
  assert.equal(result.partnerShare, 1500)
  assert.equal(result.expenses, 2000)
  assert.equal(result.netRevenue, 10000)
  assert.equal(result.allocation, 500)
})

test('a month with a loss allocates nothing', () => {
  const result = summarizeNetRevenue({ ...base, expenses: [{ dateISO: '2026-09-03', amount: 50000 }] })
  assert.ok(result.netRevenue < 0)
  assert.equal(result.allocation, 0)
})

test('older per-payment allocations for the month are not allocated twice', () => {
  const result = summarizeNetRevenue({ ...base, legacyAllocations: [{ sourcePaymentId: 'P1', amount: 300 }, { sourcePaymentId: 'P4', amount: 999 }] })
  assert.equal(result.alreadyAllocated, 300)
  assert.equal(result.allocation, 200)
})

test('no rate set means no allocation', () => {
  assert.equal(summarizeNetRevenue({ ...base, ratePercent: null }).allocation, 0)
})
