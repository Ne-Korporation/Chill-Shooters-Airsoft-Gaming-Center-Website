import React, { useMemo, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { FiX } from 'react-icons/fi'
import { useAuth } from '../context/AuthContext'
import { AppSidebar } from '../components/nav/AppSidebar'
import { TopNav } from '../components/nav/TopNav'

export function AppLayout() {
  const { user, logout } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

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
    <div className="min-h-screen bg-background text-text pt-20 print:pt-0">
      <div className="print:hidden">
        <TopNav
          onMenu={() => setMobileOpen(true)}
          userName={user?.name ?? 'Operator'}
          onLogout={logout}
        />
      </div>

      <div className="mx-auto max-w-[1400px] px-3 py-4 lg:px-6">
        <div className="relative flex gap-4">
          {/* Desktop Sidebar */}
          <aside className="hidden w-[280px] shrink-0 lg:block">{sidebar}</aside>

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
                  className="absolute left-0 top-0 h-full w-[280px]"
                >
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="text-xs uppercase tracking-widest text-muted">A.B.P</div>
                    <button
                      onClick={() => setMobileOpen(false)}
                      className="rounded-xl glass p-2 text-text hover:bg-white/5"
                      aria-label="Close menu"
                    >
                      <FiX />
                    </button>
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
              className="glass rounded-xl p-4 md:p-6"
            >
              <Outlet />
            </motion.div>
          </main>
        </div>

        <footer className="py-10 text-center text-xs text-muted">
          © {new Date().getFullYear()} Chill Shooters Airsoft — Aim. Book. Play.
        </footer>
      </div>
    </div>
  )
}

