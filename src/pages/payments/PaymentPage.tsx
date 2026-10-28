import React, { useEffect, useMemo, useRef, useState } from 'react'
import { CardElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import { useNavigate } from 'react-router-dom'
import { apiBase, apiGet, apiPost, getApiAuthHeaders } from '../../utils/apiClient'
import toast from 'react-hot-toast'
import { useAuth } from '../../context/AuthContext'

import { motion } from 'framer-motion'
import { FiCheck, FiChevronRight, FiFileText, FiInfo, FiLock, FiUpload } from 'react-icons/fi'

import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { sendRoleNotifications, useNotifications } from '../../context/NotificationContext'
import { clearPackagePrefill } from '../../utils/packagePrefill'

type PaymentMethod = 'gcash' | 'card'

type PaymentMode = 'self' | 'split'

type TeamMember = {
  id: string
  name: string
  email: string
}

type GcashQrSettings = {
  imageUrl: string
  phoneNumber?: string
  updatedAtISO?: string | null
}

type UploadState = {
  fileName: string | null
  fileSize: number | null
}

const stripePromise = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)
  : null

function formatPHP(n: number) {
  return `₱${n.toLocaleString()}`
}

class PaymentPageErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="text-sm font-medium text-accent">Payment</div>
            <h1 className="text-3xl font-bold">Reservation Payment</h1>
            <p className="text-muted text-sm">UI error fallback (prototype).</p>
          </div>

          <div className="rounded-2xl border border-danger/25 bg-danger/10 p-4">
            <div className="text-sm font-bold text-danger">Something went wrong while rendering Payment.</div>
            <div className="mt-2 text-xs text-muted">Check browser Console for the exact runtime error.</div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

function CardPaymentField({ onChange }: { onChange: (complete: boolean) => void }) {
  return (
    <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between gap-3 text-xs uppercase tracking-widest text-muted">
        <span>Card details</span>
        <span>Stripe secure entry</span>
      </div>
      <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
        <CardElement
          onChange={(event) => onChange(event.complete)}
          options={{
            hidePostalCode: true,
            style: {
              base: {
                color: '#ffffff',
                fontFamily: 'system-ui, sans-serif',
                fontSize: '16px',
                '::placeholder': { color: '#9ca3af' },
              },
              invalid: { color: '#f87171' },
            },
          }}
        />
      </div>
      <div className="mt-3 text-[11px] text-muted">Card details are entered directly into Stripe and are not stored by this app.</div>
    </div>
  )
}

