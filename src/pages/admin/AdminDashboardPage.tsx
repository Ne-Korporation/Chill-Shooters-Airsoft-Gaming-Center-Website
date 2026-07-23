import React from 'react'
import { Card } from '../../components/ui/Card'

const StatCard = ({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'accent' | 'success' | 'danger' | 'muted'
}) => {
  const toneClass =
    tone === 'accent'
      ? 'text-accent'
      : tone === 'success'
        ? 'text-success'
        : tone === 'danger'
          ? 'text-danger'
          : 'text-muted'

  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-widest text-muted">{label}</div>
      <div className={`mt-2 text-2xl font-bold ${toneClass}`}>{value}</div>
    </Card>
  )
}

const QuickAction = ({
  title,
  subtitle,
}: {
  title: string
  subtitle: string
}) => {
  return (
    <Card className="p-4 hover:bg-white/5 transition">
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-1 text-xs text-muted">{subtitle}</div>
      <div className="mt-3 h-9 rounded-xl bg-white/5 border border-white/5 flex items-center justify-between px-3">
        <div className="text-[11px] text-muted">UI only</div>
        <div className="h-2.5 w-2.5 rounded-full bg-accent" />
      </div>
    </Card>
  )
}

export function AdminDashboardPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">Admin Dashboard</h1>
        <p className="text-muted text-sm">Command center overview (UI prototype).</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Reservations" value="128" tone="accent" />
        <StatCard label="Players" value="74" tone="success" />
        <StatCard label="Payments" value="5" tone="danger" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-widest text-muted">
                  Operational Snapshot
                </div>
                <div className="mt-2 text-lg font-semibold">Today at a glance</div>
              </div>
              <div className="rounded-xl bg-white/5 border border-white/5 px-3 py-2">
                <div className="text-[11px] text-muted">System</div>
                <div className="mt-1 text-sm font-bold text-accent">Nominal</div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Card className="p-3 bg-white/5">
                <div className="text-[11px] uppercase tracking-widest text-muted">
                  Pending approvals
                </div>
                <div className="mt-2 text-xl font-bold text-accent">12</div>
              </Card>
              <Card className="p-3 bg-white/5">
                <div className="text-[11px] uppercase tracking-widest text-muted">
                  Equipment alerts
                </div>
                <div className="mt-2 text-xl font-bold text-danger">2</div>
              </Card>
              <Card className="p-3 bg-white/5">
                <div className="text-[11px] uppercase tracking-widest text-muted">
                  Notification queue
                </div>
                <div className="mt-2 text-xl font-bold text-success">7</div>
              </Card>
            </div>
          </Card>

          <Card className="p-4">
            <div className="text-xs uppercase tracking-widest text-muted">
              Recent Activity
            </div>
            <div className="mt-2 text-sm text-muted">
              UI-only list of latest admin actions.
            </div>
            <div className="mt-4 space-y-2">
              {[
                {
                  who: 'Admin',
                  action: 'Approved reservation',
                  meta: 'R-10241 • 2m ago',
                  tone: 'text-accent',
                },
                {
                  who: 'Admin',
                  action: 'Updated equipment availability',
                  meta: 'VEST-03 • 19m ago',
                  tone: 'text-success',
                },
                {
                  who: 'Admin',
                  action: 'Flagged payment for review',
                  meta: 'PMT-00921 • 1h ago',
                  tone: 'text-danger',
                },
              ].map((row, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/5/60 px-3 py-2"
                >
                  <div>
                    <div className="text-sm font-semibold">{row.action}</div>
                    <div className="text-xs text-muted">{row.who}</div>
                  </div>
                  <div className={`text-xs font-semibold ${row.tone}`}>{row.meta}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <div className="text-xs uppercase tracking-widest text-muted">
              Quick Actions
            </div>
            <div className="mt-2 text-sm text-muted">Jump to admin modules.</div>
          </Card>

          <div className="space-y-3">
            <QuickAction
              title="Reservation Management"
              subtitle="Approve/reject, reschedule, and keep schedules consistent."
            />
            <QuickAction
              title="Users"
              subtitle="Review players and manage marshal, admin, and registrar access."
            />
            <QuickAction
              title="Audit Logs"
              subtitle="Traceability view for every admin operation."
            />
          </div>
        </div>
      </div>
    </div>
  )
}


