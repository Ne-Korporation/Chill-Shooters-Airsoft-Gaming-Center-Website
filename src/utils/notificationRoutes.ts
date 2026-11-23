import type { NotificationItem } from '../context/NotificationContext'

function isStaffRole(role?: string) {
  return role === 'admin' || role === 'registrar' || role === 'marshal'
}

export function resolveNotificationRoute(notification: NotificationItem, role?: string, userId?: string) {
  const notificationType = String(notification.type || '').toLowerCase()
  const currentRole = String(role || '').toLowerCase()

  // Announcements have no page of their own; they're read in full in the notifications list.
  // Older admin broadcasts were saved as 'payment_submitted', so a broadcast reaching a player is
  // treated as an announcement too (the server never broadcasts anything else to players).
  if (notificationType === 'announcement') return null
  if (notification.userId === 'broadcast' && !isStaffRole(currentRole)) return null

  if (notificationType.startsWith('split_payment_')) return '/app/my-reservations#split-payments'
  // Game invites to answer, and spots a teammate left open.
  if (notificationType.startsWith('team_')) return '/app/my-reservations#invitations'
  // Money to collect at the counter, and players' own weapons coming to a game.
  if (notificationType === 'onsite_payment_due') {
    if (currentRole === 'admin') return '/app/admin/reservations'
    if (currentRole === 'registrar') return '/app/registrar/reservations'
    return '/app/my-reservations'
  }
  if (notificationType === 'own_weapons_incoming') return isStaffRole(currentRole) ? '/app/games' : '/app'

  // A message from a player opens the admin Inbox.
  if (notificationType === 'contact_message') return currentRole === 'admin' ? '/app/admin/inbox' : null

  if (notificationType === 'weather_advisory') return '/app'

  if (notificationType === 'reservation_payment_finalized') {
    return currentRole === 'admin' ? '/app/admin' : '/app/my-reservations'
  }

  if (notificationType.startsWith('reservation_')) {
    if (currentRole === 'admin') return '/app/admin/reservations'
    if (currentRole === 'registrar') return '/app/registrar/reservations'
    if (currentRole === 'marshal') return '/app/games'
    return '/app/my-reservations'
  }

  if (notificationType.startsWith('waiver_')) {
    if (currentRole === 'admin') return '/app/admin/waivers'
    if (currentRole === 'registrar') return '/app/registrar/waivers'
    return '/app/waiver'
  }

  if (notificationType.startsWith('payment_')) {
    if (currentRole === 'admin') return '/app/admin/payments'
    if (currentRole === 'registrar') return '/app/registrar/submitted-payments'
    return '/app/payment'
  }

  if (notificationType.startsWith('gameplay_')) {
    if (isStaffRole(currentRole)) return '/app/games'
    return '/app'
  }

  if (notificationType.startsWith('weapon_')) {
    if (currentRole === 'admin' || currentRole === 'marshal') return '/app/admin/weapons'
    if (userId) return `/app/players/${encodeURIComponent(userId)}/weapons-and-equipment`
    return '/app/players'
  }

  if (notificationType.startsWith('equipment_')) {
    if (currentRole === 'admin' || currentRole === 'marshal') return '/app/admin/equipment'
    if (userId) return `/app/players/${encodeURIComponent(userId)}/weapons-and-equipment`
    return '/app/players'
  }

  // A player submitted an ID: open the ID verification list on the players page.
  if (notificationType === 'player_id_submitted') {
    if (currentRole === 'admin') return '/app/admin/player-management#id-verifications'
    if (currentRole === 'registrar') return '/app/registrar/players#id-verifications'
    return null
  }

  if (notificationType.startsWith('player_')) {
    if (userId) return `/app/players/${encodeURIComponent(userId)}`
    return '/app/admin/player-management'
  }

  if (notificationType.startsWith('admin_') || notificationType.startsWith('audit_')) {
    return '/app/admin/audit-logs'
  }

  if (notification.linkedResourceId) {
    if (isStaffRole(currentRole)) return '/app/notifications'
    return '/app/notifications'
  }

  return null
}
