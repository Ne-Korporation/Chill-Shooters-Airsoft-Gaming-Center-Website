import React, { useState } from 'react'
import { FiCheck, FiCheckSquare, FiEdit3, FiPlus, FiTrash2, FiX } from 'react-icons/fi'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'

export type BulkChange = { status?: string; price?: number; category?: string }

const fieldClass = 'h-10 w-full rounded-xl border border-white/10 bg-background px-3 text-sm text-text [&>option]:bg-background'

// The square tick box used for selecting rows: an empty outline, or solid green with a check.
export function SelectBox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation()
        onChange()
      }}
      className={`grid h-5 w-5 flex-none place-items-center rounded-md border-2 transition ${checked ? 'border-success bg-success text-white' : 'border-white/25 hover:border-white/50'}`}
    >
      {checked ? <FiCheck className="text-xs" strokeWidth={3} /> : null}
    </button>
  )
}

// Toolbar on the right of the source tabs: "Select items" turns on row tick boxes and becomes
// "Select all"; "Update" opens the bulk changes for the ticked rows; the add button stays last.
export function InventoryToolbar({
  selecting,
  selectedCount,
  allSelected,
  addLabel,
  onStartSelecting,
  onToggleAll,
  onCancel,
  onUpdate,
  onAdd,
}: {
  selecting: boolean
  selectedCount: number
  allSelected: boolean
  addLabel: string
  onStartSelecting: () => void
  onToggleAll: () => void
  onCancel: () => void
  onUpdate: () => void
  onAdd: () => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {selecting ? (
        <>
          <Button size="sm" variant="ghost" onClick={onToggleAll}>
            <FiCheckSquare /> {allSelected ? 'Clear all' : 'Select all'}
          </Button>
          <Button size="sm" variant="accent-soft" disabled={selectedCount === 0} onClick={onUpdate}>
            <FiEdit3 /> Update{selectedCount ? ` (${selectedCount})` : ''}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel} aria-label="Stop selecting">
            <FiX /> Cancel
          </Button>
        </>
      ) : (
        <Button size="sm" variant="ghost" onClick={onStartSelecting}>
          <FiCheckSquare /> Select items
        </Button>
      )}
      <Button size="sm" onClick={onAdd}>
        <FiPlus /> {addLabel}
      </Button>
    </div>
  )
}

// Pop-up for the ticked rows: set one status, price, or category on all of them, or remove them.
export function BulkUpdateModal({
  count,
  noun,
  statuses,
  categories,
  busy,
  onApply,
  onRemove,
  onClose,
}: {
  count: number
  noun: string
  statuses: Array<{ value: string; label: string }>
  categories: Array<{ value: string; label: string }>
  busy: boolean
  onApply: (change: BulkChange) => void
  onRemove: () => void
  onClose: () => void
}) {
  const [status, setStatus] = useState('')
  const [price, setPrice] = useState('')
  const [category, setCategory] = useState('')

  return (
    <Modal eyebrow={`${count} ${noun} selected`} title="Update selected" onClose={onClose} size="md">
      <div className="space-y-4">
        <div className="flex items-end gap-2">
          <label className="flex-1 text-sm font-semibold">
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${fieldClass} mt-1`}>
              <option value="">Choose a status…</option>
              {statuses.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <Button disabled={busy || !status} onClick={() => onApply({ status })}>Apply</Button>
        </div>
        <div className="flex items-end gap-2">
          <label className="flex-1 text-sm font-semibold">
            Rental price (₱)
            <input type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 500" className={`${fieldClass} mt-1`} />
          </label>
          <Button disabled={busy || price === '' || Number(price) < 0} onClick={() => onApply({ price: Number(price) })}>Apply</Button>
        </div>
        <div className="flex items-end gap-2">
          <label className="flex-1 text-sm font-semibold">
            Category
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${fieldClass} mt-1`}>
              <option value="">Choose a category…</option>
              {categories.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <Button disabled={busy || !category} onClick={() => onApply({ category })}>Apply</Button>
        </div>
        <div className="border-t border-white/10 pt-4">
          <Button variant="danger-soft" className="w-full" disabled={busy} onClick={onRemove}>
            <FiTrash2 /> Remove {count} {noun}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// Runs one request per piece, a few at a time, and reports how many failed.
export async function forEachPiece(ids: string[], run: (id: string) => Promise<unknown>) {
  let failed = 0
  for (let i = 0; i < ids.length; i += 5) {
    const results = await Promise.allSettled(ids.slice(i, i + 5).map(run))
    failed += results.filter((result) => result.status === 'rejected').length
  }
  return failed
}
