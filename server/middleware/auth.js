import crypto from 'crypto'
import { ObjectId } from 'mongodb'
import { getUserAccountsCollection } from '../db/mongo.js'

// Read on first use, not when this module loads: server/index.js imports this file before it
// loads server/.env, so reading it at load time always missed AUTH_SECRET and signed everyone
// out on every restart (a new random secret each time).
let authSecret = ''
function getAuthSecret() {
  if (authSecret) return authSecret
  authSecret = process.env.AUTH_SECRET || ''
  if (!authSecret) {
    if (process.env.NODE_ENV === 'production') throw new Error('AUTH_SECRET must be configured in production')
    console.warn('AUTH_SECRET is not set: using a temporary secret, so everyone is signed out when the server restarts.')
    authSecret = crypto.randomBytes(32).toString('hex')
  }
  return authSecret
}

// "Remember me" sessions stay valid for 30 days; regular sessions expire after 12 hours.
export const REMEMBERED_SESSION_MS = 1000 * 60 * 60 * 24 * 30
export const STANDARD_SESSION_MS = 1000 * 60 * 60 * 12

export function createAuthToken(user, { remember = false } = {}) {
  const payload = {
    sub: user?.id || user?.email || 'unknown',
    email: user?.email || '',
    role: user?.role || 'user',
    iat: Date.now(),
    exp: Date.now() + (remember ? REMEMBERED_SESSION_MS : STANDARD_SESSION_MS),
  }

  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = crypto.createHmac('sha256', getAuthSecret()).update(body).digest('base64url')
  return `${body}.${signature}`
}

export function verifyAuthToken(token) {
  if (!token || typeof token !== 'string') return null

  const [body, signature] = token.split('.')
  if (!body || !signature) return null

  const expected = crypto.createHmac('sha256', getAuthSecret()).update(body).digest('base64url')
  const providedSignature = Buffer.from(signature)
  const expectedSignature = Buffer.from(expected)
  if (providedSignature.length !== expectedSignature.length) return null

  if (crypto.timingSafeEqual(providedSignature, expectedSignature)) {
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
      if (!payload || typeof payload !== 'object') return null
      if (Number(payload.exp) < Date.now()) return null
      return payload
    } catch {
      return null
    }
  }

  return null
}

// Every request is checked against the live account, not just the token, so these take effect
// immediately instead of when the token runs out (12 hours, or 30 days with "Remember me"):
// - a suspended player is refused,
// - a changed role (e.g. staff demoted to player) applies at once,
// - a password reset ends older sessions (sessionsValidAfterISO),
// - a deleted account can no longer use its token.
// The answer is cached briefly so this doesn't add a database read to every request.
export const SUSPENDED_ACCOUNT_ERROR = 'This account is suspended. Please contact Chill Shooters staff.'
export const SESSION_ENDED_ERROR = 'Your session has ended. Please sign in again.'
const ACCOUNT_CACHE_MS = 30 * 1000
const accountCache = new Map()

export function isSuspendedAccount(account) {
  return String(account?.status || '').toLowerCase() === 'suspended'
}

// Call after changing an account's status, role or password so the change applies immediately.
export function forgetAccount(userId) {
  accountCache.delete(String(userId))
}
// Kept for existing callers.
export const forgetSuspension = forgetAccount

// The fields to $set on an account to end every session issued before now.
export function revokeSessionsFields() {
  return { sessionsValidAfterISO: new Date().toISOString() }
}

async function loadAccountState(userId) {
  const key = String(userId)
  const cached = accountCache.get(key)
  if (cached && Date.now() - cached.checkedAt < ACCOUNT_CACHE_MS) return cached.state
  const accounts = await getUserAccountsCollection()
  const objectId = /^[a-f0-9]{24}$/i.test(key) ? new ObjectId(key) : null
  const account = await accounts.findOne(
    { $or: [{ id: key }, ...(objectId ? [{ _id: objectId }] : [])] },
    { projection: { status: 1, role: 1, sessionsValidAfterISO: 1 } },
  )
  const state = account
    ? {
      exists: true,
      role: account.role || 'user',
      suspended: isSuspendedAccount(account),
      validAfter: account.sessionsValidAfterISO ? new Date(account.sessionsValidAfterISO).getTime() : 0,
    }
    : { exists: false }
  accountCache.set(key, { state, checkedAt: Date.now() })
  return state
}

function sessionEnded(res) {
  return res.status(401).json({ ok: false, error: SESSION_ENDED_ERROR, sessionEnded: true })
}

export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  const payload = verifyAuthToken(token)

  if (!payload) {
    // sessionEnded only when a token was sent, so the app signs out instead of retrying.
    if (token) return sessionEnded(res)
    return res.status(401).json({ ok: false, error: 'Authentication required' })
  }

  req.user = {
    id: payload.sub,
    email: payload.email,
    role: payload.role,
  }

  try {
    const account = await loadAccountState(payload.sub)
    if (!account.exists) return sessionEnded(res)
    // Tokens issued before a password reset no longer work.
    if (account.validAfter && Number(payload.iat || 0) < account.validAfter) return sessionEnded(res)
    // The stored role always wins over the one written in the token.
    req.user.role = account.role
    if (account.role === 'user' && account.suspended) {
      return res.status(403).json({ ok: false, error: SUSPENDED_ACCOUNT_ERROR, suspended: true })
    }
  } catch (err) {
    // If the database is briefly unreachable, don't lock everyone out; the route will fail on its own.
    console.warn('Account check failed:', String(err))
  }

  next()
}

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const role = req.user?.role
    if (!role || !allowedRoles.includes(role)) {
      return res.status(403).json({ ok: false, error: 'Forbidden: insufficient role permissions' })
    }

    next()
  }
}
