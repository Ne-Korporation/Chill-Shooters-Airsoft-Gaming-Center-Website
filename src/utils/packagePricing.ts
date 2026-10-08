export type PackageDiscountTarget = 'package_total' | 'weapons' | 'equipment' | 'entrance'
export type PackageDiscountMode = 'percent' | 'amount' | 'settled'

export type PackageDiscountConfig = {
  mode: PackageDiscountMode
  value: number
  targets: PackageDiscountTarget[]
}

export type PackageLike = {
  basePrice: number
  discountPct?: number
  discountMode?: PackageDiscountMode
  discountValue?: number
  discountTargets?: PackageDiscountTarget[]
  weaponIds?: string[]
  equipmentIds?: string[]
  // Number of players the package is priced for (0 / undefined = not fixed to a headcount)
  players?: number
  // Fixed total (before discount) for `players` players (0 / undefined = computed pricing)
  settledAmount?: number
  // Number of weapons the package gives (0 / undefined = count of weaponIds)
  weaponCount?: number
}

export type PricedItem = {
  id?: string
  price?: number
}

export type PackagePricingBreakdown = {
  basePrice: number
  weaponsTotal: number
  equipmentTotal: number
  entranceFeeTotal: number
  preDiscountTotal: number
  discountAmount: number
  total: number
  perPlayer: number
  discountMode: PackageDiscountMode
  discountValue: number
  discountTargets: PackageDiscountTarget[]
  discountLabel: string
  discountSummary: string
  isLegacyPct: boolean
}

const DEFAULT_DISCOUNT_TARGETS: PackageDiscountTarget[] = ['package_total']

export function clampPct(n: number) {
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n))
}

export function normalizeDiscountTargets(raw: unknown): PackageDiscountTarget[] {
  const allowed: PackageDiscountTarget[] = ['package_total', 'weapons', 'equipment', 'entrance']
  const next = Array.isArray(raw) ? raw.filter((item): item is PackageDiscountTarget => allowed.includes(item as PackageDiscountTarget)) : []
  const unique = Array.from(new Set(next))
  if (unique.includes('package_total')) return ['package_total']
  if (unique.includes('weapons') && unique.includes('equipment') && unique.includes('entrance')) return ['package_total']
  return unique.length > 0 ? unique : DEFAULT_DISCOUNT_TARGETS
}

