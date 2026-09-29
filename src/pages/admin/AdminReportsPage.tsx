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
        const [reservationsRes, paymentsRes, equipmentRes] = await Promise.all([
          apiGet<{ ok: boolean; data: ReservationDoc[] }>('/api/reservations?limit=200'),
          apiGet<{ ok: boolean; data: PaymentDoc[] }>('/api/payments?limit=200'),
          apiGet<{ ok: boolean; data: EquipmentDoc[] }>('/api/equipments?limit=200'),
        ])

        const reservations = Array.isArray(reservationsRes?.data) ? reservationsRes.data : []
        const payments = Array.isArray(paymentsRes?.data) ? paymentsRes.data : []
        const equipment = Array.isArray(equipmentRes?.data) ? equipmentRes.data : []

        const revenue = payments.reduce((sum, payment) => {
          const amount = Number(payment.amount ?? payment.totalPHP ?? 0)
          return sum + (Number.isFinite(amount) ? amount : 0)
        }, 0)

        const now = Date.now()
        const recentWindowMs = 1000 * 60 * 60 * 24 * 7
        const previousWindowMs = 1000 * 60 * 60 * 24 * 14

        const currentWeek = reservations.filter((reservation) => {
          const created = toDate(reservation.createdAtISO)
          return created ? now - created.getTime() <= recentWindowMs : false
        }).length

        const previousWeek = reservations.filter((reservation) => {
          const created = toDate(reservation.createdAtISO)
          return created ? now - created.getTime() > recentWindowMs && now - created.getTime() <= previousWindowMs : false
        }).length

        const trend = previousWeek > 0 ? Math.round(((currentWeek - previousWeek) / previousWeek) * 100) : currentWeek > 0 ? 100 : 0

        const noShows = reservations.filter((reservation) => {
          const created = toDate(reservation.createdAtISO)
          const status = String(reservation.reservationStatus || '').trim().toLowerCase()
          return created ? now - created.getTime() > 1000 * 60 * 60 * 24 && (status === 'pending' || status === 'needs review' || status === 'needs_review') : false
        }).length

        const weekendReservations = reservations.filter((reservation) => {
          const created = toDate(reservation.createdAtISO)
          return created ? [0, 6].includes(created.getDay()) : false
        }).length
        const occupancyPercent = reservations.length > 0 ? Math.min(100, Math.round((weekendReservations / Math.max(1, reservations.length)) * 100)) : 0

        const highestValuePayment = payments
          .slice()
          .sort((a, b) => Number(b.amount ?? b.totalPHP ?? 0) - Number(a.amount ?? a.totalPHP ?? 0))[0]

        const topEquipment = equipment
          .slice()
          .sort((a, b) => Number(b.qty ?? 0) - Number(a.qty ?? 0))[0]

        const nextHighlights: ReportHighlight[] = [
          {
            title: 'Weekend occupancy',
            detail: `${occupancyPercent}% of recent reservations were booked for weekend slots.`,
          },
          {
            title: 'High-value bookings',
            detail: highestValuePayment
              ? `The largest payment was ${formatCurrency(Number(highestValuePayment.amount ?? highestValuePayment.totalPHP ?? 0))}.`
              : 'No recent payment records were found.',
          },
          {
            title: 'Equipment usage',
            detail: topEquipment
              ? `${topEquipment.name || 'Inventory item'} is currently stocked at ${topEquipment.qty ?? 0} units.`
              : 'Equipment inventory is empty or unavailable.',
          },
        ]

        if (mounted) {
          setMetrics([
            { label: 'Reservations', value: String(reservations.length), tone: 'accent' },
            { label: 'Revenue', value: formatCurrency(revenue), tone: 'success' },
            { label: 'No-shows', value: String(noShows), tone: 'danger' },
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
    const trendValue = Number(String(metrics[0].value).replace(/[^0-9]/g, ''))
    return trendValue > 0 ? 'Live report' : 'No data'
  }, [loading, metrics])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">Reports</h1>
        <p className="mt-1 text-sm text-muted">Review operational reports, usage spikes, and business performance indicators.</p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        {metrics.map((metric) => (
          <Card key={metric.label} className="p-4">
            <div className="text-xs uppercase tracking-widest text-muted">{metric.label}</div>
            <div className={`mt-2 text-2xl font-bold ${metric.tone === 'accent' ? 'text-accent' : metric.tone === 'success' ? 'text-success' : 'text-danger'}`}>
              {loading ? '…' : metric.value}
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Performance snapshot</div>
          <div className="mt-2 text-sm text-muted">A curated overview of the current reporting period.</div>
          <div className="mt-4 rounded-2xl border border-white/5 bg-white/5 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Weekly trend</div>
                <div className="mt-1 text-xs text-muted">Bookings are updated from recent reservation history.</div>
              </div>
              <div className="rounded-full bg-success/20 px-3 py-1 text-sm font-semibold text-success">{loading ? '…' : `${metrics[0] ? 'Live' : 'No data'}`}</div>
            </div>
            <div className="mt-3 text-sm text-muted">{loading ? 'Loading report metrics…' : `Current report window is based on ${metrics[0]?.value || 0} reservation records.`}</div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Recent report highlights</div>
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

