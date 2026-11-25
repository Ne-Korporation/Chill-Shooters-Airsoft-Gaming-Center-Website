import { ObjectId } from 'mongodb'
import { getDb } from '../db/mongo.js'

// The audit trail: who changed what, and when.
//
// Every successful change made by a signed-in user (POST / PUT / PATCH / DELETE that answers
// below 400) is recorded by `auditRequests`, so nothing slips through when a new route is added.
// The rules below give the important actions a readable name, a module and a severity; anything
// without a rule is still recorded under its path. Routes that write their own, richer entry with
// `logAudit` (reason, names, outcome) mark the request so it isn't recorded twice.
//
// Entry: { module, action, label, severity, resourceType, resourceId, summary, actorId, actorRole,
//          actorName, actorEmail, method, path, details, before, after, ip, createdAtISO }

export const AUDIT_MODULES = ['reservation', 'payment', 'player', 'staff', 'weapon', 'gear', 'operations', 'package', 'calendar', 'finance', 'waiver', 'settings', 'account', 'other']

// [method, path pattern, module, label, severity]. First match wins. Paths are without "/api".
const RULES = [
  // Money
  ['PUT', /^\/payments\/([^/]+)\/verify$/, 'payment', (b) => {
    const status = String(b?.paymentStatus || b?.status || '').toLowerCase()
    return status === 'failed' ? 'Payment rejected' : ['pending', 'review'].includes(status) ? 'Payment sent back for review' : 'Payment verified'
  }, 'warning'],
  ['POST', /^\/payments\/onsite$/, 'payment', 'Onsite payment recorded', 'warning'],
  ['POST', /^\/payments\/stripe-confirm$/, 'payment', 'Card payment confirmed', 'info'],
  ['PUT', /^\/payments\/(bank-details|gcash-qr)$/, 'settings', 'Payment details changed', 'critical'],
  ['POST', /^\/(xendit\/checkout|xendit\/verify|create-payment-intent|demo-pay\/checkout|demo-pay\/[^/]+\/pay)$/, 'payment', 'Online payment started or checked', 'info'],
  ['POST', /^\/reservations\/([^/]+)\/charges$/, 'payment', 'Charge added to a bill', 'warning'],
  ['POST', /^\/reservations\/([^/]+)\/charges\/[^/]+\/remove$/, 'payment', 'Charge removed from a bill', 'critical'],
  ['POST', /^\/reservations\/([^/]+)\/add-gun$/, 'payment', 'Extra gun rented at the counter', 'info'],
  ['POST', /^\/reservations\/([^/]+)\/receipt$/, 'payment', 'Receipt issued', 'info'],
  ['PUT', /^\/damage-reports\/([^/]+)\/review$/, 'payment', (b) => (b?.decision === 'waive' ? 'Damage fee waived' : 'Damage fee billed'), 'warning'],
  ['PUT', /^\/penalty-rules$/, 'settings', 'Damage handling fee changed', 'warning'],
  // Reservations
  ['PUT', /^\/reservations\/([^/]+)\/status$/, 'reservation', (b) => `Reservation status set to ${b?.status || b?.reservationStatus || 'new status'}`, 'warning'],
  ['PUT', /^\/reservations\/([^/]+)\/confirm$/, 'reservation', 'Reservation confirmed', 'info'],
  ['POST', /^\/reservations\/([^/]+)\/cancel$/, 'reservation', 'Reservation cancelled', 'warning'],
  ['POST', /^\/reservations\/([^/]+)\/accept$/, 'reservation', 'Team invite accepted', 'info'],
  ['POST', /^\/reservations\/([^/]+)\/decline$/, 'reservation', 'Team invite declined', 'info'],
  ['POST', /^\/reservations\/([^/]+)\/members\/[^/]+\/remove$/, 'reservation', 'Player removed from a team', 'warning'],
  ['POST', /^\/reservations\/([^/]+)\/open-slots\/[^/]+\/(cover|invite)$/, 'reservation', 'Open team spot filled', 'info'],
  ['POST', /^\/walk-ins$/, 'reservation', 'Walk-in booked', 'info'],
  // Accounts
  ['POST', /^\/auth\/admin\/add-staff$/, 'staff', 'Staff account created', 'critical'],
  ['POST', /^\/auth\/admin\/add-player$/, 'player', 'Player account created at the counter', 'info'],
  ['POST', /^\/auth\/admin\/reset-password$/, 'account', 'Password reset by an admin', 'critical'],
  ['PUT', /^\/players\/([^/]+)\/experience$/, 'player', 'Player experience level changed', 'info'],
  ['PUT', /^\/partnership-discount\/([^/]+)\/review$/, 'player', 'Partner discount request reviewed', 'warning'],
  ['POST', /^\/partnership-discount\/request$/, 'player', 'Partner discount requested', 'info'],
  ['POST', /^\/auth\/change-email\/verify$/, 'account', 'Email address changed', 'warning'],
  ['POST', /^\/children$/, 'player', 'Minor added by a guardian', 'info'],
  ['PUT', /^\/guardian-approvals\/([^/]+)\/in-person$/, 'waiver', 'Guardian approval recorded in person', 'warning'],
  // Inventory
  ['POST', /^\/inventory\/weapons\/pieces$/, 'weapon', 'Weapons added', 'info'],
  ['POST', /^\/inventory\/equipments\/pieces$/, 'gear', 'Gear added', 'info'],
  ['PUT', /^\/inventory\/weapons\/models$/, 'weapon', 'Weapon model updated', 'warning'],
  ['PUT', /^\/inventory\/equipments\/models$/, 'gear', 'Gear model updated', 'warning'],
  ['POST', /^\/damage-reports$/, 'operations', 'Damage or loss reported', 'warning'],
  ['POST', /^\/repairs$/, 'operations', 'Repair opened', 'info'],
  ['PUT', /^\/repairs\/([^/]+)\/complete$/, 'operations', 'Repair completed', 'info'],
  ['POST', /^\/rentals\/issue$/, 'operations', 'Rental handed out', 'info'],
  ['PUT', /^\/rentals\/([^/]+)\/return$/, 'operations', 'Rental returned', 'info'],
  ['POST', /^\/partner-loans$/, 'operations', 'Gear loaned to a partner', 'warning'],
  ['PUT', /^\/partner-loans\/([^/]+)\/return$/, 'operations', 'Partner loan returned', 'info'],
  ['POST', /^\/fps-logs$/, 'operations', 'FPS reading logged', 'info'],
  ['PUT', /^\/field-checkin$/, 'operations', 'Player check-in changed', 'info'],
  ['POST', /^\/team-grouping$/, 'operations', 'Teams grouped', 'info'],
  // Calendar and settings
  ['PUT', /^\/slot-hours$/, 'settings', 'Slot hours changed', 'warning'],
  ['PUT', /^\/waiver-text$/, 'settings', 'Waiver text changed', 'critical'],
  ['PUT', /^\/field-layout-fees$/, 'settings', 'Field layout fees changed', 'warning'],
  ['PUT', /^\/field-obstacles\/([^/]+)$/, 'settings', 'Field obstacles changed', 'info'],
  ['POST', /^\/weather-advisories$/, 'calendar', 'Weather advisory posted', 'warning'],
  // Finance
  ['POST', /^\/operating-expenses$/, 'finance', 'Operating expense added', 'info'],
  ['DELETE', /^\/operating-expenses\/([^/]+)$/, 'finance', 'Operating expense deleted', 'warning'],
  ['POST', /^\/reach-fund\/(allocate|entries)$/, 'finance', 'REACH fund entry recorded', 'warning'],
  ['PUT', /^\/reach-fund\/settings$/, 'finance', 'REACH fund settings changed', 'warning'],
  ['POST', /^\/reach-programs$/, 'finance', 'REACH program added', 'info'],
  ['PUT', /^\/reach-programs\/([^/]+)$/, 'finance', 'REACH program updated', 'info'],
]

