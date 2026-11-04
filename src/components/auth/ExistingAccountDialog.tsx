import React from 'react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'

// "This email already exists" pop-up.
// - provider 'password' + onProceed: "Continue with Google" matched an account made with the
//   email + password form; the player confirms it's theirs before it is linked and signed in.
// - provider 'google': the email + password form was used for an account made with Google.
// - provider 'password' without onProceed: the register form was used for an email that already
//   has a password account.
export function ExistingAccountDialog({
  account,
  provider = 'password',
  busy = false,
  onProceed,
  onUseGoogle,
  onGoToLogin,
  onCancel,
}: {
  account: { name?: string; email: string } | null
  provider?: 'password' | 'google'
  busy?: boolean
  onProceed?: () => void
  onUseGoogle?: () => void
  onGoToLogin?: () => void
  onCancel: () => void
}) {
  if (!account) return null
  const linkingGoogle = provider === 'password' && Boolean(onProceed)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="existing-account-title">
      <Card className="w-full max-w-sm space-y-4">
        <div>
          <h2 id="existing-account-title" className="text-lg font-bold">This email already exists</h2>
          <p className="mt-2 text-sm text-muted">
            An account is already registered with <span className="font-semibold text-text">{account.email}</span>
            {account.name ? <> under the name <span className="font-semibold text-text">{account.name}</span></> : null}.
            {' '}
            {linkingGoogle
              ? 'It was created with an email and password. Do you want to proceed and sign in to it with Google?'
              : provider === 'google'
                ? 'It was created with Google, so sign in with "Continue with Google" instead.'
                : 'Log in with your email and password instead.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" disabled={busy} onClick={onCancel}>Cancel</Button>
          {linkingGoogle ? (
            <Button className="flex-1" disabled={busy} onClick={onProceed}>{busy ? 'Signing in...' : 'Proceed'}</Button>
          ) : provider === 'google' && onUseGoogle ? (
            <Button className="flex-1" disabled={busy} onClick={onUseGoogle}>Continue with Google</Button>
          ) : onGoToLogin ? (
            <Button className="flex-1" disabled={busy} onClick={onGoToLogin}>Go to login</Button>
          ) : null}
        </div>
      </Card>
    </div>
  )
}
