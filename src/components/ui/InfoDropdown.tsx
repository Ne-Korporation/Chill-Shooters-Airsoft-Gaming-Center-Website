import React, { useState } from 'react'
import { FiChevronDown, FiInfo } from 'react-icons/fi'

export type InfoItem = { label: string; text: React.ReactNode }

// A collapsed "how this page works" panel under a page title: a toggle row that opens to a
// short list of labeled points. Starts closed so the page itself stays front and center.
export function InfoDropdown({ title = 'How this page works', items }: { title?: string; items: InfoItem[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-text transition hover:bg-white/5"
      >
        <FiInfo className="shrink-0 text-accent" />
        <span className="flex-1">{title}</span>
        <FiChevronDown className={['shrink-0 text-muted transition-transform', open ? 'rotate-180' : ''].join(' ')} />
      </button>
      {open ? (
        <dl className="grid gap-x-4 gap-y-2 border-t border-white/10 px-4 py-3 text-sm sm:grid-cols-[9rem_minmax(0,1fr)]">
          {items.map((item) => (
            <React.Fragment key={item.label}>
              <dt className="font-semibold text-text">{item.label}</dt>
              <dd className="text-muted">{item.text}</dd>
            </React.Fragment>
          ))}
        </dl>
      ) : null}
    </div>
  )
}
