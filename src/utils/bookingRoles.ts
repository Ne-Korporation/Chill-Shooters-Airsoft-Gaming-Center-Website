// What to call the people on a booking. A private game is one team with a captain; a public game
// is open play where strangers share the field, so the person who booked is just the booker and
// everyone they added is a player. Bookings without a session type are public.
export const isPrivateSession = (sessionType?: string | null) => String(sessionType || '').toLowerCase() === 'private'

export function bookingRoles(sessionType?: string | null) {
  return isPrivateSession(sessionType)
    ? { booker: 'Captain', member: 'Teammate', group: 'Team' }
    : { booker: 'Booker', member: 'Player', group: 'Players' }
}
