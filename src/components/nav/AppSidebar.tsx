import React, { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import type { IconType } from 'react-icons'
import { useAuth } from '../../context/AuthContext'
import { useNotifications } from '../../context/NotificationContext'
import { apiGet } from '../../utils/apiClient'
import { SPLIT_PAYMENTS_CHANGED_EVENT } from '../../pages/payments/SplitPaymentPage'
import {
  FiGrid,
  FiCalendar,
  FiList,
  FiAlertTriangle,
  FiHeart,
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
  FiMessageSquare,
  FiDollarSign,
  FiShuffle,
  FiShoppingBag,
  FiLogOut,
  FiCloudRain,
} from 'react-icons/fi'

type Role = 'user' | 'admin' | 'marshal' | 'registrar'

type Item = {
  label: string
  to: string
  icon: IconType
  roles?: Role[]
  // Heading shown above the first item of each group (used by the admin menu).
  section?: string
}

const baseItems: Item[] = [
  // Shared items the operator/registrar/marshal can see; admin gets only the admin module nav.
  { label: 'Dashboard Home', to: '/app', icon: FiGrid, roles: ['user'] },
  { label: 'Reservations', to: '/app/reservations', icon: FiCalendar, roles: ['user'] },
  { label: 'My Reservations', to: '/app/my-reservations', icon: FiList, roles: ['user'] },
  { label: 'Recommended Packages', to: '/app/packages', icon: FiPackage, roles: ['user'] },
  { label: 'Online Waiver', to: '/app/waiver', icon: FiShield, roles: ['user'] },
  { label: 'Game Evaluation', to: '/app/feedback', icon: FiMessageSquare, roles: ['user'] },
]



const marshalItems: Item[] = [
  { label: 'Marshal Dashboard', to: '/app', icon: FiGrid, roles: ['marshal'] },
  { label: 'Games', to: '/app/games', icon: FiZap, roles: ['marshal'] },
  { label: 'Equipment', to: '/app/admin/equipment', icon: FiTool, roles: ['marshal'] },
  { label: 'Weapons', to: '/app/admin/weapons', icon: FiTruck, roles: ['marshal'] },
  { label: 'Safety Logs', to: '/app/safety', icon: FiAlertTriangle, roles: ['marshal'] },
  { label: 'Field Check-in', to: '/app/check-in', icon: FiClipboard, roles: ['marshal'] },
  { label: 'Team Grouping', to: '/app/team-grouping', icon: FiShuffle, roles: ['marshal'] },
  { label: 'Rental Check-out', to: '/app/rentals', icon: FiLogOut, roles: ['marshal'] },
  { label: 'Repairs', to: '/app/repairs', icon: FiTool, roles: ['marshal'] },
  { label: 'Weather', to: '/app/weather', icon: FiCloudRain, roles: ['marshal'] },
]


// Grouped by the job the admin is doing, in the order a game day runs: check what needs
// attention, handle bookings, run the field, keep inventory, look after people, keep records.
const adminItems: Item[] = [
  { section: 'Overview', label: 'Dashboard', to: '/app/admin', icon: FiGrid, roles: ['admin'] },
  { section: 'Overview', label: 'Reports', to: '/app/admin/reports', icon: FiBarChart2, roles: ['admin'] },
  { section: 'Bookings', label: 'Reservations', to: '/app/admin/reservations', icon: FiCalendar, roles: ['admin'] },
  { section: 'Bookings', label: 'Payments', to: '/app/admin/payments', icon: FiCreditCard, roles: ['admin'] },
  { section: 'Bookings', label: 'Waivers', to: '/app/admin/waivers', icon: FiShield, roles: ['admin'] },
  { section: 'Bookings', label: 'Games', to: '/app/games', icon: FiZap, roles: ['admin'] },
  { section: 'Game day', label: 'Counter (walk-ins)', to: '/app/counter', icon: FiShoppingBag, roles: ['admin'] },
  { section: 'Game day', label: 'Rental check-out', to: '/app/rentals', icon: FiLogOut, roles: ['admin'] },
  { section: 'Game day', label: 'Field check-in', to: '/app/check-in', icon: FiClipboard, roles: ['admin'] },
  { section: 'Game day', label: 'Team grouping', to: '/app/team-grouping', icon: FiShuffle, roles: ['admin'] },
  { section: 'Game day', label: 'Safety logs', to: '/app/safety', icon: FiAlertTriangle, roles: ['admin'] },
  { section: 'Game day', label: 'Weather', to: '/app/weather', icon: FiCloudRain, roles: ['admin'] },
  { section: 'Inventory', label: 'Weapons', to: '/app/admin/weapons', icon: FiTruck, roles: ['admin'] },
  { section: 'Inventory', label: 'Equipment', to: '/app/admin/equipment', icon: FiTool, roles: ['admin'] },
  { section: 'Inventory', label: 'Rental packages', to: '/app/admin/rental-packages', icon: FiPackage, roles: ['admin'] },
  { section: 'Inventory', label: 'Repairs', to: '/app/repairs', icon: FiSettings, roles: ['admin'] },
  { section: 'People', label: 'Players & staff', to: '/app/admin/player-management', icon: FiUsers, roles: ['admin'] },
  { section: 'People', label: 'Partnerships', to: '/app/admin/partnerships', icon: FiBriefcase, roles: ['admin'] },
  { section: 'People', label: 'Player feedback', to: '/app/admin/feedback', icon: FiMessageSquare, roles: ['admin'] },
  { section: 'Records', label: 'REACH fund', to: '/app/admin/reach-fund', icon: FiHeart, roles: ['admin'] },
  { section: 'Records', label: 'Audit logs', to: '/app/admin/audit-logs', icon: FiFileText, roles: ['admin'] },
]

const registrarItems: Item[] = [
  { label: 'Reservations', to: '/app/registrar/reservations', icon: FiCalendar, roles: ['registrar'] },
  { label: 'Counter', to: '/app/counter', icon: FiShoppingBag, roles: ['registrar'] },
  { label: 'Field Check-in', to: '/app/check-in', icon: FiClipboard, roles: ['registrar'] },
  { label: 'Rental Check-out', to: '/app/rentals', icon: FiLogOut, roles: ['registrar'] },
  { label: 'Weather', to: '/app/weather', icon: FiCloudRain, roles: ['registrar'] },
  { label: 'Games', to: '/app/registrar/games', icon: FiZap, roles: ['registrar'] },
  { label: 'Availed Packages', to: '/app/registrar/availed-packages', icon: FiPackage, roles: ['registrar'] },
  { label: 'Submitted Waivers', to: '/app/registrar/waivers', icon: FiShield, roles: ['registrar'] },
  { label: 'Submitted Payments', to: '/app/registrar/submitted-payments', icon: FiCreditCard, roles: ['registrar'] },
]



// Players see the Split Payment module only while they owe a share or, as captain, are waiting on the team.
function useHasOpenSplitPayment(enabled: boolean) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!enabled) {
      setOpen(false)
      return
    }
    let active = true
    const check = () => {
      apiGet<{ ok: boolean; data: unknown[] }>('/api/split-payments/mine')
        .then((res) => { if (active) setOpen(Array.isArray(res?.data) && res.data.length > 0) })
        .catch(() => { if (active) setOpen(false) })
    }
    check()
    const timer = window.setInterval(check, 60_000)
    window.addEventListener(SPLIT_PAYMENTS_CHANGED_EVENT, check)
    window.addEventListener('focus', check)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener(SPLIT_PAYMENTS_CHANGED_EVENT, check)
      window.removeEventListener('focus', check)
    }
  }, [enabled])
  return open
}

