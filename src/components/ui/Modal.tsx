import React, { useEffect, useId } from 'react'
import { createPortal } from 'react-dom'
import { FiX } from 'react-icons/fi'
import { Button } from './Button'

const openModals: string[] = []

// Centered pop-up with a pinned title row and an X to close it.
// Clicking the backdrop or pressing Escape also closes it.
export function Modal({
  title,
  eyebrow,
  onClose,
  children,
  footer,
  size = 'lg',
}: {
  title: React.ReactNode
  eyebrow?: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  size?: 'md' | 'lg' | 'xl'
}) {
  const titleId = useId()

  useEffect(() => {
    openModals.push(titleId)
    return () => {
      openModals.splice(openModals.indexOf(titleId), 1)
    }
  }, [titleId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Only the top-most pop-up closes when pop-ups are stacked.
      if (event.key === 'Escape' && openModals[openModals.length - 1] === titleId) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, titleId])

  const width = size === 'md' ? 'max-w-lg' : size === 'xl' ? 'max-w-5xl' : 'max-w-2xl'

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={onClose}>
      <div className={`flex max-h-[90dvh] w-full ${width} flex-col overflow-hidden rounded-3xl border border-white/10 bg-background shadow-soft`} onClick={(event) => event.stopPropagation()}>
        {/* The title row sits above the scrolling area (not over it), so the X is always in reach
            and no content slides underneath it. */}
        <div
          className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-5 py-4"
          style={{ background: 'linear-gradient(90deg, rgba(197,163,90,0.16), rgba(197,163,90,0) 75%), rgb(var(--bg))' }}
        >
          <div className="min-w-0">
            {eyebrow ? <div className="text-xs uppercase tracking-widest text-muted">{eyebrow}</div> : null}
            <h2 id={titleId} className="mt-1 break-words text-2xl font-bold">{title}</h2>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close" className="w-10 shrink-0 px-0"><FiX /></Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">{children}</div>

        {footer ? <div className="flex shrink-0 justify-end gap-2 border-t border-white/10 px-5 py-4">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  )
}
