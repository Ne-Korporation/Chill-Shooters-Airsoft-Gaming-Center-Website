import React from 'react'
import { Card } from '../../components/ui/Card'
import { FiCalendar, FiShield, FiPackage, FiCreditCard, FiCheckCircle, FiZap } from 'react-icons/fi'

export function RegistrarDashboardHomePage() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-xs text-muted border border-white/5">
          <span className="h-2.5 w-2.5 rounded-full bg-accent" />
          <span className="uppercase tracking-[0.18em]">Registrar Console</span>
        </div>
        <h1 className="text-3xl font-bold">Registrar Dashboard</h1>
        <p className="text-muted text-sm">Process reservation approvals, verify waivers & payments, and track ongoing games.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-widest text-muted">Pending approvals</div>
              <div className="mt-2 text-2xl font-bold text-accent">2</div>
            </div>
            <FiShield className="text-gold" />
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-widest text-muted">Waivers to review</div>
              <div className="mt-2 text-2xl font-bold text-success">1</div>
            </div>
            <FiCheckCircle className="text-success" />
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-widest text-muted">Payments awaiting verify</div>
              <div className="mt-2 text-2xl font-bold text-danger">2</div>
            </div>
            <FiCreditCard className="text-danger" />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-accent/10 ring-1 ring-accent/25">
              <FiCalendar className="text-gold" />
            </div>
            <div>
              <div className="text-sm font-bold">Reservation Approvals</div>
              <div className="mt-1 text-xs text-muted">Approve or reject reservation requests in the registrar queue.</div>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-accent/10 ring-1 ring-accent/25">
              <FiZap className="text-gold" />
            </div>
            <div>
              <div className="text-sm font-bold">Operational Flow</div>
              <div className="mt-1 text-xs text-muted">Waiver → Payment → Confirmed reservation status.</div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-accent/10 ring-1 ring-accent/25">
              <FiPackage className="text-gold" />
            </div>
            <div>
              <div className="text-sm font-bold">Availed Packages</div>
              <div className="mt-1 text-xs text-muted">Track gear readiness status (prototype).</div>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-accent/10 ring-1 ring-accent/25">
              <FiShield className="text-gold" />
            </div>
            <div>
              <div className="text-sm font-bold">Submitted Waivers</div>
              <div className="mt-1 text-xs text-muted">Accept or flag waiver submissions (prototype).</div>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-accent/10 ring-1 ring-accent/25">
              <FiCreditCard className="text-gold" />
            </div>
            <div>
              <div className="text-sm font-bold">Submitted Payments</div>
              <div className="mt-1 text-xs text-muted">Verify payment proofs and update status (prototype).</div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

