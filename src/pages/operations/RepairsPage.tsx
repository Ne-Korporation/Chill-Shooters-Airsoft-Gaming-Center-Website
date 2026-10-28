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
}

type SummaryRow = { name: string; repairs: number; totalCost: number; open: number }

function CompleteRepairForm({ repair, onDone }: { repair: Repair; onDone: () => void }) {
  const [form, setForm] = useState({ partsReplaced: '', partsCost: '0', laborCost: '0', repairDate: manilaTodayISO(), note: '', returnToService: true })
  const [saving, setSaving] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await apiPut(`/api/repairs/${encodeURIComponent(repair.id)}/complete`, {
        ...form,
        partsCost: Number(form.partsCost),
        laborCost: Number(form.laborCost),
      })
      toast.success(`${repair.itemName} repair closed.`)
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
  const [form, setForm] = useState({ itemKey: '', damage: '', gunsmith: '', damageReportId: '' })
  const [completingId, setCompletingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

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
      await apiPost('/api/repairs', { itemCollection: item.collection, itemId: item.id, damage: form.damage, gunsmith: form.gunsmith, damageReportId: form.damageReportId })
      toast.success(`${item.name} is now under repair.`)
      setForm({ itemKey: '', damage: '', gunsmith: form.gunsmith, damageReportId: '' })
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
            <label className="block">
              <div className="mb-2 text-sm font-semibold">Item</div>
              <select value={form.itemKey} onChange={(e) => setForm((f) => ({ ...f, itemKey: e.target.value }))} className={selectClass}>
                <option value="">Choose…</option>
                {inventory.map((item) => <option key={`${item.collection}:${item.id}`} value={`${item.collection}:${item.id}`}>{item.name} ({item.category || item.collection})</option>)}
              </select>
            </label>
            <Input label="Damage" value={form.damage} onChange={(e) => setForm((f) => ({ ...f, damage: e.target.value }))} placeholder="e.g. Cracked gearbox" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Gunsmith" value={form.gunsmith} onChange={(e) => setForm((f) => ({ ...f, gunsmith: e.target.value }))} />
              <Input label="Damage report ID (optional)" value={form.damageReportId} onChange={(e) => setForm((f) => ({ ...f, damageReportId: e.target.value }))} placeholder="DMG-…" />
            </div>
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
              <div className="text-sm font-semibold">{formatPHP(Number(repair.totalCost || 0))}</div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