function PaymentPageContent() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const stripe = useStripe()
  const elements = useElements()
  const { addNotification } = useNotifications()
  const proofInputRef = useRef<HTMLInputElement | null>(null)

  const [method, setMethod] = useState<PaymentMethod>('gcash')
  const [cardComplete, setCardComplete] = useState(false)
  const [refNo, setRefNo] = useState('ABP-7F21-93')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [upload, setUpload] = useState<UploadState>({ fileName: null, fileSize: null })
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [breakdown, setBreakdown] = useState({ field: 0, equipment: 0, entranceFee: 0, service: 0, total: 0, itemized: [] as Array<{ label: string; amount: number }> })
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('self')
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [teamSize, setTeamSize] = useState(1)
  const [payerShareAmount, setPayerShareAmount] = useState(0)
  const [amountDue, setAmountDue] = useState(0)
  const [gcashQrUrl, setGcashQrUrl] = useState('')
  const [gcashPhoneNumber, setGcashPhoneNumber] = useState('')
  const [gcashQrLoading, setGcashQrLoading] = useState(true)
  const [receiptReference, setReceiptReference] = useState('')
  const [amountPaid, setAmountPaid] = useState(0)
  const [balanceDue, setBalanceDue] = useState(0)

  useEffect(() => {
    const pendingReservationJson = localStorage.getItem('pending_reservation')
    if (!pendingReservationJson) return

    try {
      const pendingReservation = JSON.parse(pendingReservationJson)
      const field = Number(pendingReservation?.fieldPrice || pendingReservation?.fieldCost || 0)
      const equipment = Number(pendingReservation?.equipmentPrice || pendingReservation?.equipmentCost || 0)
      const entranceFee = Number(pendingReservation?.entranceFee || 0)
      const service = Number(pendingReservation?.serviceFee || pendingReservation?.servicePrice || 0)
      const total = Number(pendingReservation?.totalAmount || field + equipment + entranceFee + service || 0)
      const nextPaymentMode: PaymentMode = String(pendingReservation?.paymentMode || 'self').toLowerCase() === 'split' ? 'split' : 'self'
      const nextTeamMembers: TeamMember[] = Array.isArray(pendingReservation?.teamMembers)
        ? pendingReservation.teamMembers.map((member: any) => ({
            id: String(member?.id || ''),
            name: String(member?.name || 'Unnamed player'),
            email: String(member?.email || ''),
          })).filter((member: TeamMember) => !!member.id)
        : []
      const nextTeamSize = Math.max(1, Number(pendingReservation?.teamSize || nextTeamMembers.length + 1 || 1))
      const isOwnGear = String(pendingReservation?.selectionMode || '').toLowerCase() === 'custom' &&
        !(pendingReservation?.customWeaponIds?.length || pendingReservation?.customEquipmentIds?.length)
      const estimatedDeposit = isOwnGear ? Math.min(total, 350) : Math.min(total, Math.round(total * 0.5))
      const nextPayerShareAmount = nextPaymentMode === 'split' ? Math.round((estimatedDeposit / nextTeamSize) * 100) / 100 : estimatedDeposit
      const nextAmountDue = nextPayerShareAmount
      const itemized = Array.isArray(pendingReservation?.itemizedBreakdown)
        ? pendingReservation.itemizedBreakdown.map((item: any) => ({
            label: String(item?.label || 'Charge'),
            amount: Number(item?.amount || 0),
          }))
        : [
            { label: 'Field reservation', amount: field },
            { label: 'Equipment', amount: equipment },
            { label: `Player entrance fee (${Number(pendingReservation?.numberOfPlayers || 1)} × ₱150)`, amount: entranceFee },
            { label: 'Service fee', amount: service },
          ]
      setBreakdown({ field, equipment, entranceFee, service, total, itemized })
      setPaymentMode(nextPaymentMode)
      setTeamMembers(nextTeamMembers)
      setTeamSize(nextTeamSize)
      setPayerShareAmount(nextPayerShareAmount)
      setAmountDue(nextAmountDue)
    } catch {
      setBreakdown({ field: 0, equipment: 0, entranceFee: 0, service: 0, total: 0, itemized: [] })
      setPaymentMode('self')
      setTeamMembers([])
      setTeamSize(1)
      setPayerShareAmount(0)
      setAmountDue(0)
    }
  }, [])

  // Keep the slot locked until the reservation itself is created (which then holds the slot).
  useEffect(() => {
    if (success) return
    const refreshHold = () => {
      if (localStorage.getItem('pending_reservation_id')) return
      try {
        const pending = JSON.parse(localStorage.getItem('pending_reservation') || 'null')
        if (!pending) return
        apiPost('/api/slot-holds', {
          locationId: pending.locationId,
          reservationDate: pending.reservationDate,
          reservationTime: pending.reservationTime,
          sessionType: pending.sessionType,
          fieldIds: pending.fieldIds,
          players: pending.numberOfPlayers,
        }).catch((err) => toast.error(err?.message || 'Your slot could not be kept. Please choose another one.'))
      } catch {
        // ignore malformed pending data; submit() reports it
      }
    }
    refreshHold()
    const timer = window.setInterval(refreshHold, 4 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [success])

  useEffect(() => {
    let cancelled = false

    const loadQr = async () => {
      try {
        setGcashQrLoading(true)
        const res = await apiGet<{ ok: boolean; data: GcashQrSettings }>('/api/payments/gcash-qr')
        if (!cancelled) {
          setGcashQrUrl(res?.data?.imageUrl || '')
          setGcashPhoneNumber(res?.data?.phoneNumber || '')
        }
      } catch {
        if (!cancelled) setGcashQrUrl('')
      } finally {
        if (!cancelled) setGcashQrLoading(false)
      }
    }

    loadQr()

    return () => {
      cancelled = true
    }
  }, [])

  const canSubmit = useMemo(() => {
    if (submitting) return false

    if (method === 'gcash') {
      if (!refNo.trim()) return false
      if (!upload.fileName) return false
      return true
    }

    return Boolean(stripe && elements && cardComplete && !(paymentMode === 'split' && payerShareAmount < breakdown.total))
  }, [breakdown.total, cardComplete, elements, method, payerShareAmount, paymentMode, refNo, stripe, submitting, upload.fileName])

  const onPickFile = (f: File | null) => {
    if (!f) return
    if (!f.type.startsWith('image/')) {
      setUpload({ fileName: '', fileSize: 0 })
      if (proofInputRef.current) proofInputRef.current.value = ''
      toast.error('Only image files are allowed for GCash proof.')
      return
    }
    setUpload({ fileName: f.name, fileSize: f.size })
  }

  const submit = async () => {
    setSubmitting(true)
    try {
      if (!user?.id) throw new Error('Please login to continue')

      const pendingReservationJson = localStorage.getItem('pending_reservation')
      if (!pendingReservationJson) throw new Error('No pending reservation found. Please create a reservation first.')

      let pendingReservation: any
      try {
        pendingReservation = JSON.parse(pendingReservationJson)
      } catch {
        throw new Error('Invalid pending reservation data.')
      }

      if (method === 'gcash') {
        if (!upload.fileName) throw new Error('Proof image is required')
      }
      if (method === 'card') {
        const stripeClient = stripe
        const stripeElements = elements
        if (!stripeClient || !stripeElements) throw new Error('Card payments are not configured. Use GCash or contact staff.')
        if (!cardComplete) throw new Error('Enter valid card details.')
        if (paymentMode === 'split') throw new Error('Split card payments are not supported yet. Select GCash to submit your share.')
        const cardElement = stripeElements.getElement(CardElement)
        if (!cardElement) throw new Error('Card form is unavailable. Please reload and try again.')
      }

      let reservationId = localStorage.getItem('pending_reservation_id') || ''
      let serverReservation: any
      if (!reservationId) {
        const reservationResult = await apiPost<{ ok: boolean; insertedId?: string; data?: any }>('/api/reservations', pendingReservation)
        reservationId = String(reservationResult?.data?.id ?? reservationResult?.insertedId ?? reservationResult?.data?._id ?? '')
        if (reservationId) localStorage.setItem('pending_reservation_id', reservationId)
        serverReservation = reservationResult?.data
      }
      if (!reservationId) throw new Error('Reservation ID missing from API response')
      if (!serverReservation) {
        const reservationResult = await apiGet<{ ok: boolean; data: any }>(`/api/reservations/${encodeURIComponent(reservationId)}`)
        serverReservation = reservationResult.data
      }
      const serverTotal = Number(serverReservation?.totalAmount)
      const serverDeposit = Number(serverReservation?.depositAmount)
      if (!Number.isFinite(serverTotal) || serverTotal <= 0 || !Number.isFinite(serverDeposit) || serverDeposit <= 0) {
        throw new Error('The server could not verify a valid reservation price and deposit.')
      }
      if (paymentMode === 'split' && (!Number.isInteger(Number(serverReservation.teamSize)) || Number(serverReservation.teamSize) < 2)) {
        throw new Error('The server could not verify your group payment settings.')
      }
      const amount = paymentMode === 'split'
        ? Math.round((serverDeposit / Number(serverReservation.teamSize)) * 100) / 100
        : serverDeposit
      setBalanceDue(Number(serverReservation.balanceAmount) || 0)
      setBreakdown((current) => ({
        ...current,
        total: serverTotal,
        itemized: Array.isArray(serverReservation.pricingBreakdown) ? serverReservation.pricingBreakdown : current.itemized,
      }))
      setAmountDue(amount)

      localStorage.setItem('active_reservation_id', String(reservationId))

      sendRoleNotifications(addNotification, {
        roles: ['admin', 'registrar', 'marshal'],
        type: 'reservation_submitted',
        title: 'New Reservation Request',
        message: `A new reservation request was submitted for ${pendingReservation?.reservationDate || 'a selected date'}.`,
        linkedResourceId: String(reservationId),
      })

      if (method === 'card') {
        const stripeClient = stripe
        const stripeElements = elements
        if (!stripeClient || !stripeElements) throw new Error('Card payments are not configured. Use GCash or contact staff.')
        const intent = await apiPost<{ ok: boolean; clientSecret: string; paymentIntentId: string }>(
          '/api/create-payment-intent',
          { reservationId: String(reservationId) },
        )
        const cardElement = stripeElements.getElement(CardElement)
        if (!cardElement) throw new Error('Card form is unavailable. Please reload and try again.')
        const paymentResult = await stripeClient.confirmCardPayment(intent.clientSecret, {
          payment_method: {
            card: cardElement,
            billing_details: { name: user.name, email: user.email },
          },
        })
        if (paymentResult.error) throw new Error(paymentResult.error.message || 'Card payment failed')
        if (paymentResult.paymentIntent?.status !== 'succeeded') {
          throw new Error(`Payment is not complete (status: ${paymentResult.paymentIntent?.status || 'unknown'}).`)
        }
        const receipt = await apiPost<{ ok: boolean; data: { id?: string; paymentIntentId: string } }>(
          '/api/payments/stripe-confirm',
          { reservationId: String(reservationId), paymentIntentId: intent.paymentIntentId },
        )
        setReceiptReference(receipt.data.id || receipt.data.paymentIntentId)
      } else {
        const file = proofInputRef.current?.files?.[0]
        if (!file || !file.type.startsWith('image/')) throw new Error('Only image files are allowed for GCash proof.')
        const formData = new FormData()
        formData.append('file', file)
        const uploadRes = await fetch(`${apiBase}/api/upload-image`, { method: 'POST', headers: getApiAuthHeaders(), body: formData })
        const uploadJson = await uploadRes.json().catch(() => null)
        if (!uploadRes.ok) throw new Error(uploadJson?.error || uploadJson?.message || 'Upload failed')
        const gcashImageUrl = uploadJson?.url
        if (!gcashImageUrl) throw new Error('Cloudinary upload returned no url')

        const payment = await apiPost<{ ok: boolean; data?: { id?: string } }>('/api/payments', {
          reservationId: String(reservationId),
          amount,
          paymentMethod: 'GCash',
          paymentStatus: 'pending',
          gcashImageUrl: gcashImageUrl || '',
          paymentMode,
          transactionReference: refNo.trim(),
          createdAt: new Date().toISOString(),
        })
        setReceiptReference(payment.data?.id || refNo.trim())
      }
      setAmountPaid(amount)

      localStorage.removeItem('pending_reservation')
      localStorage.removeItem('pending_reservation_id')
      clearPackagePrefill()

      setSuccess(true)
      toast.success(method === 'card' ? 'Card payment verified.' : 'Payment submitted for staff review.')
    } catch (e: any) {
      toast.error(String(e?.message || e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div id="payment-section" className="space-y-4">
      <div className="space-y-2">
        <div className="text-sm font-medium text-accent">Payment</div>
        <h1 className="text-3xl font-bold">Reservation Payment</h1>
        <p className="text-muted text-sm">The server recalculates the reservation total and deposit. GCash submissions are reviewed by staff; card payments are verified through Stripe.</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_0.9fr]">
        <Card className="p-4 md:p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs uppercase tracking-widest text-muted">Payment method</div>
            <div className="hidden md:flex items-center gap-2 text-[11px] text-muted">
              <FiLock />
              <span>Secured submission</span>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMethod('gcash')}
              className={[
                'w-full text-left rounded-2xl border px-4 py-3 transition',
                method === 'gcash'
                  ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25'
                  : 'border-white/10 bg-white/5 hover:bg-white/8',
              ].join(' ')}
            >
              <div className="text-sm font-bold">GCash</div>
              <div className="mt-1 text-xs text-muted">Scan → confirm → upload proof</div>
            </button>

            <button
              type="button"
              onClick={() => setMethod('card')}
              className={[
                'w-full text-left rounded-2xl border px-4 py-3 transition',
                method === 'card'
                  ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25'
                  : 'border-white/10 bg-white/5 hover:bg-white/8',
              ].join(' ')}
            >
              <div className="text-sm font-bold">Card Payment</div>
              <div className="mt-1 text-xs text-muted">Pay instantly with a secure checkout form</div>
            </button>
          </div>

          <div className="mt-6 rounded-2xl border border-white/10 bg-black/15 p-4">
            <div className="flex items-center gap-2 text-sm font-bold">
              <FiInfo className="text-gold" />
              <span>{method === 'gcash' ? 'Submission rules' : 'Card payment rules'}</span>
            </div>
            {method === 'gcash' ? (
              <ul className="mt-2 space-y-1 text-xs text-muted list-disc pl-5">
                <li>Reference number is required.</li>
                <li>Upload proof is required before submission.</li>
                <li>Payments are submitted for registrar review after proof upload.</li>
              </ul>
            ) : (
              <ul className="mt-2 space-y-1 text-xs text-muted list-disc pl-5">
                <li>Enter card details in Stripe’s secure card field.</li>
                <li>Card details are not sent to or stored by this app.</li>
                <li>Payment is recorded as paid only after Stripe confirms the charge.</li>
              </ul>
            )}
          </div>

          {(teamMembers.length > 0 || paymentMode === 'split') && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs uppercase tracking-widest text-muted">Team payment</div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted">
                  {paymentMode === 'split' ? `Split among ${teamSize}` : 'One payer'}
                </div>
              </div>
              {teamMembers.length > 0 ? (
                <div className="mt-2 text-sm font-semibold text-white">
                  {teamMembers.map((member) => member.name).join(', ')}
                </div>
              ) : null}
              <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted">
                <span>Your share</span>
                <span className="font-bold text-gold">{formatPHP(amountDue || payerShareAmount || breakdown.total)}</span>
              </div>
            </div>
          )}

          <div className="mt-5 space-y-5">
            <div className="space-y-4">
              {method === 'gcash' ? (
                <>
                  <Input
                    label="Phone Number"
                    value={phoneNumber || gcashPhoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder={gcashPhoneNumber || 'e.g., 0917 123 4567'}
                  />

                  <div className="rounded-2xl border border-dashed border-accent/30 bg-accent/5 p-4">
                    <div className="text-xs uppercase tracking-widest text-muted">GCash QR</div>
                    <div className="mx-auto mt-3 flex min-h-32 items-center justify-center rounded-2xl border border-dashed border-accent/30 bg-white/5 p-3 text-[10px] text-muted">
                        {gcashQrLoading ? (
                          <span>Loading QR…</span>
                        ) : gcashQrUrl ? (
                          <img src={gcashQrUrl} alt="GCash QR" className="max-h-56 w-full rounded-xl object-contain" />
                        ) : (
                          <span>Admin has not uploaded a QR yet.</span>
                        )}
                      </div>
                  </div>

                  <Input
                    label="Reference Number"
                    value={refNo}
                    onChange={(e) => setRefNo(e.target.value)}
                    placeholder="e.g., ABP-7F21-93"
                  />
                </>
              ) : (
                <div className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-[radial-gradient(circle_at_top,_rgba(245,196,73,0.18),_transparent_42%),linear-gradient(180deg,_rgba(255,255,255,0.08),_rgba(0,0,0,0.18))] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
                  <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.12)_1px,transparent_1px)] [background-size:22px_22px]" />
                  <div className="relative flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-widest text-muted">Card checkout</div>
                      <div className="mt-1 text-lg font-bold text-white">Secure payment form</div>
                    </div>
                    <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-muted">
                      Secure
                    </div>
                  </div>

                  <div className="relative mt-4 rounded-[1.25rem] border border-white/10 bg-black/35 p-4 backdrop-blur-sm">
                    <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.2em] text-muted">
                      <span>Card details</span>
                      <span>Visa / Mastercard / Amex</span>
                    </div>
                    <div className="mt-3">
                      <CardPaymentField onChange={setCardComplete} />
                    </div>

                    <div className="mt-4 grid gap-2 sm:grid-cols-3 text-[11px] text-muted">
                      <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">Encrypted entry</div>
                      <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">Provider verified</div>
                      <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">Auditable payment record</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {method === 'gcash' ? (
              <div className="mt-6">
                <div className="text-xs uppercase tracking-widest text-muted">Upload proof</div>
                <div className="mt-2">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center gap-3">
                      <div className="grid h-10 w-10 place-items-center rounded-2xl bg-accent/10 ring-1 ring-accent/25">
                        <FiUpload className="text-gold" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-bold">Attach payment screenshot / receipt</div>
                        <div className="mt-1 text-xs text-muted truncate">{upload.fileName ? upload.fileName : 'No file selected'}</div>
                      </div>
                    </div>

                    <input
                      ref={proofInputRef}
                      id="payment-proof-upload"
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
                    />

                    <div className="mt-4 flex items-center justify-between gap-3">
                      <Button type="button" variant="ghost" disabled={submitting} onClick={() => proofInputRef.current?.click()}>
                        Choose file
                      </Button>
                      <div className="text-[11px] text-muted">Accepted: image files only</div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="rounded-2xl border border-white/10 bg-black/20 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
              <div className="text-xs uppercase tracking-widest text-muted">Receipt Preview</div>
              <div className="mt-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-muted">Method</div>
                  <div className="text-xs font-bold">{method === 'gcash' ? 'GCash' : 'Card Payment'}</div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="text-xs text-muted">Reference</div>
                  <div className="text-xs font-bold">{method === 'gcash' ? refNo || '—' : receiptReference || 'Stripe checkout'}</div>
                </div>
                {method === 'gcash' ? (
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <div className="text-xs text-muted">Phone</div>
                    <div className="text-xs font-bold">{phoneNumber || '—'}</div>
                  </div>
                ) : (
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <div className="text-xs text-muted">Status</div>
                    <div className="text-xs font-bold">{!stripe ? 'Card payments unavailable' : cardComplete ? 'Card details ready' : 'Awaiting card details'}</div>
                  </div>
                )}
                <div className="mt-3 h-px bg-white/10" />
                {(breakdown.itemized.length > 0 ? breakdown.itemized : [
                  { label: 'Field reservation', amount: breakdown.field },
                  { label: 'Equipment', amount: breakdown.equipment },
                  { label: 'Player entrance fee (150 each)', amount: breakdown.entranceFee },
                  { label: 'Service fee', amount: breakdown.service },
                ]).map((item) => (
                  <div key={`${item.label}-${item.amount}`} className="mt-2 flex items-center justify-between gap-3">
                    <div className="text-xs text-muted">{item.label}</div>
                    <div className="text-xs font-bold">{formatPHP(item.amount)}</div>
                  </div>
                ))}
                <div className="mt-3 h-px bg-white/10" />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="text-xs text-muted">Reservation deposit</div>
                  <div className="text-sm font-black text-gold">{formatPHP(amountDue || payerShareAmount || breakdown.total)}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button variant="primary" disabled={!canSubmit} onClick={submit}>
              {submitting ? 'Submitting…' : success ? 'Submitted' : method === 'card' ? 'Pay with Card' : 'Submit Payment'}
              <FiChevronRight />
            </Button>
          </div>

          {success ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="mt-4 rounded-2xl border border-success/25 bg-success/10 p-4"
            >
              <div className="flex items-center gap-2 text-sm font-bold text-success">
                <FiCheck /> {method === 'card' ? 'Card Payment Verified' : 'Payment Submitted'}
              </div>
              <div className="mt-2 text-xs text-muted">
                {method === 'card'
                  ? 'Stripe confirmed the charge and the payment record was saved.'
                  : 'Your payment proof has been submitted. The registrar/admin will review and verify it.'}
                {paymentMode === 'split'
                  ? ' Your teammates have been notified of their shares. Track who has paid under Split Payment in the menu — the slot stays reserved for 24 hours while the team pays.'
                  : ''}
              </div>

              <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted">Receipt</span>
                  <span className="text-xs font-bold">
                    {receiptReference || (method === 'card' ? 'Stripe receipt' : `ABP-RCPT-${refNo ? refNo.replace(/\W/g, '').slice(-6) : '000000'}`)}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-xs text-muted">Total paid</span>
                  <span className="text-xs font-bold text-gold">{formatPHP(amountPaid)}</span>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Button variant="primary" onClick={() => navigate('/app')}>
                  Go to Dashboard <FiChevronRight />
                </Button>
                <Button variant="ghost" onClick={() => navigate('/app/reservations')}>
                  View My Reservations
                </Button>
              </div>
            </motion.div>
          ) : null}
        </Card>

        <Card className="p-4 md:p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs uppercase tracking-widest text-muted">Breakdown</div>
            <FiFileText className="text-gold" />
          </div>

          <div className="mt-3 space-y-2 text-sm">
            {(breakdown.itemized.length > 0 ? breakdown.itemized : [
              { label: 'Field reservation', amount: breakdown.field },
              { label: 'Equipment', amount: breakdown.equipment },
              { label: 'Player entrance fee (150 each)', amount: breakdown.entranceFee },
              { label: 'Service fee', amount: breakdown.service },
            ]).map((item) => (
              <div key={`${item.label}-${item.amount}`} className="flex items-center justify-between">
                <span className="text-muted">{item.label}</span>
                <span className="font-semibold">{formatPHP(item.amount)}</span>
              </div>
            ))}
            <div className="h-px bg-white/10" />
            <div className="flex items-center justify-between">
              <span className="text-muted">Reservation total</span>
              <span className="font-bold text-accent">{formatPHP(breakdown.total)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Reservation deposit</span>
              <span className="font-bold text-accent">{formatPHP(amountDue || payerShareAmount || breakdown.total)}</span>
            </div>
            {balanceDue > 0 ? (
              <div className="flex items-center justify-between">
                <span className="text-muted">Remaining balance</span>
                <span className="font-semibold">{formatPHP(balanceDue)}</span>
              </div>
            ) : null}
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-xs uppercase tracking-widest text-muted">Invoice</div>
            <div className="mt-2 text-xs text-muted">
              The receipt preview will include your reservation ID, payer details, payment method, and submitted record once completed.
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

export function PaymentPage() {
  return (
    <PaymentPageErrorBoundary>
      <Elements stripe={stripePromise}>
        <PaymentPageContent />
      </Elements>
    </PaymentPageErrorBoundary>
  )
}