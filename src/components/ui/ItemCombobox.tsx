import React, { useEffect, useId, useMemo, useState } from 'react'

export type ComboItem = { key: string; label: string; detail?: string }

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const compact = (value: string) => value.replace(/ /g, '')

const similarity = (a: string, b: string) => 1 - editDistance(a, b) / Math.max(a.length, b.length, 1)

function editDistance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1))
      previous = current
    }
  }
  return row[b.length]
}

// How close an item is to what was typed, 0–1. Exact and prefix matches rank first (ignoring
// spaces and dashes, so "ak47" finds "AK-47"), then text containing the typed words, then
// word-by-word spelling similarity (so "m4 rifel 2" still finds "M4 Rifle #2").
export function matchScore(query: string, item: ComboItem) {
  const q = normalize(query)
  if (!q) return 0
  const qWords = q.split(' ')
  const fields = [item.label, item.key, item.detail || ''].map(normalize).filter(Boolean)
  let best = 0
  for (const field of fields) {
    if (field === q || compact(field) === compact(q)) return 1
    if (field.startsWith(q) || compact(field).startsWith(compact(q))) best = Math.max(best, 0.9)
    else if (field.includes(q) || compact(field).includes(compact(q))) best = Math.max(best, 0.8)
    const words = field.split(' ')
    const wordScores = qWords.map((word) => Math.max(...words.map((candidate) => similarity(word, candidate))))
    best = Math.max(best, (wordScores.reduce((sum, score) => sum + score, 0) / qWords.length) * 0.75)
  }
  return best
}

// A minimum score for a typed name to count as one of the listed items.
const CLOSE_ENOUGH = 0.45

export function closestItem(query: string, items: ComboItem[]) {
  let best: { item: ComboItem; score: number } | null = null
  for (const item of items) {
    const score = matchScore(query, item)
    if (!best || score > best.score) best = { item, score }
  }
  return best
}

// One box to type a name or pick from the list. The list filters as you type; on Enter or when
// the box loses focus, the closest listed name is filled in. With `allowCustom`, a name that is
// nothing like any listed item is kept as typed (e.g. a player's own weapon).
export function ItemCombobox({
  label,
  items,
  selectedKey,
  onSelect,
  allowCustom = false,
  customText = '',
  onCustomText,
  placeholder,
}: {
  label: string
  items: ComboItem[]
  selectedKey: string
  onSelect: (item: ComboItem | null) => void
  allowCustom?: boolean
  customText?: string
  onCustomText?: (text: string) => void
  placeholder?: string
}) {
  const listId = useId()
  const selected = items.find((item) => item.key === selectedKey) || null
  const [text, setText] = useState(selected?.label || customText)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  // Follow outside changes, such as the form being cleared after saving.
  useEffect(() => {
    if (selected) setText(selected.label)
    else if (!customText) setText('')
  }, [selected?.key, customText]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    if (!text.trim() || selected?.label === text) return items.slice(0, 50)
    return items
      .map((item) => ({ item, score: matchScore(text, item) }))
      .filter(({ score }) => score >= CLOSE_ENOUGH)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
      .map(({ item }) => item)
  }, [items, text, selected?.label])

  const choose = (item: ComboItem) => {
    onSelect(item)
    onCustomText?.('')
    setText(item.label)
    setOpen(false)
  }

  // Fill in the closest listed name for whatever was typed.
  const commit = () => {
    setOpen(false)
    if (!text.trim() || selected) return
    const best = closestItem(text, items)
    if (best && (!allowCustom || best.score >= CLOSE_ENOUGH)) choose(best.item)
  }

  return (
    <div className="relative">
      <label className="block">
        <div className="mb-2 text-sm font-semibold text-text">{label}</div>
        <input
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            setOpen(true)
            setActive(0)
            if (selected) onSelect(null)
            if (allowCustom) onCustomText?.(event.target.value)
          }}
          onFocus={() => setOpen(true)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setOpen(true)
              setActive((index) => Math.min(index + 1, shown.length - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActive((index) => Math.max(index - 1, 0))
            } else if (event.key === 'Enter' && open) {
              event.preventDefault()
              if (shown[active] && text.trim() && !selected) choose(shown[active])
              else commit()
            } else if (event.key === 'Escape') {
              setOpen(false)
            }
          }}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          className="w-full rounded-xl border border-white/10 bg-background px-4 py-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
      </label>
      {open && shown.length > 0 ? (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-white/10 bg-background py-1 shadow-xl">
          {shown.map((item, index) => (
            <li
              key={item.key}
              role="option"
              aria-selected={item.key === selectedKey}
              onMouseDown={(event) => {
                event.preventDefault()
                choose(item)
              }}
              onMouseEnter={() => setActive(index)}
              className={`cursor-pointer px-4 py-2 text-sm ${index === active ? 'bg-white/10' : ''} ${item.key === selectedKey ? 'font-semibold text-accent' : ''}`}
            >
              {item.label}
              {item.detail ? <span className="ml-2 text-xs text-muted">{item.detail}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {allowCustom && !selected && text.trim() ? (
        <div className="mt-1 text-xs text-muted">Not in the list: it will be logged as typed.</div>
      ) : null}
    </div>
  )
}
