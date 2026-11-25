import { CapacityCalendar } from '../booking/CapacityCalendar'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import type { IconType } from 'react-icons'
import { GiAk47, GiKevlarVest } from 'react-icons/gi'
import { useAuth } from '../../context/AuthContext'
import { useLastBookedLocation } from '../../hooks/useLastBookedLocation'
import { apiGet } from '../../utils/apiClient'
import { useNotifications } from '../../context/NotificationContext'
import { useLiveRefresh } from '../../utils/liveUpdates'
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
  FiBriefcase,
  FiMessageSquare,
  FiChevronDown,
  FiPlusCircle,
  FiUserPlus,
  FiVolume2,
  FiCheckCircle,
  FiBell,
  FiInbox,
  FiMessageCircle,
  FiBookOpen,
  FiFlag,
  FiUserCheck,
  FiFolder,
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
  // The same Reservations page as admins and registrars (Games, Archived), then the game-day counter.
  { label: 'Reservations', to: '/app/games', icon: FiCalendar },
  { label: 'Games', to: '/app/counter', icon: FiZap },
  { label: 'Weapons', to: '/app/admin/weapons', icon: GiAk47 },
  { label: 'Gear', to: '/app/admin/equipment', icon: FiTool },
  // Look players up (account, ID status, level); ID and discount reviews stay with registrars.
  { label: 'Players', to: '/app/marshal/players', icon: FiUsers },
]

// Grouped by the job the admin is doing, in the order a game day runs: messages to answer,
// bookings and their payments, running the field, the equipment, the people, then the records.
const adminItems: Item[] = [
  { section: 'Overview', label: 'Dashboard', to: '/app/admin', icon: FiGrid },
  // Messages from players, system notifications, and announcements sent to everyone.
  { section: 'Messages', label: 'Inbox', to: '/app/admin/inbox', icon: FiInbox },
  { section: 'Messages', label: 'Notifications', to: '/app/notifications', icon: FiBell },
  { section: 'Messages', label: 'Announcements', to: '/app/admin/announcements', icon: FiVolume2 },
  // Games and archived games are tabs of one Reservations page.
  { section: 'Bookings & Payments', label: 'Reservations', to: '/app/admin/reservations', icon: FiCalendar },
  { section: 'Bookings & Payments', label: 'Payments', to: '/app/admin/payments', icon: FiCreditCard },
  { section: 'Game Day', label: 'Games', to: '/app/counter', icon: FiZap },
  { section: 'Game Day', label: 'Walk-ins', to: '/app/walk-ins', icon: FiUserPlus },
  { section: 'Equipment', label: 'Weapons', to: '/app/admin/weapons', icon: GiAk47 },
  { section: 'Equipment', label: 'Gear', to: '/app/admin/equipment', icon: FiTool },
  { section: 'Equipment', label: 'Rental packages', to: '/app/admin/rental-packages', icon: FiPackage },
  // Waivers belong to the players who sign them.
  { section: 'Players & Partners', label: 'Players & staff', to: '/app/admin/player-management', icon: FiUsers },
  { section: 'Players & Partners', label: 'Waivers', to: '/app/admin/waivers', icon: FiShield },
  { section: 'Players & Partners', label: 'Player feedback', to: '/app/admin/feedback', icon: FiMessageSquare },
  { section: 'Players & Partners', label: 'Partnerships', to: '/app/admin/partnerships', icon: FiBriefcase },
  { section: 'Reports & Records', label: 'Reports', to: '/app/admin/reports', icon: FiBarChart2 },
  { section: 'Reports & Records', label: 'Donation fund', to: '/app/admin/reach-fund', icon: FiHeart },
  { section: 'Reports & Records', label: 'Audit logs', to: '/app/admin/audit-logs', icon: FiFileText },
]

// An icon beside each admin group's name, so the groups are easy to scan. Each differs from the
// icons of the items inside it.
const SECTION_ICONS: Record<string, IconType> = {
  Messages: FiMessageCircle,
  'Bookings & Payments': FiBookOpen,
  'Game Day': FiFlag,
  Equipment: GiKevlarVest,
  'Players & Partners': FiUserCheck,
  'Reports & Records': FiFolder,
}

// In the order a registrar's day runs: check bookings and what players submitted (payments, then
// waivers), then game day at the counter (walk-ins, the games running now), then the full list
// of games to start, complete and archive.
const registrarItems: Item[] = [
  { label: 'Dashboard', to: '/app', icon: FiGrid },
  { label: 'Reservations', to: '/app/registrar/reservations', icon: FiCalendar },
  // The game-day counter, right under the reservations it runs.
  { label: 'Games', to: '/app/counter', icon: FiZap },
  { label: 'Payments', to: '/app/registrar/submitted-payments', icon: FiCreditCard },
  { label: 'Waivers', to: '/app/registrar/waivers', icon: FiShield },
  // Players' accounts, and the IDs they submit for verification.
  { label: 'Players', to: '/app/registrar/players', icon: FiUsers },
  { label: 'Walk-ins', to: '/app/walk-ins', icon: FiUserPlus },
  // The list of games to start, complete and archive is the Games tab of Reservations.
]

// Unread player messages, for the Inbox badge (admins only).
function useInboxUnread(enabled: boolean) {
  const [unread, setUnread] = useState(0)
  const check = useCallback(() => {
    if (!enabled) return
    apiGet<{ unread?: number }>('/api/admin/inbox?status=new')
      .then((res) => setUnread(Number(res?.unread) || 0))
      .catch(() => setUnread(0))
  }, [enabled])
  useEffect(() => { check() }, [check])
  useLiveRefresh(['inbox'], check, enabled)
  return enabled ? unread : 0
}

