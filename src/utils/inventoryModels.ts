// Rental gear is one record per physical piece ("Mask #3"), grouped by its model ("Mask").
const UNIT_SUFFIX = /\s+#\d+$/

export function modelOf(item: { model?: string; name?: string; id?: string }) {
  return String(item.model || String(item.name || '').replace(UNIT_SUFFIX, '')).trim() || String(item.id || '')
}

export type ModelSummary = { model: string; total: number; available: number; price: number; category: string }

// Count of pieces per model and how many are available, for rental (non player-owned) gear.
export function summarizeModels(items: Array<{ model?: string; name?: string; id?: string; status?: string; price?: number; category?: string; source?: string }>) {
  const groups = new Map<string, ModelSummary>()
  for (const item of items) {
    if (item.source === 'player') continue
    const model = modelOf(item)
    const group = groups.get(model) || { model, total: 0, available: 0, price: Number(item.price || 0), category: String(item.category || '') }
    group.total += 1
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
  const lowModels = summarizeModels(rental).filter((group) => group.available <= 1)
  return { maintenance, lowModels, count: maintenance.length + lowModels.length }
}
