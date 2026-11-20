// The three branches. Each keeps its own rental stock: a piece's `locationId` says which branch
// rents it out. A piece with no branch yet can be booked at any branch until staff assign one.
export const BRANCHES = [
  { id: 'salawag', label: 'Salawag' },
  { id: 'langkaan', label: 'Langkaan' },
  { id: 'binan', label: 'Biñan' },
] as const

export type BranchId = (typeof BRANCHES)[number]['id']

export function branchLabel(locationId: unknown): string {
  return BRANCHES.find((branch) => branch.id === String(locationId || ''))?.label || 'Unassigned'
}

// True when a piece can be rented out at the given branch.
export function pieceAtBranch(piece: { locationId?: string | null }, locationId: string): boolean {
  const branch = String(piece.locationId || '')
  return !branch || !locationId || branch === locationId
}
