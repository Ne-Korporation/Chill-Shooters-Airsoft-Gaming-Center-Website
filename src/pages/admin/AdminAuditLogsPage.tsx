import React, { useEffect, useMemo, useState } from 'react'
import { Card } from '../../components/ui/Card'
import { FilterTabs, titleCaseLabel } from '../../components/ui/FilterTabs'
import { apiGet } from '../../utils/apiClient'

type AuditAction = 'RESERVATION' | 'PLAYER' | 'EQUIPMENT' | 'WEAPON' | 'PAYMENT' | 'NOTIFICATION'

type AuditSeverity = 'info' | 'warning' | 'critical'

type AuditLog = {
  id: string
  action: AuditAction
  severity: AuditSeverity
  actor: string
  summary: string
  meta: string
}

type ReservationDoc = {
  id?: string
  reservationStatus?: string
  userName?: string
  player?: string
  updatedAtISO?: string
  createdAtISO?: string
}

type PaymentDoc = {
  id?: string
  paymentStatus?: string
  status?: string
  transactionReference?: string
  refNo?: string
  updatedAtISO?: string
  createdAtISO?: string
}

type EquipmentDoc = {
  id?: string
  name?: string
  status?: string
  qty?: number
  updatedAtISO?: string
  createdAtISO?: string
}

type UserDoc = {
  id?: string
  name?: string
  email?: string
  role?: string
  createdAtISO?: string
}

const severityTone: Record<AuditSeverity, 'accent' | 'success' | 'danger' | 'muted'> = {
  info: 'accent',
  warning: 'danger',
  critical: 'danger',
}

