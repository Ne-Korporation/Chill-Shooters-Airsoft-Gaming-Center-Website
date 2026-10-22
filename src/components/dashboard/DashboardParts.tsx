import React from 'react'
import { Link } from 'react-router-dom'
import type { IconType } from 'react-icons'
import { FiChevronRight } from 'react-icons/fi'

// Shared building blocks for the role dashboards (player, admin, registrar,
// marshal) so they read as one calm, consistent layout.

export type ActivityTone = 'accent' | 'success' | 'danger' | 'muted'

const toneDot: Record<ActivityTone, string> = {
  accent: 'bg-accent',
  success: 'bg-success',
  danger: 'bg-danger',
  muted: 'bg-muted',
}

export function DashboardHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow ? <div className="text-sm font-medium text-accent">{eyebrow}</div> : null}
        <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  )
}

// A number with a label. Numbers stay neutral; `attention` turns the hint red
// so colour only shows up when something actually needs action.
export function StatTile({
  label,
  value,
  icon: Icon,
  hint,
  attention = false,
  loading = false,
}: {
  label: string
  value: React.ReactNode
  icon?: IconType
  hint?: string
  attention?: boolean
  loading?: boolean
}) {
  return (
    <div className="surface rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted">{label}</span>
        {Icon ? (
          <span className="chip-accent grid h-9 w-9 shrink-0 place-items-center rounded-xl">
            <Icon className="h-4 w-4" />
          </span>
        ) : null}
      </div>
      <div className="mt-3 text-3xl font-semibold tabular-nums">
        {loading ? <span className="skeleton inline-block h-8 w-14 align-middle" /> : value}
      </div>
      {hint ? (
        <div className={`mt-1 flex items-center gap-1.5 text-xs ${attention ? 'text-danger' : 'text-muted'}`}>
          {attention ? <span className="h-1.5 w-1.5 rounded-full bg-danger" /> : null}
          {hint}
        </div>
      ) : null}
    </div>
  )
}

export function Panel({
  title,
  description,
  action,
  children,
  className = '',
}: {
  title: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`surface rounded-2xl p-5 ${className}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

// A tappable row that links to another module.
export function ActionRow({
  to,
  icon: Icon,
  title,
  description,
  badge,
}: {
  to: string
  icon: IconType
  title: string
  description?: string
  badge?: number
}) {
  return (
    <Link to={to} className="hover-row group -mx-2 flex items-center gap-3 rounded-xl px-2 py-2.5">
      <span className="chip-accent grid h-9 w-9 shrink-0 place-items-center rounded-xl">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        {description ? <span className="block truncate text-xs text-muted">{description}</span> : null}
      </span>
      {badge ? (
        <span className="rounded-full bg-danger px-2 py-0.5 text-[11px] font-semibold text-white">{badge}</span>
      ) : null}
      <FiChevronRight className="shrink-0 text-muted transition group-hover:translate-x-0.5" />
    </Link>
  )
}

export function ActivityList({
  items,
  loading,
  emptyText,
}: {
  items: { title: string; subtitle?: string; meta?: string; tone: ActivityTone }[]
  loading?: boolean
  emptyText: string
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-10 w-full" />
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-muted">{emptyText}</p>
  }

  return (
    <ul className="divider divide-y">
      {items.map((item, idx) => (
        <li key={`${item.title}-${idx}`} className="divider flex items-start gap-3 py-3 first:pt-0 last:pb-0">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${toneDot[item.tone]}`} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium capitalize">{item.title}</div>
            {item.subtitle ? <div className="truncate text-xs text-muted">{item.subtitle}</div> : null}
          </div>
          {item.meta ? <div className="shrink-0 text-xs text-muted">{item.meta}</div> : null}
        </li>
      ))}
    </ul>
  )
}
