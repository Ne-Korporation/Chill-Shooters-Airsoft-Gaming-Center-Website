import React, { useMemo, useState } from 'react'
import { confirmDialog } from '../../components/ui/ConfirmDialog'
import toast from 'react-hot-toast'
import { FiArrowLeft, FiBell, FiCheck, FiTrash2, FiX } from 'react-icons/fi'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { FilterTabs } from '../../components/ui/FilterTabs'
import { useAuth } from '../../context/AuthContext'
import { useNotifications, type NotificationItem } from '../../context/NotificationContext'
import { NotificationDetailModal } from '../../components/nav/NotificationDetailModal'
import { resolveNotificationRoute } from '../../utils/notificationRoutes'
import { groupOf, kindOf, timeLabel } from '../../utils/notificationDisplay'

const PAGE_SIZE = 20

type Filter = 'all' | 'unread'

// A player's (or registrar's / marshal's) own notifications. Admins get the compose-and-review page.
export function MyNotificationsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { loading, getNotificationsForRole, markAsRead, markAllAsRead, deleteNotification, clearNotificationsByIds } = useNotifications()
  const [filter, setFilter] = useState<Filter>('all')
  const [shown, setShown] = useState(PAGE_SIZE)
  // The notification opened in its detail pop-up (same pop-up as the bell).
  const [detail, setDetail] = useState<NotificationItem | null>(null)

  const role = user?.role || 'user'
  const all = useMemo(() => getNotificationsForRole(role, user?.id), [getNotificationsForRole, role, user?.id])
  const unread = all.filter((item) => !item.read).length
  const list = filter === 'unread' ? all.filter((item) => !item.read) : all
  const visible = list.slice(0, shown)
  const now = new Date()

  const groups: Array<{ label: string; items: NotificationItem[] }> = []
  for (const item of visible) {
    const label = groupOf(item.createdAtISO, now)
    const last = groups[groups.length - 1]
    if (last?.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }

  // Back to wherever the player came from; straight to the dashboard if they opened this page directly.
  const goBack = () => {
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1)
    else navigate('/app')
  }

  // Opens the page the notification is about (My Reservations, Split Payment, Waiver…). Ones with
  // no page of their own, like announcements, open in the pop-up to be read in full.
  const open = (item: NotificationItem) => {
    if (!item.read) markAsRead(item.id)
    const destination = resolveNotificationRoute(item, role, user?.id)
    if (destination && destination !== '/app/notifications') navigate(destination)
    else setDetail(item)
  }
  // Hides every notification on this account's list. Nothing is deleted: the server keeps each one
  // on record (the admin's Sent notifications log still lists it).
  const [clearing, setClearing] = useState(false)
  const clearAll = async () => {
    if (!(await confirmDialog({ title: `Remove all ${all.length} notification${all.length === 1 ? '' : 's'}?`, message: 'They will be removed from your list.', confirmLabel: 'Remove all', danger: true }))) return
    setClearing(true)
    try {
      await clearNotificationsByIds(all.map((item) => item.id))
      toast.success('Notifications removed from your list')
    } catch (error: any) {
      toast.error(error?.message || 'Could not clear your notifications')
    } finally {
      setClearing(false)
    }
  }

  const dismiss = (item: NotificationItem) => {
    deleteNotification(item.id)
    toast.success('Notification removed')
  }

  return (
    <div className="space-y-4">
      <div>
        <button type="button" onClick={goBack} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-muted transition hover:text-text">
          <FiArrowLeft /> Back
        </button>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">Notifications</h1>
            <p className="mt-1 text-sm text-muted">
              {loading ? 'Loading…' : unread ? `You have ${unread} unread.` : "You're all caught up."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {unread > 0 ? (
              <Button size="sm" variant="ghost" onClick={() => user?.id && markAllAsRead(user.id, role)}>
                <FiCheck /> Mark all as read
              </Button>
            ) : null}
            {all.length > 0 ? (
              <Button size="sm" variant="danger-soft" disabled={clearing} onClick={clearAll}>
                <FiTrash2 /> {clearing ? 'Clearing…' : 'Clear all'}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <FilterTabs
        ariaLabel="Show notifications"
        value={filter}
        onChange={(value) => { setFilter(value); setShown(PAGE_SIZE) }}
        options={[
          { value: 'all', label: 'All', count: all.length },
          { value: 'unread', label: 'Unread', count: unread },
        ]}
      />

      <div className="surface rounded-2xl p-2 md:p-3">
        {loading ? (
          <div className="space-y-2 p-2">
            {[0, 1, 2].map((key) => <div key={key} className="skeleton h-16 w-full rounded-xl" />)}
          </div>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <FiBell className="h-8 w-8 text-muted" />
            <div className="text-sm font-semibold">{filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}</div>
            <div className="text-xs text-muted">Booking, payment and waiver updates will show up here.</div>
          </div>
        ) : (
          <div className="space-y-2">
            {groups.map((group) => (
              <section key={group.label}>
                <h2 className="px-2 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{group.label}</h2>
                <ul className="divide-y divide-white/5">
                  {group.items.map((item) => {
                    const kind = kindOf(item)
                    const Icon = kind.icon
                    // One compact row: icon, title and time on one line, the message on one line under it.
                    return (
                      <li key={item.id} className="group relative">
                        <button
                          type="button"
                          onClick={() => open(item)}
                          title={kind.label}
                          className={`hover-row flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 pr-10 text-left ${item.read ? '' : 'bg-accent/5'}`}
                        >
                          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${item.read ? 'bg-[rgba(var(--text),0.06)] text-muted' : 'bg-accent/15 text-accent'}`}>
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline gap-2">
                              {!item.read ? <span className="h-1.5 w-1.5 shrink-0 self-center rounded-full bg-accent" aria-label="Unread" /> : null}
                              <span className={`min-w-0 flex-1 truncate text-sm ${item.read ? 'font-medium' : 'font-semibold'}`}>{item.title}</span>
                              <span className="shrink-0 text-[11px] text-muted">{timeLabel(item.createdAtISO, now)}</span>
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-muted">{item.message}</span>
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => dismiss(item)}
                          aria-label="Remove notification"
                          title="Remove"
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted transition hover:bg-danger/10 hover:text-danger sm:opacity-0 sm:focus:opacity-100 sm:group-hover:opacity-100"
                        >
                          <FiX className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
            {list.length > shown ? (
              <div className="pb-1 text-center">
                <Button size="sm" variant="ghost" onClick={() => setShown((count) => count + PAGE_SIZE)}>
                  Show older ({list.length - shown} more)
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {detail && user?.id ? <NotificationDetailModal notification={detail} role={role} userId={user.id} onClose={() => setDetail(null)} onRemove={() => { dismiss(detail); setDetail(null) }} /> : null}
    </div>
  )
}
