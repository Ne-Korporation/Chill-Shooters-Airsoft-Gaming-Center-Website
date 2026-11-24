import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { confirmDialog } from '../../components/ui/ConfirmDialog'
import { FiArchive, FiArrowLeft, FiCheck, FiRotateCcw, FiSearch, FiSend, FiUser, FiUsers, FiX } from 'react-icons/fi'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { FilterTabs } from '../../components/ui/FilterTabs'
import { useAuth } from '../../context/AuthContext'
import { useNotifications, type NotificationItem } from '../../context/NotificationContext'
import { resolveNotificationRoute } from '../../utils/notificationRoutes'
import { kindOf, timeLabel } from '../../utils/notificationDisplay'
import toast from 'react-hot-toast'
import { Paged } from '../../components/ui/Pagination'
import { apiBase, apiGet, apiGetAll, getApiAuthHeaders } from '../../utils/apiClient'
import { useLiveRefresh } from '../../utils/liveUpdates'

type Role = 'user' | 'registrar' | 'marshal' | 'admin'
type FeedFilter = 'all' | Role

// Who a notification goes to, in the order they're picked.
const ROLES: Array<{ value: Role; label: string }> = [
  { value: 'user', label: 'Players' },
  { value: 'registrar', label: 'Registrars' },
  { value: 'marshal', label: 'Marshals' },
  { value: 'admin', label: 'Admins' },
]
const ROLE_LABEL: Record<string, string> = { user: 'Players', registrar: 'Registrars', marshal: 'Marshals', admin: 'Admins', all: 'Everyone' }

const ROLE_SINGULAR: Record<string, string> = { user: 'Player', registrar: 'Registrar', marshal: 'Marshal', admin: 'Admin' }

type Account = { id: string; name: string; email: string; role: string }

const fieldClass = 'w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text placeholder:text-muted'

// A sent notification, with the recipient's name when it went to one person.
type SentNotification = NotificationItem & { recipientName?: string; recipientRole?: string }

function recipientsOf(item: SentNotification) {
  if (item.userId !== 'broadcast') return item.recipientName || 'One person'
  return ROLE_LABEL[String(item.targetRole || 'all')] || 'Everyone'
}

// Which role a notification went to: the group it was broadcast to, or the person's role.
function roleOf(item: SentNotification) {
  return item.userId === 'broadcast' ? String(item.targetRole || 'all') : String(item.recipientRole || 'user')
}

