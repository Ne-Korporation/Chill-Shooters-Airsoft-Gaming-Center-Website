import React from 'react'
import { FiCheck } from 'react-icons/fi'

export type PickerPiece = { id: string; label: string; free: boolean }
export type PickerGroup = { model: string; category: string; price: number; pieces: PickerPiece[] }

// Pieces grouped by model ("M4 Rifle · ₱500 each · 12 free"), each one a chip the player can pick.
// `limitFor` caps how many pieces of a model can be picked; `note` adds a line under the model.
export function PiecePicker({
  groups,
  selected,
  onToggle,
  limitFor,
  note,
  emptyText = 'No pieces in inventory.',
}: {
  groups: PickerGroup[]
  selected: string[]
  onToggle: (id: string) => void
  limitFor?: (model: string) => number | undefined
  note?: (group: PickerGroup) => string | undefined
  emptyText?: string
}) {
  if (groups.length === 0) return <div className="mt-4 text-sm text-muted">{emptyText}</div>

  return (
    <div className="mt-4 space-y-3">
      {groups.map((group) => {
        const picked = group.pieces.filter((piece) => selected.includes(piece.id)).length
        const free = group.pieces.filter((piece) => piece.free).length
        const limit = limitFor?.(group.model)
        const full = limit !== undefined && picked >= limit
        const extra = note?.(group)
        return (
          <div key={group.model} className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <div className="text-sm font-bold">{group.model}</div>
                <div className="text-xs text-muted">
                  {group.category ? `${group.category.toUpperCase()} · ` : ''}{free} of {group.pieces.length} free this slot
                  {picked ? ` · ${picked} picked` : ''}{limit !== undefined ? ` (max ${limit})` : ''}
                </div>
                {extra ? <div className="mt-0.5 text-[11px] text-muted">{extra}</div> : null}
              </div>
              <div className="text-xs font-semibold text-accent">₱{group.price} each</div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={`${group.model} pieces`}>
              {group.pieces.map((piece) => {
                const active = selected.includes(piece.id)
                const disabled = !active && (!piece.free || full)
                return (
                  <button
                    key={piece.id}
                    type="button"
                    disabled={disabled}
                    aria-pressed={active}
                    title={!piece.free ? `${piece.id} is reserved or out of service for this slot` : piece.id}
                    onClick={() => onToggle(piece.id)}
                    className={[
                      'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition',
                      active
                        ? 'border-accent/50 bg-accent/15 text-accent'
                        : piece.free
                          ? 'border-white/10 bg-black/20 text-text hover:border-accent/30'
                          : 'border-white/5 bg-black/10 text-muted line-through',
                      disabled ? 'cursor-not-allowed opacity-50' : '',
                    ].join(' ')}
                  >
                    {active ? <FiCheck className="h-3 w-3" /> : null}
                    {piece.label}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
