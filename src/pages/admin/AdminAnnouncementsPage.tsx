import React from 'react'
import { FiVolume2 } from 'react-icons/fi'
import { DashboardPostsPanel } from '../../components/dashboard/DashboardPostsPanel'

// Admins write and manage announcements here; they appear on every dashboard.
export function AdminAnnouncementsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold"><FiVolume2 /> Announcements</h1>
        <p className="mt-1 text-sm text-muted">
          Posts here appear on every dashboard: players, marshals, and registrars.
        </p>
      </div>
      <DashboardPostsPanel
        canManage
        groupByAge
        collapsible
        title="Announcements"
        subtitle="Click a card to view it, then edit or remove it."
      />
    </div>
  )
}
