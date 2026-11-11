import React, { useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FiBell, FiLogOut, FiMenu } from 'react-icons/fi'
import { Link, useNavigate } from 'react-router-dom'
import { ThemeToggle } from './ThemeToggle'
import { useTheme } from '../../context/ThemeContext'
import { useAuth } from '../../context/AuthContext'
import { useNotifications } from '../../context/NotificationContext'
import { resolveNotificationRoute } from '../../utils/notificationRoutes'
import { kindOf, timeLabel } from '../../utils/notificationDisplay'

function NotificationBell({ userId, role }: { userId: string; role?: string }) {
  const { notifications, unreadCount, markAsRead, markAllAsRead, getNotificationsForRole } = useNotifications()
  const roleNotifs = useMemo(() => getNotificationsForRole(role || 'user', userId), [getNotificationsForRole, role, userId])
  const count = roleNotifs.filter((n) => !n.read).length
  const [open, setOpen] = React.useState(false)
  const navigate = useNavigate()
  const dropdownRef = React.useRef<HTMLDivElement>(null)

  // The bell is the only way into notifications: a short scrolling list of the latest, then "View all".
  const userNotifications = roleNotifs.slice(0, 20)
  const now = new Date()

  // Close on click/tap outside or Escape
  React.useEffect(() => {
    if (!open) return
    const handleClick = (e: PointerEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('pointerdown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="hover-row relative rounded-xl p-2.5 text-text"
        aria-label="Notifications"
        aria-expanded={open}
      >
        <FiBell className="text-lg" />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-danger text-[10px] font-bold text-white ring-2 ring-background">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            // Phones: pinned under the header, full width with a small gutter, so it never runs off-screen.
            // sm and up: a dropdown anchored to the bell.
            className="surface fixed inset-x-3 top-[80px] z-50 flex max-h-[calc(100dvh-96px)] flex-col rounded-2xl p-3 shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-3 sm:max-h-none sm:w-96"
          >
            <div className="flex shrink-0 items-center justify-between px-1 pb-3">
              <div className="text-sm font-semibold text-text">Notifications</div>
              {count > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    markAllAsRead(userId, role)
                  }}
                  className="-my-1 rounded-lg px-2 py-1 text-xs text-accent hover:underline"
                >
                  Mark all read
                </button>
              )}
            </div>

            {userNotifications.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted">No notifications yet</div>
            ) : (
              <div className="-mx-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-1 sm:max-h-[min(420px,60vh)]">
                {userNotifications.map((n) => {
                  const Icon = kindOf(n).icon
                  return (
                    <button
                      key={n.id}
                      type="button"
                      title={`${n.title}\n${n.message}`}
                      onClick={() => {
                        markAsRead(n.id)
                        const destination = resolveNotificationRoute(n, role, userId)
                        if (destination) navigate(destination)
                        else navigate('/app/notifications')
                        setOpen(false)
                      }}
                      className={`hover-row flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2.5 text-left ${!n.read ? 'bg-accent/10' : ''}`}
                    >
                      <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${n.read ? 'bg-[rgba(var(--text),0.06)] text-muted' : 'bg-accent/15 text-accent'}`}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className={`min-w-0 flex-1 truncate text-[13px] text-text ${n.read ? 'font-medium' : 'font-semibold'}`}>{n.title}</span>
                          <span className="shrink-0 text-[10px] text-muted">{timeLabel(n.createdAtISO, now)}</span>
                        </span>
                        {/* Two lines instead of one so the message is readable on narrow screens. */}
                        <span className="mt-0.5 line-clamp-2 break-words text-xs text-muted">{n.message}</span>
                      </span>
                      {!n.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                    </button>
                  )
                })}
              </div>
            )}

            <div className="divider mt-3 shrink-0 border-t pt-3">
              <button
                type="button"
                onClick={() => {
                  navigate('/app/notifications')
                  setOpen(false)
                }}
                className="hover-row w-full rounded-xl px-3 py-2.5 text-center text-sm font-medium text-text"
              >
                View all notifications
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}


const roleLabels: Record<string, string> = {
  admin: 'Admin',
  marshal: 'Marshal',
  registrar: 'Registrar',
  user: 'Player',
}

export function TopNav({
  onMenu,
  userName,
  onLogout,
}: {
  onMenu: () => void
  userName: string
  onLogout: () => void
}) {
  const { theme } = useTheme()
  const { user } = useAuth()
  const [showLogoutMenu, setShowLogoutMenu] = React.useState(false)
  const logoutRef = React.useRef<HTMLDivElement>(null)
  const initial = (userName || '?').trim().charAt(0).toUpperCase()

  // Close the logout confirm on click outside
  React.useEffect(() => {
    if (!showLogoutMenu) return
    const handleClick = (e: MouseEvent) => {
      if (logoutRef.current && !logoutRef.current.contains(e.target as Node)) {
        setShowLogoutMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showLogoutMenu])

  return (
    <header className="divider fixed left-0 right-0 top-0 z-40 border-b bg-[rgba(var(--bg),0.85)] backdrop-blur">
      <div className="mx-auto flex h-[72px] max-w-[1400px] items-center justify-between px-3 lg:px-6">
        <div className="flex items-center gap-2">
          <button
            className="hover-row rounded-xl p-2.5 text-text lg:hidden"
            onClick={onMenu}
            aria-label="Open menu"
          >
            <FiMenu />
          </button>

          <Link to="/app" className="flex items-center gap-2.5">
            <img
              src={theme === 'light' ? '/loggingwebdark.png' : '/logingweb.png'}
              alt="Chill Shooters logo"
              className="h-10 w-10 object-contain"
            />
            <div className="hidden leading-tight sm:block">
              <div className="text-sm font-bold">Chill Shooters</div>
              <div className="text-[11px] text-muted">Airsoft Gaming Center</div>
            </div>
          </Link>
        </div>

        <div className="flex items-center gap-1.5">
          {user?.id && <NotificationBell userId={user.id} role={user.role} />}

          <div className="hidden sm:block">
            <ThemeToggle />
          </div>

          <div className="divider mx-2 hidden h-8 border-l md:block" />

          <Link
            to={user?.id ? `/app/players/${encodeURIComponent(user.id)}` : '/app'}
            className="hover-row flex items-center gap-2.5 rounded-xl px-1.5 py-1"
            title="View profile"
            aria-label="View profile"
          >
            <span className="chip-accent grid h-9 w-9 place-items-center rounded-full text-sm font-semibold">{initial}</span>
            <div className="hidden leading-tight md:block">
              <div className="max-w-[160px] truncate text-sm font-medium">{userName}</div>
              <div className="text-[11px] text-muted">{roleLabels[user?.role || 'user'] || 'Player'}</div>
            </div>
          </Link>

          <div className="relative ml-1" ref={logoutRef}>
            <button
              type="button"
              onClick={() => setShowLogoutMenu((prev) => !prev)}
              className="hover-row rounded-xl p-2.5 text-muted hover:text-text"
              aria-label="Log out"
              title="Log out"
            >
              <FiLogOut />
            </button>

            {showLogoutMenu && (
              <div className="surface absolute right-0 top-full mt-3 w-56 rounded-2xl p-3 shadow-xl">
                <div className="px-1 pb-3 text-sm font-medium text-text">Log out of your account?</div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowLogoutMenu(false)}
                    className="surface hover-row flex-1 rounded-lg px-3 py-2 text-sm text-text"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowLogoutMenu(false)
                      onLogout()
                    }}
                    className="flex-1 rounded-lg bg-danger px-3 py-2 text-sm font-semibold text-white transition hover:brightness-110"
                  >
                    Log out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
