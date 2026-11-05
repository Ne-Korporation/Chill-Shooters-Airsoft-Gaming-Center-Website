import React, { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import type { IconType } from 'react-icons'
import { useAuth } from '../../context/AuthContext'
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
  FiBarChart2,
  FiFileText,
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
  FiChevronDown,
  FiPlusCircle,
  FiUserPlus,
} from 'react-icons/fi'

type Role = 'user' | 'admin' | 'marshal' | 'registrar'

type Item = {
  label: string
  to: string
  icon: IconType
  // Admin menu group the item belongs to. "Overview" items are always shown; the other groups
  // fold open and closed.
  section?: string
}

const marshalItems: Item[] = [
  { label: 'Dashboard', to: '/app', icon: FiGrid },
  { label: 'Games', to: '/app/games', icon: FiZap },
  { label: 'Gear', to: '/app/admin/equipment', icon: FiTool },
  { label: 'Weapons', to: '/app/admin/weapons', icon: FiTruck },
  { label: 'Safety Logs', to: '/app/safety', icon: FiAlertTriangle },
  { label: 'Field Check-in', to: '/app/check-in', icon: FiClipboard },
  { label: 'Team Grouping', to: '/app/team-grouping', icon: FiShuffle },
  { label: 'Rental Check-out', to: '/app/rentals', icon: FiLogOut },
  { label: 'Repairs', to: '/app/repairs', icon: FiTool },
]

// Grouped by the job the admin is doing, in the order a game day runs: check what needs
// attention, handle bookings, run the field, keep inventory, look after people, keep records.
const adminItems: Item[] = [
  { section: 'Overview', label: 'Dashboard', to: '/app/admin', icon: FiGrid },
  { section: 'Overview', label: 'Reports', to: '/app/admin/reports', icon: FiBarChart2 },
  { section: 'Bookings', label: 'Reservations', to: '/app/admin/reservations', icon: FiCalendar },
  { section: 'Bookings', label: 'Payments', to: '/app/admin/payments', icon: FiCreditCard },
  { section: 'Bookings', label: 'Games', to: '/app/games', icon: FiZap },
  { section: 'Game day', label: 'Counter', to: '/app/counter', icon: FiShoppingBag },
  { section: 'Game day', label: 'Walk-ins', to: '/app/walk-ins', icon: FiUserPlus },
  { section: 'Game day', label: 'Rental check-out', to: '/app/rentals', icon: FiLogOut },
  { section: 'Game day', label: 'Field check-in', to: '/app/check-in', icon: FiClipboard },
  { section: 'Game day', label: 'Team grouping', to: '/app/team-grouping', icon: FiShuffle },
  { section: 'Game day', label: 'Safety logs', to: '/app/safety', icon: FiAlertTriangle },
  { section: 'Game day', label: 'Weather', to: '/app/weather', icon: FiCloudRain },
  { section: 'Inventory', label: 'Weapons', to: '/app/admin/weapons', icon: FiTruck },
  { section: 'Inventory', label: 'Gear', to: '/app/admin/equipment', icon: FiTool },
  { section: 'Inventory', label: 'Rental packages', to: '/app/admin/rental-packages', icon: FiPackage },
  { section: 'Inventory', label: 'Repairs', to: '/app/repairs', icon: FiSettings },
  // Waivers are mostly approved automatically from the verified profile ID, so they sit with the records kept here.
  { section: 'Inventory', label: 'Waivers', to: '/app/admin/waivers', icon: FiShield },
  { section: 'People', label: 'Players & staff', to: '/app/admin/player-management', icon: FiUsers },
  { section: 'People', label: 'Partnerships', to: '/app/admin/partnerships', icon: FiBriefcase },
  { section: 'People', label: 'Player feedback', to: '/app/admin/feedback', icon: FiMessageSquare },
  { section: 'Records', label: 'REACH fund', to: '/app/admin/reach-fund', icon: FiHeart },
  { section: 'Records', label: 'Audit logs', to: '/app/admin/audit-logs', icon: FiFileText },
]

