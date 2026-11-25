import React from 'react'

import { BRANCHES } from '../../utils/branches'
import { isAmmo, modelOf } from '../../utils/inventoryModels'

type StockItem = { model?: string; name?: string; id?: string; status?: string; price?: number; category?: string; source?: string; stockGrams?: number; locationId?: string }

// Gear in one table, laid out like the weapons table: a row per model, a column per field (plus
// pieces not assigned to a field, when there are any) with "available / total", the total across
// fields, and the price. Follows the Category and Branch filters. BB ammo is one stock shared by
// every field, so its row shows the grams across the field columns.
export function ModelSummaryStrip({ items, category = 'all', branch = 'all' }: { items: StockItem[]; category?: string; branch?: string }) {
  const known = new Set<string>(BRANCHES.map((entry) => entry.id))
  const fieldOf = (item: StockItem) => (known.has(String(item.locationId || '')) ? String(item.locationId) : 'none')
  const own = items.filter((item) => item.source !== 'player' && (category === 'all' || item.category === category))
  if (own.length === 0) return null
  const hasUnassigned = own.some((item) => !isAmmo(item) && fieldOf(item) === 'none')
  const allColumns = [
    ...BRANCHES.map((entry) => ({ id: entry.id as string, label: entry.label as string })),
    ...(hasUnassigned ? [{ id: 'none', label: 'Unassigned' }] : []),
  ]
  // One field picked: just its column. All branches: every field plus the total.
  const columns = branch === 'all' ? allColumns : allColumns.filter((column) => column.id === branch)
  const showTotal = branch === 'all'
  const groups = new Map<string, StockItem[]>()
  for (const item of own) {
    const model = modelOf(item)
    groups.set(model, [...(groups.get(model) || []), item])
  }
  const rows = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
  const cell = (pieces: StockItem[]) => {
    const total = pieces.length
    if (total === 0) return <span className="text-muted">—</span>
    const available = pieces.filter((item) => String(item.status || 'available') === 'available').length
    const tone = available === 0 ? 'text-danger' : available < total ? 'text-warning' : 'text-success'
    return <span><span className={`font-semibold ${tone}`}>{available}</span><span className="text-muted"> / {total}</span></span>
  }
  const categoryLabel = (value?: string) => {
    const text = String(value || '')
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : ''
  }
  const stockSpan = Math.max(1, columns.length + (showTotal ? 1 : 0))

  return (
    <div className="mt-4 overflow-x-auto rounded-2xl border border-white/5">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="bg-white/5 text-left text-[11px] uppercase tracking-widest text-muted">
          <tr>
            <th className="px-3 py-2 font-semibold">Model</th>
            {columns.map((column) => <th key={column.id} className="px-3 py-2 text-right font-semibold">{column.label}</th>)}
            {showTotal ? <th className="px-3 py-2 text-right font-semibold">All fields</th> : null}
            <th className="px-3 py-2 text-right font-semibold">Price</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map(([model, pieces]) => {
            const ammo = isAmmo(pieces[0])
            const grams = pieces.reduce((sum, item) => sum + Math.max(0, Number(item.stockGrams) || 0), 0)
            return (
              <tr key={model}>
                <td className="px-3 py-2">
                  <div className="font-semibold">{model}</div>
                  <div className="text-[11px] text-muted">{categoryLabel(pieces[0].category)}</div>
                </td>
                {ammo ? (
                  <td colSpan={stockSpan} className="px-3 py-2 text-right">
                    <span className="font-semibold">{grams.toLocaleString()} g</span>
                    <span className="text-muted"> in stock · shared by all fields</span>
                  </td>
                ) : (
                  <>
                    {columns.map((column) => <td key={column.id} className="px-3 py-2 text-right">{cell(pieces.filter((item) => fieldOf(item) === column.id))}</td>)}
                    {showTotal ? <td className="px-3 py-2 text-right">{cell(pieces)}</td> : null}
                  </>
                )}
                <td className="whitespace-nowrap px-3 py-2 text-right text-muted">
                  ₱{Number(pieces[0].price || 0).toLocaleString()} {ammo ? 'per refill' : 'each'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="border-t border-white/5 px-3 py-2 text-[11px] text-muted">Available / total pieces at each field.</div>
    </div>
  )
}
