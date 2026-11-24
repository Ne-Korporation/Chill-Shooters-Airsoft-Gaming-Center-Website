// Which automatic notifications each staff role receives. Admins aren't listed: they get
// everything, including a copy of what goes to marshals and registrars (see notifyRole).
// Announcements an admin sends by hand always go through.
//   - Marshals: every game booked (as soon as it's booked, walk-ins included), when it's
//     confirmed onto the games board, and the players' own weapons coming to it (each is
//     chronographed before play).
//   - Registrars: payments (including balances to collect onsite), waivers (guardian approvals
//     count as waiver work), every player ID submitted for verification, and partnership
//     discount requests to review.
// A notification qualifies by its type, or by the `topic` it was sent with.
export const ROLE_NOTIFICATION_RULES = {
  marshal: { types: ['game_booked', 'gameplay_created', 'own_weapons_incoming'], topics: ['game_booked'] },
  registrar: { types: ['reservation_payment_finalized', 'waiver_submitted', 'onsite_payment_due', 'player_id_submitted', 'partnership_requested', 'damage_charge_added'], topics: ['payment', 'waiver', 'identity', 'partnership'] },
}

const ALWAYS_ALLOWED_TYPES = ['announcement']

export function roleReceivesNotification(role, { type, topic } = {}) {
  const rules = ROLE_NOTIFICATION_RULES[role]
  if (!rules) return true
  if (ALWAYS_ALLOWED_TYPES.includes(type)) return true
  return rules.types.includes(type) || (topic != null && rules.topics.includes(topic))
}

// MongoDB condition matching the broadcasts a role should see (older ones sent before these
// rules are filtered the same way, so they drop off the list too).
export function roleNotificationFilter(role) {
  const rules = ROLE_NOTIFICATION_RULES[role]
  if (!rules) return {}
  return {
    $or: [
      { type: { $in: [...ALWAYS_ALLOWED_TYPES, ...rules.types] } },
      { topic: { $in: rules.topics } },
    ],
  }
}
