import { createPublicKey, createVerify } from 'crypto'

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'chill-shooters'
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
// The web API key is public (it ships in the client bundle). It is only used
// by the fallback lookup below.
const FIREBASE_WEB_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyAWZ97DTTBq6FZSorJbn-NtzCzKCIxWf9E'
const CLOCK_SKEW_SECONDS = 300

let cachedKeys = null
let cachedUntil = 0

function decodeSegment(segment) {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
}

async function getSigningKeys() {
  if (cachedKeys && Date.now() < cachedUntil) return cachedKeys
  const response = await fetch(JWKS_URL, { signal: AbortSignal.timeout(10000) })
  if (!response.ok) throw new Error(`Google key fetch failed with ${response.status}`)
  const { keys } = await response.json()
  const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') || '')?.[1] || 3600)
  cachedKeys = new Map((keys || []).map((jwk) => [jwk.kid, createPublicKey({ key: jwk, format: 'jwk' })]))
  cachedUntil = Date.now() + maxAge * 1000
  return cachedKeys
}

// Verifies the token signature and claims locally, as Firebase documents for
// third-party JWT libraries. Returns null when the token is not acceptable.
async function verifyLocally(idToken) {
  const parts = idToken.split('.')
  if (parts.length !== 3) return null
  const header = decodeSegment(parts[0])
  const claims = decodeSegment(parts[1])
  if (header.alg !== 'RS256' || !header.kid) return null

  const keys = await getSigningKeys()
  const key = keys.get(header.kid)
  if (!key) return null
  const signatureValid = createVerify('RSA-SHA256')
    .update(`${parts[0]}.${parts[1]}`)
    .verify(key, Buffer.from(parts[2], 'base64url'))
  if (!signatureValid) return null

  const now = Math.floor(Date.now() / 1000)
  if (claims.aud !== FIREBASE_PROJECT_ID) return null
  if (claims.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) return null
  if (typeof claims.sub !== 'string' || !claims.sub) return null
  if (!(claims.exp > now - CLOCK_SKEW_SECONDS) || !(claims.iat <= now + CLOCK_SKEW_SECONDS)) return null
  if (!claims.email || claims.email_verified !== true) return null
  return { email: String(claims.email), name: String(claims.name || '') }
}

async function verifyWithLookup(idToken) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_WEB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken }),
      signal: AbortSignal.timeout(10000),
    },
  )
  if (!response.ok) {
    console.error('Firebase token lookup failed', response.status, await response.text().catch(() => ''))
    return null
  }
  const account = (await response.json())?.users?.[0]
  if (!account?.email || account.emailVerified === false) return null
  return { email: String(account.email), name: String(account.displayName || '') }
}

export async function verifyFirebaseIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') return null
  try {
    return await verifyLocally(idToken)
  } catch (err) {
    // Key download or parsing failed; ask Firebase directly instead.
    console.error('Local Firebase token verification failed', err && (err.message || err))
  }
  try {
    return await verifyWithLookup(idToken)
  } catch (err) {
    console.error('Google token verification failed', err && (err.message || err))
    return null
  }
}