// Generic record writes (/:collection and /:collection/:id): module and wording per collection.
const COLLECTION_MODULES = {
  reservations: ['reservation', 'Reservation'],
  payments: ['payment', 'Payment'],
  user_accounts: ['account', 'Account'],
  weapons: ['weapon', 'Weapon'],
  equipments: ['gear', 'Gear'],
  equipment: ['gear', 'Gear'],
  packages: ['package', 'Package'],
  gameplay: ['operations', 'Game'],
  waivers: ['waiver', 'Waiver'],
  partnerships: ['player', 'Partnership'],
  dashboard_posts: ['other', 'Dashboard post'],
  feedback: ['other', 'Feedback'],
  notifications: ['other', 'Notification'],
}

// Requests that change nothing worth auditing (sign-in steps, holds, reads sent as POST).
const SKIP = [
  /^\/auth\/(login|register|logout|send-otp|verify-otp|forgot-password|reset-password|verify-reset-code|unlock|social-login|social-register|set-password|change-email\/request|me)\b/,
  /^\/slot-holds\b/,
  /^\/(upload-image|upload-document|scan-id|uploads)\b/,
  /^\/(package-recommendations|inventory-check|weather-advisories\/check|test-email)\b/,
  /^\/auth\/admin\/package-suggestions\b/,
  /^\/notifications\/[^/]+$/, // marking a notification read
]

