import React, { useEffect, useMemo, useRef, useState } from 'react'
import { CardElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import { useNavigate } from 'react-router-dom'
import { apiBase, apiGet, apiPost, getApiAuthHeaders } from '../../utils/apiClient'
import toast from 'react-hot-toast'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'

import { motion } from 'framer-motion'
import { FiCheck, FiChevronRight, FiFileText, FiInfo, FiLock, FiUpload } from 'react-icons/fi'

import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { sendRoleNotifications, useNotifications } from '../../context/NotificationContext'
import { clearPackagePrefill } from '../../utils/packagePrefill'

// Online deposits: GCash and bank transfer are proof-of-payment submissions a registrar
// verifies; card is charged through Stripe in TEST MODE for the demo (a production deployment
// would use a Philippine gateway such as PayMongo). Card is online-only: the counter has no
// card terminal, so remaining balances are settled at the field by GCash, bank transfer, or cash.
type PaymentMethod = 'gcash' | 'bank' | 'card'

const METHOD_LABELS: Record<PaymentMethod, string> = { gcash: 'GCash', bank: 'Bank Transfer', card: 'Card (online)' }

// Test mode only: a live publishable key is ignored so no real card can be charged.
const stripePublishableKey = String(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '')
const stripePromise = stripePublishableKey.startsWith('pk_test_') ? loadStripe(stripePublishableKey) : null

type BankDetails = {
  bankName: string
  accountName: string
  accountNumber: string
}

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
  const { theme } = useTheme()

  if (!stripePromise) {
    return (
      <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
        <div className="font-bold">Card payments are not set up</div>
        <div className="mt-1 text-xs text-muted">
          Add a Stripe test publishable key (VITE_STRIPE_PUBLISHABLE_KEY=pk_test_…) to enable the demo. Please pay with GCash or bank transfer for now.
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between gap-3 text-xs uppercase tracking-widest text-muted">
        <span>Card details</span>
        <span>Visa / Mastercard</span>
      </div>
      <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-4 py-4">
        <CardElement
          onChange={(event) => onChange(event.complete)}
          options={{
            hidePostalCode: true,
            style: {
              base: {
                color: theme === 'dark' ? '#ffffff' : '#0a1423',
                fontFamily: 'system-ui, sans-serif',
                fontSize: '16px',
                '::placeholder': { color: '#9ca3af' },
              },
              invalid: { color: '#f87171' },
            },
          }}
        />
      </div>
      <div className="mt-3 rounded-xl border border-accent/20 bg-accent/5 px-3 py-2 text-[11px] text-muted">
        <span className="font-semibold text-text">Demo (Stripe test mode):</span> no real money moves. Use card 4242 4242 4242 4242, any future expiry, any CVC.
      </div>
    </div>
  )
}

function PaymentPageContent() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { addNotification } = useNotifications()
  const stripe = useStripe()
  const elements = useElements()
  const [cardComplete, setCardComplete] = useState(false)
  const proofInputRef = useRef<HTMLInputElement | null>(null)

  const [method, setMethod] = useState<PaymentMethod>('gcash')
  const [bankDetails, setBankDetails] = useState<BankDetails | null>(null)
  const [refNo, setRefNo] = useState('')
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
  // Chosen when booking: pay everything online, or the downpayment online and the rest in cash at the field.
  const [paysInFull, setPaysInFull] = useState(false)

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
      const fullPlan = pendingReservation?.paymentPlan === 'full'
      setPaysInFull(fullPlan)
      const estimatedDeposit = fullPlan ? total : isOwnGear ? Math.min(total, 350) : Math.min(total, Math.round(total * 0.5))
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
    apiGet<{ ok: boolean; data: BankDetails }>('/api/payments/bank-details')
      .then((res) => { if (!cancelled) setBankDetails(res?.data ?? null) })
      .catch(() => { if (!cancelled) setBankDetails(null) })

    return () => {
      cancelled = true
    }
  }, [])

  const canSubmit = useMemo(() => {
    if (submitting) return false
    if (method === 'card') return Boolean(stripe && elements && cardComplete && paymentMode !== 'split')
    return Boolean(refNo.trim()) && Boolean(upload.fileName)
  }, [cardComplete, elements, method, paymentMode, refNo, stripe, submitting, upload.fileName])

  const onPickFile = (f: File | null) => {
    if (!f) return
    if (!f.type.startsWith('image/')) {
      setUpload({ fileName: '', fileSize: 0 })
      if (proofInputRef.current) proofInputRef.current.value = ''
      toast.error('Only image files are allowed as proof of payment.')
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

      if (method === 'card') {
        if (!stripe || !elements) throw new Error('Card payments are not configured. Use GCash or bank transfer.')
        if (!cardComplete) throw new Error('Enter valid card details.')
        if (paymentMode === 'split') throw new Error('Split shares are paid by GCash or bank transfer.')
        if (!elements.getElement(CardElement)) throw new Error('Card form is unavailable. Please reload and try again.')
      } else {
        if (!upload.fileName) throw new Error('Proof image is required')
        if (!refNo.trim()) throw new Error('Reference number is required')
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
        const cardElement = elements?.getElement(CardElement)
        if (!stripe || !cardElement) throw new Error('Card form is unavailable. Please reload and try again.')
        const intent = await apiPost<{ ok: boolean; clientSecret: string; paymentIntentId: string }>(
          '/api/create-payment-intent',
          { reservationId: String(reservationId) },
        )
        const paymentResult = await stripe.confirmCardPayment(intent.clientSecret, {
          payment_method: { card: cardElement, billing_details: { name: user.name, email: user.email } },
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
        if (phoneNumber && !/^09\d{9}$/.test(phoneNumber)) throw new Error('Enter your GCash number as 11 digits starting with 09, or leave it blank.')
        const file = proofInputRef.current?.files?.[0]
        if (!file || !file.type.startsWith('image/')) throw new Error('Only image files are allowed as proof of payment.')
        const formData = new FormData()
        formData.append('file', file)
        const uploadRes = await fetch(`${apiBase}/api/upload-image`, { method: 'POST', headers: getApiAuthHeaders(), body: formData })
        const uploadJson = await uploadRes.json().catch(() => null)
        if (!uploadRes.ok) throw new Error(uploadJson?.error || uploadJson?.message || 'Upload failed')
        const proofImageUrl = uploadJson?.url
        if (!proofImageUrl) throw new Error('The proof upload returned no URL. Please try again.')

        const payment = await apiPost<{ ok: boolean; data?: { id?: string } }>('/api/payments', {
          reservationId: String(reservationId),
          amount,
          paymentMethod: METHOD_LABELS[method],
          paymentStatus: 'pending',
          gcashImageUrl: proofImageUrl,
          paymentMode,
          transactionReference: refNo.trim(),
          ...(phoneNumber ? { senderNumber: phoneNumber } : {}),
          createdAt: new Date().toISOString(),
        })
        setReceiptReference(payment.data?.id || refNo.trim())
      }
      setAmountPaid(amount)

      localStorage.removeItem('pending_reservation')
      localStorage.removeItem('pending_reservation_id')
      clearPackagePrefill()

      setSuccess(true)
      toast.success(method === 'card' ? 'Card payment confirmed (test mode).' : 'Payment submitted for staff review.')
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
        <p className="text-muted text-sm">The server recalculates the reservation total and deposit. Pay the deposit online by GCash or bank transfer (upload your proof for registrar verification) or by card. The remaining balance is settled at the field by GCash, bank transfer, or cash — cards are not accepted onsite.</p>
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

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {([
              { key: 'gcash', title: 'GCash', hint: 'Scan the QR → pay → upload proof' },
              { key: 'bank', title: 'Bank Transfer', hint: 'Transfer to our account → upload proof' },
              { key: 'card', title: 'Card', hint: paymentMode === 'split' ? 'Not available for split shares' : 'Online only · Stripe test mode' },
            ] as const).map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setMethod(option.key)}
                disabled={option.key === 'card' && paymentMode === 'split'}
                className={[
                  'w-full text-left rounded-2xl border px-4 py-3 transition disabled:cursor-not-allowed disabled:opacity-50',
                  method === option.key
                    ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25'
                    : 'border-white/10 bg-white/5 hover:bg-white/8',
                ].join(' ')}
              >
                <div className="text-sm font-bold">{option.title}</div>
                <div className="mt-1 text-xs text-muted">{option.hint}</div>
              </button>
            ))}
          </div>

          <div className="mt-6 rounded-2xl border border-white/10 bg-black/15 p-4">
            <div className="flex items-center gap-2 text-sm font-bold">
              <FiInfo className="text-gold" />
              <span>Submission rules</span>
            </div>
            {method === 'card' ? (
              <ul className="mt-2 space-y-1 text-xs text-muted list-disc pl-5">
                <li>Card details go straight to Stripe and are never stored by this app.</li>
                <li>The payment is recorded as paid only after Stripe confirms the charge.</li>
                <li>Cards are accepted online only; there is no card terminal at the field.</li>
              </ul>
            ) : (
              <ul className="mt-2 space-y-1 text-xs text-muted list-disc pl-5">
                <li>{method === 'gcash' ? 'The GCash reference number is required.' : 'The bank transaction or confirmation number is required.'}</li>
                <li>Upload a screenshot or photo of the receipt before submitting.</li>
                <li>A registrar verifies the payment before your reservation is confirmed.</li>
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
                <div className="mt-2 text-sm font-semibold text-text">
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
                  {gcashPhoneNumber ? (
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="text-xs uppercase tracking-widest text-muted">Send payment to</div>
                      <div className="mt-1 text-lg font-bold tracking-wide">{gcashPhoneNumber}</div>
                    </div>
                  ) : null}

                  {/* The player's own GCash number, kept separate from the shop's so typing never mixes the two. */}
                  <Input
                    label="Your GCash number (optional)"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, '').slice(0, 11))}
                    inputMode="numeric"
                    maxLength={11}
                    placeholder="e.g., 09171234567"
                    hint="The number you paid from, so staff can match your payment."
                    error={phoneNumber && !/^09\d{9}$/.test(phoneNumber) ? 'Enter an 11-digit mobile number starting with 09.' : undefined}
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
                </>
              ) : method === 'card' ? (
                <CardPaymentField onChange={setCardComplete} />
              ) : (
                <div className="rounded-2xl border border-dashed border-accent/30 bg-accent/5 p-4">
                  <div className="text-xs uppercase tracking-widest text-muted">Transfer to</div>
                  {bankDetails?.accountNumber ? (
                    <dl className="mt-3 grid gap-2 text-sm">
                      <div className="flex justify-between gap-3"><dt className="text-muted">Bank</dt><dd className="font-semibold">{bankDetails.bankName}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-muted">Account name</dt><dd className="font-semibold">{bankDetails.accountName}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-muted">Account number</dt><dd className="font-mono font-semibold">{bankDetails.accountNumber}</dd></div>
                    </dl>
                  ) : (
                    <div className="mt-3 text-xs text-muted">The admin has not added bank account details yet. Please use GCash or contact staff.</div>
                  )}
                </div>
              )}

              {method !== 'card' ? (
                <Input
                  label={method === 'gcash' ? 'GCash Reference Number' : 'Bank Reference / Confirmation Number'}
                  value={refNo}
                  onChange={(e) => setRefNo(e.target.value)}
                  placeholder={method === 'gcash' ? 'e.g., 1023 456 789012' : 'e.g., FT2610281234'}
                />
              ) : null}
            </div>

            {method !== 'card' ? (
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
                  <div className="text-xs font-bold">{METHOD_LABELS[method]}</div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="text-xs text-muted">Reference</div>
                  <div className="text-xs font-bold">{method === 'card' ? receiptReference || 'Issued by Stripe' : refNo || '—'}</div>
                </div>
                {method === 'gcash' ? (
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <div className="text-xs text-muted">Phone</div>
                    <div className="text-xs font-bold">{phoneNumber || '—'}</div>
                  </div>
                ) : null}
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
                  <div className="text-xs text-muted">{paysInFull ? 'Pay online now (full amount)' : 'Pay online now (downpayment)'}</div>
                  <div className="text-sm font-black text-gold">{formatPHP(amountDue || payerShareAmount || breakdown.total)}</div>
                </div>
                {!paysInFull ? (
                  <div className="mt-2 text-[11px] text-muted">The rest is paid in cash at the counter on game day.</div>
                ) : null}
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
                <FiCheck /> {method === 'card' ? 'Card Payment Confirmed' : 'Payment Submitted'}
              </div>
              <div className="mt-2 text-xs text-muted">
                {method === 'card'
                  ? 'Stripe confirmed the charge (test mode) and the payment was recorded.'
                  : `Your ${METHOD_LABELS[method]} proof has been submitted. The registrar/admin will review and verify it.`}
                {paymentMode === 'split'
                  ? ' Your teammates have been notified of their shares. Track who has paid under Split Payment in the menu — the slot stays reserved for 24 hours while the team pays.'
                  : ''}
              </div>

              <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted">Receipt</span>
                  <span className="text-xs font-bold">
                    {receiptReference || `ABP-RCPT-${refNo ? refNo.replace(/\W/g, '').slice(-6) : '000000'}`}
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
              <span className="text-muted">{balanceDue > 0 ? 'Downpayment paid online' : 'Paid online in full'}</span>
              <span className="font-bold text-accent">{formatPHP(amountDue || payerShareAmount || breakdown.total)}</span>
            </div>
            {balanceDue > 0 ? (
              <div className="flex items-center justify-between">
                <span className="text-muted">Balance: pay in cash at the field</span>
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