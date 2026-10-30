import React from 'react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'

// Shown when "Continue with Google" matches an account that already exists, so the
// player confirms it's theirs before being signed in.
export function ExistingAccountDialog({
  account,
  busy = false,
  onProceed,
  onCancel,
}: {
  account: { name: string; email: string } | null
  busy?: boolean
  onProceed: () => void
  onCancel: () => void
}) {
  if (!account) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <Card className="w-full max-w-sm space-y-4">
        <div>
          <h2 className="text-lg font-bold">This account already exists</h2>
          <p className="mt-2 text-sm text-muted">
            An account is already registered with <span className="font-semibold text-text">{account.email}</span>
            {account.name ? <> under the name <span className="font-semibold text-text">{account.name}</span></> : null}.
            Do you want to proceed and sign in to it?
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button className="flex-1" disabled={busy} onClick={onProceed}>{busy ? 'Signing in...' : 'Proceed'}</Button>
        </div>
      </Card>
    </div>
  )
}