// Changes made without signing in: through an emailed link, or by the payment provider calling
// back. Who did it is named here; the link's token is never stored, and only the listed fields of
// the request are kept.
const PUBLIC_RULES = [
  [/^\/guardian-approvals\/[^/]+$/, {
    module: 'waiver',
    label: (b) => (b?.decision === 'declined' ? 'Guardian declined a game (emailed link)' : 'Guardian approved a game (emailed link)'),
    severity: 'warning',
    actor: { id: 'guardian-link', role: 'guardian', name: 'Guardian (emailed link)' },
    fields: ['decision', 'note'],
  }],
  [/^\/guardian-confirmations\/[^/]+$/, {
    module: 'player',
    label: 'Guardian confirmed a child profile (emailed link)',
    severity: 'info',
    actor: { id: 'guardian-link', role: 'guardian', name: 'Guardian (emailed link)' },
    fields: [],
  }],
  [/^\/xendit\/webhook$/, {
    module: 'payment',
    label: (b) => `Online payment ${String(b?.status || 'update').toLowerCase()} (payment provider)`,
    severity: 'warning',
    actor: { id: 'xendit', role: 'payment provider', name: 'Xendit (payment provider)' },
    fields: ['id', 'external_id', 'status', 'amount', 'paid_amount', 'payment_method', 'payment_channel'],
    resourceId: (b) => String(b?.external_id || b?.id || ''),
  }],
]

const SECRET_KEY = /pass(word)?|token|secret|otp|code$|signature|image|photo|document|qr|scan/i

// A compact, safe copy of a request body or record: no secrets or images, short strings, few keys.
export function sanitizeForAudit(value, depth = 0) {
  if (value == null) return value
  if (typeof value === 'string') {
    if (/^data:/.test(value)) return '[file]'
    return value.length > 200 ? `${value.slice(0, 200)}…` : value
  }
  if (typeof value !== 'object') return value
  if (value instanceof Date) return value.toISOString()
  if (value instanceof ObjectId) return String(value)
  if (depth >= 3) return Array.isArray(value) ? `[${value.length} items]` : '[object]'
  if (Array.isArray(value)) {
    const items = value.slice(0, 10).map((item) => sanitizeForAudit(item, depth + 1))
    return value.length > 10 ? [...items, `…${value.length - 10} more`] : items
  }
  const out = {}
  for (const [key, item] of Object.entries(value).slice(0, 40)) {
    if (key === '_id') continue
    out[key] = SECRET_KEY.test(key) && item ? '[hidden]' : sanitizeForAudit(item, depth + 1)
  }
  return out
}

