export type PackageDiscountTarget = 'package_total' | 'weapons' | 'equipment' | 'entrance'
export type PackageDiscountMode = 'percent' | 'amount'

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
      mode: pkg.discountMode === 'amount' ? 'amount' : 'percent',
      value: Math.max(0, Number(pkg.discountValue) || 0),
      targets,
    }
  }

  return {
    mode: 'percent',
    value: clampPct(Number(pkg.discountPct ?? 0)),
    targets: Number(pkg.discountPct ?? 0) > 0 ? ['package_total'] : targets,
  }
}

export function calculatePackagePricing({
  pkg,
  players,
  sessionMultiplier,
  weapons,
  equipment,
  entranceFeePerPlayer,
}: {
  pkg: PackageLike
  players: number
  sessionMultiplier: number
  weapons: PricedItem[]
  equipment: PricedItem[]
  entranceFeePerPlayer: number
}) {
  const weaponUnitTotal = (pkg.weaponIds || [])
    .map((weaponId) => weapons.find((weapon) => weapon.id === weaponId))
    .filter(Boolean)
    .reduce((sum, weapon) => sum + Number(weapon?.price || 0), 0)

  const equipmentUnitTotal = (pkg.equipmentIds || [])
    .map((equipmentId) => equipment.find((item) => item.id === equipmentId))
    .filter(Boolean)
    .reduce((sum, item) => sum + Number(item?.price || 0), 0)

  const basePriceTotal = Number(pkg.basePrice || 0) * players * sessionMultiplier
  const weaponsTotal = weaponUnitTotal * players * sessionMultiplier
  const equipmentTotal = equipmentUnitTotal * players * sessionMultiplier
  const entranceFeeTotal = entranceFeePerPlayer * players * sessionMultiplier
  const preDiscountTotal = Math.round(basePriceTotal + weaponsTotal + equipmentTotal + entranceFeeTotal)

  const discountRule = resolvePackageDiscountConfig(pkg)
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
    discountLabel: discountRule.mode === 'percent'
      ? `${clampPct(discountRule.value)}% off ${formatDiscountTargetLabel(discountRule.targets)}`
      : `₱${Math.round(discountRule.value).toLocaleString()} off ${formatDiscountTargetLabel(discountRule.targets)}`,
    discountSummary: `${discountRule.mode === 'percent' ? `${clampPct(discountRule.value)}%` : `₱${Math.round(discountRule.value).toLocaleString()}`} off ${formatDiscountTargetLabel(discountRule.targets)}`,
    isLegacyPct,
  }
}
