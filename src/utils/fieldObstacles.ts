import { useCallback, useEffect, useState } from 'react'
import { apiGet } from './apiClient'
import type { ObstacleType } from '../components/reservations/FieldLayoutDesigner'

// How many of each obstacle every field has (GET /api/field-obstacles, set by an admin; see
// server/utils/fieldObstacles.js). The layout designer only lets players place what's there.
export const OBSTACLE_TYPES = ['wall', 'bunker', 'barrel', 'tires', 'tower', 'container'] as const
export type PropType = typeof OBSTACLE_TYPES[number]
export type FieldObstacleCounts = Record<PropType, number>
// Custom layout fee tiers (Simple / Standard / Complex): the last has no piece limit.
export type LayoutFeeTier = { label: string; maxPieces: number | null; price: number }
export const DEFAULT_LAYOUT_FEES: LayoutFeeTier[] = [
  { label: 'Simple', maxPieces: 10, price: 300 },
  { label: 'Standard', maxPieces: 25, price: 600 },
  { label: 'Complex', maxPieces: null, price: 1000 },
]
export type FieldObstacles = {
  fields: Array<{ id: string; name: string; locationId: string; counts: FieldObstacleCounts }>
  markers: Partial<Record<ObstacleType, number>>
  layoutFees?: LayoutFeeTier[]
}

// Props placed (game markers don't count): what the layout fee is based on.
export function countLayoutPieces(items: Array<{ type: string }>) {
  return items.filter((item) => (OBSTACLE_TYPES as readonly string[]).includes(item.type)).length
}

// The tier a layout falls in, with what's next: { label, price, pieces, next? }. Null with no pieces.
// Same tiers as the server (server/utils/fieldObstacles.js), which sets the actual price.
export function layoutFeeFor(pieces: number, tiers: LayoutFeeTier[] = DEFAULT_LAYOUT_FEES) {
  if (!(pieces > 0)) return null
  const index = tiers.findIndex((tier) => tier.maxPieces == null || pieces <= tier.maxPieces)
  const tier = tiers[index < 0 ? tiers.length - 1 : index]
  const next = index >= 0 && index < tiers.length - 1 ? tiers[index + 1] : null
  return { ...tier, pieces, next, untilNext: next && tier.maxPieces != null ? tier.maxPieces - pieces + 1 : null }
}

export function useFieldObstacles() {
  const [data, setData] = useState<FieldObstacles | null>(null)
  const reload = useCallback(async () => {
    const res = await apiGet<{ ok: boolean; data: FieldObstacles }>('/api/field-obstacles').catch(() => null)
    setData(res?.data || null)
  }, [])
  useEffect(() => { void reload() }, [reload])
  return { data, reload }
}

// What the booked field(s) have in all: booking two fields gives the pieces of both. Markers keep
// their caps. Undefined (no limits) until the counts are known.
export function limitsForFields(data: FieldObstacles | null, fieldIds: string[]): Partial<Record<ObstacleType, number>> | undefined {
  if (!data) return undefined
  const fields = data.fields.filter((field) => fieldIds.includes(field.id))
  if (!fields.length) return undefined
  const limits: Partial<Record<ObstacleType, number>> = { ...data.markers }
  for (const type of OBSTACLE_TYPES) limits[type] = fields.reduce((sum, field) => sum + (Number(field.counts[type]) || 0), 0)
  return limits
}