// Which rule describes a request: { module, label, severity, resourceType, resourceId }.
export function describeRequest(method, path, body) {
  for (const [ruleMethod, pattern, module, label, severity] of RULES) {
    if (ruleMethod !== method) continue
    const match = path.match(pattern)
    if (!match) continue
    return {
      module,
      label: typeof label === 'function' ? label(body) : label,
      severity,
      resourceType: path.split('/')[1] || '',
      resourceId: match[1] && !/^(bank-details|gcash-qr|allocate|entries|cover|invite)$/.test(match[1]) ? decodeURIComponent(match[1]) : '',
    }
  }
  const generic = path.match(/^\/([a-z_]+)(?:\/([^/]+))?$/)
  if (generic && COLLECTION_MODULES[generic[1]]) {
    const [module, noun] = COLLECTION_MODULES[generic[1]]
    const verb = method === 'DELETE' ? 'deleted' : method === 'POST' ? 'created' : 'updated'
    const statusChange = body?.$set?.Status || body?.$set?.status || body?.status
    return {
      module,
      label: statusChange && method !== 'POST' ? `${noun} status set to ${statusChange}` : `${noun} ${verb}`,
      severity: method === 'DELETE' || generic[1] === 'user_accounts' || generic[1] === 'payments' ? 'warning' : 'info',
      resourceType: generic[1],
      resourceId: generic[2] ? decodeURIComponent(generic[2]) : '',
    }
  }
  const first = path.split('/')[1] || ''
  return { module: 'other', label: `${method} ${path}`, severity: 'info', resourceType: first, resourceId: '' }
}

const nameCache = new Map()
async function actorDetails(db, user) {
  const id = String(user?.id || '')
  if (!id) return { actorName: '', actorEmail: String(user?.email || '') }
  const cached = nameCache.get(id)
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.value
  const account = await db.collection('user_accounts').findOne({ id }, { projection: { name: 1, email: 1 } }).catch(() => null)
  const value = { actorName: String(account?.name || ''), actorEmail: String(account?.email || user?.email || '') }
  nameCache.set(id, { value, at: Date.now() })
  return value
}

// Emailed-link paths carry a secret token: never store it.
const redactPath = (path) => path.replace(/\/(guardian-approvals|guardian-confirmations)\/(?!.*\/in-person$)[^/]+/, '/$1/[link]')

const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim()

/**
 * Writes one audit entry. Never throws: a failed audit write is logged, the action still stands.
 * `req` gives the actor and marks the request as audited so `auditRequests` skips it.
 */
export async function logAudit(db, req, { module = 'other', action, label = '', severity = 'info', resourceType = '', resourceId = '', summary = '', details = {}, before, after, actor: actorOverride } = {}) {
  if (req) req.auditLogged = true
  try {
    // Without a signed-in user: the server itself (a scheduled job), or whoever `actor` names
    // (a guardian using an emailed link, the payment provider).
    const who = req?.user
      ? { actorId: String(req.user.id), actorRole: String(req.user.role || ''), ...(await actorDetails(db, req.user)) }
      : {
        actorId: String(actorOverride?.id || 'system'),
        actorRole: String(actorOverride?.role || 'system'),
        actorName: String(actorOverride?.name || 'System (automatic)'),
        actorEmail: String(actorOverride?.email || ''),
      }
    await db.collection('audit_logs').insertOne({
      module,
      action: action || label,
      label: label || action,
      severity,
      resourceType,
      resourceId: String(resourceId || ''),
      summary,
      ...who,
      method: req?.method || 'SYSTEM',
      path: req ? redactPath(String(req.originalUrl || '').split('?')[0]) : '',
      details: sanitizeForAudit(details),
      ...(before !== undefined ? { before: sanitizeForAudit(before) } : {}),
      ...(after !== undefined ? { after: sanitizeForAudit(after) } : {}),
      ip: req ? clientIp(req) : '',
      createdAtISO: new Date().toISOString(),
    })
  } catch (err) {
    console.error('Failed to write audit log', err)
  }
}

