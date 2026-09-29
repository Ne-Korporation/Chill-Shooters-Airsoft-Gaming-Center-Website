import React, { useEffect, useMemo, useState } from 'react'
import { Card } from '../../components/ui/Card'
import { apiGet } from '../../utils/apiClient'

type Metric = { label: string; value: string; tone: 'accent' | 'success' | 'danger' }

type ReportHighlight = { title: string; detail: string }

type ReservationDoc = {
  reservationStatus?: string
  createdAtISO?: string
  updatedAtISO?: string
  reservationDate?: string
  reservationTime?: string
}

type PaymentDoc = {
  amount?: number
  totalPHP?: number
  createdAtISO?: string
  paymentStatus?: string
  status?: string
}

type EquipmentDoc = {
  qty?: number
  name?: string
  status?: string
}

type WaiverDoc = {
  status?: string
  createdAtISO?: string
  submittedAtISO?: string
}

function formatCurrency(value: number) {
  return `₱${value.toLocaleString('en-PH', { maximumFractionDigits: 0 })}`
}

function toDate(value?: string) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function AdminReportsPage() {
  const [metrics, setMetrics] = useState<Metric[]>([])
  const [highlights, setHighlights] = useState<ReportHighlight[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    const load = async () => {
      setLoading(true)
      setError(null)

      try {
        const [reservationsRes, paymentsRes, equipmentRes, waiversRes] = await Promise.all([
          apiGet<{ ok: boolean; data: ReservationDoc[] }>('/api/reservations?limit=200'),
          apiGet<{ ok: boolean; data: PaymentDoc[] }>('/api/payments?limit=200'),
          apiGet<{ ok: boolean; data: EquipmentDoc[] }>('/api/equipments?limit=200'),
          apiGet<{ ok: boolean; data: WaiverDoc[] }>('/api/waivers?limit=200'),
        ])

        const reservations = Array.isArray(reservationsRes?.data) ? reservationsRes.data : []
        const payments = Array.isArray(paymentsRes?.data) ? paymentsRes.data : []
        const equipment = Array.isArray(equipmentRes?.data) ? equipmentRes.data : []
        const waivers = Array.isArray(waiversRes?.data) ? waiversRes.data : []

        const revenue = payments.reduce((sum, payment) => {
          const amount = Number(payment.amount ?? payment.totalPHP ?? 0)
          return sum + (Number.isFinite(amount) ? amount : 0)
        }, 0)

        const pendingApprovals = reservations.filter((reservation) => {
          const status = String(reservation.reservationStatus || '').trim().toLowerCase()
          return status === 'pending' || status === 'needs review' || status === 'needs_review'
        }).length

        const paymentsToVerify = payments.filter((payment) => {
          const status = String(payment.paymentStatus || payment.status || '').trim().toLowerCase()
          return status === 'pending' || status === 'submitted' || status === 'review'
        }).length

        const waiverBacklog = waivers.filter((waiver) => {
          const status = String(waiver.status || '').trim().toLowerCase()
          return status === 'pending' || status === 'review' || status === 'submitted'
        }).length

        const equipmentAlerts = equipment.filter((item) => {
          const status = String(item.status || '').trim().toLowerCase()
          return status === 'maintenance' || Number(item.qty ?? 0) <= 1
        }).length

        const confirmedReservations = reservations.filter((reservation) => {
          const status = String(reservation.reservationStatus || '').trim().toLowerCase()
          return status === 'confirmed' || status === 'approved'
        }).length

        const highestValuePayment = payments
          .slice()
          .sort((a, b) => Number(b.amount ?? b.totalPHP ?? 0) - Number(a.amount ?? a.totalPHP ?? 0))[0]

        const topEquipment = equipment
          .slice()
          .sort((a, b) => Number(b.qty ?? 0) - Number(a.qty ?? 0))[0]

        const nextHighlights: ReportHighlight[] = [
          {
            title: 'Approval queue',
            detail: `${pendingApprovals} reservations still require admin or registrar review before activation.`,
          },
          {
            title: 'Payment verification',
            detail: `${paymentsToVerify} payment records are waiting for review or confirmation.`,
          },
          {
            title: 'Waiver backlog',
            detail: `${waiverBacklog} waiver records are still pending action.`,
          },
          {
            title: 'Equipment risk',
            detail: `${equipmentAlerts} equipment items are under maintenance or low stock and need attention.`,
          },
          {
            title: 'Revenue snapshot',
            detail: highestValuePayment
              ? `Largest payment record is ${formatCurrency(Number(highestValuePayment.amount ?? highestValuePayment.totalPHP ?? 0))}.`
              : 'No payment records are available yet.',
          },
          {
            title: 'Inventory signal',
            detail: topEquipment
              ? `${topEquipment.name || 'Inventory item'} is the highest-stock item at ${topEquipment.qty ?? 0} units.`
              : 'No inventory entries are available to summarize.',
          },
        ]

        if (mounted) {
          setMetrics([
            { label: 'Reservations', value: String(reservations.length), tone: 'accent' },
            { label: 'Confirmed', value: String(confirmedReservations), tone: 'success' },
            { label: 'Revenue', value: formatCurrency(revenue), tone: 'success' },
            { label: 'Pending approvals', value: String(pendingApprovals), tone: 'danger' },
            { label: 'Waiver backlog', value: String(waiverBacklog), tone: 'accent' },
            { label: 'Equipment alerts', value: String(equipmentAlerts), tone: 'danger' },
          ])
          setHighlights(nextHighlights)
        }
      } catch (err: any) {
        if (mounted) {
          setError(err?.message || 'Unable to load report data')
          setMetrics([])
          setHighlights([])
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }

    load()
    return () => {
      mounted = false
    }
  }, [])

  const trendLabel = useMemo(() => {
    if (loading) return 'Loading…'
    if (metrics.length === 0) return 'No data'
    return 'Live admin report'
  }, [loading, metrics])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">Reports</h1>
        <p className="mt-1 text-sm text-muted">Operational reporting for reservations, payments, waivers, inventory, and approval flow.</p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {metrics.map((metric) => (
          <Card key={metric.label} className="p-4">
            <div className="text-xs uppercase tracking-widest text-muted">{metric.label}</div>
            <div className={`mt-2 text-2xl font-bold ${metric.tone === 'accent' ? 'text-accent' : metric.tone === 'success' ? 'text-success' : 'text-danger'}`}>
              {loading ? '…' : metric.value}
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Admin summary</div>
          <div className="mt-2 text-sm text-muted">This report snapshot is designed for daily operational decisions.</div>
          <div className="mt-4 rounded-2xl border border-white/5 bg-white/5 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Current report view</div>
                <div className="mt-1 text-xs text-muted">Across reservations, payments, waivers, and inventory.</div>
              </div>
              <div className="rounded-full bg-success/20 px-3 py-1 text-sm font-semibold text-success">{loading ? '…' : trendLabel}</div>
            </div>
            <div className="mt-3 text-sm text-muted">
              {loading
                ? 'Loading admin report metrics…'
                : 'Use this view to monitor approval bottlenecks, financial status, and item readiness before the next operating session.'}
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Operational highlights</div>
          <div className="mt-4 space-y-2">
            {highlights.map((report) => (
              <div key={report.title} className="rounded-xl border border-white/5 bg-white/5 px-3 py-3">
                <div className="text-sm font-semibold">{report.title}</div>
                <div className="mt-1 text-sm text-muted">{report.detail}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

