import React from 'react'
import { createPortal } from 'react-dom'
import { FiArchive, FiEye, FiPrinter, FiRefreshCw, FiRotateCcw, FiShield, FiX } from 'react-icons/fi'
import { WaiverApprovalDialog, type WaiverIdCheck } from '../../components/waivers/WaiverApprovalDialog'
import toast from 'react-hot-toast'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { FilterTabs, titleCaseLabel } from '../../components/ui/FilterTabs'
import { Pagination, usePagination } from '../../components/ui/Pagination'
import { apiGetAll, apiPut } from '../../utils/apiClient'
import { signedWaiverText, type WaiverText } from '../../utils/waiverText'
import { WaiverTextEditor } from '../../components/waivers/WaiverTextEditor'
import { printWaiverDocument } from '../../utils/waiverPrint'
import { formatPhPhone } from '../../utils/phone'
import { useNotifications } from '../../context/NotificationContext'
import { useAuth } from '../../context/AuthContext'

type WaiverRecord = {
  id?: string
  _id?: string
  userId?: string
  reservationId?: string
  fullName?: string
  age?: number
  birthDate?: string
  email?: string
  guardianName?: string
  guardianConsent?: boolean
  consent?: boolean
  termsAccepted?: boolean
  isMinor?: boolean
  hasSignature?: boolean
  signatureImage?: string
  guardianPhone?: string
  guardianEmail?: string
  guardianIdImage?: string
  guardianSignatureImage?: string
  status?: string
  idType?: string
  idImage?: string
  idImageBack?: string
  idChecked?: boolean
  autoApproved?: boolean
  guardianIdType?: string
  guardianIdChecked?: boolean
  waiverText?: WaiverText | null
  validUntilISO?: string
  submittedAtISO?: string
  createdAtISO?: string
  archived?: boolean
  archivedAtISO?: string
  archivedReason?: string
  supersededBy?: string
  archivedBy?: { role?: string; name?: string; email?: string }
  reviewedBy?: { role?: string; name?: string; email?: string }
  reviewedAtISO?: string
  editHistory?: Array<{ atISO: string; by?: { email?: string }; fields: Record<string, { from: unknown; to: unknown }> }>
}

const WAIVER_STATUS_FILTERS = ['all', 'pending', 'approved', 'denied', 'expired', 'archived'] as const
type WaiverStatusFilter = typeof WAIVER_STATUS_FILTERS[number]

// "Registrar Ana Cruz" from the reviewer saved on the waiver.
function staffLabel(by?: { role?: string; name?: string; email?: string }) {
  if (!by) return ''
  return [by.role ? titleCaseLabel(by.role) : '', by.name || by.email || ''].filter(Boolean).join(' ')
}

