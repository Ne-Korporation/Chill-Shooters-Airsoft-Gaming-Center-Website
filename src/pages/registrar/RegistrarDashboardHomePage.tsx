import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { DashboardPostsPanel } from '../../components/dashboard/DashboardPostsPanel'
import { ActionRow, DashboardHeader, Panel, StatTile } from '../../components/dashboard/DashboardParts'
import { FiCalendar, FiShield, FiPackage, FiCreditCard, FiZap } from 'react-icons/fi'
import { apiGet } from '../../utils/apiClient'

export function RegistrarDashboardHomePage() {
  const [pendingReservations, setPendingReservations] = useState(0)
  const [pendingWaivers, setPendingWaivers] = useState(0)
  const [pendingPayments, setPendingPayments] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const [reservationsRes, waiversRes, paymentsRes] = await Promise.all([
          apiGet<{ ok: boolean; data: any[] }>('/api/reservations?limit=200'),
          apiGet<{ ok: boolean; data: any[] }>('/api/waivers?limit=200'),
          apiGet<{ ok: boolean; data: any[] }>('/api/payments?limit=200'),
        ])

        const reservations = Array.isArray(reservationsRes?.data) ? reservationsRes.data : []
        const waivers = Array.isArray(waiversRes?.data) ? waiversRes.data : []
        const payments = Array.isArray(paymentsRes?.data) ? paymentsRes.data : []

        setPendingReservations(reservations.filter((item) => String(item.reservationStatus || '').toLowerCase() === 'pending').length)
        setPendingWaivers(waivers.filter((item) => !item.status || String(item.status).toLowerCase() === 'pending').length)
        setPendingPayments(payments.filter((item) => {
          const status = String(item.paymentStatus || item.status || '').toLowerCase()
          return status === 'pending' || status === 'submitted' || status === 'review'
        }).length)
      } catch (e: any) {
        toast.error(String(e?.message || e))
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [])

  const totalQueue = pendingReservations + pendingWaivers + pendingPayments

  return (
    <div className="space-y-6">
      <DashboardHeader
        eyebrow="Registrar"
        title="Today's queue"
        description="Approve reservations, then verify waivers and payments to confirm each booking."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Reservations to approve"
          value={pendingReservations}
          icon={FiCalendar}
          hint={pendingReservations > 0 ? 'Waiting for review' : 'All clear'}
          attention={pendingReservations > 0}
          loading={loading}
        />
        <StatTile
          label="Waivers to review"
          value={pendingWaivers}
          icon={FiShield}
          hint={pendingWaivers > 0 ? 'Waiting for review' : 'All clear'}
          attention={pendingWaivers > 0}
          loading={loading}
        />
        <StatTile
          label="Payments to verify"
          value={pendingPayments}
          icon={FiCreditCard}
          hint={pendingPayments > 0 ? 'Waiting for review' : 'All clear'}
          attention={pendingPayments > 0}
          loading={loading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel
          title="Work queue"
          description={loading ? undefined : totalQueue > 0 ? `${totalQueue} items to process` : 'Nothing waiting right now'}
        >
          <div className="space-y-0.5">
            <ActionRow
              to="/app/registrar/reservations"
              icon={FiCalendar}
              title="Reservations"
              description="Approve or reject booking requests"
              badge={loading ? undefined : pendingReservations}
            />
            <ActionRow
              to="/app/registrar/waivers"
              icon={FiShield}
              title="Submitted waivers"
              description="Accept or flag waiver submissions"
              badge={loading ? undefined : pendingWaivers}
            />
            <ActionRow
              to="/app/registrar/submitted-payments"
              icon={FiCreditCard}
              title="Submitted payments"
              description="Check proofs and update payment status"
              badge={loading ? undefined : pendingPayments}
            />
          </div>
        </Panel>

        <Panel title="Shortcuts">
          <div className="space-y-0.5">
            <ActionRow to="/app/registrar/games" icon={FiZap} title="Games" description="Ongoing and archived sessions" />
            <ActionRow
              to="/app/registrar/availed-packages"
              icon={FiPackage}
              title="Availed packages"
              description="Gear readiness per booking"
            />
          </div>
          <div className="divider mt-4 border-t pt-4 text-xs text-muted">
            Booking flow: <span className="text-text">Waiver</span> → <span className="text-text">Payment</span> →{' '}
            <span className="text-text">Confirmed</span>
          </div>
        </Panel>
      </div>

      <DashboardPostsPanel
        title="Announcements"
        subtitle="Updates and reminders from the admin team."
      />
    </div>
  )
}
