import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { FiCreditCard, FiPlusCircle, FiSearch, FiUserPlus } from 'react-icons/fi'

import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { apiGet, apiPost } from '../../utils/apiClient'
import { LOCATIONS, SLOTS, formatDateTime, formatPHP, selectClass, toInventoryOptions, type InventoryOption } from './shared'

type Ledger = {
  reservation: {
    id: string
    walkIn: boolean
    walkInName: string
    reservationDate: string
    reservationTime: string
    locationName?: string
    numberOfPlayers: number
    packageName?: string
    reservationStatus: string
  }
  total: number
  depositAmount: number
  breakdown: Array<{ label: string; amount: number }>
  payments: Array<{ id: string; amount: number; paymentMethod: string; paymentStatus: string; kind: string; transactionReference: string; createdAtISO: string }>
  collected: number
  balanceDue: number
}

type ChargeConfig = Record<string, { label: string; unitPrice: number }>
type PackageOption = { id: string; name: string }

const PAYMENT_METHODS = [
  { id: 'cash', label: 'Cash' },
  { id: 'gcash', label: 'GCash' },
  { id: 'bank_transfer', label: 'Bank transfer' },
  { id: 'card', label: 'Card' },
]

function WalkInForm({ onCreated }: { onCreated: (reservationId: string) => void }) {
  const [form, setForm] = useState({
    name: '', contact: '', locationId: LOCATIONS[0].id as string, reservationTime: 'morning', players: '1',
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
    setSaving(true)
    try {
      const res = await apiPost<{ ok: boolean; data: { id: string; totalAmount: number } }>('/api/walk-ins', {
        ...form,
        players: Number(form.players),
        customWeaponIds: picked.filter((id) => inventory.find((i) => i.id === id)?.collection === 'weapons'),
        customEquipmentIds: picked.filter((id) => inventory.find((i) => i.id === id)?.collection === 'equipments'),
        paymentMethod: form.paymentMethod === 'later' ? '' : form.paymentMethod,
      })
      toast.success(`Walk-in registered: ${formatPHP(res.data.totalAmount)}${form.paymentMethod === 'later' ? ' due' : ' paid'}.`)
      setForm((f) => ({ ...f, name: '', contact: '', players: '1', reference: '', notes: '' }))
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
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <Input label="Contact (optional)" value={form.contact} onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))} />
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
        <Button type="submit" className="w-full" disabled={saving || !form.name.trim()}>
          {saving ? 'Registering…' : 'Register walk-in'}
        </Button>
      </form>
    </Card>
  )
}

