import React, { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Card } from '../../components/ui/Card'
import { FiCalendar, FiShield, FiPackage, FiCreditCard, FiCheckCircle, FiZap } from 'react-icons/fi'
import { apiGet } from '../../utils/apiClient'

export function RegistrarDashboardHomePage() {
  const [pendingReservations, setPendingReservations] = useState(0)
  const [pendingWaivers, setPendingWaivers] = useState(0)
  const [pendingPayments, setPendingPayments] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const [reservationsRes, waiversRes, paymentsRes] = await Promise.all([
          apiGet<{ ok: boolean; data: any[] }>('/api/reservations?limit=200'),
          apiGet<{ ok: boolean; data: any[] }>('/api/waivers?limit=200'),
          apiGet<{ ok: boolean; data: any[] }>('/api/payments?limit=200'),
        ])

        const reservations = Array.isArray(reservationsRes?.data) ? reservationsRes.data : []
        const waivers = Array.isArray(waiversRes?.data) ? waiversRes.data : []
        const payments = Array.isArray(paymentsRes?.data) ? paymentsRes.data : []

        setPendingReservations(reservations.filter((item) => String(item.reservationStatus || '').toLowerCase() === 'pending').length)
        setPendingWaivers(waivers.filter((item) => !item.status || String(item.status).toLowerCase() === 'pending').length)
        setPendingPayments(payments.filter((item) => {
          const status = String(item.paymentStatus || item.status || '').toLowerCase()
          return status === 'pending' || status === 'submitted' || status === 'review'
        }).length)
      } catch (e: any) {
        toast.error(String(e?.message || e))
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [])

  const summary = useMemo(() => [
    { label: 'Pending approvals', value: pendingReservations, tone: 'accent' },
    { label: 'Waivers to review', value: pendingWaivers, tone: 'success' },
    { label: 'Payments awaiting verify', value: pendingPayments, tone: 'danger' },
  ], [pendingPayments, pendingReservations, pendingWaivers])

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
        {summary.map((item) => (
          <Card key={item.label} className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-widest text-muted">{item.label}</div>
                <div className={`mt-2 text-2xl font-bold ${item.tone === 'accent' ? 'text-accent' : item.tone === 'success' ? 'text-success' : 'text-danger'}`}>
                  {loading ? '…' : item.value}
                </div>
              </div>
              {item.tone === 'accent' ? <FiShield className="text-gold" /> : item.tone === 'success' ? <FiCheckCircle className="text-success" /> : <FiCreditCard className="text-danger" />}
            </div>
          </Card>
        ))}
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

