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

// Grounds are never picked by the player: they are assigned from the number of players, in this
// order (Upper Ground is the main field). Management rule: fewer than 20 players get Upper Ground,
// 20-49 get Upper + Lower Ground, 50 or more get all three. A private game counts its own group;
// public games share the slot, so their grounds follow the slot's total public headcount.
export const GROUND_OPENS_AT = [0, 20, 50]

export function groundCountForPlayers(players) {
  const count = Math.max(0, Number(players) || 0)
  return GROUND_OPENS_AT.filter((threshold) => count >= threshold).length || 1
}

// Field ids are `<location>-field-1` (Upper), `-2` (Lower) and `-3` (Forest).
export function groundIdsForPlayers(locationId, players) {
  return Array.from({ length: groundCountForPlayers(players) }, (_, index) => `${locationId}-field-${index + 1}`)
}

// Re-assigns the grounds of every public booking in one slot from the slot's total public
// headcount. Called whenever a public booking joins, leaves or moves.
export async function syncPublicGrounds(db, { locationId, reservationDate, reservationTime }, session) {
  if (!locationId || !reservationDate || !reservationTime) return
  const options = session ? { session } : {}
  const sameSlot = await db.collection('reservations').find(
    {
      $and: [
        { $or: [{ reservationDate }, { dateISO: reservationDate }] },
        { $or: [{ reservationTime }, { slot: reservationTime }] },
      ],
    },
    options,
  ).toArray()
  const publicGames = getBlockingSlotReservations({ reservations: sameSlot, locationId, normalizeLocationId })
    .filter((reservation) => !isPrivate(reservation))
  if (publicGames.length === 0) return
  const fieldIds = groundIdsForPlayers(locationId, getSlotPlayerCount(publicGames))
  const stale = publicGames.filter((reservation) => {
    const current = Array.isArray(reservation.fieldIds) ? reservation.fieldIds.map(String) : []
    return current.length !== fieldIds.length || current.some((id, index) => id !== fieldIds[index])
  })
  if (stale.length === 0) return
  await db.collection('reservations').updateMany(
    { _id: { $in: stale.map((reservation) => reservation._id) } },
    { $set: { fieldIds, fieldId: fieldIds[0] } },
    options,
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
