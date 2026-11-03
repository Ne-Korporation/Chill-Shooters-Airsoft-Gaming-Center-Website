import React, { useEffect, useId } from 'react'
import { createPortal } from 'react-dom'
import { FiX } from 'react-icons/fi'
import { Button } from './Button'

const openModals: string[] = []

// Centered pop-up with a title, an X in the corner and a Close button at the bottom.
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
      <div className={`max-h-[90vh] w-full ${width} overflow-y-auto rounded-3xl border border-white/10 bg-background p-5 shadow-soft`} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            {eyebrow ? <div className="text-xs uppercase tracking-widest text-muted">{eyebrow}</div> : null}
            <h2 id={titleId} className="mt-1 text-2xl font-bold">{title}</h2>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close" className="w-10 px-0"><FiX /></Button>
        </div>

        <div className="mt-4">{children}</div>

        <div className="mt-5 flex justify-end gap-2">
          {footer}
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
