import React from 'react'

import type { ModelSummary } from '../../utils/inventoryModels'

// Per-model piece counts above an inventory list, e.g. "Mask · 18 of 22 available".
export function ModelSummaryStrip({ models, unit }: { models: ModelSummary[]; unit: string }) {
  if (models.length === 0) return null
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {models.map((group) => (
        <div key={group.model} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
          <div className="text-sm font-semibold">{group.model}</div>
          <div className="text-[11px] text-muted">
            {group.available} of {group.total} {unit}{group.total === 1 ? '' : 's'} available · ₱{group.price} each
          </div>
        </div>
      ))}
    </div>
  )
}
