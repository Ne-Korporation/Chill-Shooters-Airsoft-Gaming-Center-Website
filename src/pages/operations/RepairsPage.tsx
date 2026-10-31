import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { FiTool } from 'react-icons/fi'

import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { apiGet, apiPost, apiPut } from '../../utils/apiClient'
import { formatDateTime, formatPHP, manilaTodayISO, selectClass, toInventoryOptions, type InventoryOption } from './shared'

type Repair = {
  id: string
  itemName: string
  itemCategory: string
  damage: string
  gunsmith: string
  status: 'in_progress' | 'completed'
  partsReplaced?: string
  partsCost?: number
  laborCost?: number
  totalCost?: number
  repairDate?: string
  openedAtISO: string
  playerInduced?: boolean
  reservationId?: string
  damageReportId?: string
  penaltyAmount?: number
}

type SummaryRow = { name: string; repairs: number; totalCost: number; open: number }

function CompleteRepairForm({ repair, onDone }: { repair: Repair; onDone: () => void }) {
  const [form, setForm] = useState({
    partsReplaced: '',
    partsCost: '0',
    laborCost: '0',
    repairDate: manilaTodayISO(),
    note: '',
    returnToService: true,
    playerInduced: repair.playerInduced === true,
    reservationId: repair.reservationId || '',
    penaltyAmount: '',
    overrideReason: '',
  })
  const [saving, setSaving] = useState(false)
  const [handlingFeePercent, setHandlingFeePercent] = useState(0)
  useEffect(() => {
    apiGet<{ ok: boolean; data: { handlingFeePercent: number } }>('/api/penalty-rules')
      .then((res) => setHandlingFeePercent(Number(res.data.handlingFeePercent) || 0))
      .catch(() => null)
  }, [])
  const repairCost = (Number(form.partsCost) || 0) + (Number(form.laborCost) || 0)
  // Penalty rule: repair cost plus the admin-set handling fee.
  const handlingFee = Math.round(repairCost * handlingFeePercent) / 100
  const rulePenalty = Math.round((repairCost + handlingFee) * 100) / 100
  const overriding = form.penaltyAmount !== '' && Number(form.penaltyAmount) !== rulePenalty
  const billed = form.penaltyAmount !== '' ? Number(form.penaltyAmount) : rulePenalty

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await apiPut(`/api/repairs/${encodeURIComponent(repair.id)}/complete`, {
        ...form,
        partsCost: Number(form.partsCost),
        laborCost: Number(form.laborCost),
        reservationId: form.reservationId.trim(),
        penaltyAmount: form.penaltyAmount === '' ? undefined : Number(form.penaltyAmount),
      })
      toast.success(form.playerInduced && billed > 0
        ? `${repair.itemName} repaired. ₱${billed.toLocaleString()} was added to the player's bill.`
        : `${repair.itemName} repair closed.`)
      onDone()
    } catch (e: any) {
      toast.error(e?.message || 'Could not close the repair')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={submit}>
      <div className="sm:col-span-2">
        <Input label="Parts replaced" value={form.partsReplaced} onChange={(e) => setForm((f) => ({ ...f, partsReplaced: e.target.value }))} placeholder="e.g. Gearbox shell, piston" />
      </div>
      <Input label="Parts cost (₱)" type="number" min={0} value={form.partsCost} onChange={(e) => setForm((f) => ({ ...f, partsCost: e.target.value }))} />
      <Input label="Labor cost (₱)" type="number" min={0} value={form.laborCost} onChange={(e) => setForm((f) => ({ ...f, laborCost: e.target.value }))} />
      <Input label="Repair date" type="date" value={form.repairDate} onChange={(e) => setForm((f) => ({ ...f, repairDate: e.target.value }))} />
      <label className="flex items-center gap-2 self-end pb-3 text-sm">
        <input type="checkbox" checked={form.returnToService} onChange={(e) => setForm((f) => ({ ...f, returnToService: e.target.checked }))} className="h-4 w-4 accent-[var(--color-accent)]" />
        Return to rental pool
      </label>
      <label className="flex items-start gap-2 text-sm sm:col-span-2">
        <input type="checkbox" checked={form.playerInduced} onChange={(e) => setForm((f) => ({ ...f, playerInduced: e.target.checked }))} className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]" />
        <span>Damage was caused by a player — bill the repair cost to their reservation</span>
      </label>
      {form.playerInduced ? (
        <div className="sm:col-span-2">
          <Input
            label="Reservation ID of the player"
            value={form.reservationId}
            onChange={(e) => setForm((f) => ({ ...f, reservationId: e.target.value }))}
            placeholder={repair.damageReportId ? `Leave blank to use damage report ${repair.damageReportId}` : 'R-…'}
          />
          <div className="mt-2 space-y-0.5 rounded-xl border border-white/10 bg-white/5 p-3 text-xs">
            <div className="flex justify-between text-muted"><span>Repair cost (parts + labor)</span><span>₱{repairCost.toLocaleString()}</span></div>
            {handlingFee > 0 ? (
              <div className="flex justify-between text-muted"><span>Handling fee ({handlingFeePercent}%)</span><span>₱{handlingFee.toLocaleString()}</span></div>
            ) : null}
            <div className="flex justify-between font-semibold"><span>Rule-based penalty</span><span>₱{rulePenalty.toLocaleString()}</span></div>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Input
              label="Bill a different amount (optional)"
              type="number"
              min={1}
              value={form.penaltyAmount}
              onChange={(e) => setForm((f) => ({ ...f, penaltyAmount: e.target.value }))}
            />
            {overriding ? (
              <Input label="Reason for this amount" value={form.overrideReason} onChange={(e) => setForm((f) => ({ ...f, overrideReason: e.target.value }))} />
            ) : null}
          </div>
          <div className="mt-1 text-xs text-muted">
            {billed > 0 ? `₱${billed.toLocaleString()} will be added to this reservation's balance as a repair penalty.` : 'Enter the parts and labor cost to bill the player.'}
          </div>
        </div>
      ) : null}
      <div className="sm:col-span-2">
        <Button type="submit" className="w-full" disabled={saving}>{saving ? 'Saving…' : 'Mark repaired'}</Button>
      </div>
    </form>
  )
}

