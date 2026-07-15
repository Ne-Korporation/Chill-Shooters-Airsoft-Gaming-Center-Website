import React from 'react'
import { Card } from '../../components/ui/Card'

export function DashboardHomePage() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-xs text-muted border border-white/5">
          <span className="h-2.5 w-2.5 rounded-full bg-accent" />
          <span className="uppercase tracking-[0.18em]">Operations</span>
        </div>
        <h1 className="text-3xl font-bold">Dashboard Home</h1>
        <p className="text-muted text-sm">Military-grade inventory &amp; player workflow overview.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Active Reservations</div>
          <div className="mt-2 text-2xl font-bold text-accent">12</div>
        </Card>

        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Remaining Slots</div>
          <div className="mt-2 text-2xl font-bold text-success">38</div>
        </Card>

        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Pending Payments</div>
          <div className="mt-2 text-2xl font-bold text-danger">3</div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="text-xs uppercase tracking-widest text-muted">System Status</div>
        <div className="mt-2 text-lg font-bold">Operational • All systems nominal</div>
      </Card>
    </div>
  )
}
