import React, { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { FiCheck, FiClock, FiUpload, FiUsers } from 'react-icons/fi'

import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { apiBase, apiGet, apiPost, getApiAuthHeaders } from '../../utils/apiClient'

export const SPLIT_PAYMENTS_CHANGED_EVENT = 'split-payments-changed'

type SplitMember = {
  id: string
  name: string
  isCaptain: boolean
  paid: boolean
  amount: number
  paymentStatus: string | null
}

export type SplitPaymentItem = {
  reservation: {
    id: string
    reservationDate: string
    reservationTime: string
    locationName: string
    numberOfPlayers: number
    packageName: string
    totalAmount: number
    depositAmount: number
    paymentDueAtISO?: string
  }
  isCaptain: boolean
  captainName: string
  myShareDue: number
  iHavePaid: boolean
  progress: { target: number; submitted: number; remaining: number; state: string }
  members?: SplitMember[]
}

function formatPHP(value: number) {
  return `₱${Number(value || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`
}

function formatDue(iso?: string) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })
}

type BankDetails = { bankName: string; accountName: string; accountNumber: string }

function ShareForm({ item, gcashQrUrl, bankDetails, onPaid }: { item: SplitPaymentItem; gcashQrUrl: string; bankDetails: BankDetails | null; onPaid: () => void }) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [method, setMethod] = useState<'gcash' | 'bank'>('gcash')
  const [refNo, setRefNo] = useState('')
  const [fileName, setFileName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    const file = fileRef.current?.files?.[0]
    if (!refNo.trim()) return toast.error(method === 'gcash' ? 'Enter your GCash reference number.' : 'Enter your bank reference number.')
    if (!file || !file.type.startsWith('image/')) return toast.error('Attach an image of your payment proof.')

    setSubmitting(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const uploadRes = await fetch(`${apiBase}/api/upload-image`, { method: 'POST', headers: getApiAuthHeaders(), body: formData })
      const uploadJson = await uploadRes.json().catch(() => null)
      if (!uploadRes.ok || !uploadJson?.url) throw new Error(uploadJson?.error || 'Proof upload failed')

      await apiPost('/api/payments', {
        reservationId: item.reservation.id,
        amount: item.myShareDue,
        paymentMethod: method === 'gcash' ? 'GCash' : 'Bank Transfer',
        gcashImageUrl: uploadJson.url,
        paymentMode: 'split',
        transactionReference: refNo.trim(),
      })
      toast.success('Your share was submitted for review.')
      onPaid()
    } catch (e: any) {
      toast.error(e?.message || 'Could not submit your payment')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mt-4 space-y-4 rounded-2xl border border-accent/25 bg-accent/5 p-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted">Your share due</div>
          <div className="mt-1 text-2xl font-bold text-gold">{formatPHP(item.myShareDue)}</div>
        </div>
        {item.reservation.paymentDueAtISO ? (
          <div className="flex items-center gap-1 text-xs text-muted">
            <FiClock /> Pay before {formatDue(item.reservation.paymentDueAtISO)}
          </div>
        ) : null}
      </div>

      <div>
        <div className="text-xs uppercase tracking-widest text-muted">Payment method</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {([
            { key: 'gcash', title: 'GCash', hint: 'Scan the QR, pay, then upload your proof' },
            { key: 'bank', title: 'Bank Transfer', hint: 'Transfer to our account, then upload your proof' },
          ] as const).map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setMethod(option.key)}
              className={[
                'rounded-2xl border px-4 py-3 text-left transition',
                method === option.key ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25' : 'border-white/10 bg-white/5 hover:bg-white/8',
              ].join(' ')}
            >
              <div className="text-sm font-bold">{option.title}</div>
              <div className="mt-1 text-xs text-muted">{option.hint}</div>
            </button>
          ))}
        </div>
      </div>

      {method === 'gcash' ? (
        <div className="flex min-h-32 items-center justify-center rounded-2xl border border-dashed border-accent/30 bg-white/5 p-3 text-xs text-muted">
          {gcashQrUrl ? <img src={gcashQrUrl} alt="GCash QR code" className="max-h-56 w-full rounded-xl object-contain" /> : 'Admin has not uploaded a GCash QR yet.'}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-accent/30 bg-white/5 p-4 text-sm">
          {bankDetails?.accountNumber ? (
            <dl className="grid gap-2">
              <div className="flex justify-between gap-3"><dt className="text-muted">Bank</dt><dd className="font-semibold">{bankDetails.bankName}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Account name</dt><dd className="font-semibold">{bankDetails.accountName}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Account number</dt><dd className="font-mono font-semibold">{bankDetails.accountNumber}</dd></div>
            </dl>
          ) : (
            <div className="text-xs text-muted">The admin has not added bank account details yet. Please use GCash or contact staff.</div>
          )}
        </div>
      )}

      <Input
        label={method === 'gcash' ? 'GCash reference number' : 'Bank reference / confirmation number'}
        value={refNo}
        onChange={(e) => setRefNo(e.target.value)}
        placeholder={method === 'gcash' ? 'e.g., 1234 567 890123' : 'e.g., FT2610281234'}
      />

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-accent/10 ring-1 ring-accent/25">
            <FiUpload className="text-gold" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold">Proof of payment</div>
            <div className="mt-1 truncate text-xs text-muted">{fileName || 'No file selected'}</div>
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => setFileName(e.target.files?.[0]?.name || '')}
        />
        <div className="mt-3">
          <Button type="button" variant="ghost" disabled={submitting} onClick={() => fileRef.current?.click()}>Choose image</Button>
        </div>
      </div>

      <Button variant="primary" disabled={submitting} onClick={submit}>
        {submitting ? 'Submitting…' : `Submit ${formatPHP(item.myShareDue)}`}
      </Button>
    </div>
  )
}

