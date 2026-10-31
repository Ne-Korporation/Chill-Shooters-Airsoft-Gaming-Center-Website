import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'crypto'

// The PayMongo module reads its keys when it loads, so set them first.
process.env.PAYMONGO_SECRET_KEY = 'sk_test_example'
process.env.PAYMONGO_WEBHOOK_SECRET = 'whsk_example'
const { paidPaymentOf, paymongoEnabled, verifyWebhookSignature } = await import('../utils/paymongo.js')
const { buildPaymentStatusUpdate } = await import('../utils/paymentRules.js')

function signed(body, { secret = 'whsk_example', t = Math.floor(Date.now() / 1000) } = {}) {
  const te = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')
  return `t=${t},te=${te},li=`
}

test('only test keys enable PayMongo', () => {
  assert.equal(paymongoEnabled, true)
})

test('webhook signatures are checked against the raw body', () => {
  const body = '{"data":{"id":"evt_1"}}'
  assert.equal(verifyWebhookSignature(signed(body), body), true)
  assert.equal(verifyWebhookSignature(signed(body), body.replace('evt_1', 'evt_2')), false, 'changed body')
  assert.equal(verifyWebhookSignature(signed(body, { secret: 'whsk_other' }), body), false, 'wrong secret')
  assert.equal(verifyWebhookSignature(signed(body, { t: Math.floor(Date.now() / 1000) - 7200 }), body), false, 'replayed')
  assert.equal(verifyWebhookSignature('', body), false, 'missing header')
})

test('a checkout counts as paid only with a paid payment, amount converted from centavos', () => {
  assert.equal(paidPaymentOf({ attributes: { payments: [] } }), null)
  assert.equal(paidPaymentOf({ attributes: { payments: [{ id: 'pay_1', attributes: { status: 'failed', amount: 50000 } }] } }), null)
  assert.deepEqual(
    paidPaymentOf({ attributes: { payments: [{ id: 'pay_2', attributes: { status: 'paid', amount: 150050, source: { type: 'gcash' } } }] } }),
    { id: 'pay_2', amount: 1500.5, method: 'gcash' },
  )
})

test('staff cannot change a gateway-verified payment, but can decide one held for review', () => {
  const base = { actorId: 'staff', actorRole: 'admin', changedAtISO: '2026-01-01T00:00:00Z' }
  assert.throws(() => buildPaymentStatusUpdate({ ...base, payment: { paymongoCheckoutId: 'cs_1', paymentStatus: 'paid' }, nextStatus: 'failed' }))
  assert.doesNotThrow(() => buildPaymentStatusUpdate({ ...base, payment: { paymongoCheckoutId: 'cs_1', paymentStatus: 'review' }, nextStatus: 'paid' }))
})
