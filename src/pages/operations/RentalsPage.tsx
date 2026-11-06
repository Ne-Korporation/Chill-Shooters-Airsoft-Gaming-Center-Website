import React, { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { FiAlertTriangle, FiCheck, FiLogOut } from 'react-icons/fi'

import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { apiGet, apiGetAll, apiPost, apiPut } from '../../utils/apiClient'
import { Paged } from '../../components/ui/Pagination'
import { categoryLabel, formatDateTime, selectClass, toInventoryOptions, type InventoryOption } from './shared'

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
type Condition = 'ok' | 'damaged' | 'missing'

// Rental check-out lives on the Games page: RentalsPanel in a game's pop-up (which player has
// which unit), StillOutPanel as its own tab. Damaged or missing items open a damage report
// (billed by the admin) and leave the rental pool.

async function checkInRental(rental: Rental, condition: Condition) {
  let note = ''
  if (condition !== 'ok') {
    note = window.prompt(condition === 'damaged' ? 'What is damaged?' : 'Any details about the missing item?') ?? ''
    if (condition === 'damaged' && !note.trim()) return false
  }
  try {
    const res = await apiPut<{ damageReport?: { id: string } }>(`/api/rentals/${encodeURIComponent(rental.id)}/return`, { condition, note })
    toast.success(res.damageReport ? `Checked in. Damage report ${res.damageReport.id} opened for billing.` : 'Checked in.')
    return true
  } catch (e: any) {
    toast.error(e?.message || 'Could not check in the item')
    return false
  }
}

function RentalRow({ rental, showReservation, onCheckIn }: { rental: Rental; showReservation?: boolean; onCheckIn: (rental: Rental, condition: Condition) => void }) {
  return (
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
          <Button size="sm" variant="ghost" onClick={() => onCheckIn(rental, 'ok')}><FiCheck /> Returned OK</Button>
          <Button size="sm" variant="ghost" onClick={() => onCheckIn(rental, 'damaged')}>Damaged</Button>
          <Button size="sm" variant="ghost" onClick={() => onCheckIn(rental, 'missing')}>Missing</Button>
        </div>
      ) : (
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${rental.condition === 'ok' ? 'border-success/30 text-success' : 'border-danger/30 text-danger'}`}>
          {rental.condition === 'ok' ? 'Returned' : rental.condition}
        </span>
      )}
    </li>
  )
}

// Every rental not yet checked in, across all games.
export function StillOutPanel({ onCountChange }: { onCountChange?: (count: number) => void }) {
  const [outstanding, setOutstanding] = useState<Rental[] | null>(null)

  const load = useCallback(() => {
    apiGet<{ data: Rental[] }>('/api/rentals?status=out')
      .then((res) => {
        setOutstanding(res.data)
        onCountChange?.(res.data.length)
      })
      .catch(() => setOutstanding((current) => current || []))
  }, [onCountChange])

  useEffect(() => { load() }, [load])

  const onCheckIn = async (rental: Rental, condition: Condition) => {
    if (await checkInRental(rental, condition)) load()
  }

  return (
    <Card className="p-4 md:p-5">
      <div className="flex items-center gap-2 text-sm font-bold">
        <FiAlertTriangle className="text-warning" /> Still out ({outstanding ? outstanding.length : '…'})
      </div>
      {outstanding === null ? (
        <div className="mt-3 text-sm text-muted">Loading rentals…</div>
      ) : outstanding.length === 0 ? (
        <div className="mt-3 text-sm text-muted">Every rental is checked in.</div>
      ) : (
        <Paged items={outstanding}>
          {(pageItems) => <ul className="mt-3 space-y-2">{pageItems.map((r) => <RentalRow key={r.id} rental={r} showReservation onCheckIn={onCheckIn} />)}</ul>}
        </Paged>
      )}
    </Card>
  )
}

// Rentals for one booking: issue a unit to a player, and check each one back in.
export function RentalsPanel({ reservationId }: { reservationId: string }) {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [inventory, setInventory] = useState<InventoryOption[]>([])
  const [rentals, setRentals] = useState<Rental[] | null>(null)
  const [outstanding, setOutstanding] = useState<Rental[]>([])
  const [form, setForm] = useState({ playerName: '', playerId: '', category: '', model: '', itemKey: '', unitLabel: '' })
  const [busy, setBusy] = useState(false)
  const [inventoryState, setInventoryState] = useState<'loading' | 'ready' | 'error'>('loading')

  const loadOutstanding = useCallback(() => {
    apiGet<{ data: Rental[] }>('/api/rentals?status=out').then((res) => setOutstanding(res.data)).catch(() => null)
  }, [])

  // Every piece is its own record, so the inventory easily runs past one 200-record page: read it all.
  const loadInventory = useCallback(() => {
    setInventoryState('loading')
    Promise.all([apiGetAll<any>('weapons'), apiGetAll<any>('equipments')])
      .then(([w, e]) => {
        setInventory([...toInventoryOptions(w, 'weapons'), ...toInventoryOptions(e, 'equipments')])
        setInventoryState('ready')
      })
      .catch(() => {
        setInventoryState('error')
        toast.error('Could not load inventory')
      })
  }, [])

  const loadReservation = useCallback(async () => {
    try {
      const [ledger, list] = await Promise.all([
        apiGet<{ data: { reservation: { walkIn: boolean; walkInName: string; userId?: string; captainName?: string; teamMembers: TeamMember[] } } }>(`/api/reservations/${encodeURIComponent(reservationId)}/ledger`),
        apiGet<{ data: Rental[] }>(`/api/rentals?reservationId=${encodeURIComponent(reservationId)}`),
      ])
      const r = ledger.data.reservation
      setMembers(r.walkIn
        ? [{ id: '', name: r.walkInName }]
        : [...(r.captainName && r.userId ? [{ id: r.userId, name: r.captainName }] : []), ...(r.teamMembers || [])])
      setRentals(list.data)
    } catch (e: any) {
      toast.error(e?.message || 'Reservation not found')
      setRentals([])
    }
  }, [reservationId])

  useEffect(() => {
    loadOutstanding()
    loadInventory()
    void loadReservation()
  }, [loadOutstanding, loadInventory, loadReservation])

  // Pieces already handed out (from the rental records), so they can't be issued twice.
  const outByItemId = useMemo(() => new Map(outstanding.map((rental: any) => [String(rental.itemId || ''), rental])), [outstanding])
  const pieceFree = (item: InventoryOption) => item.status === 'available' && !outByItemId.has(item.id)

  // Category -> item (model) -> piece.
  const categories = useMemo(() => {
    const counts = new Map<string, { total: number; free: number }>()
    for (const item of inventory) {
      const entry = counts.get(item.category) || { total: 0, free: 0 }
      entry.total += 1
      if (pieceFree(item)) entry.free += 1
      counts.set(item.category, entry)
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
    // pieceFree only depends on outByItemId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventory, outByItemId])
  const modelsInCategory = useMemo(() => {
    const counts = new Map<string, { total: number; free: number }>()
    for (const item of inventory.filter((entry) => entry.category === form.category)) {
      const entry = counts.get(item.model) || { total: 0, free: 0 }
      entry.total += 1
      if (pieceFree(item)) entry.free += 1
      counts.set(item.model, entry)
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventory, form.category, outByItemId])
  const piecesOfModel = useMemo(
    () => inventory
      .filter((item) => item.category === form.category && item.model === form.model)
      .sort((a, b) => a.unitNumber - b.unitNumber),
    [inventory, form.category, form.model],
  )

  const issue = async (event: React.FormEvent) => {
    event.preventDefault()
    const item = inventory.find((i) => `${i.collection}:${i.id}` === form.itemKey)
    if (!item) return toast.error('Choose an item.')
    setBusy(true)
    try {
      await apiPost('/api/rentals/issue', {
        reservationId,
        playerName: form.playerName,
        playerId: form.playerId,
        itemCollection: item.collection,
        itemId: item.id,
        unitLabel: form.unitLabel,
      })
      toast.success(`${item.name} issued to ${form.playerName}.`)
      // Keep the category and item picked: staff usually hand out several of the same.
      setForm((f) => ({ ...f, itemKey: '', unitLabel: '' }))
      await loadReservation()
      loadOutstanding()
    } catch (e: any) {
      toast.error(e?.message || 'Could not issue the item')
    } finally {
      setBusy(false)
    }
  }

  const onCheckIn = async (rental: Rental, condition: Condition) => {
    if (await checkInRental(rental, condition)) {
      await loadReservation()
      loadOutstanding()
    }
  }

  const memberOptions = useMemo(() => members.filter((m) => m.name), [members])

  return (
    <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
      <Card className="h-fit p-4">
        <form className="space-y-3" onSubmit={issue}>
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
          {inventoryState === 'loading' ? <div className="text-xs text-muted">Loading inventory…</div> : null}
          {inventoryState === 'error' ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              Could not load the inventory.
              <Button size="xs" variant="ghost" type="button" onClick={loadInventory}>Try again</Button>
            </div>
          ) : null}
          <label className="block">
            <div className="mb-2 text-sm font-semibold">Category</div>
            <select
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value, model: '', itemKey: '', unitLabel: '' }))}
              className={selectClass}
              disabled={inventoryState !== 'ready'}
            >
              <option value="">Choose a category…</option>
              {categories.map(([category, count]) => (
                <option key={category} value={category}>{categoryLabel(category)} ({count.free} of {count.total} free)</option>
              ))}
            </select>
          </label>
          {form.category ? (
            <label className="block">
              <div className="mb-2 text-sm font-semibold">Item</div>
              <select
                value={form.model}
                onChange={(e) => {
                  const model = e.target.value
                  // Pick the first free piece of the item straight away; staff can change it.
                  const first = inventory
                    .filter((item) => item.category === form.category && item.model === model && pieceFree(item))
                    .sort((a, b) => a.unitNumber - b.unitNumber)[0]
                  setForm((f) => ({
                    ...f,
                    model,
                    itemKey: first ? `${first.collection}:${first.id}` : '',
                    unitLabel: first?.unitNumber ? `#${first.unitNumber}` : '',
                  }))
                }}
                className={selectClass}
              >
                <option value="">Choose {categoryLabel(form.category).toLowerCase()}…</option>
                {modelsInCategory.map(([model, count]) => (
                  <option key={model} value={model} disabled={count.free === 0}>{model} ({count.free} of {count.total} free)</option>
                ))}
              </select>
            </label>
          ) : null}
          {form.model ? (
            <label className="block">
              <div className="mb-2 text-sm font-semibold">Piece</div>
              <select
                value={form.itemKey}
                onChange={(e) => {
                  const piece = inventory.find((item) => `${item.collection}:${item.id}` === e.target.value)
                  setForm((f) => ({ ...f, itemKey: e.target.value, unitLabel: piece?.unitNumber ? `#${piece.unitNumber}` : f.unitLabel }))
                }}
                className={selectClass}
              >
                <option value="">Choose a piece…</option>
                {piecesOfModel.map((item) => {
                  const out = outByItemId.get(item.id) as Rental | undefined
                  const reason = out ? `out with ${out.playerName}` : item.status !== 'available' ? item.status.replace('-', ' ') : ''
                  return (
                    <option key={item.id} value={`${item.collection}:${item.id}`} disabled={Boolean(reason)}>
                      {item.name}{item.unitNumber && !item.name.includes('#') ? ` #${item.unitNumber}` : ''} · {item.id}{reason ? ` (${reason})` : ''}
                    </option>
                  )
                })}
              </select>
            </label>
          ) : null}
          <Input label="Unit number / tag" hint="Filled in from the piece. Change it if the tag on the gun or gear differs." value={form.unitLabel} onChange={(e) => setForm((f) => ({ ...f, unitLabel: e.target.value }))} />
          <Button type="submit" className="w-full" disabled={busy || !form.playerName.trim() || !form.itemKey}>
            {busy ? 'Saving…' : 'Issue item'}
          </Button>
        </form>
      </Card>

      <Card className="p-4">
        <div className="text-sm font-bold">Items issued for this game</div>
        <ul className="mt-3 space-y-2">
          {rentals === null ? <li className="text-sm text-muted">Loading…</li>
            : rentals.length === 0 ? <li className="text-sm text-muted">Nothing issued yet.</li>
            : rentals.map((r) => <RentalRow key={r.id} rental={r} onCheckIn={onCheckIn} />)}
        </ul>
      </Card>
    </div>
  )
}
