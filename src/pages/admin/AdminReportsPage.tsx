import React, { useEffect, useMemo, useState } from 'react'
import { FiDownload, FiPrinter } from 'react-icons/fi'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { apiGet } from '../../utils/apiClient'

type Metric = { label: string; value: string; tone: 'accent' | 'success' | 'danger' }

type ReservationDoc = {
  id?: string
  reservationStatus?: string
  createdAtISO?: string
  reservationDate?: string
  dateISO?: string
  reservationTime?: string
  numberOfPlayers?: number
  totalAmount?: number
  locationName?: string
  locationId?: string
}

type PaymentDoc = {
  id?: string
  reservationId?: string
  amount?: number
  totalPHP?: number
  createdAtISO?: string
  createdAt?: string
  paymentStatus?: string
  status?: string
  paymentMethod?: string
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

type Period = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom'

const PERIOD_LABELS: Record<Period, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
  custom: 'Custom range',
}

// Payment statuses that mean the money was actually received.
const COLLECTED_STATUSES = ['paid', 'confirmed', 'verified', 'approved', 'succeeded']
const PAGE_SIZE = 200

function formatCurrency(value: number) {
  return `₱${value.toLocaleString('en-PH', { maximumFractionDigits: 0 })}`
}

function toISODate(date: Date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// Local calendar date (YYYY-MM-DD) of a stored timestamp or date string.
function dayOf(value?: string) {
  if (!value) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : toISODate(parsed)
}

function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00`)
  date.setDate(date.getDate() + days)
  return toISODate(date)
}

function rangeFor(period: Period, anchor: string, customStart: string, customEnd: string) {
  const date = new Date(`${anchor}T12:00:00`)
  if (period === 'daily') return { start: anchor, end: anchor }
  if (period === 'weekly') {
    const mondayOffset = (date.getDay() + 6) % 7
    const start = addDays(anchor, -mondayOffset)
    return { start, end: addDays(start, 6) }
  }
  if (period === 'monthly') {
    const start = toISODate(new Date(date.getFullYear(), date.getMonth(), 1, 12))
    const end = toISODate(new Date(date.getFullYear(), date.getMonth() + 1, 0, 12))
    return { start, end }
  }
  if (period === 'yearly') {
    return { start: `${date.getFullYear()}-01-01`, end: `${date.getFullYear()}-12-31` }
  }
  return customStart <= customEnd
    ? { start: customStart, end: customEnd }
    : { start: customEnd, end: customStart }
}

// Breakdown rows: by month for a year, by day otherwise.
function bucketKey(period: Period, day: string) {
  return period === 'yearly' ? day.slice(0, 7) : day
}

async function fetchAll<T>(collection: string): Promise<T[]> {
  const all: T[] = []
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const res = await apiGet<{ ok: boolean; data: T[] }>(`/api/${collection}?limit=${PAGE_SIZE}&skip=${skip}`)
    const page = Array.isArray(res?.data) ? res.data : []
    all.push(...page)
    if (page.length < PAGE_SIZE) return all
  }
}

function paymentAmount(payment: PaymentDoc) {
  const amount = Number(payment.amount ?? payment.totalPHP ?? 0)
  return Number.isFinite(amount) ? amount : 0
}

function paymentStatusOf(payment: PaymentDoc) {
  return String(payment.paymentStatus || payment.status || 'pending').trim().toLowerCase()
}

function reservationDay(reservation: ReservationDoc) {
  return dayOf(reservation.reservationDate || reservation.dateISO || reservation.createdAtISO)
}

function csvCell(value: unknown) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function AdminReportsPage() {
  const today = toISODate(new Date())
  const [reservations, setReservations] = useState<ReservationDoc[]>([])
  const [payments, setPayments] = useState<PaymentDoc[]>([])
  const [equipment, setEquipment] = useState<EquipmentDoc[]>([])
  const [waivers, setWaivers] = useState<WaiverDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<Period>('monthly')
  const [anchor, setAnchor] = useState(today)
  const [customStart, setCustomStart] = useState(addDays(today, -30))
  const [customEnd, setCustomEnd] = useState(today)

  useEffect(() => {
    let mounted = true

    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const [nextReservations, nextPayments, nextEquipment, nextWaivers] = await Promise.all([
          fetchAll<ReservationDoc>('reservations'),
          fetchAll<PaymentDoc>('payments'),
          fetchAll<EquipmentDoc>('equipments'),
          fetchAll<WaiverDoc>('waivers'),
        ])
        if (!mounted) return
        setReservations(nextReservations)
        setPayments(nextPayments)
        setEquipment(nextEquipment)
        setWaivers(nextWaivers)
      } catch (err: any) {
        if (mounted) setError(err?.message || 'Unable to load report data')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    load()
    return () => {
      mounted = false
    }
  }, [])

  const range = useMemo(() => rangeFor(period, anchor, customStart, customEnd), [period, anchor, customStart, customEnd])
  const inRange = (day: string) => !!day && day >= range.start && day <= range.end

  const report = useMemo(() => {
    const periodReservations = reservations.filter((reservation) => inRange(reservationDay(reservation)))
    const periodPayments = payments.filter((payment) => inRange(dayOf(payment.createdAtISO || payment.createdAt)))
    const periodWaivers = waivers.filter((waiver) => inRange(dayOf(waiver.submittedAtISO || waiver.createdAtISO)))

    const statusOf = (reservation: ReservationDoc) => String(reservation.reservationStatus || '').trim().toLowerCase()
    const confirmed = periodReservations.filter((r) => ['confirmed', 'approved', 'completed'].includes(statusOf(r))).length
    const cancelled = periodReservations.filter((r) => ['cancelled', 'canceled', 'rejected'].includes(statusOf(r))).length
    const pendingApprovals = periodReservations.filter((r) => ['pending', 'needs review', 'needs_review'].includes(statusOf(r))).length
    const players = periodReservations
      .filter((r) => !['cancelled', 'canceled', 'rejected'].includes(statusOf(r)))
      .reduce((sum, r) => sum + (Number(r.numberOfPlayers) || 0), 0)

    const collectedPayments = periodPayments.filter((p) => COLLECTED_STATUSES.includes(paymentStatusOf(p)))
    const pendingPayments = periodPayments.filter((p) => ['pending', 'submitted', 'review'].includes(paymentStatusOf(p)))
    const collected = collectedPayments.reduce((sum, p) => sum + paymentAmount(p), 0)
    const pendingAmount = pendingPayments.reduce((sum, p) => sum + paymentAmount(p), 0)

    const buckets = new Map<string, { reservations: number; players: number; collected: number }>()
    const bucket = (key: string) => {
      const existing = buckets.get(key)
      if (existing) return existing
      const created = { reservations: 0, players: 0, collected: 0 }
      buckets.set(key, created)
      return created
    }
    for (const reservation of periodReservations) {
      const row = bucket(bucketKey(period, reservationDay(reservation)))
      row.reservations += 1
      row.players += Number(reservation.numberOfPlayers) || 0
    }
    for (const payment of collectedPayments) {
      bucket(bucketKey(period, dayOf(payment.createdAtISO || payment.createdAt))).collected += paymentAmount(payment)
    }
    const breakdown = Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, values]) => ({ key, ...values }))

    const equipmentAlerts = equipment.filter((item) =>
      String(item.status || '').trim().toLowerCase() === 'maintenance' || Number(item.qty ?? 0) <= 1).length

    const metrics: Metric[] = [
      { label: 'Reservations', value: String(periodReservations.length), tone: 'accent' },
      { label: 'Confirmed / completed', value: String(confirmed), tone: 'success' },
      { label: 'Cancelled / rejected', value: String(cancelled), tone: 'danger' },
      { label: 'Players booked', value: String(players), tone: 'accent' },
      { label: 'Revenue collected', value: formatCurrency(collected), tone: 'success' },
      { label: 'Payments awaiting review', value: `${pendingPayments.length} · ${formatCurrency(pendingAmount)}`, tone: 'danger' },
      { label: 'Pending approvals', value: String(pendingApprovals), tone: 'danger' },
      { label: 'Waivers submitted', value: String(periodWaivers.length), tone: 'accent' },
      { label: 'Equipment alerts (current)', value: String(equipmentAlerts), tone: 'danger' },
    ]

    return { metrics, breakdown, periodPayments, collected, players }
  }, [reservations, payments, waivers, equipment, range, period])

  const rangeLabel = range.start === range.end ? range.start : `${range.start} to ${range.end}`

  const exportCsv = () => {
    const lines: string[] = []
    lines.push(['Chill Shooters report', PERIOD_LABELS[period], rangeLabel].map(csvCell).join(','))
    lines.push('')
    lines.push('Metric,Value')
    for (const metric of report.metrics) lines.push([metric.label, metric.value].map(csvCell).join(','))
    lines.push('')
    lines.push([period === 'yearly' ? 'Month' : 'Date', 'Reservations', 'Players', 'Revenue collected (PHP)'].join(','))
    for (const row of report.breakdown) lines.push([row.key, row.reservations, row.players, row.collected].map(csvCell).join(','))
    lines.push('')
    lines.push('Payment ID,Reservation ID,Date,Method,Status,Amount (PHP)')
    for (const payment of report.periodPayments) {
      lines.push([
        payment.id,
        payment.reservationId,
        dayOf(payment.createdAtISO || payment.createdAt),
        payment.paymentMethod,
        paymentStatusOf(payment),
        paymentAmount(payment),
      ].map(csvCell).join(','))
    }

    const blob = new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `chill-shooters-report-${period}-${range.start}_${range.end}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4 print:space-y-3">
      <style>{`@media print {
        aside, nav, header, .no-print { display: none !important; }
        body { background: #fff !important; color: #000 !important; }
        .print-area * { color: #000 !important; border-color: #ccc !important; background: transparent !important; box-shadow: none !important; }
      }`}</style>

      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Reports</h1>
          <p className="mt-1 text-sm text-muted">Operational and financial reporting for reservations, payments, waivers, and inventory.</p>
        </div>
        <div className="no-print flex gap-2">
          <Button variant="ghost" onClick={() => window.print()} disabled={loading}>
            <FiPrinter /> Print / PDF
          </Button>
          <Button variant="primary" onClick={exportCsv} disabled={loading}>
            <FiDownload /> Export CSV
          </Button>
        </div>
      </div>

      <Card className="no-print p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(PERIOD_LABELS) as Period[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPeriod(option)}
                className={[
                  'rounded-full border px-4 py-2 text-sm font-semibold transition',
                  period === option ? 'border-accent/40 bg-accent/15 text-accent' : 'border-white/10 bg-white/5 text-muted hover:text-text',
                ].join(' ')}
              >
                {PERIOD_LABELS[option]}
              </button>
            ))}
          </div>
          {period === 'custom' ? (
            <div className="flex flex-wrap gap-2">
              <label className="text-xs text-muted">
                From
                <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="ml-2 rounded-xl border border-white/10 bg-background px-3 py-2 text-sm text-text" />
              </label>
              <label className="text-xs text-muted">
                To
                <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="ml-2 rounded-xl border border-white/10 bg-background px-3 py-2 text-sm text-text" />
              </label>
            </div>
          ) : (
            <label className="text-xs text-muted">
              Period containing
              <input type="date" value={anchor} onChange={(e) => setAnchor(e.target.value || today)} className="ml-2 rounded-xl border border-white/10 bg-background px-3 py-2 text-sm text-text" />
            </label>
          )}
        </div>
      </Card>

      <div className="print-area space-y-4">
        <div className="text-sm text-muted">
          <span className="font-semibold text-text">{PERIOD_LABELS[period]} report</span> · {rangeLabel}
          {loading ? ' · Loading…' : ''}
        </div>

        {error ? (
          <div className="rounded-2xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {report.metrics.map((metric) => (
            <Card key={metric.label} className="p-4">
              <div className="text-xs uppercase tracking-widest text-muted">{metric.label}</div>
              <div className={`mt-2 text-2xl font-bold ${metric.tone === 'accent' ? 'text-accent' : metric.tone === 'success' ? 'text-success' : 'text-danger'}`}>
                {loading ? '…' : metric.value}
              </div>
            </Card>
          ))}
        </div>

        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">
            Breakdown by {period === 'yearly' ? 'month' : 'day'}
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-widest text-muted">
                <tr>
                  <th className="py-2 pr-4">{period === 'yearly' ? 'Month' : 'Date'}</th>
                  <th className="py-2 pr-4 text-right">Reservations</th>
                  <th className="py-2 pr-4 text-right">Players</th>
                  <th className="py-2 text-right">Revenue collected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {report.breakdown.length === 0 ? (
                  <tr><td colSpan={4} className="py-3 text-muted">{loading ? 'Loading…' : 'No activity in this period.'}</td></tr>
                ) : report.breakdown.map((row) => (
                  <tr key={row.key}>
                    <td className="py-2 pr-4">{row.key}</td>
                    <td className="py-2 pr-4 text-right">{row.reservations}</td>
                    <td className="py-2 pr-4 text-right">{row.players}</td>
                    <td className="py-2 text-right">{formatCurrency(row.collected)}</td>
                  </tr>
                ))}
              </tbody>
              {report.breakdown.length > 0 ? (
                <tfoot className="font-semibold">
                  <tr className="border-t border-white/10">
                    <td className="py-2 pr-4">Total</td>
                    <td className="py-2 pr-4 text-right">{report.breakdown.reduce((n, r) => n + r.reservations, 0)}</td>
                    <td className="py-2 pr-4 text-right">{report.breakdown.reduce((n, r) => n + r.players, 0)}</td>
                    <td className="py-2 text-right">{formatCurrency(report.collected)}</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </Card>

        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Payments in this period</div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-widest text-muted">
                <tr>
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4">Payment</th>
                  <th className="py-2 pr-4">Reservation</th>
                  <th className="py-2 pr-4">Method</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {report.periodPayments.length === 0 ? (
                  <tr><td colSpan={6} className="py-3 text-muted">{loading ? 'Loading…' : 'No payments in this period.'}</td></tr>
                ) : report.periodPayments.map((payment, index) => (
                  <tr key={payment.id || index}>
                    <td className="py-2 pr-4">{dayOf(payment.createdAtISO || payment.createdAt)}</td>
                    <td className="py-2 pr-4">{payment.id || '-'}</td>
                    <td className="py-2 pr-4">{payment.reservationId || '-'}</td>
                    <td className="py-2 pr-4">{payment.paymentMethod || '-'}</td>
                    <td className="py-2 pr-4 capitalize">{paymentStatusOf(payment)}</td>
                    <td className="py-2 text-right">{formatCurrency(paymentAmount(payment))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-xs text-muted">Revenue collected counts only payments marked paid, confirmed, verified, approved, or succeeded.</div>
        </Card>
      </div>
    </div>
  )
}
