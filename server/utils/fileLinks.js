import crypto from 'crypto'

// Uploaded files kept in MongoDB are served from /api/files/<id>. ID photos are marked private:
// their links only work with a signature that expires, so a link that leaks (copied, forwarded,
// left in browser history) stops working. Signed links are added to the JSON the server sends to
// logged-in users; the server only sends ID photo links to people allowed to see them (admins,
// staff checking waivers, the owner). Public uploads (profile pictures, announcements) still open
// without a signature.

const FILE_LINK = /(\/api\/files\/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\?[^"\s\\]*)?/gi
const HOUR_MS = 60 * 60 * 1000

let fallbackSecret = ''
function secret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET
  fallbackSecret ||= crypto.randomBytes(32).toString('hex')
  return fallbackSecret
}

function signature(id, exp) {
  return crypto.createHmac('sha256', secret()).update(`file:${id}:${exp}`).digest('base64url')
}

// Links stay the same within an hour (so the browser can cache the image) and work for 1–2 hours.
export function currentExpiry(now = Date.now()) {
  return Math.ceil(now / HOUR_MS) * HOUR_MS + HOUR_MS
}

export function signFileLink(id, now = Date.now()) {
  const exp = currentExpiry(now)
  return `exp=${exp}&sig=${signature(id, exp)}`
}

export function verifyFileLink(id, exp, sig, now = Date.now()) {
  const expiry = Number(exp)
  if (!Number.isFinite(expiry) || expiry < now || !sig) return false
  const expected = Buffer.from(signature(String(id), expiry))
  const given = Buffer.from(String(sig))
  return expected.length === given.length && crypto.timingSafeEqual(expected, given)
}

// Adds a fresh signature to every /api/files/<id> link in a JSON body (replacing an old one).
export function signFileLinksIn(body, now = Date.now()) {
  if (body == null || typeof body !== 'object') return body
  const text = JSON.stringify(body)
  if (!text || !text.includes('/api/files/')) return body
  return JSON.parse(text.replace(FILE_LINK, (_match, prefix, id) => `${prefix}${id}?${signFileLink(id, now)}`))
}

// Express middleware: responses to logged-in requests get signed file links, and signed links
// sent back by the browser are stored bare (a saved signature would expire).
export function signFileLinksForSignedIn(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    const text = JSON.stringify(req.body)
    if (text && text.includes('/api/files/')) req.body = JSON.parse(unsignedFileLink(text))
  }
  if (!String(req.headers.authorization || '').startsWith('Bearer ')) return next()
  const json = res.json.bind(res)
  res.json = (body) => json(signFileLinksIn(body))
  return next()
}

// The bare link, as stored in the database (no signature).
export function unsignedFileLink(url) {
  return String(url || '').replace(FILE_LINK, (_match, prefix, id) => `${prefix}${id}`)
}
