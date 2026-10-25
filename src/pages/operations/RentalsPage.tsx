import React, { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { FiAlertTriangle, FiCheck, FiLogOut } from 'react-icons/fi'

import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { apiGet, apiPost, apiPut } from '../../utils/apiClient'
import { formatDateTime, selectClass, toInventoryOptions, type InventoryOption } from './shared'

type Rental = {
  id: string
  reservationId: string
  reservationDate: string
  playerName: string
  playerId?: string
  itemCollection: 'weapons' | 'equipments'
  itemName: string
  unitLabel: string
  status: 'out' | 'returned' | 'missing'
  condition?: 'ok' | 'damaged' | 'missing'
  damageReportId?: string
  issuedAtISO: string
  returnedAtISO?: string
  overdue?: boolean
}

type TeamMember = { id: string; name: string }

// Marshals record which player took which unit, then check each one back in. Damaged or
// missing items open a damage report (billed by the admin) and leave the rental pool.
export function RentalsPage() {
  const [reservationId, setReservationId] = useState('')
  const [activeReservation, setActiveReservation] = useState<string | null>(null)
  const [members, setMembers] = useState<TeamMember[]>([])
  const [inventory, setInventory] = useState<InventoryOption[]>([])
  const [rentals, setRentals] = useState<Rental[]>([])
  const [outstanding, setOutstanding] = useState<Rental[]>([])
  const [form, setForm] = useState({ playerName: '', playerId: '', itemKey: '', unitLabel: '' })
  const [busy, setBusy] = useState(false)

  const loadOutstanding = useCallback(() => {
    apiGet<{ data: Rental[] }>('/api/rentals?status=out').then((res) => setOutstanding(res.data)).catch(() => null)
  }, [])

  useEffect(() => {
    loadOutstanding()
    Promise.all([apiGet<{ data: any[] }>('/api/weapons?limit=200'), apiGet<{ data: any[] }>('/api/equipments?limit=200')])
      .then(([w, e]) => setInventory([...toInventoryOptions(w.data || [], 'weapons'), ...toInventoryOptions(e.data || [], 'equipments')]))
      .catch(() => toast.error('Could not load inventory'))
  }, [loadOutstanding])

  const openReservation = async (id: string) => {
    try {
      const [ledger, list] = await Promise.all([
        apiGet<{ data: { reservation: { walkIn: boolean; walkInName: string; userId?: string; captainName?: string; teamMembers: TeamMember[] } } }>(`/api/reservations/${encodeURIComponent(id)}/ledger`),
        apiGet<{ data: Rental[] }>(`/api/rentals?reservationId=${encodeURIComponent(id)}`),
      ])
      const r = ledger.data.reservation
      setMembers(r.walkIn
        ? [{ id: '', name: r.walkInName }]
        : [...(r.captainName && r.userId ? [{ id: r.userId, name: r.captainName }] : []), ...(r.teamMembers || [])])
      setRentals(list.data)
      setActiveReservation(id)
    } catch (e: any) {
      toast.error(e?.message || 'Reservation not found')
    }
  }

  const issue = async (event: React.FormEvent) => {
    event.preventDefault()
    const item = inventory.find((i) => `${i.collection}:${i.id}` === form.itemKey)
    if (!activeReservation || !item) return toast.error('Choose an item.')
    setBusy(true)
    try {
      await apiPost('/api/rentals/issue', {
        reservationId: activeReservation,
        playerName: form.playerName,
        playerId: form.playerId,
        itemCollection: item.collection,
        itemId: item.id,
        unitLabel: form.unitLabel,
      })
      toast.success(`${item.name} issued to ${form.playerName}.`)
      setForm((f) => ({ ...f, itemKey: '', unitLabel: '' }))
      await openReservation(activeReservation)
      loadOutstanding()
    } catch (e: any) {
      toast.error(e?.message || 'Could not issue the item')
    } finally {
      setBusy(false)
    }
  }

  const checkIn = async (rental: Rental, condition: 'ok' | 'damaged' | 'missing') => {
    let note = ''
    if (condition !== 'ok') {
      note = window.prompt(condition === 'damaged' ? 'What is damaged?' : 'Any details about the missing item?') ?? ''
      if (condition === 'damaged' && !note.trim()) return
    }
    try {
      const res = await apiPut<{ damageReport?: { id: string } }>(`/api/rentals/${encodeURIComponent(rental.id)}/return`, { condition, note })
      toast.success(res.damageReport ? `Checked in. Damage report ${res.damageReport.id} opened for billing.` : 'Checked in.')
      if (activeReservation) await openReservation(activeReservation)
      loadOutstanding()
    } catch (e: any) {
      toast.error(e?.message || 'Could not check in the item')
    }
  }

  const memberOptions = useMemo(() => members.filter((m) => m.name), [members])

  const RentalRow = ({ rental, showReservation }: { rental: Rental; showReservation?: boolean }) => (
    <li className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-sm font-semibold">
          {rental.itemName}{rental.unitLabel ? ` · ${rental.unitLabel}` : ''} → {rental.playerName}
        </div>
        <div className="text-[11px] text-muted">
          {showReservation ? `${rental.reservationId} · ${rental.reservationDate} · ` : ''}
          Out {formatDateTime(rental.issuedAtISO)}
          {rental.returnedAtISO ? ` · In ${formatDateTime(rental.returnedAtISO)}` : ''}
          {rental.damageReportId ? ` · ${rental.damageReportId}` : ''}
          {rental.overdue ? ' · not returned after game day' : ''}
        </div>
      </div>
      {rental.status === 'out' ? (
        <div className="flex flex-none gap-1">
          <Button size="sm" variant="ghost" onClick={() => checkIn(rental, 'ok')}><FiCheck /> Returned OK</Button>
          <Button size="sm" variant="ghost" onClick={() => checkIn(rental, 'damaged')}>Damaged</Button>
          <Button size="sm" variant="ghost" onClick={() => checkIn(rental, 'missing')}>Missing</Button>
        </div>
      ) : (
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${rental.condition === 'ok' ? 'border-success/30 text-success' : 'border-danger/30 text-danger'}`}>
          {rental.condition === 'ok' ? 'Returned' : rental.condition}
        </span>
      )}
    </li>
  )

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">Rental Check-out</h1>
        <p className="mt-1 text-sm text-muted">Track which player has which rental unit, and check each one back in after the game.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <Card className="h-fit p-4 md:p-5">
          <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); if (reservationId.trim()) openReservation(reservationId.trim()) }}>
            <div className="flex-1"><Input label="Reservation ID" value={reservationId} onChange={(e) => setReservationId(e.target.value)} placeholder="R-…" /></div>
            <Button type="submit" variant="primary">Open</Button>
          </form>

          {activeReservation ? (
            <form className="mt-4 space-y-3" onSubmit={issue}>
              <div className="flex items-center gap-2 text-sm font-bold"><FiLogOut /> Issue an item</div>
              <label className="block">
                <div className="mb-2 text-sm font-semibold">Player</div>
                <select
                  value={form.playerId ? `id:${form.playerId}` : form.playerName ? `name:${form.playerName}` : ''}
                  onChange={(e) => {
                    const value = e.target.value
                    const member = memberOptions.find((m) => `id:${m.id}` === value || `name:${m.name}` === value)
                    setForm((f) => ({ ...f, playerId: member?.id || '', playerName: member?.name || '' }))
                  }}
                  className={selectClass}
                >
                  <option value="">Guest / type a name below</option>
                  {memberOptions.map((m) => <option key={m.id || m.name} value={m.id ? `id:${m.id}` : `name:${m.name}`}>{m.name}</option>)}
                </select>
              </label>
              {!form.playerId ? (
                <Input label="Player name" value={form.playerName} onChange={(e) => setForm((f) => ({ ...f, playerName: e.target.value }))} />
              ) : null}
              <label className="block">
                <div className="mb-2 text-sm font-semibold">Item</div>
                <select value={form.itemKey} onChange={(e) => setForm((f) => ({ ...f, itemKey: e.target.value }))} className={selectClass}>
                  <option value="">Choose…</option>
                  {inventory.map((item) => (
                    <option key={`${item.collection}:${item.id}`} value={`${item.collection}:${item.id}`}>
                      {item.name} ({item.category || item.collection})
                    </option>
                  ))}
                </select>
              </label>
              <Input label="Unit number / tag" hint="The number on the gun or gear, so each unit can be traced." value={form.unitLabel} onChange={(e) => setForm((f) => ({ ...f, unitLabel: e.target.value }))} />
              <Button type="submit" className="w-full" disabled={busy || !form.playerName.trim() || !form.itemKey}>
                {busy ? 'Saving…' : 'Issue item'}
              </Button>
            </form>
          ) : null}
        </Card>

        <div className="space-y-4">
          {activeReservation ? (
            <Card className="p-4 md:p-5">
              <div className="text-sm font-bold">Items for {activeReservation}</div>
              <ul className="mt-3 space-y-2">
                {rentals.length === 0 ? <li className="text-sm text-muted">Nothing issued yet.</li> : rentals.map((r) => <RentalRow key={r.id} rental={r} />)}
              </ul>
            </Card>
          ) : null}

          <Card className="p-4 md:p-5">
            <div className="flex items-center gap-2 text-sm font-bold"><FiAlertTriangle className="text-warning" /> Still out ({outstanding.length})</div>
            <ul className="mt-3 space-y-2">
              {outstanding.length === 0 ? <li className="text-sm text-muted">Every rental is checked in.</li> : outstanding.map((r) => <RentalRow key={r.id} rental={r} showReservation />)}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  )
}
