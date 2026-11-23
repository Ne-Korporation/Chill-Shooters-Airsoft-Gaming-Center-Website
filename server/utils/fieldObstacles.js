// How many of each obstacle every field physically has, so a player designing a field layout can
// only place what's really there. Each field differs (the open Upper Ground has towers and
// containers, the Forest has none). An admin can change the counts; until then the defaults below
// apply. Game markers (spawns, flags, bomb sites) aren't props, so they have fixed caps.

export const FIELD_OBSTACLES_ID = 'field_obstacles'

// Physical props a field owns.
export const OBSTACLE_TYPES = ['wall', 'bunker', 'barrel', 'tires', 'tower', 'container']
// Markers drawn on the layout, the same for every field.
export const MARKER_LIMITS = { spawnA: 1, spawnB: 1, flag: 2, bomb: 2 }

// Defaults by field kind (field ids end in field-1 / field-2 / field-3 at every branch).
const DEFAULTS_BY_KIND = {
  'field-1': { wall: 10, bunker: 4, barrel: 8, tires: 6, tower: 2, container: 2 }, // Upper Ground
  'field-2': { wall: 8, bunker: 6, barrel: 6, tires: 8, tower: 1, container: 3 }, // Lower Ground
  'field-3': { wall: 6, bunker: 4, barrel: 4, tires: 6, tower: 2, container: 0 }, // Forest
}
const FALLBACK = { wall: 8, bunker: 4, barrel: 6, tires: 6, tower: 1, container: 1 }

export function defaultObstaclesFor(fieldId) {
  const kind = Object.keys(DEFAULTS_BY_KIND).find((suffix) => String(fieldId).endsWith(suffix))
  return { ...(kind ? DEFAULTS_BY_KIND[kind] : FALLBACK) }
}

// Returns { counts } (whole numbers 0–99 for each obstacle type) or { error }.
export function validateObstacleCounts(input) {
  const counts = {}
  for (const type of OBSTACLE_TYPES) {
    const value = Number(input?.[type])
    if (!Number.isInteger(value) || value < 0 || value > 99) return { error: `Enter how many of each obstacle (0–99) the field has.` }
    counts[type] = value
  }
  return { counts }
}

// { [fieldId]: { wall, bunker, … } } for the given fields: saved counts, else the defaults.
export async function getFieldObstacles(db, fieldIds) {
  const saved = (await db.collection('settings').findOne({ _id: FIELD_OBSTACLES_ID }))?.fields || {}
  const result = {}
  for (const id of fieldIds) result[id] = { ...defaultObstaclesFor(id), ...(saved[id] || {}) }
  return result
}

// ---- Custom layout fee -------------------------------------------------------------------------
// A private game can have its field set up to a custom layout. The fee follows how much setup work
// it is: the number of props placed (game markers don't count), in tiers. The standard field is
// free. An admin can change the tiers; until then the defaults below apply.
export const DEFAULT_LAYOUT_FEES = [
  { label: 'Simple', maxPieces: 10, price: 300 },
  { label: 'Standard', maxPieces: 25, price: 600 },
  { label: 'Complex', maxPieces: null, price: 1000 },
]
const ALL_TYPES = [...OBSTACLE_TYPES, ...Object.keys(MARKER_LIMITS)]

// The layout as saved on a booking: known pieces only, positions as numbers, at most 300.
export function normalizeLayoutItems(items) {
  if (!Array.isArray(items)) return []
  return items
    .filter((item) => item && ALL_TYPES.includes(String(item.type)))
    .slice(0, 300)
    .map((item) => ({
      id: String(item.id || '').slice(0, 20),
      type: String(item.type),
      x: Math.round(Number(item.x) || 0),
      y: Math.round(Number(item.y) || 0),
      rot: Math.round(Number(item.rot) || 0) % 360,
    }))
}

// Props placed (markers excluded): what the fee counts.
export function countLayoutPieces(items) {
  return normalizeLayoutItems(items).filter((item) => OBSTACLE_TYPES.includes(item.type)).length
}

// The tier a layout falls in: { label, maxPieces, price, pieces }, or null for no custom layout.
export function layoutFeeFor(pieces, tiers = DEFAULT_LAYOUT_FEES) {
  if (!(pieces > 0)) return null
  const tier = tiers.find((t) => t.maxPieces == null || pieces <= t.maxPieces) || tiers[tiers.length - 1]
  return tier ? { ...tier, pieces } : null
}

// Returns { tiers } or { error }: three tiers with growing piece limits (the last has none) and prices.
export function validateLayoutFees(input) {
  if (!Array.isArray(input) || input.length !== DEFAULT_LAYOUT_FEES.length) return { error: 'Set all three layout tiers.' }
  const tiers = []
  let previousMax = 0
  for (const [index, raw] of input.entries()) {
    const last = index === input.length - 1
    const price = Number(raw?.price)
    const maxPieces = last ? null : Number(raw?.maxPieces)
    if (!Number.isInteger(price) || price < 0 || price > 100000) return { error: 'Each layout price must be a whole peso amount (0–100,000).' }
    if (!last && (!Number.isInteger(maxPieces) || maxPieces <= previousMax || maxPieces > 300)) {
      return { error: 'Each tier must allow more pieces than the one before it.' }
    }
    tiers.push({ label: DEFAULT_LAYOUT_FEES[index].label, maxPieces, price })
    if (!last) previousMax = maxPieces
  }
  return { tiers }
}

export async function getLayoutFees(db) {
  const saved = (await db.collection('settings').findOne({ _id: FIELD_OBSTACLES_ID }))?.layoutFees
  return Array.isArray(saved) && saved.length === DEFAULT_LAYOUT_FEES.length ? saved : DEFAULT_LAYOUT_FEES
}

// Throws (statusCode 400) when the layout uses more of a piece than the booked fields have.
export async function assertLayoutFitsFields(db, items, fieldIds) {
  const placed = normalizeLayoutItems(items)
  if (!placed.length) return
  const counts = await getFieldObstacles(db, fieldIds)
  const fail = (message) => Object.assign(new Error(message), { statusCode: 400 })
  for (const type of OBSTACLE_TYPES) {
    const have = Object.values(counts).reduce((sum, field) => sum + (Number(field[type]) || 0), 0)
    const used = placed.filter((item) => item.type === type).length
    if (used > have) throw fail(`The layout uses ${used} ${type === 'tires' ? 'tire stacks' : `${type}s`}, but the field has ${have}. Remove some in the layout designer.`)
  }
  for (const [type, cap] of Object.entries(MARKER_LIMITS)) {
    if (placed.filter((item) => item.type === type).length > cap) throw fail(`A layout can have at most ${cap} of each game marker.`)
  }
}
