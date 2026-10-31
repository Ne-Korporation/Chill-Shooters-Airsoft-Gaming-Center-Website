import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { FiHeart } from 'react-icons/fi'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { apiGet, apiPost, apiPut } from '../../utils/apiClient'
import { ReachNetRevenuePanel } from './ReachNetRevenuePanel'
import { ReachProgramsCard, type ReachProgram } from './ReachProgramsCard'

type Summary = {
  ratePercent: number | null
  rateUpdatedAtISO: string | null
  allocated: number
  donations: number
  spent: number
  balance: number
}

type LedgerEntry = {
  _id?: string
  type: 'allocation' | 'donation' | 'expenditure'
  amount: number
  description: string
  donorName?: string
  programId?: string
  dateISO?: string
  atISO: string
  recordedBy?: { actorEmail?: string }
}

function formatPHP(value: number) {
  return `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

const TYPE_STYLES: Record<LedgerEntry['type'], string> = {
  allocation: 'text-accent',
  donation: 'text-success',
  expenditure: 'text-danger',
}

export function AdminReachFundPage() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [rateInput, setRateInput] = useState('')
  const [entryForm, setEntryForm] = useState({ type: 'expenditure', amount: '', description: '', donorName: '', dateISO: '', programId: '' })
  const [programs, setPrograms] = useState<ReachProgram[]>([])

  const load = useCallback(async () => {
    try {
      const [res, programRes] = await Promise.all([
        apiGet<{ ok: boolean; summary: Summary; data: LedgerEntry[] }>('/api/reach-fund'),
        apiGet<{ ok: boolean; data: ReachProgram[] }>('/api/reach-programs'),
      ])
      setPrograms(programRes.data || [])
      setSummary(res.summary)
      setEntries(res.data || [])
      setRateInput(res.summary?.ratePercent == null ? '' : String(res.summary.ratePercent))
    } catch (err: any) {
      toast.error(err?.message || 'Unable to load the REACH fund')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const saveRate = async () => {
    setSaving(true)
    try {
      await apiPut('/api/reach-fund/settings', { ratePercent: Number(rateInput) })
      toast.success('Allocation rate saved.')
      await load()
    } catch (err: any) {
      toast.error(err?.message || 'Unable to save rate')
    } finally {
      setSaving(false)
    }
  }

  const addEntry = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await apiPost('/api/reach-fund/entries', { ...entryForm, amount: Number(entryForm.amount) })
      toast.success(entryForm.type === 'donation' ? 'Donation recorded.' : 'Expenditure recorded.')
      setEntryForm((c) => ({ ...c, amount: '', description: '', donorName: '', programId: '' }))
      await load()
    } catch (err: any) {
      toast.error(err?.message || 'Unable to record entry')
    } finally {
      setSaving(false)
    }
  }

  const tiles = summary
    ? [
        { label: 'Fund balance', value: formatPHP(summary.balance), tone: 'text-success' },
        { label: 'Allocated from revenue', value: formatPHP(summary.allocated), tone: 'text-accent' },
        { label: 'Donations received', value: formatPHP(summary.donations), tone: 'text-success' },
        { label: 'Spent on outreach', value: formatPHP(summary.spent), tone: 'text-danger' },
      ]
    : []

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold"><FiHeart /> REACH Fund</h1>
        <p className="mt-1 text-sm text-muted">
          Community outreach fund, kept in its own ledger and never counted as operating revenue. Spending can't exceed the fund balance.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {tiles.map((tile) => (
          <Card key={tile.label} className="p-4">
            <div className="text-xs uppercase tracking-widest text-muted">{tile.label}</div>
            <div className={`mt-2 text-2xl font-bold ${tile.tone}`}>{loading ? '…' : tile.value}</div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4 md:p-5">
          <div className="text-xs uppercase tracking-widest text-muted">Allocation rate</div>
          <p className="mt-2 text-sm text-muted">
            The owner-approved percentage of each month's net revenue that goes into the fund.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="w-40">
              <Input
                label="Rate (%)"
                type="number"
                min={0}
                max={100}
                step="0.1"
                value={rateInput}
                placeholder="Not set"
                onChange={(e) => setRateInput(e.target.value)}
              />
            </div>
            <Button variant="secondary" onClick={saveRate} disabled={saving || rateInput === ''}>Save rate</Button>
          </div>
          {summary?.ratePercent == null ? (
            <div className="mt-2 text-xs text-warning">No rate set yet. Enter the percentage approved by the owner.</div>
          ) : null}
        </Card>

        <Card className="p-4 md:p-5">
          <div className="text-xs uppercase tracking-widest text-muted">Record donation or expenditure</div>
          <form className="mt-3 space-y-3" onSubmit={addEntry}>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <div className="mb-2 text-sm font-semibold text-text">Type</div>
                <select
                  value={entryForm.type}
                  onChange={(e) => setEntryForm((c) => ({ ...c, type: e.target.value }))}
                  className="w-full rounded-xl border border-white/10 bg-background px-4 py-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/40 [&>option]:bg-background"
                >
                  <option value="expenditure">Expenditure</option>
                  <option value="donation">Donation</option>
                </select>
              </label>
              <Input label="Amount (₱)" type="number" min={1} value={entryForm.amount} onChange={(e) => setEntryForm((c) => ({ ...c, amount: e.target.value }))} />
              <Input label="Date" type="date" value={entryForm.dateISO} onChange={(e) => setEntryForm((c) => ({ ...c, dateISO: e.target.value }))} />
            </div>
            {entryForm.type === 'donation' ? (
              <Input label="Donor (optional)" value={entryForm.donorName} onChange={(e) => setEntryForm((c) => ({ ...c, donorName: e.target.value }))} />
            ) : (
              <label className="block">
                <div className="mb-2 text-sm font-semibold text-text">Outreach program (optional)</div>
                <select
                  value={entryForm.programId}
                  onChange={(e) => setEntryForm((c) => ({ ...c, programId: e.target.value }))}
                  className="w-full rounded-xl border border-white/10 bg-background px-4 py-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/40 [&>option]:bg-background"
                >
                  <option value="">Not linked to a program</option>
                  {programs.map((program) => <option key={program.id} value={program.id}>{program.title} ({program.dateISO})</option>)}
                </select>
              </label>
            )}
            <Input
              label="Description"
              placeholder={entryForm.type === 'donation' ? 'e.g. Sponsor donation for school outreach' : 'e.g. Supplies for barangay outreach day'}
              value={entryForm.description}
              onChange={(e) => setEntryForm((c) => ({ ...c, description: e.target.value }))}
            />
            <Button type="submit" disabled={saving || !entryForm.amount || !entryForm.description.trim()}>Record</Button>
          </form>
        </Card>
      </div>

      <ReachNetRevenuePanel onAllocated={() => void load()} />

      <ReachProgramsCard programs={programs} onChanged={() => void load()} />

      <Card className="p-4 md:p-5">
        <div className="text-xs uppercase tracking-widest text-muted">Ledger</div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-widest text-muted">
              <tr>
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4">Description</th>
                <th className="py-2 pr-4">Recorded by</th>
                <th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {!loading && entries.length === 0 ? (
                <tr><td colSpan={5} className="py-3 text-muted">No ledger entries yet.</td></tr>
              ) : null}
              {entries.map((entry, index) => (
                <tr key={entry._id || index}>
                  <td className="py-2 pr-4">{entry.dateISO || entry.atISO.slice(0, 10)}</td>
                  <td className={`py-2 pr-4 capitalize ${TYPE_STYLES[entry.type]}`}>{entry.type}</td>
                  <td className="py-2 pr-4">
                    {entry.description}{entry.donorName ? ` (${entry.donorName})` : ''}
                    {entry.programId ? (
                      <div className="text-[11px] text-muted">Program: {programs.find((p) => p.id === entry.programId)?.title || entry.programId}</div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-4 text-muted">{entry.recordedBy?.actorEmail || '-'}</td>
                  <td className="py-2 text-right">{entry.type === 'expenditure' ? '−' : '+'}{formatPHP(entry.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
