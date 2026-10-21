import React, { useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FiBell, FiLogOut, FiMenu } from 'react-icons/fi'
import { Link, useNavigate } from 'react-router-dom'
import { ThemeToggle } from './ThemeToggle'
import { useTheme } from '../../context/ThemeContext'
import { useAuth } from '../../context/AuthContext'
import { useNotifications } from '../../context/NotificationContext'
import { resolveNotificationRoute } from '../../utils/notificationRoutes'

function NotificationBell({ userId, role }: { userId: string; role?: string }) {
  const { notifications, unreadCount, markAsRead, markAllAsRead, getNotificationsForRole } = useNotifications()
  const roleNotifs = useMemo(() => getNotificationsForRole(role || 'user', userId), [getNotificationsForRole, role, userId])
  const count = roleNotifs.filter((n) => !n.read).length
  const [open, setOpen] = React.useState(false)
  const navigate = useNavigate()
  const dropdownRef = React.useRef<HTMLDivElement>(null)

  const userNotifications = roleNotifs.slice(0, 5)

  // Close on click outside
  React.useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="hover-row relative rounded-xl p-2 text-text"
        aria-label="Notifications"
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
            className="surface absolute right-0 top-full mt-3 w-80 rounded-2xl p-3 shadow-xl"
          >
            <div className="flex items-center justify-between px-1 pb-3">
              <div className="text-sm font-semibold text-text">Notifications</div>
              {count > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    markAllAsRead(userId, role)
                  }}
                  className="text-xs text-accent hover:underline"
                >
                  Mark all read
                </button>
              )}
            </div>

            {userNotifications.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted">No notifications yet</div>
            ) : (
              <div className="space-y-1">
                {userNotifications.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => {
                      markAsRead(n.id)
                      const destination = resolveNotificationRoute(n, role, userId)
                      if (destination) navigate(destination)
                      else navigate('/app/notifications')
                      setOpen(false)
                    }}
                    className={`hover-row w-full rounded-xl px-3 py-3 text-left ${
                      !n.read ? 'bg-[rgba(197,163,90,0.08)]' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-semibold text-text">{n.title}</div>
                      {!n.read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent" />}
                    </div>
                    <div className="mt-1 text-xs text-muted line-clamp-2">{n.message}</div>
                    <div className="mt-2 text-[10px] text-muted">
                      {new Date(n.createdAtISO).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </button>
                ))}
              </div>
            )}

            <div className="divider mt-3 border-t pt-3">
              <button
                type="button"
                onClick={() => {
                  navigate('/app/notifications')
                  setOpen(false)
                }}
                className="hover-row w-full rounded-xl px-3 py-2 text-center text-sm font-medium text-text"
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
            className="hover-row rounded-xl p-2 text-text lg:hidden"
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

          <div className="hidden items-center gap-2.5 md:flex">
            <span className="chip-accent grid h-9 w-9 place-items-center rounded-full text-sm font-semibold">{initial}</span>
            <div className="leading-tight">
              <div className="max-w-[160px] truncate text-sm font-medium">{userName}</div>
              <div className="text-[11px] text-muted">{roleLabels[user?.role || 'user'] || 'Player'}</div>
            </div>
          </div>

          <div className="relative ml-1" ref={logoutRef}>
            <button
              type="button"
              onClick={() => setShowLogoutMenu((prev) => !prev)}
              className="hover-row rounded-xl p-2 text-muted hover:text-text"
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
