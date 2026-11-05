import type { IconType } from 'react-icons'
import { FiBell, FiCalendar, FiCloudRain, FiCreditCard, FiFlag, FiShield, FiTarget, FiVolume2 } from 'react-icons/fi'
import type { NotificationItem } from '../context/NotificationContext'

// Shared by the notification bell and the notifications page so both read the same way.

// What a notification is about, from its type: an icon and a short label.
export function kindOf(item: NotificationItem): { icon: IconType; label: string } {
  const type = String(item.type || '').toLowerCase()
  if (type === 'announcement' || item.userId === 'broadcast') return { icon: FiVolume2, label: 'Announcement' }
  if (type.startsWith('split_payment_') || type.startsWith('payment_') || type === 'reservation_payment_finalized') return { icon: FiCreditCard, label: 'Payment' }
  if (type.startsWith('reservation_')) return { icon: FiCalendar, label: 'Booking' }
  if (type.startsWith('waiver_')) return { icon: FiShield, label: 'Waiver' }
  if (type.startsWith('weapon_') || type.startsWith('equipment_')) return { icon: FiTarget, label: 'Weapons & gear' }
  if (type.startsWith('weather_')) return { icon: FiCloudRain, label: 'Weather' }
  if (type.startsWith('gameplay_')) return { icon: FiFlag, label: 'Game' }
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
  return 'Earlier'
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
