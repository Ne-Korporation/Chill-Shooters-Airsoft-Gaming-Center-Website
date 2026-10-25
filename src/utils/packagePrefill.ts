// The package chosen in the Recommendation Engine, carried into the reservation flow. Kept in
// sessionStorage as well as router state so it survives a refresh or a detour through login.
export type PackageRecommendationPrefill = {
  fromPackageRecommendation?: boolean
  players?: number
  sessionType?: 'public' | 'private'
  selectedPackageId?: string
  selectedPackageName?: string
  weaponsWanted?: number
  ownWeapons?: number
}

const PACKAGE_PREFILL_KEY = 'aim-book-play.package-prefill'

export function savePackagePrefill(prefill: PackageRecommendationPrefill) {
  try {
    sessionStorage.setItem(PACKAGE_PREFILL_KEY, JSON.stringify(prefill))
  } catch {
    // ignore storage errors; router state still carries it
  }
}

export function loadPackagePrefill(routerState: unknown): PackageRecommendationPrefill | undefined {
  const fromState = routerState as PackageRecommendationPrefill | null
  if (fromState?.fromPackageRecommendation) return fromState
  try {
    const raw = sessionStorage.getItem(PACKAGE_PREFILL_KEY)
    const parsed = raw ? (JSON.parse(raw) as PackageRecommendationPrefill) : null
    return parsed?.fromPackageRecommendation ? parsed : undefined
  } catch {
    return undefined
  }
}

export function clearPackagePrefill() {
  try {
    sessionStorage.removeItem(PACKAGE_PREFILL_KEY)
  } catch {
    // ignore
  }
}
