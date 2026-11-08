import React, { useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { FiX } from 'react-icons/fi'
import { useAuth } from '../context/AuthContext'
import { AppSidebar } from '../components/nav/AppSidebar'
import { TopNav } from '../components/nav/TopNav'
import { ThemeToggle } from '../components/nav/ThemeToggle'

export function AppLayout() {
  const { user, logout } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  // Close the drawer whenever the page changes (back button, links inside a page, etc.).
  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  // While the drawer is open the page behind it shouldn't scroll, and Escape closes it.
  useEffect(() => {
    if (!mobileOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', onKey)
    }
  }, [mobileOpen])

  const sidebar = useMemo(
    () => (
      <AppSidebar
        onNavigate={() => setMobileOpen(false)}
        role={user?.role ?? 'user'}
        className="h-full"
      />
    ),
    [user?.role],
  )

  return (
    <div className="min-h-screen overflow-x-clip bg-background pt-[72px] text-text">
      <TopNav
        onMenu={() => setMobileOpen(true)}
        userName={user?.name ?? 'Operator'}
        onLogout={logout}
      />

      <div className="mx-auto max-w-[1400px] px-3 py-4 sm:px-4 sm:py-6 lg:px-6">
        <div className="relative flex gap-6">
          {/* Desktop Sidebar: stays in view while the page scrolls. */}
          <aside className="hidden w-[248px] shrink-0 lg:block">
            <div className="no-scrollbar sticky top-[96px] max-h-[calc(100vh-120px)] overflow-y-auto">{sidebar}</div>
          </aside>

          {/* Mobile Drawer */}
          <AnimatePresence>
            {mobileOpen && (
              <motion.div
                className="fixed inset-0 z-50 lg:hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div
                  className="absolute inset-0 bg-black/60"
                  onClick={() => setMobileOpen(false)}
                />
                <motion.div
                  initial={{ x: -20, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: -20, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 22 }}
                  className="absolute left-0 top-0 h-full w-[85vw] max-w-[300px] overflow-y-auto overscroll-contain bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Menu"
                >
                  <div className="flex items-center justify-between gap-2 px-2 py-2">
                    <div className="text-sm font-semibold">Menu</div>
                    <div className="flex items-center gap-1">
                      {/* The top bar hides the theme toggle on phones, so it lives here instead. */}
                      <div className="sm:hidden">
                        <ThemeToggle />
                      </div>
                      <button
                        onClick={() => setMobileOpen(false)}
                        className="hover-row rounded-xl p-2.5 text-text"
                        aria-label="Close menu"
                      >
                        <FiX />
                      </button>
                    </div>
                  </div>
                  {sidebar}
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          <main className="min-w-0 flex-1">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="min-w-0"
            >
              <Outlet />
            </motion.div>
          </main>
        </div>

        <footer className="py-8 text-center text-xs text-muted">
          © {new Date().getFullYear()} Chill Shooters Airsoft — Aim. Book. Play.
        </footer>
      </div>
    </div>
  )
}
