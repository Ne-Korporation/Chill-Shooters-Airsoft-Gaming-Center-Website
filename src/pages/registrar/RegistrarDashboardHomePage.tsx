import React, { useEffect, useState } from 'react'
import { useLiveRefresh } from '../../utils/liveUpdates'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { DashboardPostsPanel } from '../../components/dashboard/DashboardPostsPanel'
import { CapacityCalendar } from '../../components/booking/CapacityCalendar'
import { useAuth } from '../../context/AuthContext'
import { ActionRow, DashboardHeader, Panel, StatTile } from '../../components/dashboard/DashboardParts'
import { FiCalendar, FiPercent, FiShield, FiShoppingBag, FiCreditCard, FiUserCheck, FiZap } from 'react-icons/fi'
import { apiGet } from '../../utils/apiClient'
import { useAutoRefresh } from '../../hooks/useAutoRefresh'
import { WeatherAdvisoryWidget } from '../../components/dashboard/WeatherAdvisoryWidget'

// How many documents match, from the server's total (not just the first page).
const countOf = (collection: string, filter: object) =>
  apiGet<{ total?: number }>(`/api/${collection}?q=${encodeURIComponent(JSON.stringify(filter))}&limit=1&withTotal=1`).then((r) => Number(r?.total || 0))

const PAID_STATUSES = ['paid', 'confirmed', 'verified', 'approved', 'succeeded']
const peso = (n: number) => `₱${Math.round(n).toLocaleString('en-PH')}`

