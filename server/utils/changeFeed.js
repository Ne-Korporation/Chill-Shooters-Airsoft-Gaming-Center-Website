// A tiny change feed so open pages can refresh themselves when data changes.
//
// Each topic has a version number that goes up whenever something in it changes. The app polls
// GET /api/changes every few seconds; when a topic's version moves, the pages showing that topic
// reload their data (in place, keeping anything typed in a form).
//
// Versions live in memory. bootId changes on every server start, so a restart makes every page
// refresh once, which is the safe choice (anything may have changed while it was down).

export const TOPICS = ['reservations', 'slots', 'payments', 'waivers', 'notifications', 'accounts', 'gear', 'games', 'content']

const bootId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const versions = Object.fromEntries(TOPICS.map((topic) => [topic, 0]))

export function bumpTopics(...topics) {
  for (const topic of topics.flat()) {
    if (topic in versions) versions[topic] += 1
  }
}

export function changeSnapshot() {
  return { bootId, versions: { ...versions } }
}

// Which topics a change request (POST/PUT/PATCH/DELETE) to this API path touches. Anything
// unrecognized bumps nothing; a bump that wasn't needed only costs an extra reload.
const PATH_TOPICS = [
  [/^\/(reservations|walk-ins|team|team-bookings|cause-days|closed-days)/, ['reservations', 'slots', 'games']],
  [/^\/slot-holds/, ['slots']],
  [/^\/(payments|create-payment-intent|stripe|xendit|demo-pay|split)/, ['payments', 'reservations', 'slots']],
  [/^\/(waivers|waiver|guardian-approvals|guardian-confirmations|children)/, ['waivers', 'accounts']],
  [/^\/notifications/, ['notifications']],
  [/^\/(user_accounts|auth\/admin|players|upload-image|scan-id)/, ['accounts']],
  [/^\/(weapons|equipments|equipment|rentals|repairs|damage-reports|fps|inventory)/, ['gear', 'games']],
  [/^\/(gameplay|games|check-in|teams|field)/, ['games', 'reservations']],
  [/^\/(packages|dashboard_posts|feedback|partnerships|reach|announcements)/, ['content']],
]

export function topicsForPath(path) {
  const clean = String(path || '').replace(/^\/api/, '')
  const found = new Set()
  for (const [pattern, topics] of PATH_TOPICS) {
    if (pattern.test(clean)) topics.forEach((topic) => found.add(topic))
  }
  return [...found]
}

// Express middleware: after a successful change request, bump the topics it touched.
// Most notifications are sent as a side effect of other changes, so those bump it too.
export function trackChanges(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next()
  // Sign-in, sign-up and code checks change nothing other pages show.
  if (/^\/api\/auth\/(login|register|send-otp|verify|forgot|reset|unlock|social|me|set-password|change-email)/.test(req.originalUrl)) return next()
  res.on('finish', () => {
    if (res.statusCode >= 400) return
    const topics = topicsForPath(req.originalUrl.split('?')[0])
    if (topics.length) bumpTopics(topics, 'notifications')
  })
  return next()
}
