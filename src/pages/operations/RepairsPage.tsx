import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { FiPlus, FiPrinter, FiTool } from 'react-icons/fi'

import { Card } from '../../components/ui/Card'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { FieldError } from '../../components/ui/FieldError'
import { ItemCombobox } from '../../components/ui/ItemCombobox'
import { apiGet, apiPost, apiPut, apiGetAll } from '../../utils/apiClient'
import { formatDateTime, formatPHP, manilaTodayISO, toInventoryOptions, type InventoryOption } from './shared'

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

const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string))

// Opens the repair-cost summary as a plain black-on-white report and the browser's print dialog
// (where it can also be saved as a PDF). Prints every row, not just the top ones shown on screen.
function printRepairCosts(summary: { byItem: SummaryRow[]; byCategory: SummaryRow[] }, totalSpend: number) {
  const peso = (n: number) => escapeHtml(formatPHP(Number(n || 0)))
  const label = (name: string) => {
    const clean = String(name || '').replace(/_/g, ' ')
    return escapeHtml(clean.charAt(0).toUpperCase() + clean.slice(1))
  }
  const table = (title: string, rows: SummaryRow[]) => `
  <h2>${escapeHtml(title)}</h2>
  <table>
    <thead><tr><th>Name</th><th class="num">Repairs</th><th class="num">Open</th><th class="num">Spend</th></tr></thead>
    <tbody>
      ${rows.length === 0 ? '<tr><td colspan="4" class="muted">No repairs yet.</td></tr>' : rows.map((r) => `
      <tr><td>${label(r.name)}</td><td class="num">${escapeHtml(r.repairs)}</td><td class="num">${escapeHtml(r.open || 0)}</td><td class="num">${peso(r.totalCost)}</td></tr>`).join('')}
    </tbody>
    ${rows.length ? `<tfoot><tr><td>Total</td><td class="num">${rows.reduce((s, r) => s + Number(r.repairs || 0), 0)}</td><td class="num">${rows.reduce((s, r) => s + Number(r.open || 0), 0)}</td><td class="num">${peso(rows.reduce((s, r) => s + Number(r.totalCost || 0), 0))}</td></tr></tfoot>` : ''}
  </table>`

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Repair costs</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; margin: 0; padding: 24px; font-size: 13px; }
  .sheet { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0; }
  h2 { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; margin: 20px 0 6px; }
  .muted { color: #555; }
  .head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #000; padding-bottom: 10px; }
  .spend { text-align: right; }
  .spend b { font-size: 18px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; border-bottom: 1px solid #000; padding: 4px 0; }
  td { padding: 4px 0; border-bottom: 1px dotted #bbb; }
  .num { text-align: right; white-space: nowrap; padding-left: 12px; }
  tfoot td { font-weight: bold; border-top: 2px solid #000; border-bottom: none; }
  .foot { margin-top: 20px; border-top: 1px solid #000; padding-top: 8px; font-size: 11px; }
  @media print { body { padding: 0; } @page { margin: 12mm; } }
</style></head><body><div class="sheet">
  <div class="head">
    <div><h1>Chill Shooters Airsoft</h1><div class="muted">Repair costs report</div></div>
    <div class="spend"><div class="muted">Total spend (completed repairs)</div><b>${peso(totalSpend)}</b></div>
  </div>
  ${table('By model / category', summary.byCategory)}
  ${table('By item', summary.byItem)}
  <div class="foot muted">Printed ${escapeHtml(new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }))}.</div>
</div>
<script>window.onload = function () { window.focus(); window.print(); };</script>
</body></html>`

  const win = window.open('', '_blank', 'width=800,height=900')
  if (!win) {
    toast.error('Allow pop-ups for this site to print the report.')
    return
  }
  win.document.open()
  win.document.write(html)
  win.document.close()
}

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
// `embedded`: shown as the Repairs tab of the Weapons page, which supplies the title.
// `section`: on the Weapons page's Damage & repairs tab the repairs and their costs are separate
// sub-tabs, so it shows one of them; on its own page it shows both.
// `collection`: only weapons' or only gear's repairs (the Weapons and Equipment pages each show their own).
export function RepairsPage({ embedded = false, section = 'all', collection }: { embedded?: boolean; section?: 'all' | 'repairs' | 'costs'; collection?: 'weapons' | 'equipments' } = {}) {
  const scope = collection ? `?collection=${collection}` : ''
  const [repairs, setRepairs] = useState<Repair[]>([])
  const [summary, setSummary] = useState<{ byItem: SummaryRow[]; byCategory: SummaryRow[] }>({ byItem: [], byCategory: [] })
  const [inventory, setInventory] = useState<InventoryOption[]>([])
  const [form, setForm] = useState({ itemKey: '', damage: '', gunsmith: '', damageReportId: '', reservationId: '', playerInduced: false })
  const [completingId, setCompletingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  // One box: type a name (the list narrows as you type and the closest match is filled in) or pick one.
  const itemOptions = inventory.map((item) => ({
    key: `${item.collection}:${item.id}`,
    label: item.name,
    detail: `${item.id} · ${item.category || item.collection}`,
  }))

  const load = useCallback(async () => {
    try {
      const [list, sum] = await Promise.all([
        apiGet<{ data: Repair[] }>(`/api/repairs${scope}`),
        apiGet<{ data: { byItem: SummaryRow[]; byCategory: SummaryRow[] } }>(`/api/repairs/summary${scope}`),
      ])
      setRepairs(list.data)
      setSummary(sum.data)
    } catch (e: any) {
      toast.error(e?.message || 'Could not load repairs')
    }
  }, [scope])

  useEffect(() => {
    void load()
    Promise.all([apiGetAll<any>('weapons').then((data) => ({ ok: true, data })), apiGetAll<any>('equipments').then((data) => ({ ok: true, data }))])
      .then(([w, e]) => setInventory([
        ...(collection === 'equipments' ? [] : toInventoryOptions(w.data || [], 'weapons')),
        ...(collection === 'weapons' ? [] : toInventoryOptions(e.data || [], 'equipments')),
      ]))
      .catch(() => null)
  }, [load, collection])

  const [itemError, setItemError] = useState('')
  const open = async (event: React.FormEvent) => {
    event.preventDefault()
    const item = inventory.find((i) => `${i.collection}:${i.id}` === form.itemKey)
    if (!item) return setItemError('Choose the item.')
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
      setFormOpen(false)
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
      <div className="mt-2 overflow-x-auto">
      <table className="w-full text-sm">
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
    </div>
  )

  return (
    <div className="space-y-4">
      {!embedded ? (
        <div>
          <h1 className="text-3xl font-bold">Repairs</h1>
          <p className="mt-1 text-sm text-muted">Gunsmith repair log: damage, parts replaced, repair date, and cost for each item.</p>
        </div>
      ) : null}

      {section !== 'costs' ? (<>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold"><FiTool /> Repairs</h2>
          <p className="mt-0.5 text-xs text-muted">
            {inProgress.length > 0 ? <span className="font-semibold text-accent">{inProgress.length} in progress</span> : 'Nothing under repair'}
            {' · '}{done.length} completed · {formatPHP(totalSpend)} spent
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setFormOpen(true)}><FiPlus /> Open repair</Button>
      </div>
      <p className="-mt-2 text-xs text-muted">Damage reports open their repair automatically. Use Open repair for wear and tear or anything found during maintenance.</p>

      {formOpen ? (
        <Modal title="Open a repair" eyebrow="Weapons & gear" size="md" onClose={() => setFormOpen(false)}>
          <form className="space-y-3" onSubmit={open}>
            <ItemCombobox
              label="Item"
              placeholder="Type a weapon or gear name, or pick one"
              items={itemOptions}
              selectedKey={form.itemKey}
              onSelect={(item) => { setForm((f) => ({ ...f, itemKey: item?.key || '' })); setItemError('') }}
            />
            <FieldError className="-mt-1">{itemError}</FieldError>
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
        </Modal>
      ) : null}

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
        <div className="text-sm font-bold">Completed repairs ({done.length})</div>
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

      </>) : null}

      {section !== 'repairs' ? (
      <Card className="p-4 md:p-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-sm font-bold">Repair costs</div>
            <div className="text-xs text-muted">Which models and items break most, and what they cost.</div>
          </div>
          <div className="flex items-end gap-3">
            <div className="text-right">
              <div className="text-xs text-muted">Total spend</div>
              <div className="text-lg font-bold text-gold">{formatPHP(totalSpend)}</div>
            </div>
            <Button size="sm" variant="ghost" type="button" onClick={() => printRepairCosts(summary, totalSpend)}>
              <FiPrinter /> Print
            </Button>
          </div>
        </div>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <SummaryTable title="By model / category" rows={summary.byCategory} />
          <SummaryTable title="By item" rows={summary.byItem} />
        </div>
      </Card>
      ) : null}
    </div>
  )
}
