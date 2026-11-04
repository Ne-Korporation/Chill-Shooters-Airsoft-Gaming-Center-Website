import React from 'react'
import { FiMinus, FiPlus } from 'react-icons/fi'
import type { PickerGroup } from './PiecePicker'

// Ids of the pieces to rent when the player only says how many of each model they want:
// pieces already chosen stay, then free pieces fill the rest in unit order.
export function assignPieces(groups: PickerGroup[], selected: string[], model: string, count: number) {
  const group = groups.find((g) => g.model === model)
  if (!group) return selected
  const groupIds = new Set(group.pieces.map((piece) => piece.id))
  const others = selected.filter((id) => !groupIds.has(id))
  const kept = group.pieces.filter((piece) => piece.free && selected.includes(piece.id)).map((piece) => piece.id)
  const extra = group.pieces.filter((piece) => piece.free && !kept.includes(piece.id)).map((piece) => piece.id)
  const target = Math.max(0, count)
  return [...others, ...[...kept, ...extra].slice(0, target)]
}

// One row per model ("M4 Rifle · ₱500 each · 12 free") with a − / + counter. The exact pieces are
// assigned automatically from what's free for the slot.
export function ModelQuantityPicker({
  groups,
  selected,
  onChange,
  emptyText = 'Nothing in inventory.',
}: {
  groups: PickerGroup[]
  selected: string[]
  onChange: (ids: string[]) => void
  emptyText?: string
}) {
  if (groups.length === 0) return <div className="mt-4 text-sm text-muted">{emptyText}</div>

  return (
    <div className="mt-4 grid gap-2 md:grid-cols-2">
      {groups.map((group) => {
        const count = group.pieces.filter((piece) => selected.includes(piece.id)).length
        const free = group.pieces.filter((piece) => piece.free).length
        const setCount = (next: number) => onChange(assignPieces(groups, selected, group.model, Math.min(free, next)))
        return (
          <div
            key={group.model}
            className={[
              'flex items-center justify-between gap-3 rounded-2xl border p-3 transition',
              count > 0 ? 'border-accent/40 bg-accent/10' : 'border-white/10 bg-white/5',
              free === 0 ? 'opacity-60' : '',
            ].join(' ')}
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-bold">{group.model}</div>
              <div className="text-xs text-muted">
                ₱{group.price} each · {free === 0 ? <span className="text-danger">none free this slot</span> : `${free} free`}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCount(count - 1)}
                disabled={count === 0}
                className="grid h-8 w-8 place-items-center rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={`Fewer ${group.model}`}
              >
                <FiMinus />
              </button>
              <span className="w-7 text-center text-sm font-bold" aria-live="polite">{count}</span>
              <button
                type="button"
                onClick={() => setCount(count + 1)}
                disabled={count >= free}
                className="grid h-8 w-8 place-items-center rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={`More ${group.model}`}
              >
                <FiPlus />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
