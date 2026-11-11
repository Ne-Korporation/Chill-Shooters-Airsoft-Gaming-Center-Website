import { CapacityCalendar } from '../booking/CapacityCalendar'
import React, { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import type { IconType } from 'react-icons'
import { GiAk47 } from 'react-icons/gi'
import { useAuth } from '../../context/AuthContext'
import { useLastBookedLocation } from '../../hooks/useLastBookedLocation'
import { apiGet } from '../../utils/apiClient'
import { isLowOnAmmo } from '../../utils/inventoryModels'
import { SPLIT_PAYMENTS_CHANGED_EVENT } from '../../pages/payments/SplitPaymentPage'
import {
  FiGrid,
  FiCalendar,
  FiList,
  FiHeart,
  FiPackage,
  FiUsers,
  FiUser,
  FiBarChart2,
  FiFileText,
  FiShield,
  FiTool,
  FiZap,
  FiCreditCard,
  FiTarget,
  FiBriefcase,
  FiMessageSquare,
  FiDollarSign,
  FiChevronDown,
  FiPlusCircle,
  FiUserPlus,
  FiVolume2,
  FiCheckCircle,
} from 'react-icons/fi'

type Role = 'user' | 'admin' | 'marshal' | 'registrar'

type Item = {
  label: string
  to: string
  icon: IconType
  // Admin menu group the item belongs to. "Overview" items are always shown; the other groups
  // fold open and closed.
  section?: string
  // A count shown beside the label (e.g. weapons waiting for a check); hidden at 0.
  badge?: number
  badgeTitle?: string
}

// Inventory pieces that need a marshal before the next session: flagged for a check, in
// maintenance, or damaged. Players' own gear isn't center inventory, so it isn't counted.
const ATTENTION_STATUSES = ['needs-check', 'maintenance', 'damaged']
function useInventoryAlerts(enabled: boolean) {
  const [counts, setCounts] = useState({ weapons: 0, gear: 0 })
  useEffect(() => {
    if (!enabled) return
    let active = true
    const q = encodeURIComponent(JSON.stringify({ status: { $in: ATTENTION_STATUSES }, source: { $ne: 'player' } }))
    const count = (collection: string) =>
      apiGet<{ total?: number }>(`/api/${collection}?q=${q}&limit=1&withTotal=1`).then((r) => Number(r?.total || 0)).catch(() => 0)
    // BB ammo below its warning level also needs a marshal (a restock), so it counts on Gear.
    const ammoQ = encodeURIComponent(JSON.stringify({ category: 'ammo', source: { $ne: 'player' } }))
    const lowAmmo = () =>
      apiGet<{ data?: Array<{ category?: string; stockGrams?: number; lowStockGrams?: number }> }>(`/api/equipments?q=${ammoQ}&limit=50`)
        .then((r) => (r?.data || []).filter(isLowOnAmmo).length)
        .catch(() => 0)
    const check = () => {
      Promise.all([count('weapons'), count('equipments'), lowAmmo()]).then(([weapons, gear, ammo]) => {
        if (active) setCounts({ weapons, gear: gear + ammo })
      })
    }
    check()
    const timer = window.setInterval(check, 120_000)
    window.addEventListener('focus', check)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('focus', check)
    }
  }, [enabled])
  return counts
}

// The marshal's checks before every session, kept in the sidebar so they're always in view.
const SESSION_CHECKLIST = [
  { title: 'Safety briefing', detail: 'Squad readiness and field assignments.' },
  { title: 'Gear check', detail: 'Pull worn or damaged gear.' },
  { title: 'Player roster', detail: 'Verified players against the game.' },
]

// Game day first (the games running now, then the full game queue), then the inventory they keep.
const marshalItems: Item[] = [
  { label: 'Dashboard', to: '/app', icon: FiGrid },
  { label: 'Games', to: '/app/counter', icon: FiZap },
  { label: 'Game queue', to: '/app/games', icon: FiList },
  { label: 'Weapons', to: '/app/admin/weapons', icon: GiAk47 },
  { label: 'Gear', to: '/app/admin/equipment', icon: FiTool },
]

