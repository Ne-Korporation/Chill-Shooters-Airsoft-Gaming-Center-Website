import React from 'react'
import { motion } from 'framer-motion'
import { FiLogOut } from 'react-icons/fi'
import { IoShieldCheckmarkOutline } from 'react-icons/io5'
import { FiMenu } from 'react-icons/fi'
import { ThemeToggle } from './ThemeToggle'
import { useTheme } from '../../context/ThemeContext'


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
            {/* Theme toggle */}
            <div className="hidden sm:block">
              <ThemeToggle />
            </div>
            <button
              onClick={onLogout}
              className="rounded-xl glass p-2 text-text hover:bg-white/5"
              aria-label="Logout"
            >
              <FiLogOut />
            </button>
          </div>

        </div>
      </div>
    </motion.header>
  )
}