// How many split-payment shares the player still owes: shown as a badge on My Reservations, where
// the shares are paid (a captain only waiting on teammates has nothing to do, so no badge).
function useSharesOwed(enabled: boolean) {
  const [owed, setOwed] = useState(0)
  useEffect(() => {
    if (!enabled) {
      setOwed(0)
      return
    }
    let active = true
    const check = () => {
      apiGet<{ ok: boolean; data: Array<{ iHavePaid?: boolean; myShareDue?: number }> }>('/api/split-payments/mine')
        .then((res) => {
          if (!active) return
          const items = Array.isArray(res?.data) ? res.data : []
          setOwed(items.filter((item) => !item.iHavePaid && Number(item.myShareDue) > 0).length)
        })
        .catch(() => { if (active) setOwed(0) })
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
  return owed
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

// Every role has Notifications in the menu (as well as the bell in the top bar).
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
  const sharesOwed = useSharesOwed(role === 'user' && !!user?.id)
  // Players' games calendar starts on the location of their last booking.
  const lastLocation = useLastBookedLocation(role === 'user' ? user?.id : null)
  const profile: Item = { label: 'Profile', to: profilePath, icon: FiUser }

  // Unread counts beside Notifications (every role) and Inbox (admins).
  const { getNotificationsForRole } = useNotifications()
  const unreadNotifications = useMemo(
    () => (user?.id ? getNotificationsForRole(role, user.id).filter((n) => !n.read).length : 0),
    [getNotificationsForRole, role, user?.id],
  )
  const inboxUnread = useInboxUnread(role === 'admin')
  const notificationsItem: Item = { label: 'Notifications', to: '/app/notifications', icon: FiBell }
  const withBadges = (item: Item): Item =>
    item.to === '/app/notifications' ? { ...item, badge: unreadNotifications, badgeTitle: `${unreadNotifications} unread notification${unreadNotifications === 1 ? '' : 's'}` }
    : item.to === '/app/admin/inbox' ? { ...item, badge: inboxUnread, badgeTitle: `${inboxUnread} unread message${inboxUnread === 1 ? '' : 's'}` }
    : item.to === '/app/my-reservations' ? { ...item, badge: sharesOwed, badgeTitle: `${sharesOwed} split-payment share${sharesOwed === 1 ? '' : 's'} to pay` }
    : item

  const playerItems: Item[] = [
    { label: 'Dashboard', to: '/app', icon: FiGrid },
    // Checked often, so it sits right under the Dashboard.
    notificationsItem,
    { label: 'Book a game', to: '/app/reservations', icon: FiPlusCircle },
    { label: 'My Reservations', to: '/app/my-reservations', icon: FiList },
    { label: 'My Teams', to: '/app/my-teams', icon: FiUsers },
    { label: 'Online Waiver', to: '/app/waiver', icon: FiShield },
    { label: 'Game Evaluation', to: '/app/feedback', icon: FiMessageSquare },
    // Split payments are paid on My Reservations (badge shows shares owed).
  ]

  // Marshals see what needs them on the Weapons and Gear items themselves.
  const alerts = useInventoryAlerts(role === 'marshal')
  const marshalMenu: Item[] = marshalItems.map((item) =>
    item.to === '/app/admin/weapons' ? { ...item, badge: alerts.weapons, badgeTitle: `${alerts.weapons} weapon${alerts.weapons === 1 ? '' : 's'} to inspect before play` }
    : item.to === '/app/admin/equipment' ? { ...item, badge: alerts.gear, badgeTitle: `${alerts.gear} gear item${alerts.gear === 1 ? '' : 's'} need you: flagged, in maintenance, or BB ammo running low` }
    : item)

  // Every menu ends with the profile, at the bottom of the sidebar.
  const items = (
    role === 'admin' ? adminItems
    : role === 'marshal' ? [marshalMenu[0], notificationsItem, ...marshalMenu.slice(1)]
    : role === 'registrar' ? [registrarItems[0], notificationsItem, ...registrarItems.slice(1)]
    : playerItems
  ).map(withBadges)

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
        {/* Players, registrars and marshals all get the games calendar under the menu (on desktop;
            phones show it on the dashboard instead). */}
        <div className="divider mt-3 border-t pt-3">
          <CapacityCalendar mini defaultLocation={role === 'user' ? lastLocation : undefined} />
        </div>
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
          const SectionIcon = SECTION_ICONS[section]
          // A closed group still shows its items' unread counts (e.g. new Inbox messages).
          const sectionBadge = sectionItems.reduce((sum, item) => sum + (item.badge || 0), 0)
          return (
            <div key={section} className="pt-1">
              <button
                type="button"
                onClick={() => toggleGroup(section)}
                aria-expanded={open}
                className={`hover-row flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm lg:py-2 ${holdsCurrentPage ? 'font-medium text-text' : 'text-muted hover:text-text'}`}
              >
                <span className="flex items-center gap-3">
                  {SectionIcon ? <SectionIcon className="h-4 w-4 shrink-0" /> : null}
                  {section}
                </span>
                <span className="flex items-center gap-2">
                  {!open && sectionBadge > 0 ? (
                    <span className="rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">{sectionBadge}</span>
                  ) : null}
                  <FiChevronDown className={`h-4 w-4 transition ${open ? 'rotate-180' : ''}`} />
                </span>
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
