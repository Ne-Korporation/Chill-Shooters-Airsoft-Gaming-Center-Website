// Private games (weekdays): billed for at least PRIVATE_MIN_PLAYERS players, and the fields
// follow the headcount. Mirrored on the booking page (src/utils/privateGames.ts).
//
// A smaller group can still book: the missing spots ("empty spots") are charged at one
// player's package price and paid by the captain (see utils/bookingPricing.js and
// utils/splitShares.js).

export const PRIVATE_MIN_PLAYERS = 10

// Players needed for each number of fields: Upper Ground from 10 (the minimum), Upper + Lower
// Ground from 20, all three fields from 30.
export const FIELD_COUNT_MINIMUMS = [0, 10, 20, 30]

export function isPrivateSession(sessionType) {
  return String(sessionType || '').toLowerCase() === 'private'
}

// How many players a booking is billed for: at least the private-game minimum.
export function billedPlayers(sessionType, players) {
  const count = Math.max(0, Math.round(Number(players) || 0))
  return isPrivateSession(sessionType) ? Math.max(count, PRIVATE_MIN_PLAYERS) : count
}

// Spots paid for but not filled (0 for public games and groups of 10 or more).
export function emptySpots(sessionType, players) {
  return billedPlayers(sessionType, players) - Math.max(0, Math.round(Number(players) || 0))
}

// Minimum headcount (empty spots included) for booking this many fields.
export function fieldCountMinimum(fieldCount) {
  const count = Math.max(0, Math.floor(Number(fieldCount) || 0))
  return FIELD_COUNT_MINIMUMS[Math.min(count, FIELD_COUNT_MINIMUMS.length - 1)]
}

// How many fields a private group gets, by headcount (empty spots included).
export function fieldCountForPlayers(players) {
  const count = Math.max(PRIVATE_MIN_PLAYERS, Math.round(Number(players) || 0))
  if (count >= FIELD_COUNT_MINIMUMS[3]) return 3
  if (count >= FIELD_COUNT_MINIMUMS[2]) return 2
  return 1
}