// Grouped by the job the admin is doing, in the order a game day runs: check what needs
// attention, handle bookings, run the field, keep inventory, look after people, keep records.
const adminItems: Item[] = [
  { section: 'Overview', label: 'Dashboard', to: '/app/admin', icon: FiGrid },
  { section: 'Overview', label: 'Announcements', to: '/app/admin/announcements', icon: FiVolume2 },
  // Games and archived games are tabs of one Reservations page.
  { section: 'Bookings', label: 'Reservations', to: '/app/admin/reservations', icon: FiCalendar },
  { section: 'Bookings', label: 'Payments', to: '/app/admin/payments', icon: FiCreditCard },
  { section: 'Game day', label: 'Games', to: '/app/counter', icon: FiZap },
  { section: 'Game day', label: 'Walk-ins', to: '/app/walk-ins', icon: FiUserPlus },
  { section: 'Inventory', label: 'Weapons', to: '/app/admin/weapons', icon: GiAk47 },
  { section: 'Inventory', label: 'Gear', to: '/app/admin/equipment', icon: FiTool },
  { section: 'Inventory', label: 'Rental packages', to: '/app/admin/rental-packages', icon: FiPackage },
  // Waivers are mostly approved automatically from the verified profile ID, so they sit with the records kept here.
  { section: 'Inventory', label: 'Waivers', to: '/app/admin/waivers', icon: FiShield },
  { section: 'People', label: 'Players & staff', to: '/app/admin/player-management', icon: FiUsers },
  { section: 'People', label: 'Partnerships', to: '/app/admin/partnerships', icon: FiBriefcase },
  { section: 'People', label: 'Player feedback', to: '/app/admin/feedback', icon: FiMessageSquare },
  { section: 'Records', label: 'Reports', to: '/app/admin/reports', icon: FiBarChart2 },
  { section: 'Records', label: 'REACH fund', to: '/app/admin/reach-fund', icon: FiHeart },
  { section: 'Records', label: 'Audit logs', to: '/app/admin/audit-logs', icon: FiFileText },
]

// In the order a registrar's day runs: check bookings and what players submitted (payments, then
// waivers), then game day at the counter (walk-ins, the games running now), then the full list
// of games to start, complete and archive.
const registrarItems: Item[] = [
  { label: 'Dashboard', to: '/app', icon: FiGrid },
  { label: 'Reservations', to: '/app/registrar/reservations', icon: FiCalendar },
  { label: 'Payments', to: '/app/registrar/submitted-payments', icon: FiCreditCard },
  { label: 'Waivers', to: '/app/registrar/waivers', icon: FiShield },
  { label: 'Walk-ins', to: '/app/walk-ins', icon: FiUserPlus },
  { label: 'Games', to: '/app/counter', icon: FiZap },
  { label: 'Game queue', to: '/app/registrar/games', icon: FiList },
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
        `flex items-center gap-3 rounded-xl py-2.5 text-sm transition lg:py-2 ${nested ? 'pl-6 pr-3' : 'px-3'} ` +
        (isActive ? 'nav-active font-medium' : 'hover-row text-muted hover:text-text')
      }
    >
      {({ isActive }) => (
        <>
          <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-accent' : ''}`} />
          <span className="flex-1 truncate">{item.label}</span>
          {item.badge ? (
            <span className="rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold leading-none text-white" title={item.badgeTitle}>
              {item.badge}
            </span>
          ) : null}
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
  // Players' games calendar starts on the location of their last booking.
  const lastLocation = useLastBookedLocation(role === 'user' ? user?.id : null)
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

  // Marshals see what needs them on the Weapons and Gear items themselves.
  const alerts = useInventoryAlerts(role === 'marshal')
  const marshalMenu: Item[] = marshalItems.map((item) =>
    item.to === '/app/admin/weapons' ? { ...item, badge: alerts.weapons, badgeTitle: `${alerts.weapons} weapon${alerts.weapons === 1 ? '' : 's'} to inspect before play` }
    : item.to === '/app/admin/equipment' ? { ...item, badge: alerts.gear, badgeTitle: `${alerts.gear} gear item${alerts.gear === 1 ? '' : 's'} need you: flagged, in maintenance, or BB ammo running low` }
    : item)

  // Every menu ends with the profile, at the bottom of the sidebar.
  const items =
    role === 'admin' ? adminItems
    : role === 'marshal' ? marshalMenu
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
        {role === 'user' ? (
          <div className="divider mt-3 border-t pt-3">
            <CapacityCalendar mini defaultLocation={lastLocation} />
          </div>
        ) : null}
        {role === 'marshal' ? (
          <div className="divider mt-3 border-t px-3 pt-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Before each session</div>
            <ul className="space-y-2">
              {SESSION_CHECKLIST.map((check) => (
                <li key={check.title} className="flex gap-2">
                  <FiCheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                  <div>
                    <div className="text-xs font-medium">{check.title}</div>
                    <div className="text-[11px] text-muted">{check.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
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
                className={`hover-row flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm lg:py-2 ${holdsCurrentPage ? 'font-medium text-text' : 'text-muted hover:text-text'}`}
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