// Admin notifications: send an announcement on the left, review everything sent on the right.
// Announcements appear in each recipient's notifications (the bell and this page).
export function AdminNotificationsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { addNotification, markAsRead, archiveNotifications, restoreNotifications } = useNotifications()

  const [sendTo, setSendTo] = useState<'everyone' | 'roles' | 'person'>('roles')
  const [roles, setRoles] = useState<Role[]>(['user'])
  const [targetUserId, setTargetUserId] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [uploadingImage, setUploadingImage] = useState(false)
  const [feedFilter, setFeedFilter] = useState<FeedFilter>('all')
  // Notifications are archived, never cleared: the Archived view lists them and can restore them.
  const [showArchived, setShowArchived] = useState(false)
  const now = new Date()

  // Everything the system has sent, to anyone (the bell only shows the admin's own).
  const [allSent, setAllSent] = useState<SentNotification[]>([])
  const [archivedCount, setArchivedCount] = useState(0)
  const [loadingList, setLoadingList] = useState(true)
  const loadSent = useCallback(async () => {
    try {
      const res = await apiGet<{ ok: boolean; data: SentNotification[]; archivedCount: number }>(`/api/notifications/sent${showArchived ? '?archived=1' : ''}`)
      setAllSent(Array.isArray(res.data) ? res.data : [])
      setArchivedCount(Number(res.archivedCount) || 0)
    } catch (error: any) {
      toast.error(error?.message || 'Unable to load sent notifications')
    } finally {
      setLoadingList(false)
    }
  }, [showArchived])
  useEffect(() => {
    setLoadingList(true)
    void loadSent()
  }, [loadSent])
  useLiveRefresh(['notifications'], () => loadSent())

  // The admin's own notifications (sent to admins, everyone, or them): read state is theirs to change.
  const isMine = (item: SentNotification) =>
    item.userId === String(user?.id) || (item.userId === 'broadcast' && ['admin', 'all'].includes(String(item.targetRole || 'all')))

  const countFor = (filter: FeedFilter) => (filter === 'all' ? allSent.length : allSent.filter((item) => roleOf(item) === filter).length)
  const visible = useMemo(
    () => (feedFilter === 'all' ? allSent : allSent.filter((item) => roleOf(item) === feedFilter)),
    [allSent, feedFilter],
  )
  const unread = allSent.filter((item) => isMine(item) && !item.read).length

  // Accounts for the "One person" picker, loaded the first time it's opened.
  const [personQuery, setPersonQuery] = useState('')
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [accountsLoading, setAccountsLoading] = useState(false)
  useEffect(() => {
    if (sendTo !== 'person' || accounts !== null) return
    setAccountsLoading(true)
    apiGetAll<any>('user_accounts')
      .then((docs) => setAccounts(docs
        .map((doc: any) => ({
          id: String(doc.id ?? doc._id ?? ''),
          name: String(doc.name || doc.fullName || 'Unnamed account'),
          email: String(doc.email || ''),
          role: String(doc.role || 'user').toLowerCase(),
        }))
        .filter((acc: Account) => acc.id)))
      .catch((error: any) => {
        toast.error(error?.message || 'Unable to load accounts')
        setAccounts([])
      })
      .finally(() => setAccountsLoading(false))
  }, [sendTo, accounts])

  const selectedAccount = useMemo(
    () => (targetUserId ? accounts?.find((acc) => acc.id === targetUserId) || { id: targetUserId, name: 'Selected account', email: '', role: '' } : null),
    [accounts, targetUserId],
  )
  const matches = useMemo(() => {
    const term = personQuery.trim().toLowerCase()
    if (!term || !accounts) return []
    return accounts
      .filter((acc) => [acc.name, acc.email, acc.id].some((value) => value.toLowerCase().includes(term)))
      .slice(0, 8)
  }, [accounts, personQuery])

  const handleUploadImage = async (file: File) => {
    setUploadingImage(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch(`${apiBase}/api/uploads/upload-image`, {
        method: 'POST',
        headers: getApiAuthHeaders(),
        body: formData,
      })
      const json = await response.json().catch(() => null)
      if (!response.ok) throw new Error(json?.error || 'Unable to upload image')
      setImageUrl(String(json?.url || '').trim())
      toast.success('Picture attached.')
    } catch (error: any) {
      toast.error(error?.message || 'Unable to upload image')
    } finally {
      setUploadingImage(false)
    }
  }

  const toggleRole = (role: Role) =>
    setRoles((current) => (current.includes(role) ? current.filter((item) => item !== role) : [...current, role]))

  const canSend = Boolean(title.trim() && body.trim()) && (
    sendTo === 'everyone' || (sendTo === 'roles' && roles.length > 0) || (sendTo === 'person' && targetUserId.trim())
  )

  const handleSend = () => {
    if (!canSend) return
    const base = { type: 'announcement' as const, title: title.trim(), message: body.trim(), imageUrl: imageUrl.trim() || undefined, linkedResourceId: undefined }
    if (sendTo === 'person') {
      addNotification({ ...base, userId: targetUserId.trim() })
      toast.success('Notification sent.')
    } else {
      const targets: Array<Role | 'all'> = sendTo === 'everyone' ? ['all'] : roles
      targets.forEach((role) => addNotification({ ...base, userId: 'broadcast', targetRole: role }))
      toast.success(`Notification sent to ${targets.map((role) => ROLE_LABEL[role]).join(', ')}.`)
    }
    setTitle('')
    setBody('')
    setImageUrl('')
    setTargetUserId('')
  }

  // Archiving takes a notification off this list (it stays on record, and the people who got it keep it).
  const handleArchive = async (item: NotificationItem) => {
    try {
      await archiveNotifications([item.id])
      toast.success('Notification archived.')
      void loadSent()
    } catch (error: any) {
      toast.error(error?.message || 'Unable to archive it')
    }
  }

  const handleRestore = async (item: NotificationItem) => {
    try {
      await restoreNotifications([item.id])
      toast.success('Notification restored.')
      void loadSent()
    } catch (error: any) {
      toast.error(error?.message || 'Unable to restore it')
    }
  }

  const handleArchiveAll = async () => {
    if (!(await confirmDialog({
      title: 'Archive all notifications?',
      message: 'They move to Archived and can be restored any time. Nothing is deleted, and the people who received them keep theirs.',
      confirmLabel: 'Archive all',
    }))) return
    try {
      const archived = await archiveNotifications()
      toast.success(`Archived ${archived} notification${archived === 1 ? '' : 's'}.`)
      void loadSent()
    } catch (error: any) {
      toast.error(error?.message || 'Unable to archive notifications')
    }
  }

  const openNotification = (item: SentNotification) => {
    if (isMine(item)) markAsRead(item.id)
    const destination = resolveNotificationRoute(item, user?.role, user?.id)
    if (destination) navigate(destination)
  }

  const modeButton = (value: typeof sendTo, label: string, Icon: typeof FiUsers) => (
    <button
      type="button"
      onClick={() => setSendTo(value)}
      aria-pressed={sendTo === value}
      className={['flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition', sendTo === value ? 'bg-accent/15 text-accent' : 'text-muted hover:text-text'].join(' ')}
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Notifications</h1>
          <p className="mt-1 text-sm text-muted">Send announcements to players and staff, and review every notification the system has sent.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" disabled={showArchived || allSent.length === 0} onClick={handleArchiveAll}>
            <FiArchive /> Archive all
          </Button>
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* Compose */}
        <Card className="p-4 md:p-5 lg:sticky lg:top-4">
          <h2 className="text-lg font-bold">Send a notification</h2>
          <p className="mt-1 text-xs text-muted">Shows up in the recipients' notifications in the app.</p>

          <div className="mt-4 space-y-4">
            <div>
              <div className="mb-2 text-sm font-semibold">Send to</div>
              <div className="flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
                {modeButton('roles', 'Groups', FiUsers)}
                {modeButton('everyone', 'Everyone', FiSend)}
                {modeButton('person', 'One person', FiUser)}
              </div>

              {sendTo === 'roles' ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {ROLES.map((role) => {
                    const on = roles.includes(role.value)
                    return (
                      <button
                        key={role.value}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleRole(role.value)}
                        className={['inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold transition', on ? 'border-accent/40 bg-accent/15 text-accent' : 'surface text-muted hover:text-text'].join(' ')}
                      >
                        {on ? <FiCheck className="h-3.5 w-3.5" /> : null} {role.label}
                      </button>
                    )
                  })}
                </div>
              ) : null}
              {sendTo === 'everyone' ? (
                <p className="mt-3 text-xs text-muted">Every player, registrar, marshal and admin gets it.</p>
              ) : null}
              {sendTo === 'person' ? (
                <div className="mt-3">
                  {selectedAccount ? (
                    <div className="flex items-center justify-between gap-2 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{selectedAccount.name}</div>
                        <div className="truncate text-xs text-muted">{selectedAccount.email} · {ROLE_SINGULAR[selectedAccount.role] || selectedAccount.role} · {selectedAccount.id}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setTargetUserId(''); setPersonQuery('') }}
                        aria-label="Choose someone else"
                        title="Choose someone else"
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-white/10 hover:text-text"
                      >
                        <FiX className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <FiSearch className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                      <input
                        value={personQuery}
                        onChange={(e) => setPersonQuery(e.target.value)}
                        className={`${fieldClass} pl-10`}
                        placeholder="Search by name, email or account ID"
                        aria-label="Search for a person"
                      />
                      {personQuery.trim() ? (
                        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-white/10 bg-background p-1 shadow-xl">
                          {accountsLoading ? (
                            <div className="px-3 py-2 text-xs text-muted">Loading accounts…</div>
                          ) : matches.length === 0 ? (
                            <div className="px-3 py-2 text-xs text-muted">No one matches “{personQuery.trim()}”.</div>
                          ) : matches.map((acc) => (
                            <button
                              key={acc.id}
                              type="button"
                              onClick={() => { setTargetUserId(acc.id); setPersonQuery('') }}
                              className="block w-full rounded-lg px-3 py-2 text-left transition hover:bg-white/10"
                            >
                              <div className="truncate text-sm font-semibold">{acc.name}</div>
                              <div className="truncate text-xs text-muted">{acc.email} · {ROLE_SINGULAR[acc.role] || acc.role}</div>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )}
                  <p className="mt-1 text-xs text-muted">Search players and staff by name, email or account ID.</p>
                </div>
              ) : null}
            </div>

            <label className="block">
              <div className="mb-2 text-sm font-semibold">Title</div>
              <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 120))} className={fieldClass} placeholder="e.g. Weekend package reminder" />
            </label>

            <label className="block">
              <div className="mb-2 text-sm font-semibold">Message</div>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value.slice(0, 1000))}
                rows={4}
                className={fieldClass}
                placeholder="e.g. Please confirm the gear checklist for the Saturday booking before 5:00 PM."
              />
            </label>

            <div>
              <div className="mb-2 text-sm font-semibold">Picture <span className="font-normal text-muted">(optional)</span></div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="file"
                  accept="image/*"
                  disabled={uploadingImage}
                  className="block min-w-0 flex-1 text-xs text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-accent/15 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-accent"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file) void handleUploadImage(file)
                  }}
                />
                {imageUrl ? (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setImageUrl('')}>
                    <FiX /> Remove
                  </Button>
                ) : null}
              </div>
              {uploadingImage ? <p className="mt-2 text-xs text-muted">Uploading picture…</p> : null}
              {imageUrl ? (
                <div className="mt-3 overflow-hidden rounded-xl border border-white/10 bg-black/20">
                  <img src={imageUrl} alt="Announcement picture preview" className="block max-h-64 w-full object-contain" />
                </div>
              ) : null}
            </div>

            <Button onClick={handleSend} disabled={!canSend} className="w-full">
              <FiSend /> Send notification
            </Button>
          </div>
        </Card>

        {/* Sent notifications */}
        <Card className="p-4 md:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              {showArchived ? (
                <button type="button" onClick={() => setShowArchived(false)} aria-label="Back to sent notifications" className="grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-white/5 hover:text-text">
                  <FiArrowLeft className="h-4 w-4" />
                </button>
              ) : null}
              {showArchived ? 'Archived notifications' : 'Sent notifications'}
            </h2>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted">{!showArchived && unread > 0 ? `${unread} unread · ` : ''}{allSent.length} total</span>
              {!showArchived ? (
                <button type="button" onClick={() => setShowArchived(true)} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1 text-xs font-semibold text-muted transition hover:text-text">
                  <FiArchive className="h-3.5 w-3.5" /> Archived{archivedCount ? ` (${archivedCount})` : ''}
                </button>
              ) : null}
            </div>
          </div>
          <FilterTabs
            className="mt-3"
            size="sm"
            ariaLabel="Filter sent notifications by recipient"
            value={feedFilter}
            onChange={setFeedFilter}
            options={([{ value: 'all', label: 'All' }, ...ROLES] as Array<{ value: FeedFilter; label: string }>).map((option) => ({
              ...option,
              count: countFor(option.value),
            }))}
          />

          <div className="mt-3 divide-y divide-white/5">
            <Paged items={visible}>{(pageItems) => pageItems.map((item) => {
              const kind = kindOf(item)
              const Icon = kind.icon
              return (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openNotification(item)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      openNotification(item)
                    }
                  }}
                  className="group flex cursor-pointer gap-3 rounded-xl px-2 py-3 transition hover:bg-white/5"
                >
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/5 text-muted">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className={`min-w-0 text-sm ${item.read || !isMine(item) ? 'font-semibold' : 'font-bold'}`}>
                        {!item.read && isMine(item) ? <span aria-label="Unread" className="mr-1.5 inline-block h-2 w-2 rounded-full bg-accent align-middle" /> : null}
                        {item.title}
                      </div>
                      <span className="shrink-0 text-xs text-muted">{timeLabel(item.createdAtISO, now)}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted">{kind.label} · To {recipientsOf(item)}</div>
                    <p className="mt-1 line-clamp-2 break-words text-sm text-muted">{item.message}</p>
                  </div>
                  <button
                    type="button"
                    aria-label={`${showArchived ? 'Restore' : 'Archive'} ${item.title}`}
                    title={showArchived ? 'Restore' : 'Archive'}
                    onClick={(event) => {
                      event.stopPropagation()
                      void (showArchived ? handleRestore(item) : handleArchive(item))
                    }}
                    className="grid h-8 w-8 shrink-0 place-items-center self-center rounded-lg text-muted transition hover:bg-white/10 hover:text-text sm:opacity-0 sm:focus:opacity-100 sm:group-hover:opacity-100"
                  >
                    {showArchived ? <FiRotateCcw className="h-4 w-4" /> : <FiArchive className="h-4 w-4" />}
                  </button>
                </div>
              )
            })}</Paged>
            {loadingList ? <div className="py-8 text-center text-sm text-muted">Loading…</div>
              : visible.length === 0 ? <div className="py-8 text-center text-sm text-muted">{showArchived ? 'No archived notifications.' : 'No notifications here.'}</div> : null}
          </div>
        </Card>
      </div>
    </div>
  )
}
