// App-wide HTTP protections: security headers, allowed origins (CORS), request rate limits and
// hiding internal error details. Wired up at the top of server/index.js.
import cors from 'cors'

const isProduction = () => process.env.NODE_ENV === 'production'

// ---------------------------------------------------------------------------
// Security headers (the essentials of helmet, without the dependency). This server only returns
// JSON and uploaded files, so it can lock things down tightly.
// ---------------------------------------------------------------------------
export function securityHeaders(_req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'cross-origin', // the website (another origin) shows uploaded images
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    // API responses are data, never pages: nothing in them may run or be framed.
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  })
  if (isProduction()) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  next()
}

// Signed-in answers hold personal data: browsers and proxies must not keep a copy.
export function noStoreForAuthenticated(req, res, next) {
  if (req.headers.authorization) res.set('Cache-Control', 'no-store')
  next()
}

// ---------------------------------------------------------------------------
// Allowed origins. Set CORS_ORIGINS to a comma-separated list of website addresses
// (e.g. "https://chillshooters.vercel.app,https://www.chillshooters.com"). PUBLIC_APP_URL is always
// allowed, and the local dev sites are allowed outside production.
// ---------------------------------------------------------------------------
function cleanOrigin(value) {
  return String(value || '').trim().replace(/\/+$/, '').toLowerCase()
}

export function allowedOrigins() {
  const list = new Set(
    String(process.env.CORS_ORIGINS || '').split(',').map(cleanOrigin).filter(Boolean),
  )
  if (process.env.PUBLIC_APP_URL) list.add(cleanOrigin(process.env.PUBLIC_APP_URL))
  if (!isProduction()) {
    for (const port of [5173, 4173, 3000]) {
      list.add(`http://localhost:${port}`)
      list.add(`http://127.0.0.1:${port}`)
    }
  }
  return list
}

export function corsPolicy() {
  const origins = allowedOrigins()
  const configured = Boolean(process.env.CORS_ORIGINS || process.env.PUBLIC_APP_URL)
  if (isProduction() && !configured) {
    console.warn('CORS_ORIGINS / PUBLIC_APP_URL not set: the API accepts requests from any website. Set CORS_ORIGINS to your site address to restrict it.')
  }
  const handler = cors({
    origin: (origin, done) => {
      // No Origin header: server-to-server calls (payment webhooks, uptime checks, curl).
      if (!origin) return done(null, true)
      if (isProduction() && !configured) return done(null, true)
      return done(null, origins.has(cleanOrigin(origin)))
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  })
  // A browser request from a site that isn't allowed is refused outright (not just left without
  // CORS headers), so it can't trigger actions or plant its address in email links.
  return (req, res, next) => {
    const origin = req.headers.origin
    if (origin && !(isProduction() && !configured) && !origins.has(cleanOrigin(origin))) {
      return res.status(403).json({ ok: false, error: 'Origin not allowed' })
    }
    return handler(req, res, next)
  }
}

// ---------------------------------------------------------------------------
// Rate limits: a fixed window per visitor address, kept in memory. The sign-in and code forms
// also have their own database-backed limits (utils/attemptLimits.js); this is the outer fence
// against floods and scripted abuse.
// ---------------------------------------------------------------------------
export function rateLimit({ windowMs, max, name, message = 'Too many requests. Please slow down and try again shortly.' }) {
  const hits = new Map()
  // Old windows are swept so the map can't grow without bound.
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key)
  }, Math.max(windowMs, 60_000)).unref()

  return (req, res, next) => {
    const key = `${name}:${req.ip || req.socket?.remoteAddress || 'unknown'}`
    const now = Date.now()
    let entry = hits.get(key)
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs }
      hits.set(key, entry)
    }
    entry.count += 1
    res.set('RateLimit-Limit', String(max))
    res.set('RateLimit-Remaining', String(Math.max(0, max - entry.count)))
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)))
      return res.status(429).json({ ok: false, error: message })
    }
    return next()
  }
}

// ---------------------------------------------------------------------------
// In production a server error answers with a generic message; the details (stack traces,
// database errors) go to the server log only, never to the visitor.
// ---------------------------------------------------------------------------
export function hideServerErrors(req, res, next) {
  if (!isProduction()) return next()
  const json = res.json.bind(res)
  res.json = (body) => {
    if (res.statusCode >= 500 && body && typeof body === 'object' && 'error' in body) {
      console.error(`[${req.method} ${req.originalUrl}] ${res.statusCode}:`, body.error)
      return json({ ...body, error: 'Something went wrong on our side. Please try again.' })
    }
    return json(body)
  }
  return next()
}

// Last-resort handler for errors thrown past a route (including malformed JSON bodies).
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ ok: false, error: 'Invalid JSON body' })
  if (err?.type === 'entity.too.large') return res.status(413).json({ ok: false, error: 'Request is too large' })
  console.error(`[${req.method} ${req.originalUrl}] unhandled error:`, err)
  return res.status(500).json({ ok: false, error: isProduction() ? 'Something went wrong on our side. Please try again.' : String(err?.message || err) })
}