function CaptainTracker({ item }: { item: SplitPaymentItem }) {
  const pct = item.progress.target > 0 ? Math.min(100, Math.round((item.progress.submitted / item.progress.target) * 100)) : 0
  const members = item.members || []
  const paid = members.filter((member) => member.paid)
  const pending = members.filter((member) => !member.paid)

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-center gap-2 text-sm font-bold"><FiUsers /> Team payment tracker</div>
      <div className="mt-3 flex items-end justify-between gap-3 text-xs text-muted">
        <span>{formatPHP(item.progress.submitted)} of {formatPHP(item.progress.target)} submitted</span>
        <span className="text-sm font-bold text-text">{formatPHP(item.progress.remaining)} remaining</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-muted">Paid ({paid.length})</div>
          <ul className="mt-2 space-y-1 text-sm">
            {paid.length === 0 ? <li className="text-xs text-muted">No one yet</li> : paid.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5"><FiCheck className="text-success" />{member.name}{member.isCaptain ? ' (you)' : ''}</span>
                <span className="text-xs text-muted">{formatPHP(member.amount)}{member.paymentStatus === 'pending' ? ' · in review' : ''}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-widest text-muted">Pending ({pending.length})</div>
          <ul className="mt-2 space-y-1 text-sm">
            {pending.length === 0 ? <li className="text-xs text-muted">Everyone has paid</li> : pending.map((member) => (
              <li key={member.id} className="flex items-center gap-1.5 text-warning">
                <FiClock />{member.name}{member.isCaptain ? ' (you)' : ''}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mt-3 text-xs text-muted">
        Once the full amount is in, the reservation and everyone's proofs and waivers go to the admin for final approval.
      </div>
    </div>
  )
}

export function SplitPaymentPage() {
  const [items, setItems] = useState<SplitPaymentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [gcashQrUrl, setGcashQrUrl] = useState('')
  const [bankDetails, setBankDetails] = useState<BankDetails | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await apiGet<{ ok: boolean; data: SplitPaymentItem[] }>('/api/split-payments/mine')
      setItems(Array.isArray(res?.data) ? res.data : [])
    } catch (e: any) {
      toast.error(e?.message || 'Could not load split payments')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    apiGet<{ ok: boolean; data: { imageUrl?: string } }>('/api/payments/gcash-qr')
      .then((res) => setGcashQrUrl(res?.data?.imageUrl || ''))
      .catch(() => setGcashQrUrl(''))
    apiGet<{ ok: boolean; data: BankDetails }>('/api/payments/bank-details')
      .then((res) => setBankDetails(res?.data ?? null))
      .catch(() => setBankDetails(null))
  }, [load])

  const afterPaid = () => {
    window.dispatchEvent(new Event(SPLIT_PAYMENTS_CHANGED_EVENT))
    void load()
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-medium text-accent">Payment</div>
        <h1 className="mt-1 text-3xl font-bold">Split Payment</h1>
        <p className="mt-1 text-sm text-muted">Pay your share of a team reservation. This page disappears from the menu once your share is paid.</p>
      </div>

      {loading ? <Card className="p-4 text-sm text-muted">Loading…</Card> : null}
      {!loading && items.length === 0 ? (
        <Card className="p-4 text-sm text-muted">You have no split payments due. You're all set.</Card>
      ) : null}

      {items.map((item) => (
        <Card key={item.reservation.id} className="p-4 md:p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-lg font-semibold">
                {item.reservation.reservationDate} · <span className="capitalize">{item.reservation.reservationTime}</span>
              </div>
              <div className="mt-1 text-sm text-muted">
                {item.reservation.locationName} · {item.reservation.numberOfPlayers} players · {item.reservation.packageName}
              </div>
              <div className="mt-1 text-xs text-muted">
                {item.isCaptain ? 'You are the team captain' : `Captain: ${item.captainName}`} · Reservation total {formatPHP(item.reservation.totalAmount)} · Due online {formatPHP(item.progress.target)}
              </div>
            </div>
            <span className="self-start rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-widest">
              {item.progress.state === 'partial' ? 'Partially paid' : 'Awaiting payment'}
            </span>
          </div>

          {!item.iHavePaid && item.myShareDue > 0 ? (
            <ShareForm item={item} gcashQrUrl={gcashQrUrl} bankDetails={bankDetails} onPaid={afterPaid} />
          ) : item.iHavePaid ? (
            <div className="mt-4 flex items-center gap-2 rounded-2xl border border-success/25 bg-success/10 px-4 py-3 text-sm text-success">
              <FiCheck /> Your share is submitted.
            </div>
          ) : null}

          {item.isCaptain ? <CaptainTracker item={item} /> : null}
        </Card>
      ))}
    </div>
  )
}
