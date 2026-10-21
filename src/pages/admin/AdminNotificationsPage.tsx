import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { useAuth } from '../../context/AuthContext'
import { useNotifications } from '../../context/NotificationContext'
import { resolveNotificationRoute } from '../../utils/notificationRoutes'
import toast from 'react-hot-toast'

type NotifChannel = 'system' | 'email'

type Audience = 'all' | 'users' | 'admins' | 'registrars' | 'marshals'

export function AdminNotificationsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const isAdmin = user?.role === 'admin'
  const { addNotification, deleteNotification, getNotificationsForRole, getAllNotifications, markAsRead, markAllAsRead, clearAllNotifications, clearNotificationsByIds } = useNotifications()
  const [channel, setChannel] = useState<NotifChannel>('system')
  const [title, setTitle] = useState('Weekend package reminder')
  const [body, setBody] = useState('Please confirm the equipment checklist for the Saturday booking before 5:00 PM.')
  const [targetUserId, setTargetUserId] = useState('')
  const [sendMode, setSendMode] = useState<'audience' | 'user'>('audience')
  const [feedAudience, setFeedAudience] = useState<Audience>('all')
  const [selectedAudiences, setSelectedAudiences] = useState<Audience[]>(['users'])

  const currentRole = user?.role || 'user'
  const roleNotifications = useMemo(() => {
    return [...getNotificationsForRole(currentRole, user?.id)].sort(
      (a, b) => new Date(b.createdAtISO).getTime() - new Date(a.createdAtISO).getTime(),
    )
  }, [currentRole, getNotificationsForRole, user?.id])

  const allSentNotifications = useMemo(() => {
    return [...getAllNotifications()].sort((a, b) => new Date(b.createdAtISO).getTime() - new Date(a.createdAtISO).getTime())
  }, [getAllNotifications])

  const visibleNotifications = useMemo(() => {
    if (!isAdmin) return roleNotifications
    if (feedAudience === 'all') return allSentNotifications
    return allSentNotifications.filter((item) => {
      if (feedAudience === 'users') return item.targetRole === 'user' || (!item.targetRole && item.userId !== 'broadcast')
      if (feedAudience === 'admins') return item.targetRole === 'admin'
      if (feedAudience === 'registrars') return item.targetRole === 'registrar'
      if (feedAudience === 'marshals') return item.targetRole === 'marshal'
      return true
    })
  }, [allSentNotifications, feedAudience, isAdmin, roleNotifications])

  const toggleAudience = (audience: Audience) => {
    setSelectedAudiences((prev) => {
      if (audience === 'all') return ['all']
      const next = prev.filter((item) => item !== 'all')
      return next.includes(audience) ? next.filter((item) => item !== audience) : [...next, audience]
    })
  }

  const handleSendToUser = () => {
    if (!targetUserId.trim()) {
      toast.error('Please enter a target user ID.')
      return
    }
    addNotification({
      userId: targetUserId.trim(),
      type: 'payment_submitted',
      title: title.trim() || 'Admin notification',
      message: body.trim() || 'No message.',
      linkedResourceId: undefined,
    })
    toast.success(`Notification sent to user ${targetUserId.trim()}`)
    setTargetUserId('')
  }

  const handleSend = () => {
    if (sendMode === 'user') {
      handleSendToUser()
      return
    }
    handleBroadcast()
  }

  const handleBroadcast = () => {
    const audienceToTargetRole: Record<Audience, 'user' | 'registrar' | 'marshal' | 'admin' | 'all'> = {
      all: 'all',
      users: 'user',
      admins: 'admin',
      registrars: 'registrar',
      marshals: 'marshal',
    }
    const targets: Audience[] = selectedAudiences.length > 0 ? selectedAudiences : ['users']
    targets.forEach((audience) => {
      addNotification({
        userId: 'broadcast',
        targetRole: audienceToTargetRole[audience] || 'all',
        type: 'payment_submitted',
        title: title.trim() || 'Broadcast notification',
        message: body.trim() || 'No message.',
        linkedResourceId: undefined,
      })
    })
    toast.success(`Broadcast notification sent to ${targets.map((item) => item.toUpperCase()).join(', ')}.`)
  }

  const handleDeleteNotification = (id: string) => {
    deleteNotification(id)
    toast.success('Notification deleted.')
  }

  const handleNotificationClick = (item: ReturnType<typeof getAllNotifications>[number]) => {
    const destination = resolveNotificationRoute(item, user?.role, user?.id)
    markAsRead(item.id)
    if (destination) {
      navigate(destination)
      return
    }
    toast.error('No destination is assigned to this notification yet.')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Notifications</h1>
          <p className="mt-1 text-sm text-muted">View your notifications and manage delivery only if you are an admin.</p>
        </div>

        <div className="flex items-center gap-2 self-end">
          {!isAdmin ? (
            <>
              <Button variant="ghost" onClick={() => user?.id ? markAllAsRead(user.id, user.role) : null}>Mark all as read</Button>
              <Button
                type="button"
                variant="danger"
                onClick={async () => {
                  if (!window.confirm('Clear all notifications visible to you? This cannot be undone.')) return

                  try {
                    await clearNotificationsByIds(roleNotifications.map((notification) => notification.id))
                    toast.success('Your notifications were cleared.')
                  } catch (error: any) {
                    toast.error(error?.message || 'Unable to clear your notifications')
                  }
                }}
              >
                Clear all
              </Button>
            </>
          ) : null}

          {isAdmin ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="danger"
                onClick={async () => {
                  if (window.confirm('Clear all notifications from the database? This cannot be undone.')) {
                    try {
                      await clearAllNotifications()
                      toast.success('All notifications cleared.')
                    } catch (error: any) {
                      toast.error(error?.message || 'Unable to clear notifications')
                    }
                  }
                }}
              >
                Clear all
              </Button>
              {(['all', 'users', 'admins', 'registrars', 'marshals'] as Audience[]).map((item) => (
                <button
                  key={item}
                  onClick={() => setFeedAudience(item)}
                  className={
                    'rounded-xl border px-3 py-2 text-sm transition ' +
                    (feedAudience === item
                      ? 'bg-white/8 text-text border-accent/30'
                      : 'bg-white/5 text-muted hover:bg-white/6')
                  }
                >
                  {item === 'all' ? 'ALL' : item.toUpperCase()}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-3xl border border-white/5 bg-white/5 p-4">
        <div className={isAdmin ? 'grid gap-4 lg:grid-cols-[1.15fr_0.85fr]' : 'grid gap-4'}>
          {isAdmin ? (
            <div className="rounded-2xl border border-white/5 bg-background/70 p-4">
              <div className="text-xs uppercase tracking-widest text-muted">Compose notification</div>
              <div className="mt-2 text-sm text-muted">Use this panel to prepare operating alerts for staff or players.</div>

              <div className="mt-4 space-y-4">
                <div className="rounded-xl border border-white/5 bg-white/5 p-3">
                  <div className="text-xs text-muted">Audience</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSendMode('audience')
                        setTargetUserId('')
                      }}
                      className={['rounded-xl border px-3 py-2 text-sm transition', sendMode === 'audience' ? 'bg-white/8 text-text border-accent/30' : 'bg-white/5 text-muted hover:bg-white/6'].join(' ')}
                    >
                      Select audience
                    </button>
                    <button
                      type="button"
                      onClick={() => setSendMode('user')}
                      className={['rounded-xl border px-3 py-2 text-sm transition', sendMode === 'user' ? 'bg-white/8 text-text border-accent/30' : 'bg-white/5 text-muted hover:bg-white/6'].join(' ')}
                    >
                      Send to a user
                    </button>
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {(['users', 'marshals', 'registrars', 'admins', 'all'] as Audience[]).map((item) => (
                      <label key={item} className={['flex items-center gap-2 rounded-xl border px-3 py-2 text-sm text-text', sendMode === 'user' ? 'border-white/5 bg-white/5 opacity-50' : 'border-white/10 bg-white/5'].join(' ')}>
                        <input
                          type="checkbox"
                          checked={selectedAudiences.includes(item)}
                          disabled={sendMode === 'user'}
                          onChange={() => toggleAudience(item)}
                          className="h-4 w-4 accent-[var(--color-accent)]"
                        />
                        <span>{item === 'all' ? 'All' : item.slice(0, 1).toUpperCase() + item.slice(1)}</span>
                      </label>
                    ))}
                  </div>

                  {sendMode === 'user' ? (
                    <div className="mt-3">
                      <div className="text-xs text-muted">Send to specific user</div>
                      <input
                        value={targetUserId}
                        onChange={(e) => setTargetUserId(e.target.value)}
                        className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text placeholder:text-muted"
                        placeholder="Enter user ID"
                      />
                    </div>
                  ) : null}
                </div>

                <div>
                  <div className="text-xs text-muted">Delivery channel</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(['system', 'email'] as const).map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setChannel(item)}
                        className={['rounded-xl border px-3 py-2 text-sm transition', channel === item ? 'bg-white/8 text-text border-accent/30' : 'bg-white/5 text-muted hover:bg-white/6'].join(' ')}
                      >
                        {item.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="block">
                  <div className="mb-2 text-sm font-semibold text-text">Title</div>
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text placeholder:text-muted"
                    placeholder="Brief notification title"
                  />
                </label>

                <label className="block">
                  <div className="mb-2 text-sm font-semibold text-text">Message body</div>
                  <textarea
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    rows={4}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text placeholder:text-muted"
                    placeholder="Describe the update or instruction"
                  />
                </label>

                <Button onClick={handleSend} variant="ghost" className="w-full">
                  Send notification
                </Button>
              </div>
            </div>
          ) : null}

          <div className="rounded-2xl border border-white/5 bg-background/70 p-4">
            <div className="text-xs uppercase tracking-widest text-muted">Delivery feed</div>
            <div className="mt-2 text-sm text-muted">{isAdmin ? 'Filter by account type to review sent notifications.' : 'Your notifications from the system.'}</div>

            <div className="mt-4 space-y-2">
              {visibleNotifications.map((draft) => (
                <div
                  key={draft.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleNotificationClick(draft)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      handleNotificationClick(draft)
                    }
                  }}
                  className="cursor-pointer rounded-xl border border-white/5 bg-white/5/60 px-3 py-2 transition hover:bg-white/10"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{draft.title}</div>
                      <div className="mt-1 text-xs text-muted">
                        {draft.type.toUpperCase()} • {draft.targetRole?.toUpperCase() || 'DIRECT'}
                      </div>
                    </div>
                    <span
                      className={[
                        'inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold',
                        draft.read ? 'bg-white/5 text-muted border-white/10' : 'bg-success/15 text-success border-success/30',
                      ].join(' ')}
                    >
                      {draft.read ? 'READ' : 'NEW'}
                    </span>
                  </div>
                  <div className="mt-2 text-sm text-muted">{draft.message}</div>
                  <div className="mt-2 flex justify-end">
                    {isAdmin ? (
                      <button
                        onClick={(event) => {
                          event.stopPropagation()
                          handleDeleteNotification(draft.id)
                        }}
                        className="rounded-xl border border-danger/20 bg-danger/10 px-3 py-2 text-xs text-danger transition hover:bg-danger/20"
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
              {visibleNotifications.length === 0 && (
                <div className="p-6 text-sm text-muted">No notifications found.</div>
              )}
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}

