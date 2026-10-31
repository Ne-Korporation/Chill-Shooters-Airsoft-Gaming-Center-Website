import { createHmac, timingSafeEqual } from 'crypto'

// PayMongo runs in TEST MODE only for the capstone demo: no real money moves. Players pay with
// GCash, QR Ph, Maya or a card on PayMongo's hosted checkout, using PayMongo's test accounts.
// Live keys (sk_live_…) are refused, the same way Stripe is.
const API = 'https://api.paymongo.com/v1'
const secretKey = String(process.env.PAYMONGO_SECRET_KEY || '').trim()
const webhookSecret = String(process.env.PAYMONGO_WEBHOOK_SECRET || '').trim()
// Methods shown on the checkout page. Every method must be enabled on the PayMongo account.
const methodTypes = String(process.env.PAYMONGO_METHODS || 'gcash,qrph,paymaya,card')
  .split(',').map((method) => method.trim()).filter(Boolean)

export const paymongoEnabled = secretKey.startsWith('sk_test_')
if (secretKey && !paymongoEnabled) {
  console.warn('PAYMONGO_SECRET_KEY is not a test key (sk_test_…). PayMongo is disabled; this demo only runs PayMongo in test mode.')
} else if (paymongoEnabled) {
  console.log(`PayMongo initialized in test mode (${methodTypes.join(', ')})${webhookSecret ? '' : '; PAYMONGO_WEBHOOK_SECRET not set, payments are confirmed when the player returns'}`)
}

function paymongoError(status, json) {
  const detail = json?.errors?.map((error) => error.detail).filter(Boolean).join(' ') || `PayMongo request failed (${status})`
  const error = new Error(detail)
  error.statusCode = status >= 500 ? 502 : 400
  return error
}

async function request(method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  })
  const json = await response.json().catch(() => null)
  if (!response.ok) throw paymongoError(response.status, json)
  return json?.data
}

// amount is in pesos; PayMongo takes centavos.
export async function createCheckoutSession({ amount, name, description, reference, successUrl, cancelUrl, metadata, billing }) {
  const session = await request('POST', '/checkout_sessions', {
    data: {
      attributes: {
        line_items: [{ currency: 'PHP', amount: Math.round(Number(amount) * 100), name, quantity: 1 }],
        payment_method_types: methodTypes,
        description,
        reference_number: reference,
        success_url: successUrl,
        cancel_url: cancelUrl,
        send_email_receipt: false,
        show_description: true,
        show_line_items: true,
        ...(billing ? { billing } : {}),
        // Metadata values must be strings.
        metadata: Object.fromEntries(Object.entries(metadata || {}).map(([key, value]) => [key, String(value)])),
      },
    },
  })
  return { id: session.id, checkoutUrl: session.attributes.checkout_url }
}

export async function retrieveCheckoutSession(id) {
  return request('GET', `/checkout_sessions/${encodeURIComponent(id)}`)
}

// The paid payment on a checkout session, or null while it hasn't been paid.
export function paidPaymentOf(session) {
  const payments = session?.attributes?.payments || []
  const paid = payments.find((payment) => payment?.attributes?.status === 'paid')
  if (!paid) return null
  return {
    id: paid.id,
    amount: Number(paid.attributes.amount || 0) / 100,
    method: String(paid.attributes.source?.type || 'online'),
  }
}

// Paymongo-Signature: "t=<timestamp>,te=<test signature>,li=<live signature>". The signature is an
// HMAC-SHA256 of "<t>.<raw body>" keyed with the webhook's secret. Test mode compares "te".
export function verifyWebhookSignature(header, rawBody) {
  if (!webhookSecret || !header || !rawBody) return false
  const parts = Object.fromEntries(String(header).split(',').map((part) => {
    const [key, ...rest] = part.trim().split('=')
    return [key, rest.join('=')]
  }))
  if (!parts.t || !parts.te) return false
  // Reject replays of old notifications.
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 60 * 60) return false
  const expected = createHmac('sha256', webhookSecret).update(`${parts.t}.${rawBody}`).digest('hex')
  const given = Buffer.from(parts.te, 'utf8')
  const wanted = Buffer.from(expected, 'utf8')
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}

export const PAYMENT_METHOD_LABELS = {
  gcash: 'GCash',
  qrph: 'QR Ph',
  paymaya: 'Maya',
  card: 'Card',
  grab_pay: 'GrabPay',
  dob: 'Online banking',
  billease: 'BillEase',
  shopee_pay: 'ShopeePay',
}
