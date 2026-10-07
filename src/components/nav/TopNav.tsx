import React, { useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FiBell, FiLogOut } from 'react-icons/fi'
import { IoShieldCheckmarkOutline } from 'react-icons/io5'
import { FiMenu } from 'react-icons/fi'
import { useNavigate } from 'react-router-dom'
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
        className="relative rounded-xl glass p-2 text-text hover:bg-white/5"
        aria-label="Notifications"
      >
        <FiBell className="text-lg" />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-success text-[10px] font-bold text-white ring-2 ring-background">
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
            className="absolute right-0 top-full mt-4 w-80 rounded-2xl border border-white/15 bg-[#0f0f10]/95 p-3 shadow-2xl backdrop-blur-sm"
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
                    className={`w-full rounded-xl px-3 py-3 text-left transition hover:bg-white/5 ${
                      !n.read ? 'border-l-2 border-success bg-success/5' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-bold text-text">{n.title}</div>
                      {!n.read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-success" />}
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

            <div className="mt-3 border-t border-white/10 pt-3">
              <button
                type="button"
                onClick={() => {
                  navigate('/app/notifications')
                  setOpen(false)
                }}
                className="w-full rounded-xl bg-white/10 px-3 py-2 text-center text-sm font-semibold text-text transition hover:bg-white/15"
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

  return (
    <motion.header
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="fixed left-0 right-0 top-0 z-40 border-b border-white/5 bg-background/70 backdrop-blur"
    >
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-3 py-3 lg:px-6">
        <div className="flex items-center gap-3">
          <button
            className="lg:hidden rounded-xl glass p-2 text-text hover:bg-white/5"
            onClick={onMenu}
            aria-label="Open menu"
          >
            <FiMenu />
          </button>

          <div className="flex items-center gap-3">
            <div className="relative">
              <img
                src={theme === 'light' ? '/loggingwebdark.png' : '/logingweb.png'}
                alt="A.B.P logo"
                className="h-12 w-12 object-contain md:h-14 md:w-14"
              />
            </div>
            <div>
              <div className="text-sm font-bold tracking-wide">Chill Shooters Airsoft Gaming Center</div>
              <div className="text-[11px] text-muted">Airsoft Gaming Center</div>
            </div>
          </div> 
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2 rounded-xl glass px-3 py-2">
            <IoShieldCheckmarkOutline className="text-accent" />
            <div className="text-xs">
              <div className="font-semibold leading-4">Operator</div>
              <div className="text-muted leading-4">{userName}</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Notification Bell */}
            {user?.id && <NotificationBell userId={user.id} role={user.role} />}

            {/* Theme toggle */}
            <div className="hidden sm:block">
              <ThemeToggle />
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowLogoutMenu((prev) => !prev)}
                className="rounded-xl glass p-2 text-text hover:bg-white/5"
                aria-label="Logout"
              >
                <FiLogOut />
              </button>

              {showLogoutMenu && (
                <div className="absolute right-0 top-full mt-4 w-56 rounded-2xl border border-white/15 bg-[#0f0f10]/95 p-3 shadow-2xl backdrop-blur-sm">
                  <div className="px-1 pb-3 text-sm font-semibold text-text">Continue to logout?</div>
                  <div className="flex gap-2.5">
                    <button
                      type="button"
                      onClick={() => setShowLogoutMenu(false)}
                      className="flex-1 rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-muted transition hover:bg-white/15"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowLogoutMenu(false)
                        onLogout()
                      }}
                      className="flex-1 rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold text-text transition hover:bg-white/20"
                    >
                      Yes
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </motion.header>
  )
}

