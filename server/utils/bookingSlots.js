export const BLOCKING_RESERVATION_STATUSES = ['pending', 'confirmed', 'approved']
const blockingStatuses = new Set(BLOCKING_RESERVATION_STATUSES)

export function normalizeLocationId(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  if (!normalized) return ''
  if (normalized.includes('salawag')) return 'salawag'
  if (normalized.includes('langkaan')) return 'langkaan'
  if (normalized.includes('binan')) return 'binan'
  return normalized
}

export function getBlockingSlotReservations({ reservations, locationId, normalizeLocationId }) {
  return reservations.filter((reservation) => {
    const status = String(reservation?.reservationStatus || '').toLowerCase()
    const location = normalizeLocationId(reservation?.locationId || reservation?.location || reservation?.locationName)
    return blockingStatuses.has(status) && location === locationId
  })
}

export function getSlotPlayerCount(reservations) {
  return reservations.reduce(
    (sum, reservation) => sum + Number(reservation.numberOfPlayers || reservation.players || 0),
    0,
  )
}

const isPrivate = (item) => String(item?.sessionType || '').toLowerCase() === 'private'

// Why a new booking can't take this slot, or null. `reservations` are the slot's blocking
// reservations; `holds` are other players' live slot holds (bookings in progress).
// - A private game (booked or being booked) closes the slot to everyone.
// - A private game can't be booked where public players are already booked.
export function slotConflict({ reservations = [], holds = [], sessionType }) {
  if (reservations.some(isPrivate)) {
    return { reason: 'private_booked', message: 'This slot is already booked for a private game. Please pick another time or date.' }
  }
  if (holds.some(isPrivate)) {
    return { reason: 'being_booked', message: 'Another player is booking this slot right now. Please pick another time or date.' }
  }
  if (String(sessionType || '').toLowerCase() === 'private' && reservations.length > 0) {
    return { reason: 'public_booked', message: 'Public players are already booked in this slot, so it can\'t be booked as a private game. Please pick another time or date.' }
  }
  return null
}