function formatDate(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

const POLL_INTERVAL_MS = 15000

export function AdminWaiversPage() {
  const [waivers, setWaivers] = React.useState<WaiverRecord[]>([])
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState('')
  const [selectedWaiver, setSelectedWaiver] = React.useState<WaiverRecord | null>(null)
  const [savingStatus, setSavingStatus] = React.useState(false)

  // silent = background poll: no loading flicker, and a failed poll keeps the current list
  const refresh = React.useCallback(async (silent = false) => {
    if (silent) setRefreshing(true)
    else setLoading(true)
    try {
      setWaivers(await apiGetAll<WaiverRecord>('waivers'))
      setLoadError(null)
    } catch (e: any) {
      setLoadError(String(e?.message || 'Could not load waivers.'))
      if (!silent) setWaivers([])
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  // Initial load + light polling so newly submitted waivers show up without a page reload
  React.useEffect(() => {
    refresh(false)
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh(true)
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const { addNotification } = useNotifications()
  const { user } = useAuth()
  const reviewer = [titleCaseLabel(String(user?.role || 'staff')), user?.name].filter(Boolean).join(' ')

  const [approvalOpen, setApprovalOpen] = React.useState(false)

  React.useEffect(() => {
    setApprovalOpen(false)
  }, [selectedWaiver?.id, selectedWaiver?._id])

  const signedText = signedWaiverText(selectedWaiver)

  const updateWaiverStatus = React.useCallback(async (status: 'approved' | 'denied', idCheck?: WaiverIdCheck) => {
    if (!selectedWaiver) return
    const waiverId = selectedWaiver.id || selectedWaiver._id
    if (!waiverId) return

    setSavingStatus(true)
    try {
      const response = await apiPut<{ ok: boolean; data: WaiverRecord }>(`/api/waivers/${encodeURIComponent(String(waiverId))}`, {
        status,
        ...(idCheck || {}),
      })
      setApprovalOpen(false)

      if (response?.data) {
        setSelectedWaiver(response.data)
        setWaivers((current) => current.map((waiver) => (waiver.id === waiverId || waiver._id === waiverId ? response.data : waiver)))

        try {

          // Notify the player
          if (selectedWaiver.userId) {
            addNotification({
              userId: selectedWaiver.userId,
              type: status === 'approved' ? 'waiver_approved' : 'waiver_denied',
              title: status === 'approved' ? 'Waiver Approved' : 'Waiver Denied',
              message: status === 'approved'
                ? 'Your waiver has been approved. You can now proceed with your reservation.'
                : 'Your waiver has been denied. Please open the Waiver page, review it, and submit a new one.',
              linkedResourceId: waiverId,
            })
          }
        } catch (err) {
          console.warn('Notification failed', err)
        }

        toast.success(status === 'approved' ? 'Waiver approved' : 'Waiver denied')
      }
    } catch (e: any) {
      toast.error(String(e?.message || 'Could not update the waiver status.'))
    } finally {
      setSavingStatus(false)
    }
  }, [selectedWaiver, addNotification, reviewer])

  const approveWaiver = React.useCallback(() => setApprovalOpen(true), [])
  const denyWaiver = React.useCallback(() => updateWaiverStatus('denied'), [updateWaiverStatus])
  const portalTarget = typeof window === 'undefined' ? null : document.body

  // Waivers are archived, never deleted: the signed record stays on file. An archived waiver no
  // longer counts as the player's waiver, so they answer a new one; it can be restored later.
  const setArchived = React.useCallback(async (archived: boolean) => {
    if (!selectedWaiver) return
    const waiverId = selectedWaiver.id || selectedWaiver._id
    if (!waiverId) return
    const prompt = archived
      ? `Archive waiver ${waiverId}?\n\nThe record is kept, but it no longer counts as the player's waiver. If it was their current waiver they will need to submit a new one.`
      : `Restore waiver ${waiverId} from the archive?`
    if (!window.confirm(prompt)) return

    setSavingStatus(true)
    try {
      const response = await apiPut<{ ok: boolean; data: WaiverRecord }>(`/api/waivers/${encodeURIComponent(String(waiverId))}`, { archived })
      if (response?.data) {
        setWaivers((current) => current.map((waiver) => ((waiver.id || waiver._id) === waiverId ? response.data : waiver)))
      }
      if (archived && selectedWaiver.userId && ['approved'].includes(String(selectedWaiver.status || '').toLowerCase())) {
        addNotification({
          userId: selectedWaiver.userId,
          type: 'waiver_archived',
          title: 'Please submit a new waiver',
          message: 'Your waiver was archived by staff. Please open the Waiver page and submit a new one before your next game.',
          linkedResourceId: waiverId,
        })
      }
      setSelectedWaiver(null)
      toast.success(archived ? 'Waiver archived' : 'Waiver restored')
    } catch (e: any) {
      toast.error(String(e?.message || e))
    } finally {
      setSavingStatus(false)
    }
  }, [selectedWaiver, addNotification])

  const [statusFilter, setStatusFilter] = React.useState<WaiverStatusFilter>('all')
  const [fromDate, setFromDate] = React.useState('')
  const [toDate, setToDate] = React.useState('')
  const [sortOrder, setSortOrder] = React.useState<'newest' | 'oldest' | 'name'>('newest')

  const statusOf = (waiver: WaiverRecord) => String(waiver.status || 'pending').toLowerCase()
  const submittedDay = (waiver: WaiverRecord) => {
    const iso = waiver.submittedAtISO || waiver.createdAtISO || ''
    const date = new Date(iso)
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(date)
  }

  const counts = React.useMemo(() => {
    const next: Record<WaiverStatusFilter, number> = { all: 0, pending: 0, approved: 0, denied: 0, expired: 0, archived: 0 }
    for (const waiver of waivers) {
      if (waiver.archived) {
        next.archived += 1
        continue
      }
      next.all += 1
      const status = statusOf(waiver)
      if (status in next) next[status as WaiverStatusFilter] += 1
    }
    return next
  }, [waivers])

  const filtered = React.useMemo(() => {
    const term = query.trim().toLowerCase()
    return waivers
      .filter((waiver) => (statusFilter === 'archived' ? Boolean(waiver.archived) : !waiver.archived))
      .filter((waiver) => (statusFilter === 'all' || statusFilter === 'archived' ? true : statusOf(waiver) === statusFilter))
      .filter((waiver) => {
        if (!fromDate && !toDate) return true
        const day = submittedDay(waiver)
        if (!day) return false
        return (!fromDate || day >= fromDate) && (!toDate || day <= toDate)
      })
      .filter((waiver) => !term || [waiver.id, waiver.userId, waiver.reservationId, waiver.fullName, waiver.email]
        .some((value) => String(value || '').toLowerCase().includes(term)))
      .sort((a, b) => {
        if (sortOrder === 'name') return String(a.fullName || '').localeCompare(String(b.fullName || ''))
        const aDate = String(a.submittedAtISO || a.createdAtISO || '')
        const bDate = String(b.submittedAtISO || b.createdAtISO || '')
        return sortOrder === 'newest' ? bDate.localeCompare(aDate) : aDate.localeCompare(bDate)
      })
  }, [waivers, query, statusFilter, fromDate, toDate, sortOrder])

  const { page, setPage, pageCount, pageItems, total } = usePagination(filtered, undefined, `${query}|${statusFilter}|${fromDate}|${toDate}|${sortOrder}`)

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted"><FiShield className="text-accent" /> Admin records</div>
        <h1 className="mt-2 text-3xl font-bold">Submitted Waivers</h1>
        <p className="mt-1 text-sm text-muted">All player waivers submitted through the online waiver form.</p>
      </div>

      <WaiverTextEditor />

      <Card className="p-4 md:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted">Waiver table</div>
            <div className="mt-1 text-sm text-muted">{counts.all} current waivers • {counts.archived} archived</div>
            {loadError ? <div className="mt-1 text-xs font-semibold text-danger">Could not refresh: {loadError}</div> : null}
          </div>
          <Button variant="ghost" onClick={() => refresh(true)} disabled={refreshing || loading} aria-label="Refresh waivers">
            <FiRefreshCw className={refreshing ? 'animate-spin' : ''} /> Refresh
          </Button>
        </div>

        <FilterTabs
          className="mt-4"
          ariaLabel="Filter waivers by status"
          value={statusFilter}
          onChange={setStatusFilter}
          options={WAIVER_STATUS_FILTERS.map((status) => ({ value: status, label: titleCaseLabel(status === 'all' ? 'All current' : status), count: counts[status] }))}
        />
        <div className="mt-3 grid gap-3 md:grid-cols-[2fr_1fr_1fr_1fr] md:items-end">
          <Input label="Player name" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, email, player ID, or waiver ID" />
          <Input label="Submitted from" type="date" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} />
          <Input label="Submitted to" type="date" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} />
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-muted">Sort by</span>
            <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as typeof sortOrder)} className="select-field h-12 w-full">
              <option value="newest">Newest submission</option>
              <option value="oldest">Oldest submission</option>
              <option value="name">Player name (A–Z)</option>
            </select>
          </label>
        </div>
        {fromDate || toDate || query ? (
          <button type="button" className="mt-2 text-xs font-semibold text-accent hover:underline" onClick={() => { setQuery(''); setFromDate(''); setToDate('') }}>
            Clear filters
          </button>
        ) : null}

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead><tr className="border-b border-white/10 text-left text-xs uppercase tracking-widest text-muted"><th className="py-3 pr-4">Waiver</th><th className="py-3 pr-4">Player</th><th className="py-3 pr-4">Submitted</th><th className="py-3 pr-4">Status</th><th className="py-3 text-right">Action</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={5} className="py-8 text-center text-muted">Loading waivers...</td></tr> : null}
              {!loading && pageItems.map((waiver) => <tr key={waiver.id || waiver._id} className="border-b border-white/5"><td className="py-3 pr-4"><div className="font-semibold">{waiver.id || waiver._id}</div><div className="text-xs text-muted">Reservation: {waiver.reservationId || '-'}</div></td><td className="py-3 pr-4"><div className="font-semibold">{waiver.fullName || '-'}</div><div className="text-xs text-muted">{waiver.userId || 'Guest submission'}</div></td><td className="py-3 pr-4 text-muted">{formatDate(waiver.submittedAtISO)}</td><td className="py-3 pr-4"><span className={`${waiver.status === 'approved' ? 'rounded-full border border-success/30 bg-success/10 text-success' : waiver.status === 'denied' ? 'rounded-full border border-rose-200 bg-rose-100 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200' : 'rounded-full border border-accent/30 bg-accent/10 text-accent'} px-2 py-1 text-[11px] font-semibold uppercase`}>{waiver.status || 'pending'}</span></td><td className="py-3 text-right"><Button size="xs" variant="ghost" onClick={() => setSelectedWaiver(waiver)}><FiEye /> View</Button></td></tr>)}
              {!loading && filtered.length === 0 ? <tr><td colSpan={5} className="py-8 text-center text-muted">No waivers found.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageCount={pageCount} total={total} onPageChange={setPage} />
      </Card>

      {selectedWaiver && portalTarget ? createPortal(
        <div className="fixed inset-0 z-[9999] grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="waiver-details-title">
          <article className="flex max-h-[90dvh] w-full max-w-5xl flex-col overflow-hidden bg-white text-slate-950 dark:bg-slate-950 dark:text-white shadow-none">
            {/* The title row sits above the scrolling area, so the close button stays in reach and no text slides under it. */}
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200/70 bg-white px-6 pb-4 pt-6 dark:bg-slate-950">
              <div>
                <div className="text-xs uppercase tracking-widest text-slate-500">Waiver document</div>
                <h2 id="waiver-details-title" className="mt-1 text-2xl font-semibold">{selectedWaiver.fullName || 'Unnamed player'}</h2>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">What the participant submitted. Staff can approve or deny it but not change it.</p>
              </div>
              <button type="button" aria-label="Close waiver details" onClick={() => setSelectedWaiver(null)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"><FiX /></button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6">
            <div className="grid gap-4 sm:grid-cols-2 pt-5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              <div>
                <div className="text-[11px] uppercase tracking-widest text-slate-500">Waiver ID</div>
                <p className="mt-1 font-medium">{selectedWaiver.id || selectedWaiver._id || '-'}</p>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-widest text-slate-500">Submitted</div>
                <p className="mt-1 font-medium">{formatDate(selectedWaiver.submittedAtISO)}</p>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-widest text-slate-500">Player ID</div>
                <p className="mt-1 font-medium">{selectedWaiver.userId || 'Guest submission'}</p>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-widest text-slate-500">Status</div>
                <p className="mt-1 font-medium">{selectedWaiver.status || 'pending'}{selectedWaiver.archived ? ' (archived)' : ''}</p>
                {selectedWaiver.reviewedBy ? (
                  <p className="mt-1 text-xs text-slate-500">Reviewed by {staffLabel(selectedWaiver.reviewedBy)}{selectedWaiver.reviewedAtISO ? ` · ${formatDate(selectedWaiver.reviewedAtISO)}` : ''}</p>
                ) : null}
                {selectedWaiver.archived ? (
                  <p className="mt-1 text-xs text-slate-500">
                    {selectedWaiver.archivedReason === 'resubmitted'
                      ? `Replaced by the player's resubmitted waiver ${selectedWaiver.supersededBy || ''}`
                      : selectedWaiver.archivedReason === 'removed_by_guardian'
                        ? "The guardian removed this minor from their account. Unarchiving keeps the record but doesn't add the minor back to their account."
                        : `Archived by ${staffLabel(selectedWaiver.archivedBy) || 'staff'}`}
                    {selectedWaiver.archivedAtISO ? ` · ${formatDate(selectedWaiver.archivedAtISO)}` : ''}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="pt-6 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              <p className="uppercase tracking-widest text-[11px] text-slate-500">Participant details</p>
              <p className="mt-3"><span className="font-semibold">Name:</span> {selectedWaiver.fullName || '-'}</p>
              <p className="mt-2"><span className="font-semibold">Email:</span> {selectedWaiver.email || '-'}</p>
              <p className="mt-2"><span className="font-semibold">Birthday:</span> {selectedWaiver.birthDate || '-'}</p>
              <p className="mt-2"><span className="font-semibold">Age:</span> {selectedWaiver.age ?? '-'}</p>
              <p className="mt-2"><span className="font-semibold">Reservation:</span> {selectedWaiver.reservationId || '-'}</p>
              <p className="mt-2">
                <span className="font-semibold">ID type:</span> {selectedWaiver.idType || '-'}
                {selectedWaiver.idChecked ? <span className="ml-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">Checked</span> : null}
              </p>
              {selectedWaiver.idImage || selectedWaiver.idImageBack ? (
                <div className="mt-1 flex flex-wrap gap-2">
                  {selectedWaiver.idImage ? (
                    <div className="inline-block rounded-lg border border-slate-200 bg-white p-2">
                      <img src={selectedWaiver.idImage} alt="Participant ID (front)" className="block h-32 object-contain" />
                    </div>
                  ) : null}
                  {selectedWaiver.idImageBack ? (
                    <div className="inline-block rounded-lg border border-slate-200 bg-white p-2">
                      <img src={selectedWaiver.idImageBack} alt="Participant ID (back)" className="block h-32 object-contain" />
                    </div>
                  ) : null}
                </div>
              ) : null}
              {selectedWaiver.autoApproved ? (
                <p className="mt-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">Approved automatically: the ID was verified on the player's profile.</p>
              ) : null}
              {selectedWaiver.validUntilISO ? <p className="mt-2"><span className="font-semibold">Valid until:</span> {formatDate(selectedWaiver.validUntilISO)}</p> : null}

              <p className="mt-6 uppercase tracking-widest text-[11px] text-slate-500">Guardian information</p>
              {selectedWaiver.isMinor ? (
                <>
                  <p className="mt-3"><span className="font-semibold">Guardian name:</span> {selectedWaiver.guardianName || '-'}</p>
                  <p className="mt-2"><span className="font-semibold">Guardian consent:</span> {selectedWaiver.guardianConsent ? 'Yes' : 'No'}</p>
                  {selectedWaiver.guardianPhone ? <p className="mt-2"><span className="font-semibold">Guardian phone:</span> {formatPhPhone(selectedWaiver.guardianPhone)}</p> : null}
                  <p className="mt-2"><span className="font-semibold">Guardian email:</span> {selectedWaiver.guardianEmail || '-'}</p>
                  <p className="mt-2">
                    <span className="font-semibold">Guardian ID type:</span> {selectedWaiver.guardianIdType || '-'}
                    {selectedWaiver.guardianIdChecked ? <span className="ml-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">Checked</span> : null}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-4">
                    <div>
                      <span className="font-semibold">Guardian ID:</span>
                      {selectedWaiver.guardianIdImage ? (
                        <div className="mt-1 inline-block rounded-lg border border-slate-200 bg-white p-2">
                          <img src={selectedWaiver.guardianIdImage} alt="Guardian ID" className="block h-32 object-contain" />
                        </div>
                      ) : (
                        <div className="mt-1 text-xs text-slate-500">No ID photo submitted.</div>
                      )}
                    </div>
                    <div>
                      <span className="font-semibold">Guardian signature:</span>
                      {selectedWaiver.guardianSignatureImage ? (
                        <div className="mt-1 inline-block rounded-lg border border-slate-200 bg-white p-2">
                          <img src={selectedWaiver.guardianSignatureImage} alt="Guardian signature" className="block h-24 object-contain" />
                        </div>
                      ) : (
                        <div className="mt-1 text-xs text-slate-500">No signature submitted.</div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <p className="mt-3">Not required for participants 18 or older.</p>
              )}

              {selectedWaiver.editHistory?.length ? (
                <>
                  <p className="mt-6 uppercase tracking-widest text-[11px] text-slate-500">Edit history</p>
                  <ul className="mt-3 space-y-2 text-xs">
                    {[...selectedWaiver.editHistory].reverse().map((entry, index) => (
                      <li key={index} className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                        <div className="font-semibold">{formatDate(entry.atISO)}{entry.by?.email ? ` · ${entry.by.email}` : ''}</div>
                        {Object.entries(entry.fields).map(([field, change]) => (
                          <div key={field}>{field}: “{String(change.from ?? '')}” → “{String(change.to ?? '')}”</div>
                        ))}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}

              <p className="mt-6 uppercase tracking-widest text-[11px] text-slate-500">Consent summary</p>
              <ul className="mt-3 list-disc space-y-2 pl-5">
                <li>Terms accepted: {selectedWaiver.termsAccepted ? 'Yes' : 'No'}</li>
                <li>Participation consent: {selectedWaiver.consent ? 'Yes' : 'No'}</li>
                <li>Signature captured: {selectedWaiver.hasSignature ? 'Yes' : 'No'}</li>
              </ul>

              <p className="mt-6 uppercase tracking-widest text-[11px] text-slate-500">{signedText.title}</p>
              <div className="mt-3 space-y-3 text-xs leading-relaxed">
                <p className="font-semibold">{signedText.preamble}</p>
                <p>{signedText.intro}</p>
                <ol className="list-decimal space-y-3 pl-5">
                  {signedText.clauses.map((clause, index) => (
                    <li key={index}>{clause}</li>
                  ))}
                </ol>
                <p className="font-semibold">{signedText.closing}</p>
                {selectedWaiver.isMinor ? (
                  <>
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">{signedText.guardianTitle}</p>
                    <p>{signedText.guardianCertification}</p>
                  </>
                ) : null}

                <div className="mt-6 border-t border-slate-200/70 pt-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Signature</p>
                  {selectedWaiver.signatureImage ? (
                    <div className="mt-2 inline-block rounded-lg border border-slate-200 bg-white p-2">
                      <img src={selectedWaiver.signatureImage} alt="Participant signature" className="h-20 object-contain" />
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-slate-500">No signature image submitted.</div>
                  )}
                  <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">{selectedWaiver.fullName || '-'}</p>
                </div>
              </div>
            </div>

            <div className="mt-8 border-t border-slate-200/70 pt-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-slate-500 dark:text-slate-400">
                  <p><span className="font-semibold text-slate-700 dark:text-slate-200">Document reference:</span> {selectedWaiver.id || selectedWaiver._id || '-'}</p>
                  <p className="mt-2"><span className="font-semibold text-slate-700 dark:text-slate-200">Displayed as:</span> waiver document view</p>
                </div>
                {/* Destructive action sits apart on the left; the review decision reads left-to-right
                    ending in the primary Approve. */}
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    onClick={() => void setArchived(!selectedWaiver.archived)}
                    disabled={savingStatus || (!selectedWaiver.archived && ['pending', 'review', 'submitted', ''].includes(String(selectedWaiver.status || '').toLowerCase()))}
                    title={!selectedWaiver.archived && ['pending', 'review', 'submitted', ''].includes(String(selectedWaiver.status || '').toLowerCase()) ? 'Approve or deny this waiver before archiving it.' : undefined}
                    className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 sm:mr-4"
                  >
                    {selectedWaiver.archived ? <><FiRotateCcw /> Restore</> : <><FiArchive /> Archive</>}
                  </button>
                  <button
                    type="button"
                    onClick={() => printWaiverDocument(selectedWaiver)}
                    className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 border border-slate-300 text-slate-700 hover:bg-slate-100"
                  >
                    <FiPrinter /> Print
                  </button>
                  <button
                    type="button"
                    onClick={denyWaiver}
                    disabled={savingStatus || selectedWaiver.status === 'denied'}
                    className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 border border-rose-300 text-rose-700 hover:bg-rose-50"
                  >
                    {selectedWaiver.status === 'denied' ? 'Denied' : savingStatus ? 'Updating…' : 'Deny'}
                  </button>
                  <button
                    type="button"
                    onClick={approveWaiver}
                    disabled={savingStatus || selectedWaiver.status === 'approved' || selectedWaiver.status === 'expired'}
                    className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 bg-accent text-background hover:bg-accent/90"
                  >
                    {selectedWaiver.status === 'approved' ? 'Approved' : selectedWaiver.status === 'expired' ? 'Expired' : savingStatus ? 'Updating…' : 'Approve waiver'}
                  </button>
                </div>
              </div>
            </div>
            </div>
          </article>
        </div>,
        portalTarget,
      ) : null}

      <WaiverApprovalDialog
        key={String(selectedWaiver?.id || selectedWaiver?._id || 'none')}
        open={approvalOpen && Boolean(selectedWaiver)}
        waiver={selectedWaiver}
        busy={savingStatus}
        onCancel={() => setApprovalOpen(false)}
        onConfirm={(check) => void updateWaiverStatus('approved', check)}
      />
    </div>
  )
}