import React, { useEffect, useMemo, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import toast from 'react-hot-toast'
import { apiDelete, apiGet, apiPut } from '../../utils/apiClient'
import { useAuth } from '../../context/AuthContext'
import { sendRoleNotifications, useNotifications } from '../../context/NotificationContext'


type PaymentStatus = 'paid' | 'pending' | 'failed' | 'review' | 'confirmed'

type PaymentItem = {
  id: string
  player: string
  amount: number
  method: string
  status: PaymentStatus
  date: string
  note: string
}

const statusBadge = (status: PaymentStatus) => {
  switch (status) {
    case 'paid':
      return 'bg-success/20 text-success border-success/30'
    case 'confirmed':
      return 'bg-success/20 text-success border-success/30'
    case 'pending':
      return 'bg-accent/20 text-accent border-accent/30'
    case 'failed':
      return 'bg-danger/20 text-danger border-danger/30'
    case 'review':
      return 'bg-white/5 text-text border-white/5'
  }
}

const StatusPill = ({ status }: { status: PaymentStatus }) => {
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${statusBadge(status)}`}>
      {status.toUpperCase()}
    </span>
  )
}

export function AdminPaymentsPage() {
  const { user } = useAuth()
  const [active, setActive] = React.useState<PaymentStatus | 'all'>('all')
  const [payments, setPayments] = React.useState<PaymentItem[]>([])
  const [loading, setLoading] = useState(true)
  const { addNotification } = useNotifications()

  const load = async () => {
    setLoading(true)
    try {
      const res = await apiGet<{ ok: boolean; data: any[] }>('/api/payments?limit=200')
      const docs = Array.isArray(res?.data) ? res.data : []
      setPayments(
        docs.map((d: any) => ({
          id: d.id ?? (d._id ? String(d._id) : ''),
          player: d.userId ? String(d.userId) : d.player ?? '—',
          amount: Number(d.amount ?? d.totalPHP ?? 0),
          method: d.paymentMethod ?? d.method ?? '—',
          status: d.paymentStatus ?? d.status ?? 'pending',
          date: d.createdAtISO ?? d.createdAt ?? d.submittedAtISO ?? '—',
          note: d.transactionReference ?? d.refNo ?? d.note ?? '',
        }))
      )
    } catch (e: any) {
      toast.error(String(e?.message || e))
      setPayments([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])





  const filtered = payments.filter((payment) => (active === 'all' ? true : payment.status === active))
  const reviewCount = payments.filter((payment) => payment.status === 'review').length
  const pendingValue = payments.filter((payment) => payment.status === 'pending').reduce((sum, p) => sum + p.amount, 0)

  const updateStatus = async (id: string, nextStatus: PaymentStatus) => {
    try {
      await apiPut(`/api/payments/${id}/verify`, { paymentStatus: nextStatus })
      sendRoleNotifications(addNotification, {
        roles: ['admin', 'registrar', 'marshal'],
        type: 'payment_verified',
        title: 'Payment Status Updated',
        message: `Payment ${id} was marked ${nextStatus}.`,
        linkedResourceId: id,
      })
      await load()
      toast.success('Payment updated')
    } catch (e: any) {
      toast.error(String(e?.message || e))
    }
  }


  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Payments</h1>
          <p className="mt-1 text-sm text-muted">Review submitted receipts, resolve pending transactions, and confirm booking payments.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {(['all', 'review', 'paid', 'pending', 'failed', 'confirmed'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setActive(status)}
              className={
                'rounded-xl border px-3 py-2 text-sm transition ' +
                (active === status
                  ? 'bg-white/8 text-text border-accent/30'
                  : 'bg-white/5 text-muted hover:bg-white/6')
              }
            >
              {status === 'all' ? 'ALL' : status.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Needs review</div>
          <div className="mt-2 text-2xl font-bold text-accent">{reviewCount}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Pending amount</div>
          <div className="mt-2 text-2xl font-bold text-danger">₱{pendingValue}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Completed today</div>
          <div className="mt-2 text-2xl font-bold text-success">2</div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted">Verification & receipts</div>
            <div className="mt-2 text-sm text-muted">Approve payments, request corrections, or flag suspicious transactions.</div>
          </div>
          <div className="rounded-xl border border-white/5 bg-white/5 px-3 py-2">
            <div className="text-[11px] text-muted">Settlement window</div>
            <div className="mt-1 text-sm font-semibold">Today • 4:00 PM cutoff</div>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-white/5">
          <div className="hidden lg:grid lg:grid-cols-12 bg-white/5 px-3 py-2 text-xs uppercase tracking-widest text-muted">
            <div className="col-span-3">Payment ID</div>
            <div className="col-span-3">Player</div>
            <div className="col-span-2 text-right">Amount</div>
            <div className="col-span-2 text-right">Method</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>

          <div className="divide-y divide-white/5">
            {filtered.length === 0 ? (
              <div className="p-6 text-sm text-muted">No payments match the selected filter.</div>
            ) : (
              filtered.map((payment) => (
                <div key={payment.id} className="flex flex-col gap-3 px-3 py-3 lg:grid lg:grid-cols-12 lg:items-center">
                  <div className="lg:col-span-3">
                    <div className="text-sm font-semibold">{payment.id}</div>
                    <div className="mt-1 text-xs text-muted">{payment.date}</div>
                  </div>
                  <div className="lg:col-span-3">
                    <div className="text-sm font-semibold">{payment.player}</div>
                    <div className="mt-1 text-xs text-muted">{payment.note}</div>
                  </div>
                  <div className="text-sm font-semibold lg:col-span-2 lg:text-right">₱{payment.amount}</div>
                  <div className="lg:col-span-2 lg:text-right">
                    <StatusPill status={payment.status} />
                    <div className="mt-1 text-xs text-muted">{payment.method}</div>
                  </div>
                  <div className="lg:col-span-2 lg:text-right">
                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                      <button className="rounded-xl border border-white/5 bg-white/5 px-3 py-2 text-xs text-muted transition hover:bg-white/6">
                        Receipt
                      </button>
                      {payment.status === 'review' ? (
                        <button
                          onClick={() => updateStatus(payment.id, 'paid')}
                          className="rounded-xl border border-success/30 bg-success/20 px-3 py-2 text-xs font-semibold text-success transition hover:bg-success/25"
                        >
                          Approve
                        </button>
                      ) : (
                        <button
                          onClick={() => updateStatus(payment.id, 'review')}
                          className="rounded-xl border border-accent/30 bg-accent/20 px-3 py-2 text-xs font-semibold text-accent transition hover:bg-accent/25"
                        >
                          Send back
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-muted">Latest settlement queue includes online transfers, card confirmations, and manual follow-ups.</div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm">Previous</Button>
            <Button variant="ghost" size="sm">Next</Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

