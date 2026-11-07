import React from 'react'

import { isAmmo, type ModelSummary } from '../../utils/inventoryModels'

// Per-model piece counts above an inventory list, as a compact table: model, how many are
// available out of the total, and the price.
export function ModelSummaryStrip({ models, unit }: { models: ModelSummary[]; unit: string }) {
  if (models.length === 0) return null
  const sorted = [...models].sort((a, b) => a.model.localeCompare(b.model, undefined, { numeric: true, sensitivity: 'base' }))
  return (
    <div className="mt-4 overflow-x-auto rounded-2xl border border-white/5">
      <table className="w-full min-w-[420px] text-sm">
        <thead className="bg-white/5 text-left text-[11px] uppercase tracking-widest text-muted">
          <tr>
            <th className="px-3 py-2 font-semibold">Model</th>
            <th className="px-3 py-2 text-right font-semibold">Available</th>
            <th className="px-3 py-2 text-right font-semibold">Price</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {sorted.map((group) => {
            const ammo = isAmmo(group)
            const tone = ammo
              ? 'text-text'
              : group.available === 0
                ? 'text-danger'
                : group.available < group.total
                  ? 'text-warning'
                  : 'text-success'
            return (
              <tr key={group.model}>
                <td className="px-3 py-2 font-semibold">{group.model}</td>
                <td className={`px-3 py-2 text-right font-semibold ${tone}`}>
                  {ammo
                    ? `${group.grams.toLocaleString()} g in stock`
                    : <>{group.available} <span className="font-normal text-muted">of {group.total} {unit}{group.total === 1 ? '' : 's'}</span></>}
                </td>
                <td className="px-3 py-2 text-right text-muted">
                  ₱{group.price.toLocaleString()} {ammo ? 'per refill' : 'each'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