function LedgerPanel({ reservationId }: { reservationId: string }) {
  const [ledger, setLedger] = useState<Ledger | null>(null)
  const [config, setConfig] = useState<ChargeConfig>({})
  const [payment, setPayment] = useState({ amount: '', method: 'cash', reference: '', note: '' })
  const [charge, setCharge] = useState({ type: 'ammo_reload', quantity: '1', unitPrice: '', note: '' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    apiGet<{ data: ChargeConfig }>('/api/charge-config').then((res) => setConfig(res.data)).catch(() => null)
  }, [])

  useEffect(() => {
    setLedger(null)
    apiGet<{ data: Ledger }>(`/api/reservations/${encodeURIComponent(reservationId)}/ledger`)
      .then((res) => {
        setLedger(res.data)
        setPayment((p) => ({ ...p, amount: String(res.data.balanceDue || '') }))
      })
      .catch((e) => toast.error(e?.message || 'Reservation not found'))
  }, [reservationId])

  useEffect(() => {
    if (config[charge.type]) setCharge((c) => ({ ...c, unitPrice: String(config[c.type]?.unitPrice || '') }))
  }, [charge.type, config])

  const recordPayment = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      const res = await apiPost<{ ledger: Ledger }>('/api/payments/onsite', { reservationId, ...payment, amount: Number(payment.amount) })
      setLedger(res.ledger)
      setPayment((p) => ({ ...p, amount: String(res.ledger.balanceDue || ''), reference: '', note: '' }))
      toast.success('Payment recorded.')
    } catch (e: any) {
      toast.error(e?.message || 'Could not record the payment')
    } finally {
      setBusy(false)
    }
  }

  const addCharge = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      const res = await apiPost<{ ledger: Ledger }>(`/api/reservations/${encodeURIComponent(reservationId)}/charges`, {
        ...charge,
        quantity: Number(charge.quantity),
        unitPrice: Number(charge.unitPrice),
      })
      setLedger(res.ledger)
      setPayment((p) => ({ ...p, amount: String(res.ledger.balanceDue || '') }))
      setCharge((c) => ({ ...c, quantity: '1', note: '' }))
      toast.success('Charge added to the bill.')
    } catch (e: any) {
      toast.error(e?.message || 'Could not add the charge')
    } finally {
      setBusy(false)
    }
  }

  if (!ledger) return <Card className="p-4 text-sm text-muted">Loading reservation…</Card>
  const r = ledger.reservation

  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
      <Card className="p-4 md:p-5">
        <div className="text-lg font-semibold">{r.walkIn ? `Walk-in: ${r.walkInName}` : r.packageName || 'Reservation'}</div>
        <div className="mt-1 text-sm text-muted">
          {r.reservationDate} · <span className="capitalize">{r.reservationTime}</span> · {r.locationName} · {r.numberOfPlayers} players ·{' '}
          <span className="capitalize">{r.reservationStatus}</span> · {r.id}
        </div>
        <div className="mt-4 space-y-1 text-sm">
          {ledger.breakdown.map((item, index) => (
            <div key={`${item.label}-${index}`} className="flex justify-between gap-3">
              <span className="text-muted">{item.label}</span>
              <span>{formatPHP(item.amount)}</span>
            </div>
          ))}
          <div className="my-2 h-px bg-white/10" />
          <div className="flex justify-between font-semibold"><span>Total</span><span>{formatPHP(ledger.total)}</span></div>
          <div className="flex justify-between"><span className="text-muted">Paid so far</span><span>{formatPHP(ledger.collected)}</span></div>
          <div className="flex justify-between text-base font-bold text-gold"><span>Balance due</span><span>{formatPHP(ledger.balanceDue)}</span></div>
        </div>
        <div className="mt-4 text-xs uppercase tracking-widest text-muted">Payments</div>
        <ul className="mt-2 space-y-1 text-xs">
          {ledger.payments.length === 0 ? <li className="text-muted">None yet.</li> : ledger.payments.map((p) => (
            <li key={p.id} className="flex justify-between gap-2">
              <span>{p.paymentMethod} · {p.kind === 'onsite' ? 'onsite' : 'online'} · <span className="capitalize">{p.paymentStatus}</span>{p.transactionReference ? ` · ${p.transactionReference}` : ''}</span>
              <span>{formatPHP(p.amount)} · {formatDateTime(p.createdAtISO)}</span>
            </li>
          ))}
        </ul>
      </Card>

      <div className="space-y-4">
        <Card className="p-4 md:p-5">
          <div className="flex items-center gap-2 text-sm font-bold"><FiCreditCard /> Record onsite payment</div>
          <form className="mt-3 space-y-3" onSubmit={recordPayment}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Amount" type="number" min={0} step="0.01" value={payment.amount} onChange={(e) => setPayment((p) => ({ ...p, amount: e.target.value }))} />
              <label className="block">
                <div className="mb-2 text-sm font-semibold">Method</div>
                <select value={payment.method} onChange={(e) => setPayment((p) => ({ ...p, method: e.target.value }))} className={selectClass}>
                  {PAYMENT_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </label>
            </div>
            {payment.method !== 'cash' ? (
              <Input label="Reference number" value={payment.reference} onChange={(e) => setPayment((p) => ({ ...p, reference: e.target.value }))} />
            ) : null}
            <Button type="submit" className="w-full" disabled={busy || ledger.balanceDue <= 0}>
              {ledger.balanceDue <= 0 ? 'Fully paid' : 'Record payment'}
            </Button>
          </form>
        </Card>

        <Card className="p-4 md:p-5">
          <div className="flex items-center gap-2 text-sm font-bold"><FiPlusCircle /> Add a charge</div>
          <form className="mt-3 space-y-3" onSubmit={addCharge}>
            <label className="block">
              <div className="mb-2 text-sm font-semibold">Type</div>
              <select value={charge.type} onChange={(e) => setCharge((c) => ({ ...c, type: e.target.value }))} className={selectClass}>
                {Object.entries(config).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Quantity" type="number" min={1} value={charge.quantity} onChange={(e) => setCharge((c) => ({ ...c, quantity: e.target.value }))} />
              <Input label="Price each" type="number" min={0} step="0.01" value={charge.unitPrice} onChange={(e) => setCharge((c) => ({ ...c, unitPrice: e.target.value }))} />
            </div>
            <Input
              label={charge.type === 'other' ? 'Description' : 'Note (optional)'}
              value={charge.note}
              onChange={(e) => setCharge((c) => ({ ...c, note: e.target.value }))}
            />
            <Button type="submit" variant="ghost" className="w-full" disabled={busy}>Add to bill</Button>
          </form>
        </Card>
      </div>
    </div>
  )
}

// Front-desk screen: register walk-ins, collect remaining balances, and add field charges.
export function CounterPage() {
  const [lookup, setLookup] = useState('')
  const [reservationId, setReservationId] = useState<string | null>(null)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">Counter</h1>
        <p className="mt-1 text-sm text-muted">Register walk-ins, collect balances paid at the field, and add extra charges like ammo reloads.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <WalkInForm onCreated={(id) => { setLookup(id); setReservationId(id) }} />
        <Card className="h-fit p-4 md:p-5">
          <div className="flex items-center gap-2 text-sm font-bold"><FiSearch /> Find a reservation</div>
          <form
            className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(e) => { e.preventDefault(); if (lookup.trim()) setReservationId(lookup.trim()) }}
          >
            <div className="flex-1"><Input label="Reservation ID" value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="R-…" /></div>
            <Button type="submit" variant="primary">Open</Button>
          </form>
          <p className="mt-2 text-xs text-muted">Find IDs in Reservations, on the player's receipt, or in My Reservations.</p>
        </Card>
      </div>

      {reservationId ? <LedgerPanel key={reservationId} reservationId={reservationId} /> : null}
    </div>
  )
}