const SeverityPill = ({ severity }: { severity: AuditSeverity }) => {
  const tone = severityTone[severity]
  const cls =
    tone === 'success'
      ? 'bg-success/20 text-success border-success/30'
      : tone === 'danger'
        ? 'bg-danger/20 text-danger border-danger/30'
        : 'bg-accent/20 text-accent border-accent/30'

  return <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${cls}`}>{severity.toUpperCase()}</span>
}

function formatRelativeTime(value?: string) {
  if (!value) return 'recently updated'
  const diff = Date.now() - new Date(value).getTime()
  const minutes = Math.max(1, Math.floor(diff / 60000))
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function AdminAuditLogsPage() {
  const [action, setAction] = useState<AuditAction | 'all'>('all')
  const [severity, setSeverity] = useState<AuditSeverity | 'all'>('all')
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    const load = async () => {
      setLoading(true)
      setError(null)

      try {
        const [reservationsRes, paymentsRes, equipmentRes, usersRes] = await Promise.all([
          apiGet<{ ok: boolean; data: ReservationDoc[] }>('/api/reservations?limit=200'),
          apiGet<{ ok: boolean; data: PaymentDoc[] }>('/api/payments?limit=200'),
          apiGet<{ ok: boolean; data: EquipmentDoc[] }>('/api/equipments?limit=200'),
          apiGet<{ ok: boolean; data: UserDoc[] }>('/api/user_accounts?limit=200'),
        ])

        const reservations = Array.isArray(reservationsRes?.data) ? reservationsRes.data : []
        const payments = Array.isArray(paymentsRes?.data) ? paymentsRes.data : []
        const equipment = Array.isArray(equipmentRes?.data) ? equipmentRes.data : []
        const users = Array.isArray(usersRes?.data) ? usersRes.data : []

        const nextLogs: AuditLog[] = []

        reservations.slice().sort((a, b) => (b.updatedAtISO || b.createdAtISO || '').localeCompare(a.updatedAtISO || a.createdAtISO || '')).slice(0, 3).forEach((reservation) => {
          const status = String(reservation.reservationStatus || 'pending').trim().toLowerCase()
          nextLogs.push({
            id: reservation.id || 'R-UNKNOWN',
            action: 'RESERVATION',
            severity: status === 'confirmed' || status === 'approved' ? 'info' : 'warning',
            actor: reservation.userName || reservation.player || 'Admin',
            summary: `Reservation ${reservation.id || 'record'} is currently ${status}.`,
            meta: formatRelativeTime(reservation.updatedAtISO || reservation.createdAtISO),
          })
        })

        payments.slice().sort((a, b) => (b.updatedAtISO || b.createdAtISO || '').localeCompare(a.updatedAtISO || a.createdAtISO || '')).slice(0, 3).forEach((payment) => {
          const status = String(payment.paymentStatus || payment.status || 'pending').trim().toLowerCase()
          nextLogs.push({
            id: payment.id || 'PAYMENT-UNKNOWN',
            action: 'PAYMENT',
            severity: status === 'paid' || status === 'confirmed' ? 'info' : 'critical',
            actor: 'Finance',
            summary: `Payment ${payment.id || payment.transactionReference || payment.refNo || 'entry'} is ${status}.`,
            meta: formatRelativeTime(payment.updatedAtISO || payment.createdAtISO),
          })
        })

        equipment.filter((item) => String(item.status || '').toLowerCase() === 'maintenance' || Number(item.qty ?? 0) <= 1).slice(0, 2).forEach((item) => {
          nextLogs.push({
            id: item.id || 'EQ-UNKNOWN',
            action: 'EQUIPMENT',
            severity: 'warning',
            actor: 'Inventory',
            summary: `${item.name || 'Equipment'} needs attention with ${item.qty ?? 0} unit(s) left.`,
            meta: formatRelativeTime(item.updatedAtISO || item.createdAtISO),
          })
        })

        users.slice(0, 2).forEach((user) => {
          nextLogs.push({
            id: user.id || 'USER-UNKNOWN',
            action: 'PLAYER',
            severity: 'info',
            actor: user.name || user.email || 'System',
            summary: `${user.name || user.email || 'User'} appears in the active player roster.`,
            meta: formatRelativeTime(user.createdAtISO),
          })
        })

        if (mounted) setLogs(nextLogs)
      } catch (err: any) {
        if (mounted) setError(err?.message || 'Unable to load audit logs')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    load()
    return () => {
      mounted = false
    }
  }, [])

  const visible = useMemo(() => logs.filter((log) => {
    const matchAction = action === 'all' ? true : log.action === action
    const matchSeverity = severity === 'all' ? true : log.severity === severity
    return matchAction && matchSeverity
  }), [logs, action, severity])

  const actionOptions: (AuditAction | 'all')[] = ['all', 'RESERVATION', 'PLAYER', 'EQUIPMENT', 'WEAPON', 'PAYMENT', 'NOTIFICATION']
  const severityOptions: (AuditSeverity | 'all')[] = ['all', 'info', 'warning', 'critical']
  const criticalEvents = logs.filter((log) => log.severity === 'critical').length

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Audit Logs</h1>
          <p className="mt-1 text-sm text-muted">Track key admin actions by module, severity, and timestamp for accountability.</p>
        </div>

        <FilterTabs
          ariaLabel="Filter by module"
          value={action}
          onChange={setAction}
          options={actionOptions.map((option) => ({ value: option, label: option === 'all' ? 'All' : option }))}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Audit records</div>
          <div className="mt-2 text-2xl font-bold text-accent">{loading ? '…' : logs.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Critical events</div>
          <div className="mt-2 text-2xl font-bold text-danger">{loading ? '…' : criticalEvents}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Recent activity</div>
          <div className="mt-2 text-2xl font-bold text-success">{loading ? '…' : 'Today'}</div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted">Traceability</div>
            <div className="mt-2 text-sm text-muted">A detailed audit trail of admin actions and follow-up responses.</div>
          </div>
          <FilterTabs
            size="sm"
            ariaLabel="Filter by severity"
            value={severity}
            onChange={setSeverity}
            options={severityOptions.map((option) => ({ value: option, label: option === 'all' ? 'All severities' : titleCaseLabel(option) }))}
          />
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-white/5">
          <div className="grid grid-cols-12 bg-white/5 px-3 py-2 text-xs uppercase tracking-widest text-muted">
            <div className="col-span-2">ID</div>
            <div className="col-span-2 text-left">Action</div>
            <div className="col-span-3">Summary</div>
            <div className="col-span-2 text-right">Severity</div>
            <div className="col-span-3 text-right">Meta</div>
          </div>

          <div className="divide-y divide-white/5">
            {loading ? (
              <div className="p-6 text-sm text-muted">Loading audit activity…</div>
            ) : error ? (
              <div className="p-6 text-sm text-danger">{error}</div>
            ) : visible.length === 0 ? (
              <div className="p-6 text-sm text-muted">No audit logs found for selected filters.</div>
            ) : (
              visible.map((log) => (
                <div key={`${log.id}-${log.action}`} className="grid grid-cols-12 items-center px-3 py-3">
                  <div className="col-span-2 text-sm font-semibold">{log.id}</div>
                  <div className="col-span-2 text-left text-sm text-muted">{log.action}</div>
                  <div className="col-span-3">
                    <div className="text-sm font-semibold">{log.summary}</div>
                    <div className="mt-1 text-xs text-muted">Actor: {log.actor}</div>
                  </div>
                  <div className="col-span-2 text-right">
                    <SeverityPill severity={log.severity} />
                  </div>
                  <div className="col-span-3 text-right">
                    <div className="text-sm text-muted">{log.meta}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </Card>
    </div>
  )
}

