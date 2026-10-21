import React, { useMemo, useState } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { FiCheck, FiChevronRight, FiCreditCard, FiShield, FiUpload, FiX } from 'react-icons/fi'

type PaymentStatus = 'submitted' | 'verified' | 'rejected'

type PaymentRow = {
  id: string
  reservationId: string
  method: 'GCash' | 'Bank Transfer'
  refNo: string
  submittedAtISO: string
  totalPHP: number
  proofLabel: string
  status: PaymentStatus
}

function money(n: number) {
  return `₱${n.toLocaleString()}`
}

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export function RegistrarSubmittedPaymentsPage() {
  const [query, setQuery] = useState('')

  const [rows, setRows] = useState<PaymentRow[]>(() => [
    {
      id: 'pay-16001',
      reservationId: 'res-12001',
      method: 'GCash',
      refNo: 'ABP-7F21-93',
      submittedAtISO: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
      totalPHP: 9850,
      proofLabel: 'gcash_receipt_12001.jpg',
      status: 'submitted',
    },
    {
      id: 'pay-16002',
      reservationId: 'res-12002',
      method: 'Bank Transfer',
      refNo: 'ABP-88K1-40',
      submittedAtISO: new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString(),
      totalPHP: 12400,
      proofLabel: 'bank_transfer_12002.png',
      status: 'submitted',
    },
    {
      id: 'pay-16003',
      reservationId: 'res-12003',
      method: 'GCash',
      refNo: 'ABP-0012-90',
      submittedAtISO: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      totalPHP: 11200,
      proofLabel: 'gcash_receipt_12003.jpg',
      status: 'verified',
    },
  ])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => {
      return (
        r.id.toLowerCase().includes(q) ||
        r.reservationId.toLowerCase().includes(q) ||
        r.refNo.toLowerCase().includes(q) ||
        r.method.toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q)
      )
    })
  }, [query, rows])

  const submittedCount = useMemo(() => rows.filter((r) => r.status === 'submitted').length, [rows])

  const verify = (id: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'verified' } : r)))
  }

  const reject = (id: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'rejected' } : r)))
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="text-sm font-medium text-accent">Registrar</div>
        <h1 className="text-3xl font-bold">Submitted Online Payments</h1>
        <p className="text-muted text-sm">Verify uploaded payment proofs (prototype state-only).</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Submitted</div>
          <div className="mt-2 text-2xl font-bold text-accent">{submittedCount}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Verified</div>
          <div className="mt-2 text-2xl font-bold text-success">{rows.filter((r) => r.status === 'verified').length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Rejected</div>
          <div className="mt-2 text-2xl font-bold text-danger">{rows.filter((r) => r.status === 'rejected').length}</div>
        </Card>
      </div>

      <Card className="p-4 md:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2 text-sm font-bold">
            <FiShield /> <span>Payment queue</span>
          </div>

          <div className="md:w-[420px]">
            <Input label="Search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="id / reservation / refno / status" />
          </div>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-widest text-muted">
                <th className="py-2 pr-3">Payment</th>
                <th className="py-2 pr-3">Reservation</th>
                <th className="py-2 pr-3">Method / Ref</th>
                <th className="py-2 pr-3">Proof</th>
                <th className="py-2 pr-3">Amount</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="py-3 pr-3">
                    <div className="font-bold">{r.id}</div>
                    <div className="mt-1 text-xs text-muted">{fmt(r.submittedAtISO)}</div>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="font-bold">{r.reservationId}</div>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="font-bold">{r.method}</div>
                    <div className="mt-1 text-xs text-muted">Ref: {r.refNo}</div>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="flex items-center gap-2">
                      <FiUpload className="text-accent" />
                      <div>
                        <div className="font-bold">{r.proofLabel}</div>
                        <div className="mt-1 text-xs text-muted">UI-only proof reference</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="font-bold text-gold">{money(r.totalPHP)}</div>
                  </td>
                  <td className="py-3 pr-3">
                    <span
                      className={[
                        'inline-flex items-center rounded-xl border px-3 py-1 text-[11px] font-bold',
                        r.status === 'verified'
                          ? 'bg-success/15 text-success border-success/30'
                          : r.status === 'rejected'
                            ? 'bg-danger/15 text-danger border-danger/30'
                            : 'bg-accent/15 text-gold border-accent/30',
                      ].join(' ')}
                    >
                      {r.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-3 pr-3">
                    {r.status === 'submitted' ? (
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <Button variant="primary" className="w-full sm:w-auto" onClick={() => verify(r.id)}>
                          <FiCheck /> Verify
                        </Button>
                        <Button variant="ghost" className="w-full sm:w-auto" onClick={() => reject(r.id)}>
                          <FiX /> Reject
                        </Button>
                      </div>
                    ) : (
                      <div className="text-xs text-muted">No action</div>
                    )}
                  </td>
                </tr>
              ))}

              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-xs text-muted">
                    No payments match your search.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="mt-5 rounded-2xl border border-white/10 bg-black/15 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 grid h-10 w-10 place-items-center rounded-2xl bg-accent/10 ring-1 ring-accent/25">
              <FiCreditCard className="text-gold" />
            </div>
            <div>
              <div className="text-sm font-bold">Registrar verification</div>
              <div className="mt-1 text-xs text-muted">In production, this would match amounts and record receipt status.</div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}