// Recommended Packages is hidden until the admin has created at least one active package.
function useHasPackages(enabled: boolean) {
  const [hasPackages, setHasPackages] = useState(false)
  useEffect(() => {
    if (!enabled) return
    let active = true
    apiGet<{ ok: boolean; data: Array<{ status?: string }> }>('/api/packages?limit=200')
      .then((res) => {
        const docs = Array.isArray(res?.data) ? res.data : []
        if (active) setHasPackages(docs.some((pkg) => !pkg.status || pkg.status === 'active'))
      })
      .catch(() => { if (active) setHasPackages(false) })
    return () => { active = false }
  }, [enabled])
  return hasPackages
}

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
  const hasOpenSplitPayment = useHasOpenSplitPayment(role === 'user' && !!user?.id)
  const hasPackages = useHasPackages(role === 'user')

  const items = [
    ...(role === 'user' || role === 'registrar' || role === 'marshal'
      ? [
          { label: 'Profile', to: profilePath, icon: FiUser, roles: ['user', 'registrar', 'marshal'] },
        ]
      : []),
    ...baseItems.filter((it) => (!it.roles || it.roles.includes(role)) && (it.to !== '/app/packages' || hasPackages)),
    ...(hasOpenSplitPayment
      ? [{ label: 'Split Payment', to: '/app/split-payments', icon: FiDollarSign, roles: ['user'] }]
      : []),
    ...(role === 'user' || role === 'registrar' || role === 'marshal'
      ? [
          { label: 'My Weapons & Equipment', to: `/app/players/${encodeURIComponent(user?.id || '1')}/weapons-and-equipment`, icon: FiTarget, roles: ['user'] },
        ]
      : []),
    ...(role === 'registrar' ? registrarItems.filter((it) => !it.roles || it.roles.includes(role)) : []),
    ...(role === 'admin' ? adminItems.filter((it) => !it.roles || it.roles.includes(role)) : []),
    ...(role === 'marshal' ? marshalItems.filter((it) => !it.roles || it.roles.includes(role)) : []),
    ...(role === 'admin' || role === 'user' || role === 'registrar' || role === 'marshal'
      ? [{ label: 'Notifications', to: '/app/notifications', icon: FiBell, roles: ['user', 'admin', 'registrar', 'marshal'], ...(role === 'admin' ? { section: 'Records' } : {}) }]
      : []),
  ]



  const roleLabel =
    role === 'admin' ? 'Admin' : role === 'marshal' ? 'Marshal' : role === 'registrar' ? 'Registrar' : 'Player'

  return (
    <div className={'surface rounded-2xl p-3 ' + (className ? className : '')}>
      <div className="px-3 pb-2 pt-1 text-xs font-medium text-muted">{roleLabel} menu</div>

      <nav className="space-y-0.5">
        {items.map((item, index) => {
          const Icon = item.icon
          const startsSection = !!item.section && item.section !== items[index - 1]?.section
          return (
            <React.Fragment key={item.to}>
            {startsSection ? (
              <div className={`px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted ${index === 0 ? 'pt-1' : 'pt-4'}`}>
                {item.section}
              </div>
            ) : null}
            <NavLink
              to={item.to}
              onClick={onNavigate}
              end
              className={({ isActive }) =>
                'flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ' +
                (isActive ? 'nav-active font-medium' : 'hover-row text-muted hover:text-text')
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-accent' : ''}`} />
                  <span className="truncate">{item.label}</span>
                  {item.label === 'Notifications' && userUnread > 0 && (
                    <span className="ml-auto rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                      {userUnread > 9 ? '9+' : userUnread}
                    </span>
                  )}
                </>
              )}
            </NavLink>
            </React.Fragment>
          )
        })}
      </nav>
    </div>
  )
}
