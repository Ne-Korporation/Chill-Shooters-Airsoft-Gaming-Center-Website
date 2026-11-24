// Shared helpers for the demo seed: a seeded random generator (so every run makes the same data),
// stable ids, Manila-time dates, and the placeholder images stored as real uploaded files.

import crypto from 'crypto'
import { Binary } from 'mongodb'

// Every document the seed creates carries this flag, so demo data can always be told apart
// from real business records (and found again by the validator).
export const DEMO_FLAG = { demoSeed: true }

export const DEMO_PASSWORD = 'ChillDemo2026!'
export const DEMO_EMAIL_DOMAIN = 'demo.chillshooters.test'

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

export function createRng(seed = 20261124) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const rng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
    shuffle: (list) => {
      const copy = [...list]
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1))
        ;[copy[i], copy[j]] = [copy[j], copy[i]]
      }
      return copy
    },
  }
  return rng
}

export function hashHex(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex')
}

// A UUID-shaped id made from a key: the same key always gives the same id.
export function uuidFrom(key) {
  const h = hashHex(`uuid:${key}`)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

// Same alphabet as utils/shortIds.js newReservationId (no 0/O, 1/I/L).
const RESERVATION_ID_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export function reservationIdFrom(key) {
  const bytes = crypto.createHash('sha256').update(`reservation:${key}`).digest()
  let suffix = ''
  for (let i = 0; i < 8; i += 1) suffix += RESERVATION_ID_ALPHABET[bytes[i] % RESERVATION_ID_ALPHABET.length]
  return `R-${suffix}`
}

export function shortId(prefix, n) {
  return `${prefix}-${String(n).padStart(6, '0')}`
}

export function counter(prefix, start = 1) {
  let n = start - 1
  return () => {
    n += 1
    return shortId(prefix, n)
  }
}

export const round2 = (value) => Math.round(Number(value || 0) * 100) / 100

// ---------------------------------------------------------------------------
// Manila dates
// ---------------------------------------------------------------------------

const MANILA_OFFSET_MS = 8 * 3600_000
export const HOUR = 3600_000
export const DAY = 24 * HOUR

export function manilaDay(ms) {
  return new Date(ms + MANILA_OFFSET_MS).toISOString().slice(0, 10)
}

export function atManila(dateISO, hhmm = '12:00') {
  return Date.parse(`${dateISO}T${hhmm}:00+08:00`)
}

export function isoAt(dateISO, hhmm) {
  return new Date(atManila(dateISO, hhmm)).toISOString()
}

export function addDays(dateISO, n) {
  return manilaDay(atManila(dateISO, '12:00') + n * DAY)
}

// 0 = Sunday … 6 = Saturday.
export function dayOfWeek(dateISO) {
  return new Date(`${dateISO}T12:00:00+08:00`).getUTCDay()
}

export const isWeekend = (dateISO) => [0, 6].includes(dayOfWeek(dateISO))

export function minutesToHHMM(minutes) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export function hhmmToMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number)
  return h * 60 + (m || 0)
}

export function ageOn(birthDate, onDateISO) {
  const [by, bm, bd] = birthDate.split('-').map(Number)
  const [y, m, d] = onDateISO.split('-').map(Number)
  let age = y - by
  if (m < bm || (m === bm && d < bd)) age -= 1
  return age
}

// ---------------------------------------------------------------------------
// Placeholder images (SVG), stored in uploaded_files like a real upload
// ---------------------------------------------------------------------------

