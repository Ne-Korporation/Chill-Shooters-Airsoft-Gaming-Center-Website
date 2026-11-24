import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { FiHeart, FiPlusCircle } from 'react-icons/fi'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { apiGet, apiPost } from '../../utils/apiClient'
import { confirmDialog } from '../../components/ui/ConfirmDialog'

type Summary = {
  ratePercent: number | null
  rateUpdatedAtISO: string | null
  // Monthly allocations from net revenue: how the fund used to be filled, kept as history.
  allocated: number
  fromCauses: number
  donations: number
  spent: number
  balance: number
}

type LedgerEntry = {
  _id?: string
  type: 'allocation' | 'cause_day' | 'donation' | 'expenditure'
  amount: number
  description: string
  donorName?: string
  dateISO?: string
  atISO: string
  recordedBy?: { actorEmail?: string }
}

function formatPHP(value: number) {
  return `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

// One game for a cause: what it raised from collected payments and how much is in the fund.
type CauseDayRow = {
  dateISO: string
  title: string
  beneficiary: string
  donationPercent: number
  bookings: number
  players: number
  collected: number
  donation: number
  expected: number
  added: number
  toAdd: number
  finished: boolean
}

const TYPE_STYLES: Record<LedgerEntry['type'], string> = {
  allocation: 'text-accent',
  cause_day: 'text-accent',
  donation: 'text-success',
  expenditure: 'text-danger',
}

const TYPE_LABELS: Record<LedgerEntry['type'], string> = {
  allocation: 'Allocation (earlier)',
  cause_day: 'Game for a cause',
  donation: 'Donation',
  expenditure: 'Expenditure',
}

function longDate(dateISO: string) {
  const date = new Date(`${dateISO}T12:00:00`)
  return Number.isNaN(date.getTime()) ? dateISO : date.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

export function AdminReachFundPage() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [causeDays, setCauseDays] = useState<CauseDayRow[]>([])
  const [addingDay, setAddingDay] = useState<string | null>(null)
  const [entryForm, setEntryForm] = useState({ type: 'expenditure', amount: '', description: '', donorName: '', dateISO: '' })

  const load = useCallback(async () => {
    try {
      const [res, causeRes] = await Promise.all([
        apiGet<{ ok: boolean; summary: Summary; data: LedgerEntry[] }>('/api/reach-fund'),
        apiGet<{ ok: boolean; data: CauseDayRow[] }>('/api/reach-fund/cause-days'),
      ])
      setSummary(res.summary)
      setEntries(res.data || [])
      setCauseDays(causeRes.data || [])
    } catch (err: any) {
      toast.error(err?.message || 'Unable to load the donation fund')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Moves a finished cause day's donation share (what's not in the fund yet) into the fund.
  const addCauseDay = async (day: CauseDayRow) => {
    const ok = await confirmDialog({
      title: `Add ${formatPHP(day.toAdd)} to the fund?`,
      message: `${day.donationPercent}% of the ${formatPHP(day.collected)} collected for "${day.title}" on ${longDate(day.dateISO)}${day.added > 0 ? `, on top of the ${formatPHP(day.added)} already added` : ''}.`,
      confirmLabel: 'Add to fund',
    })
    if (!ok) return
    setAddingDay(day.dateISO)
    try {
      await apiPost(`/api/reach-fund/cause-days/${encodeURIComponent(day.dateISO)}/add`, {})
      toast.success(`${formatPHP(day.toAdd)} added to the donation fund.`)
      await load()
    } catch (err: any) {
      toast.error(err?.message || 'Unable to add it to the fund')
    } finally {
      setAddingDay(null)
    }
  }

  const addEntry = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await apiPost('/api/reach-fund/entries', { ...entryForm, amount: Number(entryForm.amount) })
      toast.success(entryForm.type === 'donation' ? 'Donation recorded.' : 'Expenditure recorded.')
      setEntryForm((c) => ({ ...c, amount: '', description: '', donorName: '' }))
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
        { label: 'From games for a cause', value: formatPHP(summary.fromCauses), tone: 'text-accent' },
        { label: 'Donations received', value: formatPHP(summary.donations), tone: 'text-success' },
        { label: 'Spent on outreach', value: formatPHP(summary.spent), tone: 'text-danger' },
      ]
    : []

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold"><FiHeart /> Donation Fund</h1>
        <p className="mt-1 text-sm text-muted">
          Community outreach fund, filled by games for a cause and outside donations. It's kept in its own ledger, and spending can't exceed the fund balance.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-2 xl:grid-cols-4">
        {tiles.map((tile) => (
          <Card key={tile.label} className="rounded-xl px-3 py-2 md:px-3 md:py-2">
            <div className="truncate text-[10px] uppercase tracking-wider text-muted">{tile.label}</div>
            <div className={`mt-0.5 text-base font-bold ${tile.tone}`}>{loading ? '…' : tile.value}</div>
          </Card>
        ))}
      </div>

      {summary && summary.allocated > 0 ? (
        <p className="-mt-2 text-xs text-muted">Includes {formatPHP(summary.allocated)} allocated from monthly revenue before the fund moved to games for a cause.</p>
      ) : null}

      {/* Where the fund's money comes from: each game for a cause, once the day is over. */}
      <Card className="p-4 md:p-5">
        <div className="text-xs uppercase tracking-widest text-muted">Games for a cause</div>
        <p className="mt-1 text-sm text-muted">
          Each day's donation share of the payments collected for its bookings. Add it to the fund once the day is over; payments collected later can be added the same way.
        </p>
        {loading ? (
          <div className="mt-3 text-sm text-muted">Loading games for a cause…</div>
        ) : causeDays.length === 0 ? (
          <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-muted">
            No games for a cause yet. Mark a day as a game for a cause on the capacity calendar, and its donation shows here after the day.
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-white/5">
            {causeDays.map((day) => (
              <li key={day.dateISO} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{day.title}{day.beneficiary ? <span className="font-normal text-muted"> · for {day.beneficiary}</span> : null}</div>
                  <div className="mt-0.5 text-xs text-muted">
                    {longDate(day.dateISO)} · {day.bookings} booking{day.bookings === 1 ? '' : 's'}, {day.players} player{day.players === 1 ? '' : 's'} · {day.donationPercent}% of {formatPHP(day.collected)} collected
                  </div>
                  {day.expected > day.donation ? (
                    <div className="mt-0.5 text-[11px] text-warning">{formatPHP(day.expected - day.donation)} more once the remaining balances are paid.</div>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
                  <div className="text-sm"><span className="font-bold text-accent">{formatPHP(day.donation)}</span> <span className="text-xs text-muted">raised</span></div>
                  {!day.finished ? (
                    <span className="text-[11px] text-muted">Today: add it once the day is over</span>
                  ) : day.toAdd > 0 ? (
                    <Button size="xs" variant="accent-soft" disabled={addingDay === day.dateISO} onClick={() => void addCauseDay(day)}>
                      <FiPlusCircle /> {addingDay === day.dateISO ? 'Adding…' : `Add ${formatPHP(day.toAdd)} to fund`}
                    </Button>
                  ) : day.donation > 0 ? (
                    <span className="text-[11px] font-semibold text-success">In the fund</span>
                  ) : (
                    <span className="text-[11px] text-muted">Nothing collected</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div>
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
            ) : null}
            <Input
              label="Description"
              placeholder={entryForm.type === 'donation' ? 'e.g. Sponsor donation for the cause' : 'e.g. Relief goods handed to the beneficiary'}
              value={entryForm.description}
              onChange={(e) => setEntryForm((c) => ({ ...c, description: e.target.value }))}
            />
            <Button type="submit" disabled={saving || !entryForm.amount || !entryForm.description.trim()}>Record</Button>
          </form>
        </Card>
      </div>

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
                  <td className={`py-2 pr-4 ${TYPE_STYLES[entry.type] || ''}`}>{TYPE_LABELS[entry.type] || entry.type}</td>
                  <td className="py-2 pr-4">
                    {entry.description}{entry.donorName ? ` (${entry.donorName})` : ''}
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
