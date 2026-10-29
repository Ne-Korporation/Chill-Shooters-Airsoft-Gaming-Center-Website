import React from 'react'

export type FilterTabOption<T extends string> = {
  value: T
  label: React.ReactNode
  count?: number
}

// Pill-style filter tabs shared by the admin pages (status filters, periods, audiences).
// One look everywhere: the active tab is tinted gold, the rest are quiet theme-aware pills.
export function FilterTabs<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  className = '',
  ariaLabel,
}: {
  options: ReadonlyArray<FilterTabOption<T>>
  value: T
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  className?: string
  ariaLabel?: string
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={['flex flex-wrap items-center gap-2', className].join(' ')}>
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={[
              'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-semibold transition focus:outline-none focus:ring-2 focus:ring-accent/40',
              size === 'sm' ? 'px-3 py-1 text-xs' : 'px-4 py-1.5 text-sm',
              active ? 'border-accent/40 bg-accent/15 text-accent' : 'surface text-muted hover:text-text',
            ].join(' ')}
          >
            {option.label}
            {typeof option.count === 'number' ? (
              <span className={['rounded-full px-1.5 text-[11px]', active ? 'bg-accent/20' : 'bg-black/10'].join(' ')}>{option.count}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

// "needs review" → "Needs review": readable labels instead of SHOUTED status keys.
export function titleCaseLabel(value: string) {
  const text = value.replace(/[_-]+/g, ' ').trim()
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text
}
