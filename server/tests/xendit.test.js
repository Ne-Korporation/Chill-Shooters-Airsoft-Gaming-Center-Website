import test from 'node:test'
import assert from 'node:assert/strict'

// The Xendit module reads its keys when it loads, so set them first.
process.env.XENDIT_SECRET_KEY = 'xnd_development_example'
process.env.XENDIT_CALLBACK_TOKEN = 'callback_example'
const { paidPaymentOf, verifyCallbackToken, xenditEnabled } = await import('../utils/xendit.js')
const { buildPaymentStatusUpdate } = await import('../utils/paymentRules.js')

test('only development keys enable Xendit', () => {
  assert.equal(xenditEnabled, true)
})

test('webhooks need the exact callback token', () => {
  assert.equal(verifyCallbackToken('callback_example'), true)
  assert.equal(verifyCallbackToken('callback_other'), false, 'wrong token')
  assert.equal(verifyCallbackToken('callback_exampl'), false, 'shorter token')
  assert.equal(verifyCallbackToken(''), false, 'missing header')
  assert.equal(verifyCallbackToken(undefined), false, 'no header')
})

test('an invoice counts as paid only when Xendit marks it PAID or SETTLED', () => {
  assert.equal(paidPaymentOf({ id: 'inv_1', status: 'PENDING', amount: 500 }), null)
  assert.equal(paidPaymentOf({ id: 'inv_1', status: 'EXPIRED', amount: 500 }), null)
  assert.deepEqual(
    paidPaymentOf({ id: 'inv_2', status: 'PAID', amount: 1500.5, paid_amount: 1500.5, payment_id: 'pay_2', payment_channel: 'GCASH' }),
    { id: 'pay_2', amount: 1500.5, method: 'GCASH' },
  )
  assert.equal(paidPaymentOf({ id: 'inv_3', status: 'SETTLED', amount: 800, payment_method: 'CREDIT_CARD' })?.amount, 800)
})

test('staff cannot change a gateway-verified payment, but can decide one held for review', () => {
  const base = { actorId: 'staff', actorRole: 'admin', changedAtISO: '2026-01-01T00:00:00Z' }
  assert.throws(() => buildPaymentStatusUpdate({ ...base, payment: { xenditInvoiceId: 'inv_1', paymentStatus: 'paid' }, nextStatus: 'failed' }))
  assert.doesNotThrow(() => buildPaymentStatusUpdate({ ...base, payment: { xenditInvoiceId: 'inv_1', paymentStatus: 'review' }, nextStatus: 'paid' }))
  // Payments recorded through PayMongo before the switch stay protected.
  assert.throws(() => buildPaymentStatusUpdate({ ...base, payment: { paymongoCheckoutId: 'cs_1', paymentStatus: 'paid' }, nextStatus: 'failed' }))
})
