import React, { useMemo, useState } from 'react'
import { confirmDialog } from '../../components/ui/ConfirmDialog'
import { FiCheck, FiSend, FiTrash2, FiUser, FiUsers } from 'react-icons/fi'
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

const fieldClass = 'w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text placeholder:text-muted'

function recipientsOf(item: NotificationItem) {
  if (item.userId !== 'broadcast') return 'One person'
  return ROLE_LABEL[String(item.targetRole || 'all')] || 'Everyone'
}

// Admin notifications: send an announcement on the left, review everything sent on the right.
// Announcements appear in each recipient's notifications (the bell and this page).
export function AdminNotificationsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { addNotification, deleteNotification, getAllNotifications, markAsRead, clearAllNotifications } = useNotifications()

  const [sendTo, setSendTo] = useState<'everyone' | 'roles' | 'person'>('roles')
  const [roles, setRoles] = useState<Role[]>(['user'])
  const [targetUserId, setTargetUserId] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [feedFilter, setFeedFilter] = useState<FeedFilter>('all')
  const now = new Date()

  const allSent = useMemo(
    () => [...getAllNotifications()].sort((a, b) => new Date(b.createdAtISO).getTime() - new Date(a.createdAtISO).getTime()),
    [getAllNotifications],
  )
  const countFor = (filter: FeedFilter) =>
    filter === 'all' ? allSent.length
    : allSent.filter((item) => (filter === 'user' ? item.targetRole === 'user' || (!item.targetRole && item.userId !== 'broadcast') : item.targetRole === filter)).length
  const visible = useMemo(() => {
    if (feedFilter === 'all') return allSent
    if (feedFilter === 'user') return allSent.filter((item) => item.targetRole === 'user' || (!item.targetRole && item.userId !== 'broadcast'))
    return allSent.filter((item) => item.targetRole === feedFilter)
  }, [allSent, feedFilter])
  const unread = allSent.filter((item) => !item.read).length

  const toggleRole = (role: Role) =>
    setRoles((current) => (current.includes(role) ? current.filter((item) => item !== role) : [...current, role]))

  const canSend = Boolean(title.trim() && body.trim()) && (
    sendTo === 'everyone' || (sendTo === 'roles' && roles.length > 0) || (sendTo === 'person' && targetUserId.trim())
  )

  const handleSend = () => {
    if (!canSend) return
    const base = { type: 'announcement' as const, title: title.trim(), message: body.trim(), linkedResourceId: undefined }
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
    setTargetUserId('')
  }

  const handleDelete = async (id: string) => {
    if (!(await confirmDialog({ title: 'Delete this notification?', message: 'It is removed for everyone who received it.', confirmLabel: 'Delete', danger: true }))) return
    deleteNotification(id)
    toast.success('Notification deleted.')
  }

  const handleClearAll = async () => {
    if (!(await confirmDialog({ title: 'Clear every notification?', message: 'Every account loses all of its notifications. This cannot be undone.', confirmLabel: 'Clear all', danger: true }))) return
    try {
      await clearAllNotifications()
      toast.success('All notifications cleared.')
    } catch (error: any) {
      toast.error(error?.message || 'Unable to clear notifications')
    }
  }

  const openNotification = (item: NotificationItem) => {
    markAsRead(item.id)
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
          <Button size="sm" variant="danger-soft" disabled={allSent.length === 0} onClick={handleClearAll}>
            <FiTrash2 /> Clear all
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
                  <input value={targetUserId} onChange={(e) => setTargetUserId(e.target.value)} className={fieldClass} placeholder="Account ID" />
                  <p className="mt-1 text-xs text-muted">The account ID shown on Players &amp; staff.</p>
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

            <Button onClick={handleSend} disabled={!canSend} className="w-full">
              <FiSend /> Send notification
            </Button>
          </div>
        </Card>

        {/* Sent notifications */}
        <Card className="p-4 md:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-bold">Sent notifications</h2>
            <span className="text-xs text-muted">{unread > 0 ? `${unread} unread · ` : ''}{allSent.length} total</span>
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
                      <div className={`min-w-0 text-sm ${item.read ? 'font-semibold' : 'font-bold'}`}>
                        {!item.read ? <span aria-label="Unread" className="mr-1.5 inline-block h-2 w-2 rounded-full bg-accent align-middle" /> : null}
                        {item.title}
                      </div>
                      <span className="shrink-0 text-xs text-muted">{timeLabel(item.createdAtISO, now)}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted">{kind.label} · To {recipientsOf(item)}</div>
                    <p className="mt-1 line-clamp-2 break-words text-sm text-muted">{item.message}</p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Delete ${item.title}`}
                    title="Delete"
                    onClick={(event) => {
                      event.stopPropagation()
                      void handleDelete(item.id)
                    }}
                    className="grid h-8 w-8 shrink-0 place-items-center self-center rounded-lg text-muted transition hover:bg-danger/10 hover:text-danger sm:opacity-0 sm:focus:opacity-100 sm:group-hover:opacity-100"
                  >
                    <FiTrash2 className="h-4 w-4" />
                  </button>
                </div>
              )
            })}</Paged>
            {visible.length === 0 ? <div className="py-8 text-center text-sm text-muted">No notifications here.</div> : null}
          </div>
        </Card>
      </div>
    </div>
  )
}
