import crypto from 'crypto'

const AUTH_SECRET =
  process.env.AUTH_SECRET ||
  (process.env.NODE_ENV === 'production' ? '' : crypto.randomBytes(32).toString('hex'))

if (!AUTH_SECRET) {
  throw new Error('AUTH_SECRET must be configured in production')
}

// "Remember me" sessions stay valid for 30 days; regular sessions expire after 12 hours.
export const REMEMBERED_SESSION_MS = 1000 * 60 * 60 * 24 * 30
export const STANDARD_SESSION_MS = 1000 * 60 * 60 * 12

export function createAuthToken(user, { remember = false } = {}) {
  const payload = {
    sub: user?.id || user?.email || 'unknown',
    email: user?.email || '',
    role: user?.role || 'user',
    exp: Date.now() + (remember ? REMEMBERED_SESSION_MS : STANDARD_SESSION_MS),
  }

  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url')
  return `${body}.${signature}`
}

export function verifyAuthToken(token) {
  if (!token || typeof token !== 'string') return null

  const [body, signature] = token.split('.')
  if (!body || !signature) return null

  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url')
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

export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  const payload = verifyAuthToken(token)

  if (!payload) {
    return res.status(401).json({ ok: false, error: 'Authentication required' })
  }

  req.user = {
    id: payload.sub,
    email: payload.email,
    role: payload.role,
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
