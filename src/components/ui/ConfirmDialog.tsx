import React, { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { Button } from './Button'

// In-app replacements for the browser's confirm() and prompt() boxes, which show the site's raw
// address and can't match the app. Call them from anywhere and await the answer:
//
//   if (!(await confirmDialog({ title: 'Archive this game?', confirmLabel: 'Archive' }))) return
//   const reason = await promptDialog({ title: 'Why is it rejected?', required: true })
//
// <DialogHost /> (mounted once in main.tsx) shows them, one at a time, above every other pop-up.

type ConfirmOptions = {
  title: string
  message?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  // Red confirm button, for deleting or anything that can't be undone.
  danger?: boolean
}

type PromptOptions = ConfirmOptions & {
  label?: string
  placeholder?: string
  defaultValue?: string
  // The confirm button stays off until something is typed.
  required?: boolean
  multiline?: boolean
  maxLength?: number
}

type Request =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void }

const queue: Request[] = []
let notify: (() => void) | null = null

function enqueue(request: Request) {
  queue.push(request)
  notify?.()
}

/** Asks the user to confirm; resolves true for the confirm button, false for cancel/close. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => enqueue({ kind: 'confirm', options, resolve }))
}

/** Asks the user to type something; resolves the trimmed text, or null when cancelled. */
export function promptDialog(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => enqueue({ kind: 'prompt', options, resolve }))
}

export function DialogHost() {
  const [current, setCurrent] = useState<Request | null>(null)
  const [text, setText] = useState('')
  // The one on screen, readable outside renders (one pop-up at a time).
  const shown = React.useRef<Request | null>(null)

  useEffect(() => {
    const showNext = () => {
      if (shown.current || !queue.length) return
      const next = queue.shift() as Request
      shown.current = next
      setText(next.kind === 'prompt' ? next.options.defaultValue || '' : '')
      setCurrent(next)
    }
    notify = showNext
    showNext()
    return () => {
      if (notify === showNext) notify = null
    }
  }, [])

  if (!current) return null
  const { options } = current

  const finish = (confirmed: boolean) => {
    if (current.kind === 'confirm') current.resolve(confirmed)
    else current.resolve(confirmed ? text.trim() : null)
    shown.current = null
    setCurrent(null)
    // Then the next waiting one, if any.
    window.setTimeout(() => notify?.(), 0)
  }

  const prompt = current.kind === 'prompt' ? current.options : null
  const blocked = Boolean(prompt?.required && !text.trim())
  const inputClass = 'w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/60'

  return (
    <Modal
      title={options.title}
      size="md"
      zIndex={100100}
      confirmDiscard={false}
      onClose={() => finish(false)}
      footer={(
        <>
          <Button variant="ghost" onClick={() => finish(false)}>{options.cancelLabel || 'Cancel'}</Button>
          <Button variant={options.danger ? 'danger' : 'primary'} disabled={blocked} onClick={() => finish(true)}>
            {options.confirmLabel || 'OK'}
          </Button>
        </>
      )}
    >
      {options.message ? <div className="whitespace-pre-line text-sm text-muted">{options.message}</div> : null}
      {prompt ? (
        <form
          className={options.message ? 'mt-4' : ''}
          onSubmit={(event) => {
            event.preventDefault()
            if (!blocked) finish(true)
          }}
        >
          {prompt.label ? <div className="mb-2 text-sm font-semibold">{prompt.label}</div> : null}
          {prompt.multiline ? (
            <textarea
              autoFocus
              rows={3}
              value={text}
              maxLength={prompt.maxLength}
              placeholder={prompt.placeholder}
              onChange={(event) => setText(event.target.value)}
              className={inputClass}
            />
          ) : (
            <input
              autoFocus
              value={text}
              maxLength={prompt.maxLength}
              placeholder={prompt.placeholder}
              onChange={(event) => setText(event.target.value)}
              className={inputClass}
            />
          )}
        </form>
      ) : null}
    </Modal>
  )
}
