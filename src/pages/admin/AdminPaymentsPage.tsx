import React, { useEffect, useMemo, useState } from 'react'
import { FiCheck, FiCornerUpLeft, FiFileText, FiFlag } from 'react-icons/fi'
import { ActionGroup, Button } from '../../components/ui/Button'
import { FilterTabs, titleCaseLabel } from '../../components/ui/FilterTabs'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import toast from 'react-hot-toast'
import { apiBase, apiDelete, apiGet, apiPut, getApiAuthHeaders } from '../../utils/apiClient'
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
  receiptUrl: string
  stripe: boolean
}

const KNOWN_STATUSES: PaymentStatus[] = ['paid', 'pending', 'failed', 'review', 'confirmed']

function normalizePaymentStatus(value: unknown): PaymentStatus {
  const lower = String(value || 'pending').toLowerCase()
  if (lower === 'rejected') return 'failed'
  if (lower === 'submitted') return 'pending'
  return (KNOWN_STATUSES as string[]).includes(lower) ? (lower as PaymentStatus) : 'pending'
}

type BankDetails = { bankName: string; accountName: string; accountNumber: string }

type GcashQrSettings = {
  imageUrl: string
  phoneNumber?: string
  updatedAtISO?: string | null
  updatedBy?: string | null
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
  const [qrSettings, setQrSettings] = useState<GcashQrSettings>({ imageUrl: '' })
  const [qrPreview, setQrPreview] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [qrSaving, setQrSaving] = useState(false)
  const [qrLoading, setQrLoading] = useState(true)
  const [qrFile, setQrFile] = useState<File | null>(null)
  const [qrModalOpen, setQrModalOpen] = useState(false)
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
          status: normalizePaymentStatus(d.paymentStatus ?? d.status),
          date: d.createdAtISO ?? d.createdAt ?? d.submittedAtISO ?? '—',
          note: d.transactionReference ?? d.refNo ?? d.note ?? '',
          receiptUrl: d.gcashImageUrl ?? d.proofUrl ?? d.receiptUrl ?? '',
          stripe: Boolean(d.stripePaymentIntentId),
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

  useEffect(() => {
    let cancelled = false

    const loadQr = async () => {
      try {
        setQrLoading(true)
        const res = await apiGet<{ ok: boolean; data: GcashQrSettings }>('/api/payments/gcash-qr')
        if (!cancelled) {
          setQrSettings(res?.data || { imageUrl: '' })
          setQrPreview(res?.data?.imageUrl || '')
          setPhoneNumber(res?.data?.phoneNumber || '')
        }
      } catch (e: any) {
        if (!cancelled) {
          toast.error(String(e?.message || e))
        }
      } finally {
        if (!cancelled) setQrLoading(false)
      }
    }

    loadQr()
    apiGet<{ ok: boolean; data: BankDetails }>('/api/payments/bank-details')
      .then((res) => { if (!cancelled && res?.data) setBankForm(res.data) })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [])

  const [bankForm, setBankForm] = useState<BankDetails>({ bankName: '', accountName: '', accountNumber: '' })
  const [bankSaving, setBankSaving] = useState(false)

  const saveBankDetails = async () => {
    setBankSaving(true)
    try {
      const saved = await apiPut<{ ok: boolean; data: BankDetails }>('/api/payments/bank-details', bankForm)
      setBankForm(saved.data)
      toast.success('Bank transfer details saved')
    } catch (e: any) {
      toast.error(String(e?.message || e))
    } finally {
      setBankSaving(false)
    }
  }

  const saveQrImage = async () => {
    if (!qrFile) {
      toast.error('Please choose a QR image.')
      return
    }
    if (!phoneNumber.trim()) {
      toast.error('GCash phone number is required.')
      return
    }
    if (!qrFile.type.startsWith('image/')) {
      toast.error('Please upload an image file for the GCash QR.')
      return
    }

    setQrSaving(true)
    try {
      const formData = new FormData()
      formData.append('file', qrFile)

      const uploadRes = await fetch(`${apiBase}/api/upload-image`, {
        method: 'POST',
        headers: getApiAuthHeaders(),
        body: formData,
      })
      const uploadJson = await uploadRes.json().catch(() => null)
      if (!uploadRes.ok) {
        throw new Error(uploadJson?.error || uploadJson?.message || 'QR upload failed')
      }

      const imageUrl = String(uploadJson?.url || '').trim()
      if (!imageUrl) throw new Error('Upload returned no image URL')

      const saved = await apiPut<{ ok: boolean; data: GcashQrSettings }>('/api/payments/gcash-qr', { imageUrl, phoneNumber: phoneNumber.trim() })
      setQrSettings(saved?.data || { imageUrl })
      setQrPreview(imageUrl)
      setQrFile(null)
      setQrModalOpen(false)
      toast.success('GCash QR updated')
    } catch (e: any) {
      toast.error(String(e?.message || e))
    } finally {
      setQrSaving(false)
    }
  }

  const openQrModal = () => {
    setQrModalOpen(true)
  }

  const closeQrModal = () => {
    if (qrSaving) return
    setQrModalOpen(false)
  }

  const qrUploadReady = Boolean(qrFile && phoneNumber.trim())





  const filtered = payments.filter((payment) => (active === 'all' ? true : payment.status === active))
  const reviewCount = payments.filter((payment) => payment.status === 'review').length
  const pendingValue = payments.filter((payment) => payment.status === 'pending').reduce((sum, p) => sum + p.amount, 0)

  const [updatingId, setUpdatingId] = useState('')

  const updateStatus = async (id: string, nextStatus: PaymentStatus, reason = '') => {
    setUpdatingId(id)
    try {
      await apiPut(`/api/payments/${encodeURIComponent(id)}/verify`, { paymentStatus: nextStatus, reason })
      sendRoleNotifications(addNotification, {
        roles: ['admin', 'registrar', 'marshal'],
        type: 'payment_verified',
        title: 'Payment Status Updated',
        message: `Payment ${id} was marked ${nextStatus}.`,
        linkedResourceId: id,
      })
      await load()
      toast.success(nextStatus === 'paid' ? 'Payment approved' : nextStatus === 'failed' ? 'Payment sent back to the player' : 'Payment updated')
    } catch (e: any) {
      toast.error(String(e?.message || e))
    } finally {
      setUpdatingId('')
    }
  }

  const sendBack = (payment: PaymentItem) => {
    const reason = window.prompt('Why is this payment being sent back? The player sees this reason and can submit a corrected payment.')
    if (reason === null) return
    if (!reason.trim()) {
      toast.error('Enter a reason so the player knows what to fix.')
      return
    }
    void updateStatus(payment.id, 'failed', reason.trim())
  }


  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Payments</h1>
          <p className="mt-1 text-sm text-muted">Review submitted receipts, resolve pending transactions, and confirm booking payments.</p>
        </div>

        <FilterTabs
          ariaLabel="Filter payments by status"
          value={active}
          onChange={setActive}
          options={(['all', 'pending', 'review', 'paid', 'confirmed', 'failed'] as const).map((status) => ({
            value: status,
            label: status === 'all' ? 'All' : status === 'failed' ? 'Sent back' : titleCaseLabel(status),
            count: status === 'all' ? payments.length : payments.filter((p) => p.status === status).length,
          }))}
        />
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
          <div className="max-w-2xl">
            <div className="text-xs uppercase tracking-widest text-muted">GCash QR</div>
            <div className="mt-2 text-sm text-muted">
              Upload the GCash QR that players should scan on the payment page. The latest image is stored centrally and shown to all players.
            </div>
            <div className="mt-3 text-xs text-muted">
              {qrSettings.updatedAtISO ? `Last updated ${qrSettings.updatedAtISO}` : 'No QR uploaded yet.'}
            </div>
          </div>

          <Button variant="primary" onClick={openQrModal}>
            Upload GCash QR
          </Button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted">GCash phone number</div>
            <input
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
              placeholder="e.g. 09171234567"
              className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:outline-none"
              inputMode="numeric"
              pattern="[0-9]*"
            />
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-muted">
            GCash phone number is required to make sure both the number and QR image are uploaded.
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[240px_1fr]">
          <div className="flex items-center justify-center rounded-2xl border border-white/10 bg-black/20 p-4">
            {qrLoading ? (
              <div className="text-sm text-muted">Loading QR…</div>
            ) : qrPreview ? (
              <img src={qrPreview} alt="GCash QR preview" className="max-h-56 w-full rounded-xl object-contain" />
            ) : (
              <div className="text-center text-sm text-muted">No QR image configured.</div>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-muted">
            <div className="font-semibold text-white">How it works</div>
            <div className="mt-2 space-y-2">
              <div>1. Upload the GCash QR image here.</div>
              <div>2. The payment page will fetch and display the latest QR automatically.</div>
              <div>3. Players can scan it when submitting GCash proof.</div>
            </div>
          </div>
        </div>
      </Card>

      {qrModalOpen && (
        <div className="fixed inset-0 z-[99999] grid place-items-center bg-black/70 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="gcash-qr-upload-title">
          <div className="w-full max-w-2xl rounded-[1.5rem] border border-white/10 bg-[#111214] p-4 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div id="gcash-qr-upload-title" className="text-lg font-bold text-white">Upload GCash QR</div>
                <div className="mt-1 text-sm text-muted">Add the GCash phone number and QR image before saving.</div>
              </div>
              <Button variant="ghost" size="sm" onClick={closeQrModal}>
                Close
              </Button>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <div className="text-xs uppercase tracking-widest text-muted">GCash phone number</div>
                <input
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
                  placeholder="e.g. 09171234567"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:outline-none"
                />
                <div className="mt-2 text-xs text-warning">GCash phone number is required.</div>
              </div>

              <div>
                <div className="text-xs uppercase tracking-widest text-muted">GCash QR</div>
                <label className="mt-2 flex min-h-28 cursor-pointer items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/5 px-4 py-4 text-sm text-muted transition hover:bg-white/8">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={qrSaving}
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null
                      setQrFile(file)
                      if (file) setQrPreview(URL.createObjectURL(file))
                      e.currentTarget.value = ''
                    }}
                  />
                  Upload GCash QR
                </label>
              </div>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[240px_1fr]">
              <div className="flex items-center justify-center rounded-2xl border border-white/10 bg-black/20 p-4">
                {qrPreview ? (
                  <img src={qrPreview} alt="GCash QR preview" className="max-h-56 w-full rounded-xl object-contain" />
                ) : (
                  <div className="text-center text-sm text-muted">QR preview will appear here after upload.</div>
                )}
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-muted">
                <div className="font-semibold text-white">Upload warning</div>
                <div className="mt-2">GCash phone number is required before saving the QR setup.</div>
                <div className="mt-2">The save button will appear only after both the phone number and QR image are provided.</div>
              </div>
            </div>

            {qrUploadReady ? (
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="ghost" disabled={qrSaving} onClick={closeQrModal}>
                  Cancel
                </Button>
                <Button variant="primary" disabled={qrSaving} onClick={() => void saveQrImage()}>
                  {qrSaving ? 'Saving…' : 'Save GCash QR'}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <Card className="p-4">
        <div className="text-xs uppercase tracking-widest text-muted">Bank transfer account</div>
        <div className="mt-2 text-sm text-muted">Shown to players who choose Bank Transfer on the payment page.</div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Input label="Bank" value={bankForm.bankName} onChange={(e) => setBankForm((f) => ({ ...f, bankName: e.target.value }))} placeholder="e.g., BDO" />
          <Input label="Account name" value={bankForm.accountName} onChange={(e) => setBankForm((f) => ({ ...f, accountName: e.target.value }))} placeholder="Chill Shooters Airsoft" />
          <Input label="Account number" value={bankForm.accountNumber} onChange={(e) => setBankForm((f) => ({ ...f, accountNumber: e.target.value }))} placeholder="0000 0000 0000" />
        </div>
        <div className="mt-3 flex justify-end">
          <Button
            variant="primary"
            disabled={bankSaving || !bankForm.bankName.trim() || !bankForm.accountName.trim() || !bankForm.accountNumber.trim()}
            onClick={() => void saveBankDetails()}
          >
            {bankSaving ? 'Saving…' : 'Save bank details'}
          </Button>
        </div>
      </Card>

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
            <div className="col-span-2">Player</div>
            <div className="col-span-1 text-right">Amount</div>
            <div className="col-span-2 text-right">Status</div>
            <div className="col-span-4 text-right">Actions</div>
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
                  <div className="min-w-0 lg:col-span-2">
                    <div className="truncate text-sm font-semibold">{payment.player}</div>
                    <div className="mt-1 truncate text-xs text-muted">{payment.note}</div>
                  </div>
                  <div className="text-sm font-semibold lg:col-span-1 lg:text-right">₱{payment.amount}</div>
                  <div className="lg:col-span-2 lg:text-right">
                    <StatusPill status={payment.status} />
                    <div className="mt-1 text-xs text-muted">{payment.method}</div>
                  </div>
                  <div className="lg:col-span-4">
                    <ActionGroup className="lg:justify-end" align="start">
                      {payment.receiptUrl ? (
                        <a
                          href={payment.receiptUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="surface hover-row inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-text"
                        >
                          <FiFileText /> Receipt
                        </a>
                      ) : (
                        <span className="inline-flex h-8 items-center px-1 text-xs text-muted">No receipt</span>
                      )}
                      {payment.status === 'paid' || payment.status === 'confirmed' ? (
                        <span className="inline-flex h-8 items-center px-1 text-xs font-semibold text-success">Verified</span>
                      ) : payment.status === 'failed' ? (
                        <span className="inline-flex h-8 items-center px-1 text-xs text-muted">Sent back</span>
                      ) : payment.stripe ? (
                        <span className="inline-flex h-8 items-center px-1 text-xs text-muted">Verified by Stripe</span>
                      ) : (
                        <>
                          <Button size="xs" variant="success-soft" disabled={updatingId === payment.id} onClick={() => updateStatus(payment.id, 'paid')}>
                            <FiCheck /> Approve
                          </Button>
                          {payment.status === 'pending' && (
                            <Button size="xs" variant="accent-soft" disabled={updatingId === payment.id} onClick={() => updateStatus(payment.id, 'review')}>
                              <FiFlag /> Flag for review
                            </Button>
                          )}
                          <Button size="xs" variant="danger-soft" disabled={updatingId === payment.id} onClick={() => sendBack(payment)}>
                            <FiCornerUpLeft /> Send back
                          </Button>
                        </>
                      )}
                    </ActionGroup>
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

