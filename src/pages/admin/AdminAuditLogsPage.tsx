import React, { useCallback, useEffect, useState } from 'react'
import { FiChevronDown, FiChevronRight, FiRefreshCw, FiSearch } from 'react-icons/fi'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { FilterTabs, titleCaseLabel } from '../../components/ui/FilterTabs'
import { Pagination } from '../../components/ui/Pagination'
import { apiGet } from '../../utils/apiClient'

type AuditSeverity = 'info' | 'warning' | 'critical'

type AuditEntry = {
  id: string
  module: string
  action: string
  label: string
  severity: AuditSeverity
  resourceType?: string
  resourceId?: string
  summary?: string
  actorId: string
  actorRole: string
  actorName?: string
  actorEmail?: string
  method?: string
  path?: string
  details?: Record<string, unknown>
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  ip?: string
  createdAtISO: string
}

type AuditResponse = {
  data: AuditEntry[]
  total: number
  page: number
  limit: number
  counts: { total: number; critical: number; today: number; lastAtISO: string | null; byModule: Record<string, number> }
  actors: Array<{ id: string; name: string; role: string }>
}

const PAGE_SIZE = 50

// The modules, in the order the tabs show them.
const MODULES: Array<[string, string]> = [
  ['all', 'All'],
  ['payment', 'Payments'],
  ['reservation', 'Reservations'],
  ['player', 'Players'],
  ['staff', 'Staff'],
  ['account', 'Accounts'],
  ['weapon', 'Weapons'],
  ['gear', 'Gear'],
  ['operations', 'Field ops'],
  ['package', 'Packages'],
  ['waiver', 'Waivers'],
  ['calendar', 'Calendar'],
  ['finance', 'Finance'],
  ['settings', 'Settings'],
  ['other', 'Other'],
]
const moduleLabel = (value: string) => MODULES.find(([key]) => key === value)?.[1] || titleCaseLabel(value)

const severityClass: Record<AuditSeverity, string> = {
  info: 'border-white/10 bg-white/5 text-muted',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  critical: 'border-danger/30 bg-danger/15 text-danger',
}

const formatWhen = (iso?: string | null) => (iso
  ? new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })
  : '—')

