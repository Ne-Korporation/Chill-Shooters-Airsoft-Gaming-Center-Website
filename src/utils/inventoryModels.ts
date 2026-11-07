// Rental gear is one record per physical piece ("Mask #3"), grouped by its model ("Mask").
const UNIT_SUFFIX = /\s+#\d+$/

export function modelOf(item: { model?: string; name?: string; id?: string }) {
  return String(item.model || String(item.name || '').replace(UNIT_SUFFIX, '')).trim() || String(item.id || '')
}

// Ammo is tracked in grams (stockGrams) and priced per refill, not as pieces.
export function isAmmo(item: { category?: string }) {
  return String(item.category || '').toLowerCase() === 'ammo'
}

// Below this many grams an ammo record is low and staff are told to restock (the server sends
// the notice; see server/utils/ammoStock.js). Set per ammo record, 2,000 g by default.
export const DEFAULT_LOW_STOCK_GRAMS = 2000
export function ammoLowLevel(item: { lowStockGrams?: number }) {
  const own = Number(item.lowStockGrams)
  return Number.isFinite(own) && own > 0 ? own : DEFAULT_LOW_STOCK_GRAMS
}
export function isLowOnAmmo(item: { category?: string; stockGrams?: number; lowStockGrams?: number }) {
  return isAmmo(item) && Math.max(0, Number(item.stockGrams) || 0) < ammoLowLevel(item)
}

export type ModelSummary = { model: string; total: number; available: number; price: number; category: string; grams: number }

// Count of pieces per model and how many are available, for rental (non player-owned) gear.
export function summarizeModels(items: Array<{ model?: string; name?: string; id?: string; status?: string; price?: number; category?: string; source?: string; stockGrams?: number }>) {
  const groups = new Map<string, ModelSummary>()
  for (const item of items) {
    if (item.source === 'player') continue
    const model = modelOf(item)
    const group = groups.get(model) || { model, total: 0, available: 0, price: Number(item.price || 0), category: String(item.category || ''), grams: 0 }
    group.total += 1
    group.grams += Math.max(0, Number(item.stockGrams) || 0)
    if (String(item.status || 'available') === 'available') group.available += 1
    groups.set(model, group)
  }
  return [...groups.values()].sort((a, b) => a.model.localeCompare(b.model))
}

// One entry per model (its first piece), for pickers that choose a kind of item rather than a piece.
export function oneItemPerModel<T extends { model?: string; name?: string; id?: string; source?: string }>(items: T[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (item.source === 'player') return false
    const model = modelOf(item)
    if (seen.has(model)) return false
    seen.add(model)
    return true
  })
}

// Equipment needing attention: pieces under maintenance, plus models down to one or no available piece.
export function equipmentAlerts(items: Array<{ model?: string; name?: string; id?: string; status?: string; price?: number; category?: string; source?: string }>) {
  const rental = items.filter((item) => item.source !== 'player')
  const maintenance = rental.filter((item) => String(item.status || '').trim().toLowerCase() === 'maintenance')
  const lowModels = summarizeModels(rental).filter((group) => !isAmmo(group) && group.available <= 1)
  return { maintenance, lowModels, count: maintenance.length + lowModels.length }
}
