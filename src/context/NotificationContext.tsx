import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'

export type NotificationType =
  | 'reservation_confirmed'
  | 'reservation_approved'
  | 'reservation_rejected'
  | 'reservation_submitted'
  | 'reservation_status_update'
  | 'weapon_approved'
  | 'weapon_rejected'
  | 'equipment_approved'
  | 'equipment_rejected'
  | 'waiver_approved'
  | 'waiver_denied'
  | 'waiver_submitted'
  | 'payment_submitted'
  | 'payment_verified'
  | 'gameplay_status_updated'
  | 'gameplay_created'

export type NotificationTargetRole = 'user' | 'registrar' | 'marshal' | 'admin' | 'all'

export type NotificationItem = {
  id: string
  userId: string
  targetRole?: NotificationTargetRole
  type: NotificationType
  title: string
  message: string
  linkedResourceId?: string
  read: boolean
  createdAtISO: string
}

export const STAFF_NOTIFICATION_ROLES: NotificationTargetRole[] = ['admin', 'registrar', 'marshal']

export function sendRoleNotifications(
  addNotification: (item: Omit<NotificationItem, 'id' | 'read' | 'createdAtISO'>) => void,
  {
    roles,
    type,
    title,
    message,
    linkedResourceId,
    userId = 'broadcast',
  }: {
    roles: NotificationTargetRole[]
    type: NotificationType
    title: string
    message: string
    linkedResourceId?: string
    userId?: string
  },
) {
  roles.forEach((role) => {
    addNotification({
      userId,
      targetRole: role,
      type,
      title,
      message,
      linkedResourceId,
    })
  })
}

type NotificationContextValue = {
  notifications: NotificationItem[]
  addNotification: (item: Omit<NotificationItem, 'id' | 'read' | 'createdAtISO'>) => void
  markAsRead: (id: string) => void
  markAllAsRead: (userId: string, role?: string) => void
  unreadCount: (userId: string) => number
  getNotificationsForUser: (userId: string) => NotificationItem[]
  getNotificationsForRole: (role: string, userId?: string) => NotificationItem[]
  deleteNotification: (id: string) => void
  getAllNotifications: () => NotificationItem[]
}

const STORAGE_KEY = 'chillshooters_notifications'

function loadNotifications(): NotificationItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as NotificationItem[]
  } catch {
    return []
  }
}

function saveNotifications(items: NotificationItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    // ignore storage errors
  }
}

let notificationCounter = 0
function generateId(): string {
  notificationCounter++
  return `NOTIF-${Date.now()}-${notificationCounter}`
}

const NotificationContext = createContext<NotificationContextValue | null>(null)

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<NotificationItem[]>(() => loadNotifications())

  const persist = useCallback((items: NotificationItem[]) => {
    setNotifications(items)
    saveNotifications(items)
  }, [])

  const addNotification = useCallback(
    (item: Omit<NotificationItem, 'id' | 'read' | 'createdAtISO'>) => {
      const newItem: NotificationItem = {
        ...item,
        id: generateId(),
        read: false,
        createdAtISO: new Date().toISOString(),
      }
      setNotifications((prev) => {
        const updated = [newItem, ...prev]
        saveNotifications(updated)
        return updated
      })
    },
    [],
  )

  const markAsRead = useCallback(
    (id: string) => {
      setNotifications((prev) => {
        const updated = prev.map((n) => (n.id === id ? { ...n, read: true } : n))
        saveNotifications(updated)
        return updated
      })
    },
    [],
  )

  const markAllAsRead = useCallback(
    (userId: string, role?: string) => {
      setNotifications((prev) => {
        const updated = prev.map((n) => {
          const matchesDirectUser = n.userId === userId
          const matchesRole = role ? n.targetRole === 'all' || n.targetRole === role : false
          return matchesDirectUser || matchesRole ? { ...n, read: true } : n
        })
        saveNotifications(updated)
        return updated
      })
    },
    [],
  )

  const unreadCount = useCallback(
    (userId: string) => {
      return notifications.filter((n) => n.userId === userId && !n.read).length
    },
    [notifications],
  )

  const getNotificationsForUser = useCallback(
    (userId: string) => {
      return notifications.filter((n) => n.userId === userId)
    },
    [notifications],
  )

  const getNotificationsForRole = useCallback(
    (role: string, userId?: string) => {
      // Admins only need notifications targeted to admins or broadcast items.
      if (role === 'admin') {
        return notifications.filter((n) => {
          if (n.targetRole === 'all') return true
          if (n.targetRole === 'admin') return true
          if (userId && n.userId === userId) return true
          return false
        })
      }
      // For other roles: match their role, 'all' targetRole, or notifications sent directly to the user's userId
      return notifications.filter((n) => {
        if (n.targetRole === 'all') return true
        if (n.targetRole === role) return true
        // Include notifications sent directly to this specific user
        if (userId && n.userId === userId) return true
        return false
      })
    },
    [notifications],
  )

  const deleteNotification = useCallback(
    (id: string) => {
      setNotifications((prev) => {
        const updated = prev.filter((n) => n.id !== id)
        saveNotifications(updated)
        return updated
      })
    },
    [],
  )

  const getAllNotifications = useCallback(() => notifications, [notifications])

  const value = useMemo<NotificationContextValue>(
    () => ({
      notifications,
      addNotification,
      markAsRead,
      markAllAsRead,
      unreadCount,
      getNotificationsForUser,
      getNotificationsForRole,
      deleteNotification,
      getAllNotifications,
    }),
    [notifications, addNotification, markAsRead, markAllAsRead, unreadCount, getNotificationsForUser, getNotificationsForRole, deleteNotification, getAllNotifications],
  )

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
}

export function useNotifications() {
  const ctx = useContext(NotificationContext)
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider')
  return ctx
}


