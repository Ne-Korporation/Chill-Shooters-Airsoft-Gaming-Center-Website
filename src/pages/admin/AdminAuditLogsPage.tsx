import React from 'react'
import { Card } from '../../components/ui/Card'

type AuditAction = 'RESERVATION' | 'PLAYER' | 'EQUIPMENT' | 'WEAPON' | 'PAYMENT' | 'NOTIFICATION'

type AuditSeverity = 'info' | 'warning' | 'critical'

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

export function AdminAuditLogsPage() {
  const [action, setAction] = React.useState<AuditAction | 'all'>('all')
  const [severity, setSeverity] = React.useState<AuditSeverity | 'all'>('all')

  const logs = [
    {
      id: 'AL-5001',
      action: 'RESERVATION' as const,
      severity: 'info' as const,
      actor: 'Admin',
      summary: 'Approved reservation R-10241 for the weekend package.',
      meta: '2026-07-18 09:12',
    },
    {
      id: 'AL-5002',
      action: 'EQUIPMENT' as const,
      severity: 'warning' as const,
      actor: 'Admin',
      summary: 'Flagged equipment EQ-V-007 for maintenance before the next session.',
      meta: '2026-07-18 10:04',
    },
    {
      id: 'AL-5003',
      action: 'PAYMENT' as const,
      severity: 'critical' as const,
      actor: 'Admin',
      summary: 'Marked payment PMT-00921 as requires review after an authorization mismatch.',
      meta: '2026-07-18 10:45',
    },
    {
      id: 'AL-5004',
      action: 'NOTIFICATION' as const,
      severity: 'info' as const,
      actor: 'Admin',
      summary: 'Sent notification N-1001 to all admins about the equipment issue.',
      meta: '2026-07-17 18:30',
    },
  ]

  const visible = logs.filter((log) => {
    const matchAction = action === 'all' ? true : log.action === action
    const matchSeverity = severity === 'all' ? true : log.severity === severity
    return matchAction && matchSeverity
  })

  const actionOptions: (AuditAction | 'all')[] = ['all', 'RESERVATION', 'PLAYER', 'EQUIPMENT', 'WEAPON', 'PAYMENT', 'NOTIFICATION']
  const severityOptions: (AuditSeverity | 'all')[] = ['all', 'info', 'warning', 'critical']

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Audit Logs</h1>
          <p className="mt-1 text-sm text-muted">Track key admin actions by module, severity, and timestamp for accountability.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {actionOptions.map((option) => (
            <button
              key={option}
              onClick={() => setAction(option)}
              className={
                'rounded-xl border px-3 py-2 text-sm transition ' +
                (action === option
                  ? 'bg-white/8 text-text border-accent/30'
                  : 'bg-white/5 text-muted hover:bg-white/6')
              }
            >
              {option === 'all' ? 'ALL' : option}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Audit records</div>
          <div className="mt-2 text-2xl font-bold text-accent">{logs.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Critical events</div>
          <div className="mt-2 text-2xl font-bold text-danger">1</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Recent activity</div>
          <div className="mt-2 text-2xl font-bold text-success">Today</div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted">Traceability</div>
            <div className="mt-2 text-sm text-muted">A detailed audit trail of admin actions and follow-up responses.</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {severityOptions.map((option) => (
              <button
                key={option}
                onClick={() => setSeverity(option)}
                className={
                  'rounded-xl border px-3 py-2 text-sm transition ' +
                  (severity === option
                    ? 'bg-white/8 text-text border-accent/30'
                    : 'bg-white/5 text-muted hover:bg-white/6')
                }
              >
                {option === 'all' ? 'ALL' : option.toUpperCase()}
              </button>
            ))}
          </div>
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
            {visible.length === 0 ? (
              <div className="p-6 text-sm text-muted">No audit logs found for selected filters.</div>
            ) : (
              visible.map((log) => (
                <div key={log.id} className="grid grid-cols-12 items-center px-3 py-3">
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
                    <div className="mt-2 flex justify-end">
                      <button className="rounded-xl border border-white/5 bg-white/5 px-3 py-2 text-xs text-muted transition hover:bg-white/6">
                        Details
                      </button>
                    </div>
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

