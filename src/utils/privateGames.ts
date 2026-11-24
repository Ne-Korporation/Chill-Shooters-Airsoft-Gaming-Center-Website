// Private games (weekdays): billed for at least PRIVATE_MIN_PLAYERS players, and the fields follow
// the headcount. Same rule as server/utils/privateGames.js.
//
// A smaller group can still book: each empty spot costs one player's package price and is paid
// by the captain.

export const PRIVATE_MIN_PLAYERS = 10

// Players needed for each number of fields: Upper Ground from 10, Upper + Lower Ground from 20,
// all three fields from 30.
export const FIELD_COUNT_MINIMUMS = [0, 10, 20, 30]

export function billedPlayers(sessionType: string, players: number): number {
  const count = Math.max(0, Math.round(Number(players) || 0))
  return sessionType === 'private' ? Math.max(count, PRIVATE_MIN_PLAYERS) : count
}

export function emptySpots(sessionType: string, players: number): number {
  return billedPlayers(sessionType, players) - Math.max(0, Math.round(Number(players) || 0))
}

export function fieldCountMinimum(fieldCount: number): number {
  return FIELD_COUNT_MINIMUMS[Math.min(Math.max(0, fieldCount), FIELD_COUNT_MINIMUMS.length - 1)]
}

// How many fields a private group gets, by headcount (empty spots included).
export function fieldCountForPlayers(players: number): number {
  const count = Math.max(PRIVATE_MIN_PLAYERS, Math.round(Number(players) || 0))
  if (count >= FIELD_COUNT_MINIMUMS[3]) return 3
  if (count >= FIELD_COUNT_MINIMUMS[2]) return 2
  return 1
}