function relative(iso?: string | null) {
  if (!iso) return 'No activity yet'
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.floor(hours / 24)} d ago`
}

const show = (value: unknown) => {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

// The expanded view of one entry: what changed (before → after), the details sent, and where from.
function EntryDetails({ entry }: { entry: AuditEntry }) {
  const changedKeys = [...new Set([...Object.keys(entry.before || {}), ...Object.keys(entry.after || {})])]
  const details = Object.entries(entry.details || {}).filter(([, value]) => value !== '' && value !== undefined && value !== null)
  return (
    <div className="space-y-3 border-t border-white/5 bg-black/20 px-4 py-3 text-xs">
      {changedKeys.length ? (
        <div>
          <div className="mb-1 font-semibold uppercase tracking-wider text-muted">Changes</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px]">
              <thead className="text-left text-muted">
                <tr><th className="py-1 pr-3 font-medium">Field</th><th className="py-1 pr-3 font-medium">Before</th><th className="py-1 font-medium">After</th></tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {changedKeys.map((key) => (
                  <tr key={key}>
                    <td className="py-1 pr-3 font-mono text-muted">{key}</td>
                    <td className="break-all py-1 pr-3 text-danger/90">{show(entry.before?.[key])}</td>
                    <td className="break-all py-1 text-success">{show(entry.after?.[key])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      {details.length ? (
        <div>
          <div className="mb-1 font-semibold uppercase tracking-wider text-muted">Details</div>
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_minmax(0,1fr)]">
            {details.map(([key, value]) => (
              <React.Fragment key={key}>
                <dt className="font-mono text-muted">{key}</dt>
                <dd className="break-all">{show(value)}</dd>
              </React.Fragment>
            ))}
          </dl>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted">
        <span>{formatWhen(entry.createdAtISO)}</span>
        {entry.actorEmail ? <span>{entry.actorEmail}</span> : null}
        {entry.method && entry.path ? <span className="font-mono">{entry.method} {entry.path}</span> : null}
        {entry.ip ? <span>IP {entry.ip}</span> : null}
        <span className="font-mono">{entry.id}</span>
      </div>
    </div>
  )
}

// The audit trail, read from the server's audit log: every change made by a signed-in user, with
// who did it, when, and what changed. Filters run on the server, 50 entries a page.
export function AdminAuditLogsPage() {
  const [module, setModule] = useState('all')
  const [severity, setSeverity] = useState<AuditSeverity | 'all'>('all')
  const [actorId, setActorId] = useState('all')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<AuditResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  // Typing in the search box waits a moment before asking the server.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 350)
    return () => clearTimeout(timer)
  }, [search])
  useEffect(() => setPage(1), [module, severity, actorId, query, from, to])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
    if (module !== 'all') params.set('module', module)
    if (severity !== 'all') params.set('severity', severity)
    if (actorId !== 'all') params.set('actorId', actorId)
    if (query) params.set('q', query)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    try {
      setResult(await apiGet<AuditResponse>(`/api/audit-logs?${params}`))
    } catch (err: any) {
      setError(err?.message || 'Unable to load the audit log')
    } finally {
      setLoading(false)
    }
  }, [page, module, severity, actorId, query, from, to])

  useEffect(() => { void load() }, [load])

  const counts = result?.counts
  const entries = result?.data || []
  const pageCount = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1
  const filtered = module !== 'all' || severity !== 'all' || actorId !== 'all' || Boolean(query) || Boolean(from) || Boolean(to)
  const clearFilters = () => { setModule('all'); setSeverity('all'); setActorId('all'); setSearch(''); setFrom(''); setTo('') }
  const inputClass = 'w-full rounded-xl border border-white/10 bg-background px-3 py-2 text-sm text-text outline-none focus:ring-2 focus:ring-accent/40'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Audit Logs</h1>
          <p className="mt-1 text-sm text-muted">Every change made in the system: who did it, when, and what changed.</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading}><FiRefreshCw /> Refresh</Button>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Card className="rounded-xl px-3 py-2 md:px-3 md:py-2">
          <div className="truncate text-[10px] uppercase tracking-wider text-muted">{filtered ? 'Matching entries' : 'Entries'}</div>
          <div className="mt-0.5 text-base font-bold text-accent">{counts ? counts.total.toLocaleString() : '…'}</div>
        </Card>
        <Card className="rounded-xl px-3 py-2 md:px-3 md:py-2">
          <div className="truncate text-[10px] uppercase tracking-wider text-muted">Critical</div>
          <div className="mt-0.5 text-base font-bold text-danger">{counts ? counts.critical.toLocaleString() : '…'}</div>
        </Card>
        <Card className="rounded-xl px-3 py-2 md:px-3 md:py-2">
          <div className="truncate text-[10px] uppercase tracking-wider text-muted">Today</div>
          <div className="mt-0.5 text-base font-bold text-text">{counts ? counts.today.toLocaleString() : '…'}</div>
        </Card>
        <Card className="rounded-xl px-3 py-2 md:px-3 md:py-2">
          <div className="truncate text-[10px] uppercase tracking-wider text-muted">Last activity</div>
          <div className="mt-0.5 truncate text-base font-bold text-success" title={formatWhen(counts?.lastAtISO)}>{counts ? relative(counts.lastAtISO) : '…'}</div>
        </Card>
      </div>

      <Card className="p-4">
        <FilterTabs
          size="sm"
          ariaLabel="Filter by module"
          value={module}
          onChange={setModule}
          options={MODULES
            .filter(([key]) => key === 'all' || key === module || (counts?.byModule[key] || 0) > 0)
            .map(([key, label]) => ({ value: key, label, count: key === 'all' ? undefined : counts?.byModule[key] }))}
        />

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_repeat(2,minmax(0,1fr))]">
          <label className="block">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted">Search</div>
            <div className="relative">
              <FiSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Action, record ID, name…" className={`${inputClass} pl-9`} />
            </div>
          </label>
          <label className="block">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted">Done by</div>
            <select value={actorId} onChange={(e) => setActorId(e.target.value)} className={inputClass}>
              <option value="all">Everyone</option>
              {(result?.actors || []).map((actor) => (
                <option key={actor.id} value={actor.id}>{actor.name}{actor.role ? ` (${actor.role === 'user' ? 'player' : actor.role})` : ''}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted">From</div>
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
          </label>
          <label className="block">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted">To</div>
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={inputClass} />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <FilterTabs
            size="sm"
            ariaLabel="Filter by severity"
            value={severity}
            onChange={setSeverity}
            options={(['all', 'info', 'warning', 'critical'] as const).map((option) => ({ value: option, label: option === 'all' ? 'All severities' : titleCaseLabel(option) }))}
          />
          {filtered ? <button type="button" onClick={clearFilters} className="text-xs font-semibold text-accent hover:underline">Clear filters</button> : null}
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-white/5">
          <div className="hidden grid-cols-[10rem_minmax(0,1fr)_11rem_6rem] gap-3 bg-white/5 px-4 py-2 text-[11px] uppercase tracking-widest text-muted md:grid">
            <div>When</div>
            <div>What happened</div>
            <div>Done by</div>
            <div className="text-right">Severity</div>
          </div>
          <div className="divide-y divide-white/5">
            {loading && !result ? (
              <div className="p-6 text-sm text-muted">Loading the audit log…</div>
            ) : error ? (
              <div className="p-6 text-sm text-danger">{error}</div>
            ) : entries.length === 0 ? (
              <div className="p-6 text-sm text-muted">{filtered ? 'No entries match these filters.' : 'Nothing has been recorded yet. Changes appear here as staff and players use the system.'}</div>
            ) : entries.map((entry) => {
              const expanded = open === entry.id
              return (
                <div key={entry.id} className={loading ? 'opacity-60' : ''}>
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : entry.id)}
                    aria-expanded={expanded}
                    className="grid w-full gap-1 px-4 py-3 text-left transition hover:bg-white/[0.03] md:grid-cols-[10rem_minmax(0,1fr)_11rem_6rem] md:items-center md:gap-3"
                  >
                    <div className="flex items-center gap-1.5 text-xs text-muted">
                      {expanded ? <FiChevronDown className="shrink-0" /> : <FiChevronRight className="shrink-0" />}
                      <span title={formatWhen(entry.createdAtISO)}>{formatWhen(entry.createdAtISO)}</span>
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">{entry.label}</span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-muted">{moduleLabel(entry.module)}</span>
                      </div>
                      {entry.summary && entry.summary !== entry.label ? <div className="mt-0.5 truncate text-xs text-muted" title={entry.summary}>{entry.summary}</div> : null}
                    </div>
                    <div className="min-w-0 text-xs">
                      <div className="truncate font-semibold text-text">{entry.actorName || entry.actorEmail || entry.actorId}</div>
                      <div className="text-muted">{entry.actorRole === 'user' ? 'Player' : titleCaseLabel(entry.actorRole || '')}</div>
                    </div>
                    <div className="md:text-right">
                      <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase ${severityClass[entry.severity] || severityClass.info}`}>{entry.severity}</span>
                    </div>
                  </button>
                  {expanded ? <EntryDetails entry={entry} /> : null}
                </div>
              )
            })}
          </div>
        </div>

        {result && result.total > PAGE_SIZE ? (
          <Pagination className="mt-4" page={page} pageCount={pageCount} total={result.total} pageSize={PAGE_SIZE} onPageChange={setPage} noun="entries" />
        ) : null}
      </Card>
    </div>
  )
}
