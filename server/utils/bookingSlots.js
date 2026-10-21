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
