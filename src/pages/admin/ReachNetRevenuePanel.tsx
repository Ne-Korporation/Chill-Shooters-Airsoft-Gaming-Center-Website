import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { FiTrash2 } from 'react-icons/fi'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { apiDelete, apiGet, apiPost } from '../../utils/apiClient'

type NetRevenue = {
  month: string
  collected: number
  paymentCount: number
  penalties: number
  partnerShare: number
  expenses: number
  netRevenue: number
  ratePercent: number | null
  alreadyAllocated: number
  allocation: number
  allocatedEntry: { amount: number; atISO: string; recordedBy?: { actorEmail?: string } } | null
  canAllocate: boolean
}

type Expense = {
  id: string
  dateISO: string
  category: string
  amount: number
  description: string
  vendor?: string
  receiptUrl?: string
  recordedBy?: { actorEmail?: string }
}

const CATEGORY_LABELS: Record<string, string> = {
  repairs_parts: 'Repairs & parts',
  supplies: 'Supplies (BBs, gas, consumables)',
  utilities: 'Utilities',
  rent: 'Field rent',
  salaries: 'Staff pay',
  marketing: 'Marketing',
  other: 'Other',
}

function formatPHP(value: number) {
  return `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

function manilaMonth(offset = 0) {
  const now = new Date(Date.now() + 8 * 3600_000)
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)).toISOString().slice(0, 7)
}

const selectClass = 'w-full rounded-xl border border-white/10 bg-background px-4 py-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/40 [&>option]:bg-background'

// Monthly REACH allocation from net revenue, and the operating expenses that reduce it.
export function ReachNetRevenuePanel({ onAllocated }: { onAllocated: () => void }) {
  const [month, setMonth] = useState(manilaMonth(-1))
  const [data, setData] = useState<NetRevenue | null>(null)
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ dateISO: '', category: 'supplies', amount: '', description: '', vendor: '' })

  const load = useCallback(async () => {
    try {
      const [netRes, expenseRes] = await Promise.all([
        apiGet<{ ok: boolean; data: NetRevenue }>(`/api/reach-fund/net-revenue?month=${month}`),
        apiGet<{ ok: boolean; data: Expense[] }>(`/api/operating-expenses?month=${month}&limit=500`),
      ])
      setData(netRes.data)
      setExpenses(expenseRes.data || [])
    } catch (err: any) {
      toast.error(err?.message || 'Unable to load net revenue')
    }
  }, [month])

  useEffect(() => {
    void load()
    setForm((current) => ({ ...current, dateISO: current.dateISO.startsWith(month) ? current.dateISO : `${month}-01` }))
  }, [load, month])

  const allocate = async () => {
    setSaving(true)
    try {
      const res = await apiPost<{ ok: boolean; data: { amount: number } }>('/api/reach-fund/allocate', { month })
      toast.success(`Allocated ${formatPHP(res.data.amount)} from ${month} net revenue.`)
      onAllocated()
      await load()
    } catch (err: any) {
      toast.error(err?.message || 'Unable to allocate')
    } finally {
      setSaving(false)
    }
  }

  const addExpense = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await apiPost('/api/operating-expenses', { ...form, amount: Number(form.amount) })
      toast.success('Expense recorded.')
      setForm((current) => ({ ...current, amount: '', description: '', vendor: '' }))
      await load()
    } catch (err: any) {
      toast.error(err?.message || 'Unable to record the expense')
    } finally {
      setSaving(false)
    }
  }

  const removeExpense = async (expense: Expense) => {
    if (!window.confirm(`Delete expense ${expense.id} (${formatPHP(expense.amount)})?`)) return
    try {
      await apiDelete(`/api/operating-expenses/${encodeURIComponent(expense.id)}`)
      await load()
    } catch (err: any) {
      toast.error(err?.message || 'Unable to delete the expense')
    }
  }

  const locked = Boolean(data?.allocatedEntry)
  const rows: Array<[string, number, string?]> = data
    ? [
        [`Collected payments (${data.paymentCount})`, data.collected],
        ['Less damage / loss penalties', -data.penalties, 'Reimburse repairs, not revenue'],
        ['Less partner equipment share', -data.partnerShare, 'Owed to equipment partners'],
        ['Less operating expenses', -data.expenses],
      ]
    : []

  return (
    <Card className="p-4 md:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted">Allocation from net revenue</div>
          <p className="mt-1 text-sm text-muted">
            Each finished month, the approved percentage of that month's net revenue moves into the fund. A month is allocated once, and its expenses lock after that.
          </p>
        </div>
        <label className="text-xs text-muted">
          Month
          <input type="month" value={month} max={manilaMonth(0)} onChange={(e) => setMonth(e.target.value)} className="ml-2 rounded-xl border border-white/10 bg-background px-3 py-2 text-sm text-text" />
        </label>
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-white/5">
              {rows.map(([label, amount, hint]) => (
                <tr key={label}>
                  <td className="py-2 pr-4">
                    {label}
                    {hint ? <div className="text-[11px] text-muted">{hint}</div> : null}
                  </td>
                  <td className={`py-2 text-right ${amount < 0 ? 'text-danger' : ''}`}>{amount < 0 ? '−' : ''}{formatPHP(Math.abs(amount))}</td>
                </tr>
              ))}
              {data ? (
                <>
                  <tr className="font-semibold">
                    <td className="py-2 pr-4">Net revenue</td>
                    <td className="py-2 text-right">{formatPHP(data.netRevenue)}</td>
                  </tr>
                  {data.alreadyAllocated > 0 ? (
                    <tr>
                      <td className="py-2 pr-4 text-muted">Already allocated per payment (older method)</td>
                      <td className="py-2 text-right text-muted">−{formatPHP(data.alreadyAllocated)}</td>
                    </tr>
                  ) : null}
                  <tr className="text-base font-bold text-accent">
                    <td className="py-2 pr-4">REACH share{data.ratePercent != null ? ` (${data.ratePercent}%)` : ''}</td>
                    <td className="py-2 text-right">{formatPHP(locked ? data.allocatedEntry!.amount : data.allocation)}</td>
                  </tr>
                </>
              ) : null}
            </tbody>
          </table>
          <div className="mt-3">
            {locked ? (
              <div className="text-xs text-success">
                Allocated {new Date(data!.allocatedEntry!.atISO).toLocaleDateString()} by {data!.allocatedEntry!.recordedBy?.actorEmail || 'admin'}.
              </div>
            ) : data?.ratePercent == null ? (
              <div className="text-xs text-warning">Set the allocation rate first.</div>
            ) : !data?.canAllocate ? (
              <div className="text-xs text-muted">This month isn't over yet. It can be allocated from the 1st of next month.</div>
            ) : (
              <Button onClick={allocate} disabled={saving || !(data.allocation > 0)}>Allocate {formatPHP(data.allocation)} to REACH</Button>
            )}
          </div>
        </div>

        <div>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Operating expenses for {month}</div>
          {!locked ? (
            <form className="mt-2 space-y-2" onSubmit={addExpense}>
              <div className="grid gap-2 sm:grid-cols-3">
                <Input label="Date" type="date" value={form.dateISO} min={`${month}-01`} max={`${month}-31`} onChange={(e) => setForm({ ...form, dateISO: e.target.value })} />
                <label className="block sm:col-span-2">
                  <div className="mb-2 text-sm font-semibold text-text">Category</div>
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={selectClass}>
                    {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <Input label="Amount (₱)" type="number" min={1} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                <div className="sm:col-span-2">
                  <Input label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </div>
              </div>
              <Input label="Vendor (optional)" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
              <Button type="submit" variant="secondary" disabled={saving || !form.amount || !form.description.trim()}>Add expense</Button>
            </form>
          ) : null}
          <ul className="mt-3 divide-y divide-white/5 text-sm">
            {expenses.length === 0 ? <li className="py-2 text-muted">No expenses recorded for this month.</li> : null}
            {expenses.map((expense) => (
              <li key={expense.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="font-semibold">{expense.description}</div>
                  <div className="text-xs text-muted">
                    {expense.dateISO} · {CATEGORY_LABELS[expense.category] || expense.category}{expense.vendor ? ` · ${expense.vendor}` : ''} · {expense.recordedBy?.actorEmail || 'admin'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span>{formatPHP(expense.amount)}</span>
                  {!locked ? (
                    <button type="button" onClick={() => removeExpense(expense)} className="text-muted hover:text-danger" aria-label="Delete expense"><FiTrash2 /></button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  )
}
