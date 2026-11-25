import { apiDelete, apiGet, apiPost, apiPut } from './apiClient'

// A player's saved team roster (see server/routes/savedTeams.js). Whether each member can be put
// on a booking right now is worked out by the server every time the teams are read.
export type SavedTeamMember = {
  id: string
  name: string
  email: string
  idVerified: boolean
  waiverApproved: boolean
  // Why they can't be booked right now ('Waiver not approved', …), or '' when they can.
  blockedReason: string
}

export type SavedTeam = {
  id: string
  name: string
  members: SavedTeamMember[]
  createdAtISO: string
  updatedAtISO: string
  lastUsedAtISO?: string
}

// A player found by name or email, as the teammate lookup returns them.
export type FoundPlayer = { id: string; name: string; email: string; waiverApproved: boolean }

export const MAX_SAVED_TEAMS = 20
export const MAX_TEAM_MEMBERS = 49

export async function listSavedTeams() {
  const res = await apiGet<{ ok: boolean; data: SavedTeam[] }>('/api/my-teams')
  return Array.isArray(res?.data) ? res.data : []
}

export async function createSavedTeam(name: string, memberIds: string[]) {
  const res = await apiPost<{ ok: boolean; data: SavedTeam }>('/api/my-teams', { name, memberIds })
  return res.data
}

export async function updateSavedTeam(id: string, changes: { name?: string; memberIds?: string[]; used?: boolean }) {
  const res = await apiPut<{ ok: boolean; data: SavedTeam }>(`/api/my-teams/${encodeURIComponent(id)}`, changes)
  return res.data
}

export async function deleteSavedTeam(id: string) {
  await apiDelete(`/api/my-teams/${encodeURIComponent(id)}`)
}

// The same lookup the booking form uses: verified players only, by full email or 3+ letters of
// the name (up to 5 matches, emails partly hidden).
export async function findPlayers(query: string) {
  const res = await apiGet<{ ok: boolean; data: FoundPlayer; matches?: FoundPlayer[] }>(`/api/team-directory/lookup?q=${encodeURIComponent(query)}`)
  return Array.isArray(res.matches) && res.matches.length ? res.matches : [res.data]
}

export const canBook = (member: SavedTeamMember) => !member.blockedReason
