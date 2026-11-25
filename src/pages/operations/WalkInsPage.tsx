import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { FiInfo, FiUserPlus } from 'react-icons/fi'

import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { apiPost } from '../../utils/apiClient'
import { formatPhPhone, isValidPhPhone, PH_PHONE_PLACEHOLDER, toStoredPhPhone } from '../../utils/phone'
import { LOCATIONS, SLOTS, formatPHP, manilaTodayISO, selectClass } from './shared'
import { PAYMENT_METHODS } from './CounterPage'

// What happened to the optional player account (see createWalkInAccount on the server).
type WalkInAccountResult = {
  status: 'created' | 'exists' | 'resent' | 'failed'
  account?: { id: string; name: string; email: string }
  error?: string
}

// Public games run on weekends only (weekdays are private bookings), so walk-ins are too.
function isPublicGameDay(dateISO: string) {
  const day = new Date(`${dateISO}T12:00:00Z`).getUTCDay()
  return day === 0 || day === 6
}

function WalkInForm({ disabled, onCreated }: { disabled: boolean; onCreated: (reservationId: string) => void }) {
  const [form, setForm] = useState({
    name: '', contact: '', email: '', adultConfirmed: false, locationId: LOCATIONS[0].id as string, reservationTime: 'morning',
    paymentMethod: 'cash', reference: '', notes: '',
  })
  // Walk-ins must bring their own complete gear: players who need rentals reserve online.
  const [ownGearConfirmed, setOwnGearConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [contactError, setContactError] = useState('')

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (form.contact && !isValidPhPhone(form.contact)) {
      setContactError('Enter the contact number as 09XX XXX XXXX, or leave it blank.')
      return
    }
    setSaving(true)
    try {
      const email = form.email.trim()
      const res = await apiPost<{ ok: boolean; data: { id: string; totalAmount: number }; account: WalkInAccountResult | null }>('/api/walk-ins', {
        ...form,
        email,
        adultConfirmed: Boolean(email) && form.adultConfirmed,
        contact: toStoredPhPhone(form.contact),
        mode: 'own_gear',
        paymentMethod: form.paymentMethod === 'later' ? '' : form.paymentMethod,
      })
      toast.success(`${form.name.trim()} registered: ${formatPHP(res.data.totalAmount)}${form.paymentMethod === 'later' ? ' due' : ' paid'}.`)
      const account = res.account
      if (account?.status === 'created') toast.success(`Account made for ${account.account?.email}. Welcome email sent.`, { duration: 5000 })
      if (account?.status === 'resent') toast.success(`${account.account?.email} already had an account waiting for a password. A new link was emailed.`, { duration: 6000 })
      if (account?.status === 'exists') toast(`${account.account?.email} already has an account, so no new one was made.`, { duration: 6000 })
      if (account?.status === 'failed') toast.error(account.error || 'The player account could not be created.', { duration: 6000 })
      setForm((f) => ({ ...f, name: '', contact: '', email: '', adultConfirmed: false, reference: '', notes: '' }))
      setOwnGearConfirmed(false)
      onCreated(res.data.id)
    } catch (e: any) {
      toast.error(e?.message || 'Could not register the walk-in')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="p-4 md:p-5">
      <div className="flex items-center gap-2 text-sm font-bold"><FiUserPlus /> Register a walk-in player</div>
      <p className="mt-1 text-xs text-muted">One player at a time, for today's public game. Friends who walk in together are each registered on their own, so each has their own bill and check-in. Walk-ins bring their own complete airsoft gear and protective equipment and pay the entrance fee only. Players who need rental gear must reserve online.</p>
      <form className="mt-4 space-y-3" onSubmit={submit}>
        <fieldset disabled={disabled} className={`space-y-3 ${disabled ? 'opacity-50' : ''}`}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <Input label="Contact number (optional)" inputMode="tel" placeholder={PH_PHONE_PLACEHOLDER} value={form.contact} error={contactError} onChange={(e) => { setForm((f) => ({ ...f, contact: formatPhPhone(e.target.value) })); setContactError('') }} />
        </div>
        <div>
          <Input
            label="Email (optional)"
            type="email"
            inputMode="email"
            autoComplete="off"
            placeholder="player@email.com"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
          <p className="mt-1 text-xs text-muted">
            With an email we make their player account and send a welcome email with a link to set their password.
          </p>
          {form.email.trim() ? (
            <label className="mt-2 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.adultConfirmed}
                onChange={(e) => setForm((f) => ({ ...f, adultConfirmed: e.target.checked }))}
                className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
              />
              <span>The player is 18 or older. <span className="text-muted">(A minor is added by a parent on their own account.)</span></span>
            </label>
          ) : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <div className="mb-2 text-sm font-semibold">Location</div>
            <select value={form.locationId} onChange={(e) => setForm((f) => ({ ...f, locationId: e.target.value }))} className={selectClass}>
              {LOCATIONS.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="mb-2 text-sm font-semibold">Time slot</div>
            <select value={form.reservationTime} onChange={(e) => setForm((f) => ({ ...f, reservationTime: e.target.value }))} className={`${selectClass} capitalize`}>
              {SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
        <label className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
          <input
            type="checkbox"
            checked={ownGearConfirmed}
            onChange={(e) => setOwnGearConfirmed(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
          />
          <span>
            This player has their own complete gear: a replica, face protection and vest.
            <span className="block text-xs text-muted">No rentals for walk-ins. A player who needs gear must reserve online.</span>
          </span>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <div className="mb-2 text-sm font-semibold">Payment</div>
            <select value={form.paymentMethod} onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value }))} className={selectClass}>
              {PAYMENT_METHODS.map((m) => <option key={m.id} value={m.id}>Paid now — {m.label}</option>)}
              <option value="later">Collect later</option>
            </select>
          </label>
          {form.paymentMethod !== 'cash' && form.paymentMethod !== 'later' ? (
            <Input label="Reference number" value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} />
          ) : null}
        </div>
        <Button type="submit" className="w-full" disabled={disabled || saving || !form.name.trim() || !ownGearConfirmed || (Boolean(form.email.trim()) && !form.adultConfirmed)}>
          {saving ? 'Registering…' : 'Register walk-in'}
        </Button>
        </fieldset>
      </form>
    </Card>
  )
}

// Walk-ins: staff register players who arrive without a booking, for today's public game.
export function WalkInsPage() {
  const navigate = useNavigate()
  const today = manilaTodayISO()
  const open = isPublicGameDay(today)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">Walk-ins</h1>
        <p className="mt-1 text-sm text-muted">Register players who arrive without a booking and bring their own complete gear.</p>
      </div>

      {/* Only needed on private-booking days, to explain why the form is closed. */}
      {!open ? (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          <FiInfo className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <div className="font-semibold">Walk-ins are for public games only.</div>
            <div className="mt-1 text-xs text-muted">
              Public games run on weekends only, so walk-ins open again on Saturday. Today is a private-booking day.
            </div>
          </div>
        </div>
      ) : null}

      <div className="max-w-2xl">
        <WalkInForm
          disabled={!open}
          // Payment for the new booking is taken at the Counter.
          onCreated={(id) => navigate(`/app/counter?reservation=${encodeURIComponent(id)}`)}
        />
      </div>
    </div>
  )
}
