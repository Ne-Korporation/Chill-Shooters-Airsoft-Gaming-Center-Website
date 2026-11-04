import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { DashboardPostsPanel } from '../../components/dashboard/DashboardPostsPanel'
import { WeekendCapacity } from '../../components/booking/WeekendCapacity'
import { useAuth } from '../../context/AuthContext'
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

  const { user } = useAuth()
  const firstName = String(user?.name || 'there').trim().split(/\s+/)[0]
  const totalQueue = pendingReservations + pendingWaivers + pendingPayments

  return (
    <div className="space-y-6">
      <DashboardHeader
        eyebrow="Dashboard"
        title={`Welcome back, ${firstName}`}
        description="Approve reservations, then verify waivers and payments to confirm each booking."
        actions={
          <Link to="/app/registrar/reservations" className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white transition hover:brightness-110">
            <FiCalendar /> Reservations
          </Link>
        }
      />

      {/* Same layout as the player dashboard: announcements in the main column, a compact summary on the right. */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <DashboardPostsPanel
          title="Announcements"
          subtitle="Updates and reminders from the admin team."
          beforePosts={
            <WeekendCapacity
              compact
              title="This week's public game capacity"
              subtitle="How many players have booked this weekend's open games."
            />
          }
        />

        <aside className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <StatTile compact label="To approve" value={pendingReservations} hint={pendingReservations > 0 ? 'Bookings' : 'All clear'} attention={pendingReservations > 0} loading={loading} />
            <StatTile compact label="Waivers" value={pendingWaivers} hint={pendingWaivers > 0 ? 'To review' : 'All clear'} attention={pendingWaivers > 0} loading={loading} />
            <StatTile compact label="Payments" value={pendingPayments} hint={pendingPayments > 0 ? 'To verify' : 'All clear'} attention={pendingPayments > 0} loading={loading} />
          </div>

          <Panel
            compact
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

          <Panel compact title="Shortcuts">
            <div className="space-y-0.5">
              <ActionRow to="/app/registrar/games" icon={FiZap} title="Games" description="Ongoing and archived sessions" />
              <ActionRow
                to="/app/registrar/availed-packages"
                icon={FiPackage}
                title="Availed packages"
                description="Gear readiness per booking"
              />
            </div>
            <div className="divider mt-3 border-t pt-3 text-[11px] text-muted">
              Booking flow: <span className="text-text">Waiver</span> → <span className="text-text">Payment</span> →{' '}
              <span className="text-text">Confirmed</span>
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  )
}