const esc = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function idCardSvg({ name, idType, idNumber, birthDate, side = 'front' }) {
  const back = side === 'back'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">
<rect width="640" height="400" rx="24" fill="#e8eef6"/>
<rect x="0" y="0" width="640" height="72" rx="24" fill="#1f3b63"/><rect x="0" y="48" width="640" height="24" fill="#1f3b63"/>
<text x="32" y="46" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="#ffffff">${esc(idType)}</text>
<text x="608" y="46" text-anchor="end" font-family="Arial, sans-serif" font-size="16" fill="#c9d6ea">${back ? 'BACK' : 'FRONT'}</text>
${back
    ? `<rect x="32" y="110" width="576" height="56" fill="#1f2937" opacity="0.85"/>
<text x="32" y="220" font-family="Arial, sans-serif" font-size="18" fill="#334155">ID No. ${esc(idNumber)}</text>
<text x="32" y="256" font-family="Arial, sans-serif" font-size="16" fill="#475569">Issued for identification purposes only.</text>`
    : `<rect x="32" y="104" width="150" height="190" rx="12" fill="#cbd5e1"/>
<circle cx="107" cy="170" r="38" fill="#94a3b8"/><rect x="62" y="218" width="90" height="56" rx="28" fill="#94a3b8"/>
<text x="210" y="140" font-family="Arial, sans-serif" font-size="14" fill="#64748b">NAME</text>
<text x="210" y="168" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="#0f172a">${esc(name)}</text>
<text x="210" y="212" font-family="Arial, sans-serif" font-size="14" fill="#64748b">DATE OF BIRTH</text>
<text x="210" y="238" font-family="Arial, sans-serif" font-size="20" fill="#0f172a">${esc(birthDate || '')}</text>
<text x="210" y="280" font-family="Arial, sans-serif" font-size="14" fill="#64748b">ID NUMBER</text>
<text x="210" y="304" font-family="Arial, sans-serif" font-size="20" fill="#0f172a">${esc(idNumber)}</text>`}
<text x="320" y="374" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#b91c1c">DEMO DATA: NOT A REAL ID</text>
</svg>`
}

export function gcashReceiptSvg({ amount, reference, dateLabel, sender }) {
  const peso = `₱${Number(amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="640" viewBox="0 0 420 640">
<rect width="420" height="640" fill="#f4f7fb"/>
<rect width="420" height="150" fill="#0a5bd8"/>
<text x="210" y="70" text-anchor="middle" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#fff">GCash</text>
<text x="210" y="110" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" fill="#dbe8ff">Express Send</text>
<rect x="24" y="180" width="372" height="380" rx="18" fill="#fff"/>
<text x="210" y="230" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" fill="#64748b">Sent to Chill Shooters Airsoft</text>
<text x="210" y="290" text-anchor="middle" font-family="Arial, sans-serif" font-size="40" font-weight="700" fill="#0f172a">${esc(peso)}</text>
<text x="48" y="360" font-family="Arial, sans-serif" font-size="15" fill="#64748b">Ref. No.</text>
<text x="372" y="360" text-anchor="end" font-family="Arial, sans-serif" font-size="15" fill="#0f172a">${esc(reference)}</text>
<text x="48" y="400" font-family="Arial, sans-serif" font-size="15" fill="#64748b">Date</text>
<text x="372" y="400" text-anchor="end" font-family="Arial, sans-serif" font-size="15" fill="#0f172a">${esc(dateLabel)}</text>
<text x="48" y="440" font-family="Arial, sans-serif" font-size="15" fill="#64748b">From</text>
<text x="372" y="440" text-anchor="end" font-family="Arial, sans-serif" font-size="15" fill="#0f172a">${esc(sender)}</text>
<text x="210" y="600" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#b91c1c">DEMO DATA: NOT A REAL TRANSACTION</text>
</svg>`
}

export function posterSvg({ title, subtitle, accent = '#d4a017' }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#14181f"/><stop offset="1" stop-color="#26303b"/></linearGradient></defs>
<rect width="1200" height="630" fill="url(#g)"/>
<path d="M0 520 L220 430 L420 490 L640 400 L860 470 L1200 380 L1200 630 L0 630 Z" fill="#1f5135" opacity="0.8"/>
<circle cx="1000" cy="160" r="90" fill="none" stroke="${accent}" stroke-width="6"/>
<line x1="1000" y1="50" x2="1000" y2="270" stroke="${accent}" stroke-width="4"/><line x1="890" y1="160" x2="1110" y2="160" stroke="${accent}" stroke-width="4"/>
<text x="80" y="250" font-family="Arial, sans-serif" font-size="68" font-weight="800" fill="#ffffff">${esc(title)}</text>
<text x="80" y="320" font-family="Arial, sans-serif" font-size="32" fill="${accent}">${esc(subtitle)}</text>
<text x="80" y="580" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="#e5e7eb">CHILL SHOOTERS AIRSOFT GAMING CENTER</text>
</svg>`
}

export function fieldPlanSvg({ title }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="560" viewBox="0 0 800 560">
<rect width="800" height="560" fill="#2f4a2c"/>
<rect x="30" y="30" width="740" height="500" fill="none" stroke="#e5e7eb" stroke-width="4" stroke-dasharray="14 10"/>
<rect x="60" y="230" width="90" height="100" fill="#3b82f6" opacity="0.7"/><text x="105" y="290" text-anchor="middle" font-family="Arial" font-size="18" fill="#fff">BLUE</text>
<rect x="650" y="230" width="90" height="100" fill="#ef4444" opacity="0.7"/><text x="695" y="290" text-anchor="middle" font-family="Arial" font-size="18" fill="#fff">RED</text>
<rect x="250" y="120" width="60" height="120" fill="#a16207"/><rect x="490" y="320" width="60" height="120" fill="#a16207"/>
<rect x="360" y="240" width="80" height="80" fill="#57534e"/><circle cx="220" cy="400" r="34" fill="#166534"/><circle cx="580" cy="160" r="34" fill="#166534"/>
<rect x="330" y="420" width="140" height="36" fill="#78716c"/><rect x="330" y="104" width="140" height="36" fill="#78716c"/>
<text x="400" y="545" text-anchor="middle" font-family="Arial" font-size="20" fill="#e5e7eb">${esc(title)}</text>
</svg>`
}

// A hand-drawn-looking signature as an inline image (waivers store signatures inline).
export function signatureDataUri(name, rng) {
  const letters = String(name).replace(/[^A-Za-z ]/g, '')
  let x = 20
  let d = `M ${x} 60`
  for (const ch of letters.slice(0, 14)) {
    const up = 20 + Math.floor(rng.next() * 30)
    const down = 60 + Math.floor(rng.next() * 20)
    d += ` Q ${x + 6} ${up}, ${x + 12} ${ch === ' ' ? 60 : down}`
    x += ch === ' ' ? 14 : 12
  }
  d += ` L ${x + 30} 58`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${x + 60}" height="100"><path d="${d}" fill="none" stroke="#111827" stroke-width="2.5" stroke-linecap="round"/></svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

// Collects uploaded_files documents and hands back the URL the app would store.
export function createFileStore(filesBase) {
  const files = []
  const base = String(filesBase || '').replace(/\/+$/, '')
  return {
    files,
    add({ key, filename, svg, uploadedBy = '', isPrivate = false, createdAtISO }) {
      const id = uuidFrom(`file:${key}`)
      const buffer = Buffer.from(svg, 'utf8')
      files.push({
        _id: id,
        filename,
        contentType: 'image/svg+xml',
        size: buffer.length,
        data: new Binary(buffer),
        uploadedBy: String(uploadedBy),
        ...(isPrivate ? { private: true } : {}),
        createdAtISO,
        ...DEMO_FLAG,
      })
      return `${base}/api/files/${id}`
    },
  }
}

export function actor(staff) {
  return { actorId: String(staff.id), actorEmail: staff.email, actorRole: staff.role }
}
