import React from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import type { IconType } from 'react-icons'
import { useAuth } from '../../context/AuthContext'
import { useNotifications } from '../../context/NotificationContext'
import {
  FiGrid,
  FiCalendar,
  FiPackage,
  FiUsers,
  FiUser,
  FiSearch,
  FiBarChart2,
  FiFileText,
  FiBell,
  FiSettings,
  FiTruck,
  FiShield,
  FiTool,
  FiZap,
  FiClipboard,
  FiCreditCard,
  FiTarget,
  FiBriefcase,
} from 'react-icons/fi'

type Role = 'user' | 'admin' | 'marshal' | 'registrar'

type Item = {
  label: string
  to: string
  icon: IconType
  roles?: Role[]
}

const baseItems: Item[] = [
  // Shared items the operator/registrar/marshal can see; admin gets only the admin module nav.
  { label: 'Dashboard Home', to: '/app', icon: FiGrid, roles: ['user'] },
  { label: 'Reservations', to: '/app/reservations', icon: FiCalendar, roles: ['user'] },
  { label: 'Recommended Packages', to: '/app/packages', icon: FiPackage, roles: ['user'] },
  { label: 'Online Waiver', to: '/app/waiver', icon: FiShield, roles: ['user'] },
]



const marshalItems: Item[] = [
  { label: 'Marshal Dashboard', to: '/app', icon: FiGrid, roles: ['marshal'] },
  { label: 'Games', to: '/app/games', icon: FiZap, roles: ['marshal'] },
  { label: 'Equipment', to: '/app/admin/equipment', icon: FiTool, roles: ['marshal'] },
  { label: 'Weapons', to: '/app/admin/weapons', icon: FiTruck, roles: ['marshal'] },
]


const adminItems: Item[] = [
  { label: 'Admin Dashboard', to: '/app/admin', icon: FiGrid, roles: ['admin'] },
  { label: 'Analytics', to: '/app/admin/reports', icon: FiBarChart2, roles: ['admin'] },
  { label: 'Reservation Management', to: '/app/admin/reservation-management', icon: FiCalendar, roles: ['admin'] },
  { label: 'Games', to: '/app/games', icon: FiZap, roles: ['admin'] },
  { label: 'Users', to: '/app/admin/player-management', icon: FiUsers, roles: ['admin'] },
  { label: 'Equipment', to: '/app/admin/equipment', icon: FiTool, roles: ['admin'] },
  { label: 'Weapons', to: '/app/admin/weapons', icon: FiTruck, roles: ['admin'] },
  { label: 'Waivers', to: '/app/admin/waivers', icon: FiShield, roles: ['admin'] },
  { label: 'Rental Packages', to: '/app/admin/rental-packages', icon: FiPackage, roles: ['admin'] },
  { label: 'Payments', to: '/app/admin/payments', icon: FiCreditCard, roles: ['admin'] },
  { label: 'Partnerships', to: '/app/admin/partnerships', icon: FiBriefcase, roles: ['admin'] },
  { label: 'Audit Logs', to: '/app/admin/audit-logs', icon: FiFileText, roles: ['admin'] },
]

const registrarItems: Item[] = [
  { label: 'Reservations', to: '/app/registrar/reservations', icon: FiCalendar, roles: ['registrar'] },
  { label: 'Games', to: '/app/registrar/games', icon: FiZap, roles: ['registrar'] },
  { label: 'Availed Packages', to: '/app/registrar/availed-packages', icon: FiPackage, roles: ['registrar'] },
  { label: 'Submitted Waivers', to: '/app/registrar/waivers', icon: FiShield, roles: ['registrar'] },
  { label: 'Submitted Payments', to: '/app/registrar/submitted-payments', icon: FiCreditCard, roles: ['registrar'] },
]



export function AppSidebar({
  role,
  onNavigate,
  className,
}: {
  role: Role
  onNavigate?: () => void
  className?: string
}) {
  const { user } = useAuth()
  const { unreadCount, getNotificationsForRole } = useNotifications()
  const userUnread = user?.role ? getNotificationsForRole(user.role, user.id).filter((n) => !n.read).length : 0
  const profilePath = user?.id ? `/app/players/${encodeURIComponent(user.id)}` : '/app/players/1'

  const items = [
    ...(role === 'user' || role === 'registrar' || role === 'marshal'
      ? [
          { label: 'Profile', to: profilePath, icon: FiUser, roles: ['user', 'registrar', 'marshal'] },
        ]
      : []),
    ...baseItems.filter((it) => !it.roles || it.roles.includes(role)),
    ...(role === 'user' || role === 'registrar' || role === 'marshal'
      ? [
          { label: 'My Weapons & Equipment', to: `/app/players/${encodeURIComponent(user?.id || '1')}/weapons-and-equipment`, icon: FiTarget, roles: ['user'] },
        ]
      : []),
    ...(role === 'registrar' ? registrarItems.filter((it) => !it.roles || it.roles.includes(role)) : []),
    ...(role === 'admin' ? adminItems.filter((it) => !it.roles || it.roles.includes(role)) : []),
    ...(role === 'marshal' ? marshalItems.filter((it) => !it.roles || it.roles.includes(role)) : []),
    ...(role === 'admin' || role === 'user' || role === 'registrar' || role === 'marshal'
      ? [{ label: 'Notifications', to: '/app/notifications', icon: FiBell, roles: ['user', 'admin', 'registrar', 'marshal'] }]
      : []),
  ]



  return (
    <div
      className={
        'rounded-2xl glass border border-white/5 p-3 ' +
        (className ? className : '')
      }
    >
      <div className="mb-3 rounded-xl bg-white/5 p-3">
        <div className="text-xs uppercase tracking-widest text-muted">Mission</div>
        <div className="mt-1 text-sm font-semibold">
          {role === 'admin'
            ? 'Command Operations'
            : role === 'marshal'
              ? "Marshal Oversight"
              : role === 'registrar'
                ? 'Registrar Processing'
                : 'Operator Dashboard'}
        </div>
        <div className="mt-2 text-[11px] text-muted">
        </div>
      </div>

      <nav className="space-y-1">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <motion.div
              key={item.to}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              className="rounded-xl"
            >
              <NavLink
                to={item.to}
                onClick={onNavigate}
                end
                className={({ isActive }) =>
                  'flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition border border-transparent ' +
                  (isActive
                    ? 'bg-white/8 text-text border-accent/30'
                    : 'text-muted hover:bg-white/5 hover:text-text')
                }
              >
                <Icon className="text-accent" />
                <span className="truncate">{item.label}</span>
                {item.label === 'Notifications' && userUnread > 0 && (
                  <span className="ml-auto h-2.5 w-2.5 rounded-full bg-success ring-2 ring-black" />
                )}
              </NavLink>
            </motion.div>
          )
        })}
      </nav>

      <div className="mt-4 rounded-xl bg-white/5 p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted">Status</div>
            <div className="mt-1 text-sm font-semibold">Operational</div>
          </div>
          <div className="h-10 w-10 rounded-xl bg-success/20 flex items-center justify-center">
            <span className="h-2.5 w-2.5 rounded-full bg-success" />
          </div>
        </div>
        <div className="mt-2 text-[11px] text-muted">System latency: nominal</div>
      </div>
    </div>
  )
}

