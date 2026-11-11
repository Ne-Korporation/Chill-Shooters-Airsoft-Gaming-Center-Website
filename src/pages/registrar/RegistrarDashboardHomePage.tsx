import React, { useEffect, useState } from 'react'
import { useLiveRefresh } from '../../utils/liveUpdates'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { DashboardPostsPanel } from '../../components/dashboard/DashboardPostsPanel'
import { CapacityCalendar } from '../../components/booking/CapacityCalendar'
import { useAuth } from '../../context/AuthContext'
import { ActionRow, DashboardHeader, Panel, StatTile } from '../../components/dashboard/DashboardParts'
import { FiCalendar, FiShield, FiShoppingBag, FiCreditCard, FiZap } from 'react-icons/fi'
import { apiGet } from '../../utils/apiClient'
import { useAutoRefresh } from '../../hooks/useAutoRefresh'
import { WeatherAdvisoryWidget } from '../../components/dashboard/WeatherAdvisoryWidget'

export function RegistrarDashboardHomePage() {
  const [pendingReservations, setPendingReservations] = useState(0)
  const [pendingWaivers, setPendingWaivers] = useState(0)
  const [pendingPayments, setPendingPayments] = useState(0)
  const [loading, setLoading] = useState(true)
  // Bumped when the data shown here changes on the server; re-runs the load below quietly.
  const [liveTick, setLiveTick] = useState(0)
  useLiveRefresh(['reservations', 'payments', 'waivers'], () => setLiveTick((tick) => tick + 1))

  // Bumped every few seconds so new bookings, waivers and payments show without reloading.
  const [refreshTick, setRefreshTick] = useState(0)
  useAutoRefresh(() => setRefreshTick((tick) => tick + 1))

  useEffect(() => {
    let active = true
    // Background refreshes keep what's on screen instead of showing loading or errors.
    const silent = refreshTick > 0
    const load = async () => {
      if (!silent) setLoading(true)
      try {
        const [reservationsRes, waiversRes, paymentsRes] = await Promise.all([
          apiGet<{ ok: boolean; data: any[] }>('/api/reservations?limit=200'),
          apiGet<{ ok: boolean; data: any[] }>('/api/waivers?limit=200'),
          apiGet<{ ok: boolean; data: any[] }>('/api/payments?limit=200'),
        ])

        if (!active) return
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
        if (!silent) toast.error(String(e?.message || e))
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()
    return () => { active = false }
  }, [refreshTick])

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

      {/* Same layout as the admin dashboard: the capacity calendar in the main column (view only;
          games for a cause are set by the admin) and one column beside it: announcements first, then the
          counts and the work queue. */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <CapacityCalendar
            title="Game Capacity"
            subtitle="Spots booked for each weekend's open games. Click a day for details."
          />
        </div>

        <aside className="space-y-3">
          <WeatherAdvisoryWidget />
          <DashboardPostsPanel
            title="Announcements"
            initialCount={3}
          />

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
            {/* Shortcuts, under the queue so the side column stays about as tall as the calendar. */}
            <div className="divider mt-2 space-y-0.5 border-t pt-2">
              <ActionRow to="/app/registrar/games" icon={FiZap} title="Games" description="Ongoing and archived sessions" />
              <ActionRow to="/app/counter" icon={FiShoppingBag} title="Game counter" description="Check-in, rentals, ammo and payments per game" />
            </div>
            <div className="divider mt-2 border-t pt-2 text-[11px] text-muted">
              Booking flow: <span className="text-text">Waiver</span> → <span className="text-text">Payment</span> →{' '}
              <span className="text-text">Confirmed</span>
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  )
}
