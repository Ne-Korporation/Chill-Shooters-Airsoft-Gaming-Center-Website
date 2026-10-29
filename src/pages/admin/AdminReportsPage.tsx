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
  depositAmount?: number
  balanceAmount?: number
  packageDiscountAmount?: number
  pricingBreakdown?: Array<{ label?: string; amount?: number }>
  extraCharges?: Array<{ label?: string; type?: string; amount?: number; atISO?: string }>
  damageCharges?: Array<{ itemName?: string; amount?: number; atISO?: string }>
  locationName?: string
  locationId?: string
}

type RentalDoc = {
  id?: string
  reservationId?: string
  playerName?: string
  itemName?: string
  itemCategory?: string
  status?: string
  condition?: string
  issuedAtISO?: string
}

type AccountDoc = {
  id?: string
  role?: string
  createdAtISO?: string
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

// Transaction types the report can be narrowed to (matched against paymentMethod).
const TRANSACTION_TYPES = [
  { key: 'all', label: 'All transactions' },
  { key: 'gcash', label: 'GCash' },
  { key: 'bank', label: 'Bank transfer' },
  { key: 'cash', label: 'Cash (onsite)' },
  { key: 'card', label: 'Card (online)' },
] as const
type TransactionType = (typeof TRANSACTION_TYPES)[number]['key']

function paymentType(payment: PaymentDoc & { stripePaymentIntentId?: string }): TransactionType {
  const method = String(payment.paymentMethod || '').toLowerCase()
  if (method.includes('card') || payment.stripePaymentIntentId) return 'card'
  if (method.includes('bank')) return 'bank'
  if (method.includes('cash')) return 'cash'
  return 'gcash'
}

const CANCELLED_STATUSES = ['cancelled', 'canceled', 'rejected']

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
  const [rentals, setRentals] = useState<RentalDoc[]>([])
  const [accounts, setAccounts] = useState<AccountDoc[]>([])
  const [transactionType, setTransactionType] = useState<TransactionType>('all')
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
        const [nextReservations, nextPayments, nextEquipment, nextWaivers, nextAccounts, rentalRes] = await Promise.all([
          fetchAll<ReservationDoc>('reservations'),
          fetchAll<PaymentDoc>('payments'),
          fetchAll<EquipmentDoc>('equipments'),
          fetchAll<WaiverDoc>('waivers'),
          fetchAll<AccountDoc>('user_accounts'),
          apiGet<{ ok: boolean; data: RentalDoc[] }>('/api/rentals').catch(() => ({ ok: false, data: [] as RentalDoc[] })),
        ])
        if (!mounted) return
        setReservations(nextReservations)
        setPayments(nextPayments)
        setEquipment(nextEquipment)
        setWaivers(nextWaivers)
        setAccounts(nextAccounts)
        setRentals(Array.isArray(rentalRes?.data) ? rentalRes.data : [])
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
    const periodPayments = payments.filter((payment) =>
      inRange(dayOf(payment.createdAtISO || payment.createdAt)) &&
      (transactionType === 'all' || paymentType(payment) === transactionType))
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

    // Player registrations (player accounts created in the period).
    const registrations = accounts.filter((account) =>
      String(account.role || 'user').toLowerCase() === 'user' && inRange(dayOf(account.createdAtISO))).length

    // Equipment rentals issued in the period, and which items went out most.
    const periodRentals = rentals.filter((rental) => inRange(dayOf(rental.issuedAtISO)))
    const rentalsByItem = new Map<string, number>()
    for (const rental of periodRentals) {
      const name = rental.itemName || 'Unknown item'
      rentalsByItem.set(name, (rentalsByItem.get(name) || 0) + 1)
    }
    const topRentals = Array.from(rentalsByItem.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8)
    const unreturned = periodRentals.filter((rental) => ['out', 'missing'].includes(String(rental.status || '').toLowerCase())).length

    // Penalties and extra charges added to bills in the period.
    const penalties: Array<{ day: string; reservationId: string; label: string; amount: number }> = []
    for (const reservation of reservations) {
      const reservationId = reservation.id || ''
      for (const charge of reservation.damageCharges || []) {
        if (inRange(dayOf(charge.atISO))) penalties.push({ day: dayOf(charge.atISO), reservationId, label: `Damage / repair: ${charge.itemName || 'item'}`, amount: Number(charge.amount) || 0 })
      }
      for (const charge of reservation.extraCharges || []) {
        if (inRange(dayOf(charge.atISO))) penalties.push({ day: dayOf(charge.atISO), reservationId, label: charge.label || charge.type || 'Extra charge', amount: Number(charge.amount) || 0 })
      }
    }
    penalties.sort((a, b) => a.day.localeCompare(b.day))
    const penaltyTotal = penalties.reduce((sum, row) => sum + row.amount, 0)
    const damageTotal = penalties.filter((row) => row.label.startsWith('Damage')).reduce((sum, row) => sum + row.amount, 0)

    // Financial statement for bookings dated in the period.
    const activeReservations = periodReservations.filter((r) => !CANCELLED_STATUSES.includes(statusOf(r)))
    const grossBookings = activeReservations.reduce((sum, r) => sum + (Number(r.totalAmount) || 0), 0)
    const discounts = activeReservations.reduce((sum, r) => {
      const fromBreakdown = (r.pricingBreakdown || [])
        .filter((line) => Number(line.amount) < 0)
        .reduce((total, line) => total + Math.abs(Number(line.amount) || 0), 0)
      return sum + Math.max(fromBreakdown, Number(r.packageDiscountAmount) || 0)
    }, 0)
    const outstanding = activeReservations.reduce((sum, r) => sum + Math.max(0, Number(r.balanceAmount) || 0), 0)
    const collectedByType = TRANSACTION_TYPES.filter((type) => type.key !== 'all').map((type) => ({
      label: type.label,
      amount: collectedPayments.filter((p) => paymentType(p) === type.key).reduce((sum, p) => sum + paymentAmount(p), 0),
    }))
    const statement = [
      { label: 'Gross booking value (after discounts)', amount: grossBookings },
      { label: 'Discounts given (package and partnership)', amount: discounts },
      { label: 'Extra charges and penalties billed', amount: penaltyTotal },
      ...collectedByType.map((row) => ({ label: `Collected via ${row.label}`, amount: row.amount })),
      { label: 'Total collected', amount: collected },
      { label: 'Outstanding balances on these bookings', amount: outstanding },
    ]

    const metrics: Metric[] = [
      { label: 'Reservations', value: String(periodReservations.length), tone: 'accent' },
      { label: 'Confirmed / completed', value: String(confirmed), tone: 'success' },
      { label: 'Cancelled / rejected', value: String(cancelled), tone: 'danger' },
      { label: 'Players booked', value: String(players), tone: 'accent' },
      { label: 'Revenue collected', value: formatCurrency(collected), tone: 'success' },
      { label: 'Payments awaiting review', value: `${pendingPayments.length} · ${formatCurrency(pendingAmount)}`, tone: 'danger' },
      { label: 'Pending approvals', value: String(pendingApprovals), tone: 'danger' },
      { label: 'Waivers submitted', value: String(periodWaivers.length), tone: 'accent' },
      { label: 'Player registrations', value: String(registrations), tone: 'accent' },
      { label: 'Equipment rentals issued', value: `${periodRentals.length}${unreturned ? ` · ${unreturned} not returned` : ''}`, tone: 'accent' },
      { label: 'Penalties & extra charges', value: `${penalties.length} · ${formatCurrency(penaltyTotal)}`, tone: 'danger' },
      { label: 'Damage / repair penalties', value: formatCurrency(damageTotal), tone: 'danger' },
      { label: 'Equipment alerts (current)', value: String(equipmentAlerts), tone: 'danger' },
    ]

    return { metrics, breakdown, periodPayments, collected, players, statement, penalties, topRentals, periodRentals }
  }, [reservations, payments, waivers, equipment, accounts, rentals, range, period, transactionType])

  const rangeLabel = range.start === range.end ? range.start : `${range.start} to ${range.end}`
  const transactionLabel = TRANSACTION_TYPES.find((type) => type.key === transactionType)?.label || 'All transactions'

  const exportCsv = () => {
    const lines: string[] = []
    lines.push(['Chill Shooters report', PERIOD_LABELS[period], rangeLabel, transactionLabel].map(csvCell).join(','))
    lines.push('')
    lines.push('Metric,Value')
    for (const metric of report.metrics) lines.push([metric.label, metric.value].map(csvCell).join(','))
    lines.push('')
    lines.push('Financial statement,Amount (PHP)')
    for (const row of report.statement) lines.push([row.label, row.amount].map(csvCell).join(','))
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
    lines.push('')
    lines.push('Penalty date,Reservation ID,Charge,Amount (PHP)')
    for (const row of report.penalties) lines.push([row.day, row.reservationId, row.label, row.amount].map(csvCell).join(','))
    lines.push('')
    lines.push('Rental ID,Issued,Reservation ID,Player,Item,Category,Status')
    for (const rental of report.periodRentals) {
      lines.push([rental.id, dayOf(rental.issuedAtISO), rental.reservationId, rental.playerName, rental.itemName, rental.itemCategory, rental.status].map(csvCell).join(','))
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
          <p className="mt-1 text-sm text-muted">Operational and financial reporting for reservations, sales, payments, registrations, rentals, and penalties.</p>
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
          <label className="text-xs text-muted">
            Transaction type
            <select
              value={transactionType}
              onChange={(e) => setTransactionType(e.target.value as TransactionType)}
              className="ml-2 rounded-xl border border-white/10 bg-background px-3 py-2 text-sm text-text"
            >
              {TRANSACTION_TYPES.map((type) => <option key={type.key} value={type.key}>{type.label}</option>)}
            </select>
          </label>
        </div>
      </Card>

      <div className="print-area space-y-4">
        <div className="text-sm text-muted">
          <span className="font-semibold text-text">{PERIOD_LABELS[period]} report</span> · {rangeLabel} · {transactionLabel}
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
          <div className="text-xs uppercase tracking-widest text-muted">Financial statement</div>
          <table className="mt-3 w-full text-sm">
            <tbody className="divide-y divide-white/5">
              {report.statement.map((row) => (
                <tr key={row.label}>
                  <td className="py-2 pr-4">{row.label}</td>
                  <td className="py-2 text-right font-semibold">{loading ? '…' : formatCurrency(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 text-xs text-muted">Booking values cover reservations dated in this period; collections count verified payments received in it.</div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <div className="text-xs uppercase tracking-widest text-muted">Most rented equipment</div>
            <table className="mt-3 w-full text-sm">
              <tbody className="divide-y divide-white/5">
                {report.topRentals.length === 0 ? (
                  <tr><td className="py-3 text-muted">{loading ? 'Loading…' : 'No rentals issued in this period.'}</td></tr>
                ) : report.topRentals.map(([name, count]) => (
                  <tr key={name}>
                    <td className="py-2 pr-4">{name}</td>
                    <td className="py-2 text-right font-semibold">{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card className="p-4">
            <div className="text-xs uppercase tracking-widest text-muted">Penalties and extra charges</div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-white/5">
                  {report.penalties.length === 0 ? (
                    <tr><td className="py-3 text-muted">{loading ? 'Loading…' : 'No penalties or extra charges in this period.'}</td></tr>
                  ) : report.penalties.map((row, index) => (
                    <tr key={`${row.reservationId}-${index}`}>
                      <td className="py-2 pr-4 whitespace-nowrap">{row.day}</td>
                      <td className="py-2 pr-4">{row.label}<div className="text-xs text-muted">{row.reservationId}</div></td>
                      <td className="py-2 text-right font-semibold">{formatCurrency(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
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
          <div className="text-xs uppercase tracking-widest text-muted">Payments in this period · {transactionLabel}</div>
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
