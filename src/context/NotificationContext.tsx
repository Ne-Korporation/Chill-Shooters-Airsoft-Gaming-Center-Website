import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { apiDelete, apiGet, apiPost, apiPut } from '../utils/apiClient'

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
  | 'waiver_deleted' 
  | 'waiver_submitted'
  | 'payment_submitted'
  | 'payment_verified'
  | 'gameplay_status_updated'
  | 'gameplay_created'
  | 'split_payment_requested'
  | 'reservation_payment_finalized'
  | 'reservation_reminder'
  | 'waiver_reminder'

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
  clearAllNotifications: () => Promise<void>
  clearNotificationsByIds: (ids: string[]) => Promise<void>
  unreadCount: (userId: string) => number
  getNotificationsForUser: (userId: string) => NotificationItem[]
  getNotificationsForRole: (role: string, userId?: string) => NotificationItem[]
  deleteNotification: (id: string) => void
  getAllNotifications: () => NotificationItem[]
}

const STORAGE_KEY = 'chillshooters_notifications'
const NOTIFICATIONS_ENDPOINT = '/api/notifications?limit=500'

function sortNotifications(items: NotificationItem[]) {
  return [...items].sort((a, b) => new Date(b.createdAtISO).getTime() - new Date(a.createdAtISO).getTime())
}

function loadLegacyNotifications(): NotificationItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as NotificationItem[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function clearLegacyNotifications() {
  try {
    localStorage.removeItem(STORAGE_KEY)
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
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [loaded, setLoaded] = useState(false)

  const syncNotifications = useCallback((items: NotificationItem[]) => {
    setNotifications(sortNotifications(items))
  }, [])

  useEffect(() => {
    let active = true

    const load = async () => {
      try {
        const response = await apiGet<{ ok: boolean; data: NotificationItem[] }>(NOTIFICATIONS_ENDPOINT)
        const remoteNotifications = Array.isArray(response?.data) ? sortNotifications(response.data) : []

        if (remoteNotifications.length === 0) {
          const legacyNotifications = sortNotifications(loadLegacyNotifications())
          if (legacyNotifications.length > 0) {
            await Promise.all(legacyNotifications.map((item) => apiPost('/api/notifications', item)))
            clearLegacyNotifications()

            const migrated = await apiGet<{ ok: boolean; data: NotificationItem[] }>(NOTIFICATIONS_ENDPOINT)
            const migratedNotifications = Array.isArray(migrated?.data) ? sortNotifications(migrated.data) : []
            if (active) syncNotifications(migratedNotifications)
            return
          }
        }

        if (active) syncNotifications(remoteNotifications)
      } catch {
        const legacyNotifications = sortNotifications(loadLegacyNotifications())
        if (active) syncNotifications(legacyNotifications)
      } finally {
        if (active) setLoaded(true)
      }
    }

    void load()

    return () => {
      active = false
    }
  }, [syncNotifications])

  const addNotification = useCallback(
    (item: Omit<NotificationItem, 'id' | 'read' | 'createdAtISO'>) => {
      const newItem: NotificationItem = {
        ...item,
        id: generateId(),
        read: false,
        createdAtISO: new Date().toISOString(),
      }
      setNotifications((prev) => sortNotifications([newItem, ...prev]))
      void apiPost('/api/notifications', newItem).catch((error) => {
        console.warn('Failed to persist notification', error)
      })
    },
    [],
  )

  const markAsRead = useCallback(
    (id: string) => {
      setNotifications((prev) => {
        const updated = sortNotifications(prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
        void apiPut(`/api/notifications/${encodeURIComponent(id)}`, { read: true }).catch((error) => {
          console.warn('Failed to update notification', error)
        })
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
          const shouldMark = matchesDirectUser || matchesRole
          if (shouldMark) {
            void apiPut(`/api/notifications/${encodeURIComponent(n.id)}`, { read: true }).catch((error) => {
              console.warn('Failed to update notification', error)
            })
          }
          return shouldMark ? { ...n, read: true } : n
        })
        return sortNotifications(updated)
      })
    },
    [],
  )

  const clearAllNotifications = useCallback(async () => {
    setNotifications([])
    await apiDelete('/api/notifications')
  }, [])

  const clearNotificationsByIds = useCallback(async (ids: string[]) => {
    const uniqueIds = Array.from(new Set(ids.map((id) => String(id)).filter(Boolean)))
    if (uniqueIds.length === 0) return

    setNotifications((prev) => prev.filter((notification) => !uniqueIds.includes(notification.id)))

    await Promise.all(
      uniqueIds.map((id) => apiDelete(`/api/notifications/${encodeURIComponent(id)}`)),
    )
  }, [])

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
        const updated = sortNotifications(prev.filter((n) => n.id !== id))
        void apiDelete(`/api/notifications/${encodeURIComponent(id)}`).catch((error) => {
          console.warn('Failed to delete notification', error)
        })
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
      clearAllNotifications,
      clearNotificationsByIds,
      unreadCount,
      getNotificationsForUser,
      getNotificationsForRole,
      deleteNotification,
      getAllNotifications,
    }),
    [notifications, addNotification, markAsRead, markAllAsRead, clearAllNotifications, clearNotificationsByIds, unreadCount, getNotificationsForUser, getNotificationsForRole, deleteNotification, getAllNotifications],
  )

  if (!loaded) {
    // Keep the provider mounted while we hydrate notifications from MongoDB.
  }

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
}

export function useNotifications() {
  const ctx = useContext(NotificationContext)
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider')
  return ctx
}


