import React, { useEffect, useId, useRef, useState } from 'react'
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
  zIndex,
  confirmDiscard = true,
}: {
  title: React.ReactNode
  eyebrow?: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  size?: 'md' | 'lg' | 'xl'
  // Raise above other full-screen layers (e.g. the Edit Profile sheet).
  zIndex?: number
  // Ask "Discard changes?" before the X, Escape or a click outside closes a pop-up the viewer
  // has typed in. The pop-up's own buttons (Cancel, Save) still close it straight away.
  confirmDiscard?: boolean
}) {
  const titleId = useId()
  const confirmId = useId()
  // Set once anything inside is typed in, ticked or picked. Pop-ups usually close after saving,
  // so it doesn't need resetting.
  const edited = useRef(false)
  const markEdited = () => { edited.current = true }
  const [confirming, setConfirming] = useState(false)
  const requestClose = () => {
    if (confirmDiscard && edited.current) setConfirming(true)
    else onClose()
  }

  useEffect(() => {
    openModals.push(titleId)
    return () => {
      openModals.splice(openModals.indexOf(titleId), 1)
    }
  }, [titleId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Only the top-most pop-up closes when pop-ups are stacked. Escape on the
      // "Discard changes?" prompt goes back to editing.
      if (event.key !== 'Escape' || openModals[openModals.length - 1] !== titleId) return
      if (confirming) setConfirming(false)
      else requestClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  const width = size === 'md' ? 'max-w-lg' : size === 'xl' ? 'max-w-5xl' : 'max-w-2xl'

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4" style={zIndex ? { zIndex } : undefined} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={requestClose}>
      <div
        className={`relative flex max-h-[90dvh] w-full ${width} flex-col overflow-hidden rounded-3xl border border-white/10 bg-background shadow-soft`}
        onClick={(event) => event.stopPropagation()}
        onInputCapture={markEdited}
        onChangeCapture={markEdited}
      >
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
          <Button size="sm" variant="ghost" onClick={requestClose} aria-label="Close" className="w-10 shrink-0 px-0"><FiX /></Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">{children}</div>

        {footer ? <div className="flex shrink-0 justify-end gap-2 border-t border-white/10 px-5 py-4">{footer}</div> : null}

        {confirming ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 p-4" onClick={() => setConfirming(false)}>
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby={confirmId}
              className="w-full max-w-sm rounded-2xl border border-white/10 bg-background p-5 shadow-soft"
              onClick={(event) => event.stopPropagation()}
            >
              <h3 id={confirmId} className="text-lg font-bold">Discard changes?</h3>
              <p className="mt-1 text-sm text-muted">You have unsaved changes. If you close this now, they'll be lost.</p>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Keep editing</Button>
                <Button size="sm" variant="danger" onClick={() => { setConfirming(false); onClose() }}>Discard</Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