export function RegistrarDashboardHomePage() {
  // The registrar's own work: payments to verify, IDs to verify (waivers follow from them), waivers
  // to review and partnership requests; plus the money still due on today's games.
  const [pendingPayments, setPendingPayments] = useState(0)
  const [pendingIds, setPendingIds] = useState(0)
  const [pendingWaivers, setPendingWaivers] = useState(0)
  const [pendingPartnerships, setPendingPartnerships] = useState(0)
  const [collectToday, setCollectToday] = useState({ amount: 0, bookings: 0 })
  const [loading, setLoading] = useState(true)
  // Bumped when the data shown here changes on the server; re-runs the load below quietly.
  const [liveTick, setLiveTick] = useState(0)
  useLiveRefresh(['reservations', 'payments', 'waivers', 'accounts'], () => setLiveTick((tick) => tick + 1))

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
        const todayISO = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())
        const [payments, ids, waivers, partnerships, todayRes] = await Promise.all([
          countOf('payments', { paymentStatus: { $in: ['pending', 'submitted', 'review'] } }),
          countOf('user_accounts', { role: 'user', identityVerificationStatus: 'pending_review' }),
          countOf('waivers', { archived: { $ne: true }, $or: [{ status: 'pending' }, { status: { $exists: false } }, { status: '' }] }),
          countOf('user_accounts', { role: 'user', partnershipEligibilityStatus: 'pending' }),
          apiGet<{ ok: boolean; data: any[] }>(`/api/reservations?q=${encodeURIComponent(JSON.stringify({ reservationDate: todayISO, reservationStatus: { $in: ['confirmed', 'approved'] } }))}&limit=200`),
        ])
        // Still due on today's confirmed games: each booking's total less what's been paid toward it.
        const today = Array.isArray(todayRes?.data) ? todayRes.data : []
        const keys = today.flatMap((r: any) => [r.id, r._id && String(r._id)].filter(Boolean))
        const todayPayments = keys.length
          ? (await apiGet<{ ok: boolean; data: any[] }>(`/api/payments?q=${encodeURIComponent(JSON.stringify({ reservationId: { $in: keys } }))}&limit=500`)).data || []
          : []
        let amount = 0
        let bookings = 0
        for (const r of today) {
          const mine = todayPayments.filter((p: any) => [r.id, r._id && String(r._id)].includes(String(p.reservationId || '')))
          const paid = mine.filter((p: any) => PAID_STATUSES.includes(String(p.paymentStatus || p.status || '').toLowerCase()))
            .reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0)
          const due = Math.max(0, (Number(r.totalAmount) || 0) - paid)
          if (due > 0.5) { amount += due; bookings += 1 }
        }

        if (!active) return
        setPendingPayments(payments)
        setPendingIds(ids)
        setPendingWaivers(waivers)
        setPendingPartnerships(partnerships)
        setCollectToday({ amount, bookings })
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
  // Things only the registrar can clear (pending bookings wait on the player, so they aren't here).
  const totalQueue = pendingPayments + pendingIds + pendingWaivers + pendingPartnerships

  return (
    <div className="space-y-6">
      <DashboardHeader
        eyebrow="Dashboard"
        title={`Welcome back, ${firstName}`}
        description="Verify payments and IDs, and collect what's due at the counter."
        actions={
          <Link to="/app/registrar/reservations" className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white transition hover:brightness-110">
            <FiCalendar /> Reservations
          </Link>
        }
      />

      {/* Same layout as the player dashboard: announcements in the main column, the calendar under
          the sidebar menu on desktop (under the announcements on phones), and the weather, counts
          and work queue on the right. */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <DashboardPostsPanel
            title="Announcements"
            subtitle="Updates and reminders from the Chill Shooters team."
            initialCount={3}
          />
          <div className="lg:hidden"><CapacityCalendar /></div>
        </div>

        {/* On desktop the side column stays in view while the announcements scroll (like the menu on the left). */}
        <aside className="no-scrollbar order-first space-y-3 lg:sticky lg:top-[96px] lg:order-none lg:max-h-[calc(100vh-120px)] lg:overflow-y-auto">
          <WeatherAdvisoryWidget />

          <div className="grid grid-cols-3 gap-2">
            <StatTile compact label="Payments" value={pendingPayments} hint={pendingPayments > 0 ? 'To verify' : 'All clear'} attention={pendingPayments > 0} loading={loading} to="/app/registrar/submitted-payments" />
            <StatTile compact label="IDs" value={pendingIds} hint={pendingIds > 0 ? 'To verify' : 'All clear'} attention={pendingIds > 0} loading={loading} to="/app/registrar/players#id-verifications" />
            <StatTile compact label="Collect today" value={peso(collectToday.amount)} hint={collectToday.bookings > 0 ? `${collectToday.bookings} booking${collectToday.bookings === 1 ? '' : 's'}` : 'Nothing due'} loading={loading} to="/app/counter?view=today" />
          </div>

          <Panel
            compact
            title="Work queue"
            description={loading ? undefined : totalQueue > 0 ? `${totalQueue} item${totalQueue === 1 ? '' : 's'} to process` : 'Nothing waiting right now'}
          >
            <div className="space-y-0.5">
              <ActionRow
                to="/app/registrar/submitted-payments"
                icon={FiCreditCard}
                title="Submitted payments"
                description="Check proofs so bookings confirm"
                badge={loading ? undefined : pendingPayments}
              />
              <ActionRow
                to="/app/registrar/players#id-verifications"
                icon={FiUserCheck}
                title="ID verifications"
                description="Verify IDs; their waivers then approve"
                badge={loading ? undefined : pendingIds}
              />
              <ActionRow
                to="/app/registrar/waivers"
                icon={FiShield}
                title="Submitted waivers"
                description="Approve or deny the ones still waiting"
                badge={loading ? undefined : pendingWaivers}
              />
              <ActionRow
                to="/app/registrar/players#partnership-requests"
                icon={FiPercent}
                title="Partnership requests"
                description="Check proof for the member discount"
                badge={loading ? undefined : pendingPartnerships}
              />
            </div>
            {/* Shortcuts, under the queue so the side column stays about as tall as the calendar. */}
            <div className="divider mt-2 space-y-0.5 border-t pt-2">
              <ActionRow to="/app/registrar/reservations" icon={FiCalendar} title="Reservations" description="Games to start, complete and archive" />
              <ActionRow to="/app/counter?view=today" icon={FiShoppingBag} title="Game counter" description="Check-in, bills and payments for today's games" />
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
