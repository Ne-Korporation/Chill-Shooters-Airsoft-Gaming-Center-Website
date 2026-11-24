import type { IconType } from 'react-icons'
import { FiBell, FiCalendar, FiCloudRain, FiCreditCard, FiFlag, FiInbox, FiShield, FiTarget, FiUsers, FiVolume2 } from 'react-icons/fi'
import { isAdminAnnouncement, type NotificationItem } from '../context/NotificationContext'

// Shared by the notification bell and the notifications page so both read the same way.

// What a notification is about, from its type: an icon and a short label.
export function kindOf(item: NotificationItem): { icon: IconType; label: string } {
  const type = String(item.type || '').toLowerCase()
  if (isAdminAnnouncement(item)) return { icon: FiVolume2, label: 'Announcement from Admin' }
  // The server only ever broadcasts announcements to players / everyone (older ones were saved with
  // another type). Broadcasts to staff roles are system notices, labelled by their type below.
  if (type === 'announcement' || (item.userId === 'broadcast' && ['user', 'all'].includes(String(item.targetRole || 'all')))) {
    return { icon: FiVolume2, label: 'Announcement' }
  }
  if (type.startsWith('split_payment_') || type.startsWith('payment_') || type === 'reservation_payment_finalized' || type === 'onsite_payment_due' || type === 'team_spot_onsite') return { icon: FiCreditCard, label: 'Payment' }
  if (type.startsWith('team_')) return { icon: FiUsers, label: 'Team' }
  if (type === 'own_weapons_incoming') return { icon: FiTarget, label: 'Weapons & gear' }
  if (type.startsWith('reservation_')) return { icon: FiCalendar, label: 'Booking' }
  if (type.startsWith('waiver_')) return { icon: FiShield, label: 'Waiver' }
  if (type.startsWith('weapon_') || type.startsWith('equipment_')) return { icon: FiTarget, label: 'Weapons & gear' }
  if (type.startsWith('weather_')) return { icon: FiCloudRain, label: 'Weather' }
  if (type.startsWith('gameplay_')) return { icon: FiFlag, label: 'Game' }
  if (type === 'contact_message') return { icon: FiInbox, label: 'Message' }
  return { icon: FiBell, label: 'Update' }
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

export function groupOf(iso: string, now: Date) {
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return 'Earlier'
  const today = startOfDay(now)
  const day = 86_400_000
  if (time >= today) return 'Today'
  if (time >= today - day) return 'Yesterday'
  if (time >= today - 6 * day) return 'This week'
  if (time >= today - 13 * day) return 'Last week'
  const date = new Date(time)
  if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()) return 'Earlier this month'
  // Older ones are grouped by month: "October", or "October 2025" from another year.
  return date.toLocaleString('en-PH', { month: 'long', ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) })
}

export function timeLabel(iso: string, now: Date) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 360) return `${Math.floor(minutes / 60)}h ago`
  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleString('en-PH', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), hour: 'numeric', minute: '2-digit' })
}
