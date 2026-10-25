import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { FiCheck, FiExternalLink } from 'react-icons/fi'

import { Panel } from './DashboardParts'
import { Button } from '../ui/Button'
import { apiGet, apiPut } from '../../utils/apiClient'

type CompiledReservation = {
  reservation: {
    id: string
    reservationDate: string
    reservationTime: string
    locationName: string
    numberOfPlayers: number
    packageName: string
    totalAmount: number
    depositAmount: number
    paymentMode: string
    captainName: string
    forwardedToAdminAtISO: string
  }
  payments: Array<{
    id: string
    payerName: string
    amount: number
    paymentMethod: string
    paymentStatus: string
    transactionReference?: string
    proofUrl: string
  }>
  waivers: Array<{ userId: string; name: string; waiverId: string | null; status: string }>
}

function formatPHP(value: number) {
  return `₱${Number(value || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`
}

// Reservations whose full payment is in, compiled with every proof and waiver for final approval.
export function PaymentCompletePanel() {
  const [items, setItems] = useState<CompiledReservation[]>([])
  const [loading, setLoading] = useState(true)
  const [approvingId, setApprovingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await apiGet<{ ok: boolean; data: CompiledReservation[] }>('/api/admin/payment-complete-reservations')
      setItems(Array.isArray(res?.data) ? res.data : [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const approve = async (id: string) => {
    setApprovingId(id)
    try {
      await apiPut(`/api/reservations/${encodeURIComponent(id)}/status`, { reservationStatus: 'confirmed' })
      toast.success('Reservation approved.')
      await load()
    } catch (e: any) {
      toast.error(e?.message || 'Could not approve reservation')
    } finally {
      setApprovingId(null)
    }
  }

  return (
    <Panel
      title="Fully paid — awaiting approval"
      description={loading ? undefined : items.length > 0 ? `${items.length} reservation${items.length === 1 ? '' : 's'} with every payment in` : 'Nothing waiting'}
    >
      {loading ? <div className="text-sm text-muted">Loading…</div> : null}
      <div className="space-y-4">
        {items.map(({ reservation, payments, waivers }) => {
          const unverified = payments.filter((payment) => !['paid', 'confirmed', 'verified', 'approved'].includes(String(payment.paymentStatus).toLowerCase()))
          const missingWaivers = waivers.filter((waiver) => String(waiver.status).toLowerCase() !== 'approved')
          return (
            <div key={reservation.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-sm font-semibold">
                    {reservation.reservationDate} · <span className="capitalize">{reservation.reservationTime}</span> · {reservation.locationName}
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    Captain {reservation.captainName} · {reservation.numberOfPlayers} players · {reservation.packageName} ·{' '}
                    {reservation.paymentMode === 'split' ? 'Split payment' : 'Single payer'} · {formatPHP(reservation.depositAmount)} paid of {formatPHP(reservation.totalAmount)}
                  </div>
                </div>
                <Button variant="primary" size="sm" disabled={approvingId === reservation.id} onClick={() => approve(reservation.id)}>
                  <FiCheck /> {approvingId === reservation.id ? 'Approving…' : 'Approve'}
                </Button>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                  <div className="text-[11px] uppercase tracking-widest text-muted">Payments ({payments.length})</div>
                  <ul className="mt-1 space-y-1 text-xs">
                    {payments.map((payment) => (
                      <li key={payment.id} className="flex items-center justify-between gap-2">
                        <span>{payment.payerName} · {formatPHP(payment.amount)} · <span className="capitalize">{payment.paymentStatus}</span></span>
                        {payment.proofUrl ? (
                          <a href={payment.proofUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                            Proof <FiExternalLink />
                          </a>
                        ) : <span className="text-muted">{payment.paymentMethod}</span>}
                      </li>
                    ))}
                  </ul>
                  {unverified.length > 0 ? (
                    <div className="mt-1 text-[11px] text-warning">{unverified.length} proof{unverified.length === 1 ? '' : 's'} not yet verified in Payments.</div>
                  ) : null}
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-widest text-muted">Waivers ({waivers.length})</div>
                  <ul className="mt-1 space-y-1 text-xs">
                    {waivers.map((waiver) => (
                      <li key={waiver.userId} className="flex items-center justify-between gap-2">
                        <span>{waiver.name}</span>
                        <span className={String(waiver.status).toLowerCase() === 'approved' ? 'text-success' : 'text-warning'}>{waiver.status}</span>
                      </li>
                    ))}
                  </ul>
                  {missingWaivers.length > 0 ? (
                    <div className="mt-1 text-[11px] text-warning">Some waivers are not approved yet.</div>
                  ) : null}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}