export function formatDiscountTargetLabel(targets: PackageDiscountTarget[]): string {
  const sorted = Array.from(new Set(targets))
  if (sorted.length === 0) return 'package total'
  const labels = sorted.map((target) => {
    if (target === 'package_total') return 'package total'
    if (target === 'weapons') return 'weapons'
    if (target === 'equipment') return 'equipment'
    return 'entrance fee'
  })
  if (labels.length === 1) return labels[0]
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`
}

export function resolvePackageDiscountConfig(pkg: PackageLike): PackageDiscountConfig {
  const targets = normalizeDiscountTargets(pkg.discountTargets)
  const hasStructuredRule = typeof pkg.discountMode === 'string' && typeof pkg.discountValue === 'number'
  if (hasStructuredRule) {
    return {
      mode: pkg.discountMode === 'amount' ? 'amount' : pkg.discountMode === 'settled' ? 'settled' : 'percent',
      value: Math.max(0, Number(pkg.discountValue) || 0),
      targets: pkg.discountMode === 'settled' ? ['package_total'] : targets,
    }
  }

  return {
    mode: 'percent',
    value: clampPct(Number(pkg.discountPct ?? 0)),
    targets: Number(pkg.discountPct ?? 0) > 0 ? ['package_total'] : targets,
  }
}

/** Number of weapons a package offers: the typed weaponCount, else the count of picked weapons. */
export function getPackageWeaponCount(pkg: PackageLike): number {
  const typed = Math.round(Number(pkg.weaponCount ?? 0))
  if (Number.isFinite(typed) && typed > 0) return typed
  return (pkg.weaponIds || []).length
}

/** True when the package has a settled (fixed) amount that is set for a number of players. */
export function hasSettledAmount(pkg: PackageLike): boolean {
  return Number(pkg.settledAmount ?? 0) > 0
}

/**
 * Whether the package's settled price is valid for this headcount.
 * A package set for N players only applies to exactly N players.
 */
export function settledAmountApplies(pkg: PackageLike, players: number): boolean {
  if (!hasSettledAmount(pkg)) return false
  const fixedPlayers = Math.round(Number(pkg.players ?? 0))
  return fixedPlayers > 0 ? fixedPlayers === players : true
}

function buildDiscountTexts(discountRule: PackageDiscountConfig) {
  if (discountRule.mode === 'settled') {
    return {
      label: `Settled amount ₱${Math.round(discountRule.value).toLocaleString()}`,
      summary: 'Settled amount',
    }
  }

  const valueText = discountRule.mode === 'percent'
    ? `${clampPct(discountRule.value)}%`
    : `₱${Math.round(discountRule.value).toLocaleString()}`
  const label = `${valueText} off ${formatDiscountTargetLabel(discountRule.targets)}`
  return { label, summary: label }
}

export function calculatePackagePricing({
  pkg,
  players,
  ownWeapons = 0,
  sessionMultiplier,
  weapons,
  equipment,
  entranceFeePerPlayer,
}: {
  pkg: PackageLike
  players: number
  ownWeapons?: number
  sessionMultiplier: number
  weapons: PricedItem[]
  equipment: PricedItem[]
  entranceFeePerPlayer: number
}) {
  const discountRule = resolvePackageDiscountConfig(pkg)

  // ---------------------------------------------------------------------
  // Settled amount: fixed price for the package's set number of players.
  // Discount (percent or fixed amount) comes off the settled amount, and the
  // session multiplier is not applied so the price stays fixed.
  // ---------------------------------------------------------------------
  if (settledAmountApplies(pkg, players)) {
    const settled = discountRule.mode === 'settled'
      ? Math.max(0, Math.round(discountRule.value))
      : Math.max(0, Math.round(Number(pkg.settledAmount || 0)))
    const isSettledPrice = discountRule.mode === 'settled'
    const rawDiscount = discountRule.mode === 'amount'
      ? Math.round(discountRule.value)
      : Math.round(settled * clampPct(discountRule.value) / 100)
    const settledDiscount = isSettledPrice ? 0 : Math.min(Math.max(0, rawDiscount), settled)
    const settledTotal = Math.max(0, settled - settledDiscount)
    const texts = buildDiscountTexts({ ...discountRule, targets: ['package_total'] })

    return {
      basePriceTotal: settled,
      weaponsTotal: 0,
      equipmentTotal: 0,
      entranceFeeTotal: 0,
      preDiscountTotal: settled,
      discountAmount: settledDiscount,
      total: settledTotal,
      perPlayer: Math.round(settledTotal / Math.max(1, players)),
      discountMode: discountRule.mode,
      discountValue: discountRule.value,
      discountTargets: ['package_total'] as PackageDiscountTarget[],
      discountLabel: texts.label,
      discountSummary: texts.summary,
      isLegacyPct: false,
      isSettled: true,
      settledAmount: settled,
    }
  }

  // ---------------------------------------------------------------------
  // Computed pricing (per-player base + gear + entrance)
  // ---------------------------------------------------------------------
  const selectedWeaponPrices = (pkg.weaponIds || [])
    .map((weaponId) => weapons.find((weapon) => weapon.id === weaponId))
    .filter(Boolean)
    .map((weapon) => Number(weapon?.price || 0))

  const packageWeaponCount = getPackageWeaponCount(pkg)
  const weaponUnitTotal = selectedWeaponPrices.reduce((sum, price) => sum + price, 0)
  const averageWeaponPrice = selectedWeaponPrices.length > 0 ? weaponUnitTotal / selectedWeaponPrices.length : 0
  const rentedWeaponCount = Math.max(0, packageWeaponCount * players - Math.max(0, Math.round(ownWeapons)))

  const equipmentUnitTotal = (pkg.equipmentIds || [])
    .map((equipmentId) => equipment.find((item) => item.id === equipmentId))
    .filter(Boolean)
    .reduce((sum, item) => sum + Number(item?.price || 0), 0)

  const basePriceTotal = Number(pkg.basePrice || 0) * players * sessionMultiplier
  const weaponsTotal = averageWeaponPrice * rentedWeaponCount * sessionMultiplier
  const equipmentTotal = equipmentUnitTotal * players * sessionMultiplier
  const entranceFeeTotal = entranceFeePerPlayer * players * sessionMultiplier
  const preDiscountTotal = Math.round(basePriceTotal + weaponsTotal + equipmentTotal + entranceFeeTotal)

  const componentTotals: Record<PackageDiscountTarget, number> = {
    package_total: preDiscountTotal,
    weapons: Math.round(weaponsTotal),
    equipment: Math.round(equipmentTotal),
    entrance: Math.round(entranceFeeTotal),
  }

  const targetedSubtotal = discountRule.targets.reduce((sum, target) => sum + (componentTotals[target] || 0), 0)
  const discountAmount = discountRule.mode === 'amount'
    ? Math.min(Math.round(discountRule.value), targetedSubtotal)
    : Math.round(targetedSubtotal * clampPct(discountRule.value) / 100)

  const total = Math.max(0, preDiscountTotal - discountAmount)
  const perPlayer = Math.round(total / Math.max(1, players))
  const isLegacyPct = Number(pkg.discountPct ?? 0) > 0 && !pkg.discountMode && !pkg.discountValue && (!pkg.discountTargets || pkg.discountTargets.length === 0)
  const texts = buildDiscountTexts(discountRule)

  return {
    basePriceTotal: Math.round(basePriceTotal),
    weaponsTotal: Math.round(weaponsTotal),
    equipmentTotal: Math.round(equipmentTotal),
    entranceFeeTotal: Math.round(entranceFeeTotal),
    preDiscountTotal,
    discountAmount,
    total,
    perPlayer,
    discountMode: discountRule.mode,
    discountValue: discountRule.value,
    discountTargets: discountRule.targets,
    discountLabel: texts.label,
    discountSummary: texts.summary,
    isLegacyPct,
    isSettled: false,
    settledAmount: 0,
  }
}