// The fields a generic record update changes, so the entry can show them before and after.
function changedFields(body) {
  if (!body || typeof body !== 'object') return []
  const set = body.$set && typeof body.$set === 'object' ? body.$set : Object.fromEntries(Object.entries(body).filter(([key]) => !key.startsWith('$')))
  return [...Object.keys(set), ...Object.keys(body.$unset || {})].filter((key) => key !== '_id' && !/AtISO$/.test(key)).slice(0, 30)
}

async function loadRecord(db, collection, id) {
  const filter = /^[a-f0-9]{24}$/i.test(id) ? { $or: [{ id }, { _id: new ObjectId(id) }] } : { id }
  return db.collection(collection).findOne(filter)
}

/** Express middleware: records every successful change. Mount after the JSON body parser. */
export function auditRequests(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next()
  const path = String(req.originalUrl || '').split('?')[0].replace(/^\/api/, '')
  if (!path || SKIP.some((pattern) => pattern.test(path))) return next()

  const body = req.body
  const publicRule = req.method === 'POST' ? PUBLIC_RULES.find(([pattern]) => pattern.test(path))?.[1] : null
  if (publicRule) {
    res.on('finish', () => {
      if (res.statusCode >= 400 || req.auditLogged) return
      const label = typeof publicRule.label === 'function' ? publicRule.label(body) : publicRule.label
      const resourceId = publicRule.resourceId ? publicRule.resourceId(body) : ''
      void getDb().then((db) => logAudit(db, req, {
        module: publicRule.module,
        action: label,
        label,
        severity: publicRule.severity,
        resourceType: path.split('/')[1] || '',
        resourceId,
        summary: `${label}${resourceId ? ` (${resourceId})` : ''}`,
        details: Object.fromEntries(publicRule.fields.map((key) => [key, body?.[key]])),
        actor: publicRule.actor,
      })).catch((err) => console.error('Failed to audit request', err))
    })
    return next()
  }

  const rule = describeRequest(req.method, path, req.body)
  // Generic record edits and deletes: keep the record's values before the change.
  const generic = (req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE') && COLLECTION_MODULES[rule.resourceType] && rule.resourceId
  const beforePromise = generic
    ? getDb().then((db) => loadRecord(db, rule.resourceType, rule.resourceId)).catch(() => null)
    : Promise.resolve(null)

  res.on('finish', () => {
    if (res.statusCode >= 400 || req.auditLogged || !req.user) return
    void (async () => {
      try {
        const db = await getDb()
        const record = await beforePromise
        let before
        let after
        if (record && req.method !== 'DELETE') {
          const fields = changedFields(body)
          before = Object.fromEntries(fields.map((key) => [key, record[key]]))
          const set = body?.$set || body || {}
          after = Object.fromEntries(fields.map((key) => [key, key in (body?.$unset || {}) ? null : set[key]]))
        } else if (record) {
          before = record
        }
        const name = record?.name || record?.itemName || record?.captainName || ''
        await logAudit(db, req, {
          ...rule,
          action: rule.label,
          summary: [rule.label, rule.resourceId ? `(${rule.resourceId}${name ? ` · ${name}` : ''})` : ''].filter(Boolean).join(' '),
          details: generic ? {} : body,
          before,
          after,
        })
      } catch (err) {
        console.error('Failed to audit request', err)
      }
    })()
  })
  return next()
}

const MODULE_OF_ACTION = [
  [/^player_|^minor_/, 'player'],
  [/^staff_/, 'staff'],
  [/^(cause|closed)_day/, 'calendar'],
  [/^reservation_/, 'reservation'],
]

// Older entries were written before modules existed: work one out from the action name.
export function moduleOfEntry(entry) {
  if (entry.module) return entry.module
  const action = String(entry.action || '')
  return MODULE_OF_ACTION.find(([pattern]) => pattern.test(action))?.[1] || 'other'
}

export function labelOfEntry(entry) {
  if (entry.label) return entry.label
  const text = String(entry.action || 'Action').replace(/_/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}