// The gunsmith's log: open a repair (pulls the item from rental), record parts and cost when
// it's fixed, and see which models break most and what they cost.
export function RepairsPage() {
  const [repairs, setRepairs] = useState<Repair[]>([])
  const [summary, setSummary] = useState<{ byItem: SummaryRow[]; byCategory: SummaryRow[] }>({ byItem: [], byCategory: [] })
  const [inventory, setInventory] = useState<InventoryOption[]>([])
  const [form, setForm] = useState({ itemKey: '', damage: '', gunsmith: '', damageReportId: '', reservationId: '', playerInduced: false })
  const [completingId, setCompletingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // The item dropdown narrows with every letter typed in the search box above it.
  const [itemSearch, setItemSearch] = useState('')
  const matchingItems = (text: string) => {
    const needle = text.trim().toLowerCase()
    if (!needle) return inventory
    return inventory.filter((item) => [item.name, item.id, item.category, item.collection].some((value) => String(value || '').toLowerCase().includes(needle)))
  }
  // The chosen item stays listed even when it no longer matches the search.
  const shownItems = (() => {
    const matches = matchingItems(itemSearch)
    const chosen = inventory.find((item) => `${item.collection}:${item.id}` === form.itemKey)
    return chosen && !matches.includes(chosen) ? [chosen, ...matches] : matches
  })()

  const load = useCallback(async () => {
    try {
      const [list, sum] = await Promise.all([
        apiGet<{ data: Repair[] }>('/api/repairs'),
        apiGet<{ data: { byItem: SummaryRow[]; byCategory: SummaryRow[] } }>('/api/repairs/summary'),
      ])
      setRepairs(list.data)
      setSummary(sum.data)
    } catch (e: any) {
      toast.error(e?.message || 'Could not load repairs')
    }
  }, [])

  useEffect(() => {
    void load()
    Promise.all([apiGet<{ data: any[] }>('/api/weapons?limit=200'), apiGet<{ data: any[] }>('/api/equipments?limit=200')])
      .then(([w, e]) => setInventory([...toInventoryOptions(w.data || [], 'weapons'), ...toInventoryOptions(e.data || [], 'equipments')]))
      .catch(() => null)
  }, [load])

  const open = async (event: React.FormEvent) => {
    event.preventDefault()
    const item = inventory.find((i) => `${i.collection}:${i.id}` === form.itemKey)
    if (!item) return toast.error('Choose the item.')
    setSaving(true)
    try {
      await apiPost('/api/repairs', {
        itemCollection: item.collection,
        itemId: item.id,
        damage: form.damage,
        gunsmith: form.gunsmith,
        damageReportId: form.damageReportId,
        reservationId: form.reservationId.trim(),
        playerInduced: form.playerInduced,
      })

      toast.success(`${item.name} is now under repair.`)
      setForm({ itemKey: '', damage: '', gunsmith: form.gunsmith, damageReportId: '', reservationId: '', playerInduced: false })
      setItemSearch('')
      await load()
    } catch (e: any) {
      toast.error(e?.message || 'Could not open the repair')
    } finally {
      setSaving(false)
    }
  }

  const inProgress = repairs.filter((r) => r.status === 'in_progress')
  const done = repairs.filter((r) => r.status === 'completed')
  const totalSpend = done.reduce((sum, r) => sum + Number(r.totalCost || 0), 0)

  const SummaryTable = ({ title, rows }: { title: string; rows: SummaryRow[] }) => (
    <div>
      <div className="text-xs uppercase tracking-widest text-muted">{title}</div>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted"><th className="py-1 font-medium">Name</th><th className="font-medium">Repairs</th><th className="text-right font-medium">Spend</th></tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={3} className="py-1 text-xs text-muted">No repairs yet.</td></tr> : rows.slice(0, 8).map((row) => (
            <tr key={row.name} className="border-t border-white/5">
              <td className="py-1 capitalize">{row.name}</td>
              <td>{row.repairs}{row.open ? ` (${row.open} open)` : ''}</td>
              <td className="text-right">{formatPHP(row.totalCost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">Repairs</h1>
        <p className="mt-1 text-sm text-muted">Gunsmith repair log: damage, parts replaced, repair date, and cost for each item.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <Card className="h-fit p-4 md:p-5">
          <div className="flex items-center gap-2 text-sm font-bold"><FiTool /> Open a repair</div>
          <form className="mt-3 space-y-3" onSubmit={open}>
            <div>
              <div className="mb-2 text-sm font-semibold">Item</div>
              <input
                value={itemSearch}
                onChange={(e) => {
                  const next = e.target.value
                  setItemSearch(next)
                  // One match left: pick it, so typing the name is enough.
                  const matches = matchingItems(next)
                  if (next.trim() && matches.length === 1) setForm((f) => ({ ...f, itemKey: `${matches[0].collection}:${matches[0].id}` }))
                }}
                placeholder="Search by name, ID, or category…"
                aria-label="Search items"
                className={`${selectClass} mb-2`}
              />
              <select value={form.itemKey} onChange={(e) => setForm((f) => ({ ...f, itemKey: e.target.value }))} className={selectClass} aria-label="Item">
                <option value="">{itemSearch.trim() ? `Choose… (${shownItems.length} match${shownItems.length === 1 ? '' : 'es'})` : 'Choose…'}</option>
                {shownItems.map((item) => <option key={`${item.collection}:${item.id}`} value={`${item.collection}:${item.id}`}>{item.name} ({item.category || item.collection})</option>)}
              </select>
            </div>
            <Input label="Damage" value={form.damage} onChange={(e) => setForm((f) => ({ ...f, damage: e.target.value }))} placeholder="e.g. Cracked gearbox" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Gunsmith" value={form.gunsmith} onChange={(e) => setForm((f) => ({ ...f, gunsmith: e.target.value }))} />
              <Input label="Damage report ID (optional)" value={form.damageReportId} onChange={(e) => setForm((f) => ({ ...f, damageReportId: e.target.value }))} placeholder="DMG-…" />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={form.playerInduced} onChange={(e) => setForm((f) => ({ ...f, playerInduced: e.target.checked }))} className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]" />
              <span>Caused by a player — the repair cost is billed to them when the repair is completed</span>
            </label>
            {form.playerInduced ? (
              <Input
                label="Reservation ID (optional if the damage report is linked)"
                value={form.reservationId}
                onChange={(e) => setForm((f) => ({ ...f, reservationId: e.target.value }))}
                placeholder="R-…"
              />
            ) : null}
            <Button type="submit" className="w-full" disabled={saving || !form.itemKey || !form.damage.trim()}>
              {saving ? 'Saving…' : 'Open repair'}
            </Button>
          </form>
        </Card>

        <Card className="p-4 md:p-5">
          <div className="flex items-end justify-between gap-3">
            <div className="text-sm font-bold">Repair costs</div>
            <div className="text-right">
              <div className="text-xs text-muted">Total spend</div>
              <div className="text-lg font-bold text-gold">{formatPHP(totalSpend)}</div>
            </div>
          </div>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <SummaryTable title="By model / category" rows={summary.byCategory} />
            <SummaryTable title="By item" rows={summary.byItem} />
          </div>
        </Card>
      </div>

      <Card className="p-4 md:p-5">
        <div className="text-sm font-bold">In progress ({inProgress.length})</div>
        <ul className="mt-3 space-y-2">
          {inProgress.length === 0 ? <li className="text-sm text-muted">Nothing under repair.</li> : inProgress.map((repair) => (
            <li key={repair.id} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-semibold">{repair.itemName} · {repair.id}</div>
                  <div className="text-[11px] text-muted">{repair.damage}{repair.gunsmith ? ` · ${repair.gunsmith}` : ''} · opened {formatDateTime(repair.openedAtISO)}</div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setCompletingId(completingId === repair.id ? null : repair.id)}>
                  {completingId === repair.id ? 'Cancel' : 'Mark repaired'}
                </Button>
              </div>
              {completingId === repair.id ? <CompleteRepairForm repair={repair} onDone={() => { setCompletingId(null); void load() }} /> : null}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-4 md:p-5">
        <div className="text-sm font-bold">Repair history</div>
        <ul className="mt-3 space-y-2">
          {done.length === 0 ? <li className="text-sm text-muted">No completed repairs yet.</li> : done.map((repair) => (
            <li key={repair.id} className="flex flex-col gap-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold">{repair.itemName} · {repair.repairDate}</div>
                <div className="text-[11px] text-muted">{repair.damage}{repair.partsReplaced ? ` · Parts: ${repair.partsReplaced}` : ''}{repair.gunsmith ? ` · ${repair.gunsmith}` : ''}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold">{formatPHP(Number(repair.totalCost || 0))}</div>
                {Number(repair.penaltyAmount || 0) > 0 ? (
                  <div className="text-[11px] text-warning">Billed to player · {repair.reservationId}</div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