const registrarItems: Item[] = [
  { label: 'Dashboard', to: '/app', icon: FiGrid },
  { label: 'Reservations', to: '/app/registrar/reservations', icon: FiCalendar },
  { label: 'Counter', to: '/app/counter', icon: FiShoppingBag },
  { label: 'Walk-ins', to: '/app/walk-ins', icon: FiUserPlus },
  { label: 'Field Check-in', to: '/app/check-in', icon: FiClipboard },
  { label: 'Rental Check-out', to: '/app/rentals', icon: FiLogOut },
  { label: 'Games', to: '/app/registrar/games', icon: FiZap },
  { label: 'Availed Packages', to: '/app/registrar/availed-packages', icon: FiPackage },
  { label: 'Submitted Waivers', to: '/app/registrar/waivers', icon: FiShield },
  { label: 'Submitted Payments', to: '/app/registrar/submitted-payments', icon: FiCreditCard },
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



function SidebarLink({ item, onNavigate, nested = false }: { item: Item; onNavigate?: () => void; nested?: boolean }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      end
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-xl py-2 text-sm transition ${nested ? 'pl-6 pr-3' : 'px-3'} ` +
        (isActive ? 'nav-active font-medium' : 'hover-row text-muted hover:text-text')
      }
    >
      {({ isActive }) => (
        <>
          <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-accent' : ''}`} />
          <span className="truncate">{item.label}</span>
        </>
      )}
    </NavLink>
  )
}

// Notifications are reached from the bell in the top bar, not from this menu.
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
  const { pathname } = useLocation()
  const profilePath = user?.id ? `/app/players/${encodeURIComponent(user.id)}` : '/app/players/1'
  const hasOpenSplitPayment = useHasOpenSplitPayment(role === 'user' && !!user?.id)
  const profile: Item = { label: 'Profile', to: profilePath, icon: FiUser }

  const playerItems: Item[] = [
    { label: 'Dashboard', to: '/app', icon: FiGrid },
    { label: 'Book a game', to: '/app/reservations', icon: FiPlusCircle },
    { label: 'My Reservations', to: '/app/my-reservations', icon: FiList },
    { label: 'My Weapons & Gear', to: `/app/players/${encodeURIComponent(user?.id || '1')}/weapons-and-equipment`, icon: FiTarget },
    { label: 'Online Waiver', to: '/app/waiver', icon: FiShield },
    { label: 'Game Evaluation', to: '/app/feedback', icon: FiMessageSquare },
    ...(hasOpenSplitPayment ? [{ label: 'Split Payment', to: '/app/split-payments', icon: FiDollarSign }] : []),
  ]

  // Every menu ends with the profile, at the bottom of the sidebar.
  const items =
    role === 'admin' ? adminItems
    : role === 'marshal' ? marshalItems
    : role === 'registrar' ? registrarItems
    : playerItems

  // Admin groups: the one holding the current page is open. Others can be opened to look around,
  // and close again as soon as the admin moves to another page.
  const [openGroups, setOpenGroups] = useState<string[]>([])
  useEffect(() => setOpenGroups([]), [pathname])
  const toggleGroup = (section: string) => {
    setOpenGroups((current) => (current.includes(section) ? current.filter((s) => s !== section) : [...current, section]))
  }

  if (role !== 'admin') {
    return (
      <div className={'surface rounded-2xl p-3 ' + (className || '')}>
        <nav className="space-y-0.5">
          {items.map((item) => <SidebarLink key={item.to} item={item} onNavigate={onNavigate} />)}
          <div className="divider mt-2 border-t pt-2">
            <SidebarLink item={profile} onNavigate={onNavigate} />
          </div>
        </nav>
      </div>
    )
  }

  const sections = [...new Set(items.map((item) => item.section || 'Overview'))]
  return (
    <div className={'surface rounded-2xl p-3 ' + (className || '')}>
      <nav className="space-y-0.5">
        {sections.map((section) => {
          const sectionItems = items.filter((item) => (item.section || 'Overview') === section)
          if (section === 'Overview') {
            return sectionItems.map((item) => <SidebarLink key={item.to} item={item} onNavigate={onNavigate} />)
          }
          const holdsCurrentPage = sectionItems.some((item) => item.to === pathname)
          const open = holdsCurrentPage || openGroups.includes(section)
          return (
            <div key={section} className="pt-1">
              <button
                type="button"
                onClick={() => toggleGroup(section)}
                aria-expanded={open}
                className={`hover-row flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm ${holdsCurrentPage ? 'font-medium text-text' : 'text-muted hover:text-text'}`}
              >
                <span>{section}</span>
                <FiChevronDown className={`h-4 w-4 transition ${open ? 'rotate-180' : ''}`} />
              </button>
              {open ? (
                <div className="mt-0.5 space-y-0.5">
                  {sectionItems.map((item) => <SidebarLink key={item.to} item={item} onNavigate={onNavigate} nested />)}
                </div>
              ) : null}
            </div>
          )
        })}
        <div className="divider mt-2 border-t pt-2">
          <SidebarLink item={profile} onNavigate={onNavigate} />
        </div>
      </nav>
    </div>
  )
}
