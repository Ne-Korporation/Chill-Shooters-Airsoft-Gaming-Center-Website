import React from 'react'
import { confirmDialog } from '../../components/ui/ConfirmDialog'
import { useLiveRefresh } from '../../utils/liveUpdates'
import { FiArchive, FiEye, FiPrinter, FiRefreshCw, FiRotateCcw, FiShield } from 'react-icons/fi'
import { WaiverApprovalDialog, type WaiverIdCheck } from '../../components/waivers/WaiverApprovalDialog'
import toast from 'react-hot-toast'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { FilterTabs, titleCaseLabel } from '../../components/ui/FilterTabs'
import { Pagination, usePagination } from '../../components/ui/Pagination'
import { apiGetAll, apiPut } from '../../utils/apiClient'
import { type WaiverText } from '../../utils/waiverText'
import { WaiverTextEditor } from '../../components/waivers/WaiverTextEditor'
import { buildWaiverPrintHtml, printWaiverDocument } from '../../utils/waiverPrint'
import { Modal } from '../../components/ui/Modal'
import { WaiverReviewPanel } from '../../components/waivers/WaiverReviewPanel'
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

  useLiveRefresh(['waivers', 'accounts'], () => refresh(true))

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
  // Registrars get this same page; editing the waiver text and archiving stay with admins.
  const isAdmin = user?.role === 'admin'

  const [approvalOpen, setApprovalOpen] = React.useState(false)

  React.useEffect(() => {
    setApprovalOpen(false)
  }, [selectedWaiver?.id, selectedWaiver?._id])

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
        // The server tells the player (or the parent, for a child's waiver).
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

  // Waivers are archived, never deleted: the signed record stays on file. An archived waiver no
  // longer counts as the player's waiver, so they answer a new one; it can be restored later.
  const setArchived = React.useCallback(async (archived: boolean) => {
    if (!selectedWaiver) return
    const waiverId = selectedWaiver.id || selectedWaiver._id
    if (!waiverId) return
    const confirmed = await confirmDialog(archived
      ? {
        title: `Archive waiver ${waiverId}?`,
        message: "The record is kept, but it no longer counts as the player's waiver. If it was their current waiver they will need to submit a new one.",
        confirmLabel: 'Archive',
        danger: true,
      }
      : { title: `Restore waiver ${waiverId} from the archive?`, confirmLabel: 'Restore' })
    if (!confirmed) return

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
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted"><FiShield className="text-accent" /> {isAdmin ? 'Admin records' : 'Registrar'}</div>
        <h1 className="mt-2 text-3xl font-bold">Submitted Waivers</h1>
        <p className="mt-1 text-sm text-muted">{isAdmin ? 'All player waivers submitted through the online waiver form.' : 'Review player waivers: open one to check it, then approve or deny it.'}</p>
      </div>

      {isAdmin ? <WaiverTextEditor /> : null}

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
              {!loading && pageItems.map((waiver) => <tr key={waiver.id || waiver._id} className="border-b border-white/5"><td className="py-3 pr-4"><div className="font-semibold">{waiver.id || waiver._id}</div></td><td className="py-3 pr-4"><div className="font-semibold">{waiver.fullName || '-'}</div><div className="text-xs text-muted">{waiver.userId || 'Guest submission'}</div></td><td className="py-3 pr-4 text-muted">{formatDate(waiver.submittedAtISO)}</td><td className="py-3 pr-4"><span className={`${waiver.status === 'approved' ? 'rounded-full border border-success/30 bg-success/10 text-success' : waiver.status === 'denied' ? 'rounded-full border border-rose-200 bg-rose-100 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200' : 'rounded-full border border-accent/30 bg-accent/10 text-accent'} px-2 py-1 text-[11px] font-semibold uppercase`}>{waiver.status || 'pending'}</span></td><td className="py-3 text-right"><Button size="xs" variant="ghost" onClick={() => setSelectedWaiver(waiver)}><FiEye /> View</Button></td></tr>)}
              {!loading && filtered.length === 0 ? <tr><td colSpan={5} className="py-8 text-center text-muted">No waivers found.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageCount={pageCount} total={total} onPageChange={setPage} />
      </Card>

      {/* The same window as the registrar's: the signed waiver as it prints, with the review details
          above it and the admin's actions (archive, print, deny, approve) at the bottom. */}
      {selectedWaiver ? (() => {
        const waiverId = String(selectedWaiver.id || selectedWaiver._id || '')
        const status = String(selectedWaiver.status || 'pending').toLowerCase()
        const undecided = ['pending', 'review', 'submitted', ''].includes(status)
        return (
          <Modal
            eyebrow={`Waiver ${waiverId}`}
            title={`${selectedWaiver.fullName || 'Unnamed player'}${selectedWaiver.age != null ? ` (Age ${selectedWaiver.age})` : ''}`}
            size="lg"
            confirmDiscard={false}
            onClose={() => setSelectedWaiver(null)}
            footer={
              <>
                {/* Archiving sits apart on the left; the review decision ends in the primary Approve. */}
                {isAdmin ? (
                <Button
                  variant="ghost"
                  className="w-full sm:mr-auto sm:w-auto"
                  onClick={() => void setArchived(!selectedWaiver.archived)}
                  disabled={savingStatus || (!selectedWaiver.archived && undecided)}
                  title={!selectedWaiver.archived && undecided ? 'Approve or deny this waiver before archiving it.' : undefined}
                >
                  {selectedWaiver.archived ? <><FiRotateCcw /> Restore</> : <><FiArchive /> Archive</>}
                </Button>
                ) : null}
                <Button variant="ghost" className="flex-1 sm:flex-none" onClick={() => printWaiverDocument(selectedWaiver)}><FiPrinter /> Print</Button>
                <Button variant="danger-soft" className="flex-1 sm:flex-none" onClick={denyWaiver} disabled={savingStatus || status === 'denied'}>
                  {status === 'denied' ? 'Denied' : savingStatus ? 'Updating…' : 'Deny'}
                </Button>
                <Button className="flex-1 sm:flex-none" onClick={approveWaiver} disabled={savingStatus || status === 'approved' || status === 'expired'}>
                  {status === 'approved' ? 'Approved' : status === 'expired' ? 'Expired' : savingStatus ? 'Updating…' : 'Approve waiver'}
                </Button>
              </>
            }
          >
            <div className="space-y-4">
              <WaiverReviewPanel waiver={selectedWaiver} />

              {/* The signed waiver as it prints (text, signatures and IDs), fitted to the window; it
                  grows to its full height so only the window scrolls. */}
              <iframe
                title={`Waiver ${waiverId}`}
                srcDoc={buildWaiverPrintHtml(selectedWaiver, { preview: true })}
                scrolling="no"
                onLoad={(event) => {
                  const frame = event.currentTarget
                  const fit = () => {
                    const body = frame.contentDocument?.body
                    if (body) frame.style.height = `${body.scrollHeight}px`
                  }
                  fit()
                  frame.contentDocument?.querySelectorAll('img').forEach((img) => img.addEventListener('load', fit))
                }}
                className="block min-h-[50vh] w-full rounded-xl border border-white/10 bg-white"
              />
            </div>
          </Modal>
        )
      })() : null}

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