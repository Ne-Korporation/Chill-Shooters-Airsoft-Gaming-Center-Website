import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { FiInfo, FiUserPlus } from 'react-icons/fi'

import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { apiGet, apiPost } from '../../utils/apiClient'
import { formatPhPhone, isValidPhPhone, PH_PHONE_PLACEHOLDER, toStoredPhPhone } from '../../utils/phone'
import { LOCATIONS, SLOTS, formatPHP, manilaTodayISO, selectClass, toInventoryOptions, type InventoryOption } from './shared'
import { PAYMENT_METHODS } from './CounterPage'

type PackageOption = { id: string; name: string }

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
    name: '', contact: '', email: '', adultConfirmed: false, locationId: LOCATIONS[0].id as string, reservationTime: 'morning', players: '1',
    mode: 'own_gear', selectedPackageId: '', paymentMethod: 'cash', reference: '', notes: '',
  })
  const [packages, setPackages] = useState<PackageOption[]>([])
  const [inventory, setInventory] = useState<InventoryOption[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([
      apiGet<{ data: any[] }>('/api/packages?limit=200'),
      apiGet<{ data: any[] }>('/api/weapons?limit=200'),
      apiGet<{ data: any[] }>('/api/equipments?limit=200'),
    ]).then(([pkgRes, wepRes, eqRes]) => {
      setPackages((pkgRes.data || [])
        .filter((p) => (p.status || 'active') === 'active')
        .map((p) => ({ id: String(p.id || p._id), name: p.name || 'Package' })))
      setInventory([
        ...toInventoryOptions((wepRes.data || []).filter((w) => (w.status || 'available') === 'available'), 'weapons'),
        ...toInventoryOptions((eqRes.data || []).filter((e) => (e.status || 'available') === 'available'), 'equipments'),
      ])
    }).catch(() => toast.error('Could not load packages and inventory'))
  }, [])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (form.contact && !isValidPhPhone(form.contact)) {
      toast.error('Enter the contact number as 09XX XXX XXXX, or leave it blank.')
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
        players: Number(form.players),
        customWeaponIds: picked.filter((id) => inventory.find((i) => i.id === id)?.collection === 'weapons'),
        customEquipmentIds: picked.filter((id) => inventory.find((i) => i.id === id)?.collection === 'equipments'),
        paymentMethod: form.paymentMethod === 'later' ? '' : form.paymentMethod,
      })
      toast.success(`Walk-in registered: ${formatPHP(res.data.totalAmount)}${form.paymentMethod === 'later' ? ' due' : ' paid'}.`)
      const account = res.account
      if (account?.status === 'created') toast.success(`Account made for ${account.account?.email}. Welcome email sent.`, { duration: 5000 })
      if (account?.status === 'resent') toast.success(`${account.account?.email} already had an account waiting for a password. A new link was emailed.`, { duration: 6000 })
      if (account?.status === 'exists') toast(`${account.account?.email} already has an account, so no new one was made.`, { duration: 6000 })
      if (account?.status === 'failed') toast.error(account.error || 'The player account could not be created.', { duration: 6000 })
      setForm((f) => ({ ...f, name: '', contact: '', email: '', adultConfirmed: false, players: '1', reference: '', notes: '' }))
      setPicked([])
      onCreated(res.data.id)
    } catch (e: any) {
      toast.error(e?.message || 'Could not register the walk-in')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="p-4 md:p-5">
      <div className="flex items-center gap-2 text-sm font-bold"><FiUserPlus /> Register a walk-in</div>
      <p className="mt-1 text-xs text-muted">For today's public game. Own-gear players pay the entrance fee; rentals are limited to gear that is still free.</p>
      <form className="mt-4 space-y-3" onSubmit={submit}>
        <fieldset disabled={disabled} className={`space-y-3 ${disabled ? 'opacity-50' : ''}`}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <Input label="Contact number (optional)" inputMode="tel" placeholder={PH_PHONE_PLACEHOLDER} value={form.contact} onChange={(e) => setForm((f) => ({ ...f, contact: formatPhPhone(e.target.value) }))} />
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
        <div className="grid gap-3 sm:grid-cols-3">
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
          <Input label="Players" type="number" min={1} value={form.players} onChange={(e) => setForm((f) => ({ ...f, players: e.target.value }))} />
        </div>
        <label className="block">
          <div className="mb-2 text-sm font-semibold">Gear</div>
          <select value={form.mode} onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value }))} className={selectClass}>
            <option value="own_gear">Own gear (entrance fee only)</option>
            <option value="package">Rental package</option>
            <option value="custom">Pick rental items</option>
          </select>
        </label>
        {form.mode === 'package' ? (
          <label className="block">
            <div className="mb-2 text-sm font-semibold">Package</div>
            <select value={form.selectedPackageId} onChange={(e) => setForm((f) => ({ ...f, selectedPackageId: e.target.value }))} className={selectClass}>
              <option value="">Choose a package…</option>
              {packages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        ) : null}
        {form.mode === 'custom' ? (
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-white/10 bg-white/5 p-3">
            {inventory.length === 0 ? <div className="text-xs text-muted">No available rental items.</div> : inventory.map((item) => (
              <label key={item.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={picked.includes(item.id)}
                  onChange={() => setPicked((p) => (p.includes(item.id) ? p.filter((id) => id !== item.id) : [...p, item.id]))}
                  className="h-4 w-4 accent-[var(--color-accent)]"
                />
                {item.name} <span className="text-xs text-muted">({item.category || item.collection})</span>
              </label>
            ))}
          </div>
        ) : null}
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
        <Button type="submit" className="w-full" disabled={disabled || saving || !form.name.trim() || (Boolean(form.email.trim()) && !form.adultConfirmed)}>
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
        <p className="mt-1 text-sm text-muted">Register players who arrive without a booking.</p>
      </div>

      <div className={`flex items-start gap-3 rounded-2xl border p-4 text-sm ${open ? 'border-accent/30 bg-accent/10' : 'border-amber-500/30 bg-amber-500/10'}`}>
        <FiInfo className={`mt-0.5 h-5 w-5 shrink-0 ${open ? 'text-accent' : 'text-amber-600 dark:text-amber-400'}`} />
        <div>
          <div className="font-semibold">This is only for public games.</div>
          <div className="mt-1 text-xs text-muted">
            {open
              ? "Walk-ins join today's public game (weekends). Private games are booked online."
              : 'Public games run on weekends only, so walk-ins open again on Saturday. Today is a private-booking day.'}
          </div>
        </div>
      </div>

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
