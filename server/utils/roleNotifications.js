// Which automatic notifications each staff role receives. Roles not listed here (admins) get
// everything sent to them. Announcements an admin sends by hand always go through.
//   - Marshals: only when a game is booked (a confirmed reservation lands on the games board).
//   - Registrars: only payments and waivers (guardian approvals count as waiver work).
// A notification qualifies by its type, or by the `topic` it was sent with.
export const ROLE_NOTIFICATION_RULES = {
  marshal: { types: ['gameplay_created'], topics: ['game_booked'] },
  registrar: { types: ['reservation_payment_finalized', 'waiver_submitted'], topics: ['payment', 'waiver'] },
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
