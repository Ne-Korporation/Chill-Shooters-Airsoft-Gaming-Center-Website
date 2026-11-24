import type { NotificationItem } from '../context/NotificationContext'

function isStaffRole(role?: string) {
  return role === 'admin' || role === 'registrar' || role === 'marshal'
}

// The games board for this role, opened on one game when the notice names it.
function gamesBoardRoute(role: string, linkedId?: string) {
  // Registrars: the Games tab of Reservations.
  if (role === 'registrar') {
    const id = String(linkedId || '').trim()
    return `/app/registrar/reservations?tab=games${id ? `&game=${encodeURIComponent(id)}` : ''}`
  }
  const id = String(linkedId || '').trim()
  return id ? `/app/games?game=${encodeURIComponent(id)}` : '/app/games'
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
  // Notices about one game (booked, confirmed, due to start, own weapons coming) open that game on
  // the games board: its details pop up and its row is highlighted. The link is the game id, or the
  // booking id for a game just booked.
  if (notificationType === 'own_weapons_incoming' || notificationType === 'game_booked' || notificationType === 'game_due_to_start' || notificationType.startsWith('gameplay_')) {
    return isStaffRole(currentRole) ? gamesBoardRoute(currentRole, notification.linkedResourceId) : '/app'
  }

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

  // A damage fee added to a booking: open that booking's bill at the counter.
  if (notificationType === 'damage_charge_added') {
    if (!isStaffRole(currentRole)) return '/app/my-reservations'
    const id = String(notification.linkedResourceId || '').trim()
    return id ? `/app/counter?reservation=${encodeURIComponent(id)}` : '/app/counter'
  }

  if (notificationType.startsWith('payment_')) {
    if (currentRole === 'admin') return '/app/admin/payments'
    if (currentRole === 'registrar') return '/app/registrar/submitted-payments'
    return '/app/payment'
  }

  if (notificationType.startsWith('weapon_')) {
    if (currentRole === 'admin' || currentRole === 'marshal') return '/app/admin/weapons'
    return '/app'
  }

  if (notificationType.startsWith('equipment_')) {
    if (currentRole === 'admin' || currentRole === 'marshal') return '/app/admin/equipment'
    return '/app'
  }

  // A player submitted an ID: open that player's details on the players page (the link is their
  // account id), or the ID verification list when the notice names no one.
  if (notificationType === 'player_id_submitted') {
    const base = currentRole === 'admin' ? '/app/admin/player-management' : currentRole === 'registrar' ? '/app/registrar/players' : ''
    if (!base) return null
    const playerId = String(notification.linkedResourceId || '').trim()
    return playerId ? `${base}?player=${encodeURIComponent(playerId)}#id-verifications` : `${base}#id-verifications`
  }

  // Partnership discount: staff open the requests list; the player opens their profile, where the
  // discount card shows the decision.
  if (notificationType.startsWith('partnership_')) {
    if (currentRole === 'admin') return '/app/admin/player-management#partnership-requests'
    if (currentRole === 'registrar') return '/app/registrar/players#partnership-requests'
    return userId ? `/app/players/${encodeURIComponent(userId)}` : '/app'
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
