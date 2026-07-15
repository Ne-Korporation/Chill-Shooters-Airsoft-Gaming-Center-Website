import React from 'react'
import { Card } from '../../components/ui/Card'

export function AdminReportsPage() {
  const metrics = [
    { label: 'Reservations', value: '128', tone: 'accent' },
    { label: 'Revenue', value: '₱84,200', tone: 'success' },
    { label: 'No-shows', value: '6', tone: 'danger' },
  ]

  const recentReports = [
    { title: 'Weekend occupancy', detail: '82% utilization across Saturday and Sunday slots.' },
    { title: 'High-value bookings', detail: 'Three elite package reservations generated the strongest revenue lift.' },
    { title: 'Equipment usage', detail: 'Masks and vests had the highest turnover this week.' },
  ]

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">Reports</h1>
        <p className="mt-1 text-sm text-muted">Review operational reports, usage spikes, and business performance indicators.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {metrics.map((metric) => (
          <Card key={metric.label} className="p-4">
            <div className="text-xs uppercase tracking-widest text-muted">{metric.label}</div>
            <div className={`mt-2 text-2xl font-bold ${metric.tone === 'accent' ? 'text-accent' : metric.tone === 'success' ? 'text-success' : 'text-danger'}`}>
              {metric.value}
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
                <div className="mt-1 text-xs text-muted">Bookings are up 12% compared to the previous week.</div>
              </div>
              <div className="rounded-full bg-success/20 px-3 py-1 text-sm font-semibold text-success">+12%</div>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Recent report highlights</div>
          <div className="mt-4 space-y-2">
            {recentReports.map((report) => (
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

