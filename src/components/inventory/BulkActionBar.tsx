import React, { useState } from 'react'
import { FiTrash2, FiX } from 'react-icons/fi'
import { Button } from '../ui/Button'

export type BulkChange = { status?: string; price?: number; category?: string }

const fieldClass = 'h-9 rounded-xl border border-white/10 bg-background px-3 text-sm text-text [&>option]:bg-background'

// Shown above an inventory table while pieces are selected: set one status, price, or category
// on every selected piece, or remove them all.
export function BulkActionBar({
  count,
  statuses,
  categories,
  busy,
  onApply,
  onRemove,
  onClear,
}: {
  count: number
  statuses: Array<{ value: string; label: string }>
  categories: Array<{ value: string; label: string }>
  busy: boolean
  onApply: (change: BulkChange) => void
  onRemove: () => void
  onClear: () => void
}) {
  const [status, setStatus] = useState('')
  const [price, setPrice] = useState('')
  const [category, setCategory] = useState('')
  if (count === 0) return null

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-accent/30 bg-accent/10 px-3 py-2">
      <span className="text-sm font-semibold">{count} selected</span>
      <span className="mx-1 h-5 border-l border-white/10" />
      <select value={status} onChange={(e) => setStatus(e.target.value)} className={fieldClass} aria-label="New status">
        <option value="">Status…</option>
        {statuses.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <Button size="xs" variant="ghost" disabled={busy || !status} onClick={() => onApply({ status })}>Set status</Button>
      <input
        type="number"
        min="0"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        placeholder="Price ₱"
        aria-label="New price"
        className={`${fieldClass} w-28`}
      />
      <Button size="xs" variant="ghost" disabled={busy || price === '' || Number(price) < 0} onClick={() => onApply({ price: Number(price) })}>Set price</Button>
      <select value={category} onChange={(e) => setCategory(e.target.value)} className={fieldClass} aria-label="New category">
        <option value="">Category…</option>
        {categories.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <Button size="xs" variant="ghost" disabled={busy || !category} onClick={() => onApply({ category })}>Set category</Button>
      <span className="ml-auto flex gap-2">
        <Button size="xs" variant="danger-soft" disabled={busy} onClick={onRemove}><FiTrash2 /> Remove</Button>
        <Button size="xs" variant="ghost" disabled={busy} onClick={onClear}><FiX /> Clear</Button>
      </span>
    </div>
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
