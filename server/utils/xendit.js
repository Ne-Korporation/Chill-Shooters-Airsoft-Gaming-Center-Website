import { timingSafeEqual } from 'crypto'

// Xendit runs in TEST MODE only for the capstone demo: no real money moves. Players pay with
// GCash, Maya, a card or another enabled channel on Xendit's hosted invoice page. Only
// development keys (xnd_development_…) are accepted; production keys are refused.
const API = 'https://api.xendit.co'
const secretKey = String(process.env.XENDIT_SECRET_KEY || '').trim()
// The "Callback verification token" from the Xendit dashboard (Settings > Webhooks).
const callbackToken = String(process.env.XENDIT_CALLBACK_TOKEN || '').trim()
// Optional: limit the invoice page to these channels (each must be activated on the account).
// Empty shows every channel the account has.
const paymentMethods = String(process.env.XENDIT_PAYMENT_METHODS || '')
  .split(',').map((method) => method.trim().toUpperCase()).filter(Boolean)

export const xenditEnabled = secretKey.startsWith('xnd_development_')
if (secretKey && !xenditEnabled) {
  console.warn('XENDIT_SECRET_KEY is not a development key (xnd_development_…). Xendit is disabled; this demo only runs Xendit in test mode.')
} else if (xenditEnabled) {
  console.log(`Xendit initialized in test mode${callbackToken ? '' : '; XENDIT_CALLBACK_TOKEN not set, payments are confirmed when the player returns'}`)
}

function xenditError(status, json) {
  const error = new Error(json?.message || `Xendit request failed (${status})`)
  error.statusCode = status >= 500 ? 502 : 400
  return error
}

async function request(method, path, body) {
  let response
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: {
        authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    })
  } catch {
    const unreachable = new Error('Online payment is unavailable right now. Please pay by GCash or bank transfer instead.')
    unreachable.statusCode = 503
    throw unreachable
  }
  const json = await response.json().catch(() => null)
  if (!response.ok) throw xenditError(response.status, json)
  return json
}

// amount is in pesos (Xendit takes PHP amounts as-is).
export async function createInvoice({ amount, externalId, description, successUrl, failureUrl, customer, durationSeconds = 3600 }) {
  const invoice = await request('POST', '/v2/invoices', {
    external_id: externalId,
    amount: Math.round(Number(amount) * 100) / 100,
    currency: 'PHP',
    description,
    invoice_duration: durationSeconds,
    success_redirect_url: successUrl,
    failure_redirect_url: failureUrl,
    ...(customer?.email ? { payer_email: customer.email, customer: { given_names: customer.name || 'Player', email: customer.email } } : {}),
    ...(paymentMethods.length ? { payment_methods: paymentMethods } : {}),
  })
  return { id: invoice.id, invoiceUrl: invoice.invoice_url }
}

export async function retrieveInvoice(id) {
  return request('GET', `/v2/invoices/${encodeURIComponent(id)}`)
}

// The payment on a paid invoice, or null while it hasn't been paid.
export function paidPaymentOf(invoice) {
  const status = String(invoice?.status || '').toUpperCase()
  if (status !== 'PAID' && status !== 'SETTLED') return null
  return {
    id: String(invoice.payment_id || invoice.id),
    amount: Number(invoice.paid_amount ?? invoice.amount ?? 0),
    method: String(invoice.payment_channel || invoice.payment_method || 'online'),
  }
}

// Xendit sends the account's callback verification token in the x-callback-token header.
export function verifyCallbackToken(header) {
  if (!callbackToken || !header) return false
  const given = Buffer.from(String(header), 'utf8')
  const wanted = Buffer.from(callbackToken, 'utf8')
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}

export const PAYMENT_CHANNEL_LABELS = {
  GCASH: 'GCash',
  PAYMAYA: 'Maya',
  GRABPAY: 'GrabPay',
  SHOPEEPAY: 'ShopeePay',
  QRPH: 'QR Ph',
  CREDIT_CARD: 'Card',
  CARD: 'Card',
  BPI: 'BPI online banking',
  UBP: 'UnionBank online banking',
  '7ELEVEN': '7-Eleven',
}
