import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiGet, apiPost } from '../../utils/apiClient'
import toast from 'react-hot-toast'
import { useAuth } from '../../context/AuthContext'

import { motion } from 'framer-motion'
import { FiAlertTriangle, FiCheck, FiChevronRight, FiFileText, FiInfo, FiLock } from 'react-icons/fi'

import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { clearPackagePrefill } from '../../utils/packagePrefill'
import { StripeCardPayment } from '../../components/payments/StripeCardPayment'
import { openPaymentTab, sendToPaymentTab } from '../../utils/xendit'
import { cancelBookingDraftLeft, clearBookingDraft, hasBookingDraft, markBookingDraftLeft, readBookingDraft, saveBookingDraft, scheduleBookingDraftLeft } from '../../utils/bookingDraft'

// Players pay online with GCash or QR Ph (a demo payment page for the capstone, /app/payment/demo) or by
// card (Stripe). Both providers verify the payment themselves, so no staff check is needed and the
// booking is confirmed automatically. With the downpayment plan the rest is paid at the field
// (cash, GCash, or bank transfer).
type PaymentMethod = 'gcash' | 'qrph' | 'stripe'

const METHOD_LABELS: Record<PaymentMethod, string> = { gcash: 'GCash', qrph: 'QR Ph', stripe: 'Card (Stripe)' }

// Pay everything online, or the downpayment online and the rest at the field.
type PaymentPlan = 'full' | 'cash_balance'

type PaymentMode = 'self' | 'split'

type TeamMember = {
  id: string
  name: string
  email: string
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

function PaymentPageContent() {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [method, setMethod] = useState<PaymentMethod>('gcash')
  // GCash and QR Ph both go through the demo payment page (they used to go through Xendit).
  const isXendit = method !== 'stripe'
  // GCash and QR Ph are the demo payment page, which is always available: no provider to check.
  const xenditEnabled: boolean | null = true
  // Stripe card payments (test mode), shown next to the other methods when configured.
  const [stripeConfig, setStripeConfig] = useState<{ enabled: boolean; publishableKey: string }>({ enabled: false, publishableKey: '' })
  const [stripeSession, setStripeSession] = useState<{ clientSecret: string; paymentIntentId: string; reservationId: string; amount: number } | null>(null)
  useEffect(() => {
    apiGet<{ ok: boolean; enabled: boolean; publishableKey: string }>('/api/stripe/config')
      .then((res) => setStripeConfig({ enabled: Boolean(res?.enabled), publishableKey: res?.publishableKey || '' }))
      .catch(() => null)
  }, [])
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [breakdown, setBreakdown] = useState({ field: 0, equipment: 0, entranceFee: 0, service: 0, total: 0, itemized: [] as Array<{ label: string; amount: number }> })
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('self')
  const [paymentPlan, setPaymentPlan] = useState<PaymentPlan>('cash_balance')
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [isOwnGear, setIsOwnGear] = useState(false)
  // Set once the server amount is known after submitting.
  const [amountDue, setAmountDue] = useState(0)
  // Who pays and how can change until the reservation is created; then the server has fixed them.
  const [choicesLocked, setChoicesLocked] = useState(() => Boolean(localStorage.getItem('pending_reservation_id')))
  const canSplit = teamMembers.length > 0
  const showWhoPays = canSplit || paymentMode === 'split'
  const teamSize = paymentMode === 'split' ? teamMembers.length + 1 : 1
  const paysInFull = paymentPlan === 'full'
  // Estimate shown before submitting; the server recalculates the exact amount.
  const payerShareAmount = useMemo(() => {
    const total = breakdown.total
    const online = paysInFull ? total : isOwnGear ? Math.min(total, 350) : Math.min(total, Math.round(total * 0.5))
    return paymentMode === 'split' ? Math.round((online / teamSize) * 100) / 100 : online
  }, [breakdown.total, isOwnGear, paymentMode, paysInFull, teamSize])

  // Saves the choice into the booking draft, which is what gets sent when the reservation is created.
  const updateChoice = (changes: { paymentMode?: PaymentMode; paymentPlan?: PaymentPlan }) => {
    if (choicesLocked) return
    const nextMode = changes.paymentMode ?? paymentMode
    const nextPlan = changes.paymentPlan ?? paymentPlan
    setPaymentMode(nextMode)
    setPaymentPlan(nextPlan)
    try {
      const pending = JSON.parse(localStorage.getItem('pending_reservation') || 'null')
      if (!pending) return
      localStorage.setItem('pending_reservation', JSON.stringify({
        ...pending,
        paymentMode: nextMode,
        paymentPlan: nextPlan,
        teamSize: nextMode === 'split' ? teamMembers.length + 1 : 1,
      }))
    } catch {
      // ignore malformed pending data; submit() reports it
    }
  }
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
        // Children on the team don't pay, so they aren't part of a split.
        ? pendingReservation.teamMembers.filter((member: any) => !member?.isMinor).map((member: any) => ({
            id: String(member?.id || ''),
            name: String(member?.name || 'Unnamed player'),
            email: String(member?.email || ''),
          })).filter((member: TeamMember) => !!member.id)
        : []
      setIsOwnGear(String(pendingReservation?.selectionMode || '').toLowerCase() === 'custom' &&
        !(pendingReservation?.customWeaponIds?.length || pendingReservation?.customEquipmentIds?.length))
      setPaymentPlan(pendingReservation?.paymentPlan === 'full' ? 'full' : 'cash_balance')
      const itemized = Array.isArray(pendingReservation?.itemizedBreakdown)
        ? pendingReservation.itemizedBreakdown.map((item: any) => ({
            label: String(item?.label || 'Charge'),
            amount: Number(item?.amount || 0),
          }))
        : [
            { label: 'Field reservation', amount: field },
            { label: 'Weapons & gear', amount: equipment },
            { label: `Player entrance fee (${Number(pendingReservation?.numberOfPlayers || 1)} × ₱150)`, amount: entranceFee },
            { label: 'Service fee', amount: service },
          ]
      setBreakdown({ field, equipment, entranceFee, service, total, itemized })
      // Splitting needs at least one registered teammate.
      setPaymentMode(nextTeamMembers.length > 0 ? nextPaymentMode : 'self')
      setTeamMembers(nextTeamMembers)
    } catch {
      setBreakdown({ field: 0, equipment: 0, entranceFee: 0, service: 0, total: 0, itemized: [] })
      setPaymentMode('self')
      setTeamMembers([])
    }
  }, [])

  // Unfinished-booking draft (utils/bookingDraft): a player who left more than a minute ago lost
  // their slot and starts over; one who came back in time stops the countdown.
  const [draftExpired] = useState(() => {
    if (!user?.id || !hasBookingDraft(user.id)) return false
    const draft = readBookingDraft(user.id)
    if (!draft) return true
    saveBookingDraft(user.id, { path: '/app/payment', label: draft.label, state: {} })
    return false
  })
  useEffect(() => {
    if (!draftExpired) return
    localStorage.removeItem('pending_reservation')
    localStorage.removeItem('pending_reservation_id')
    toast.error('You were away for more than a minute, so the slot was released. Please book again.')
    navigate('/app/reservations', { replace: true })
  }, [draftExpired, navigate])

  // Leaving before paying keeps the slot for one more minute so the player can come back.
  const successRef = useRef(false)
  successRef.current = success
  useEffect(() => {
    cancelBookingDraftLeft()
    const leaving = () => !successRef.current && !draftExpired
    const onPageHide = () => { if (leaving()) markBookingDraftLeft(user?.id) }
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      if (leaving()) scheduleBookingDraftLeft(user?.id)
    }
  }, [user?.id, draftExpired])

  // Keep the slot locked until the reservation itself is created (which then holds the slot).
  useEffect(() => {
    if (success || draftExpired) return
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
  }, [success, draftExpired])

  // Card can't cover a split payment (or may not be set up): fall back to GCash.
  useEffect(() => {
    if (method === 'stripe' && !stripeSession && (paymentMode === 'split' || !stripeConfig.enabled)) setMethod('gcash')
  }, [method, paymentMode, stripeConfig.enabled, stripeSession])

  const canSubmit = useMemo(() => {
    if (submitting) return false
    if (isXendit) return xenditEnabled === true
    return !stripeSession && paymentMode !== 'split'
  }, [isXendit, submitting, stripeSession, paymentMode, xenditEnabled])

  const submit = async () => {
    setSubmitting(true)
    // GCash / QR Ph open in a new tab. It must be opened now, during the click: browsers block
    // tabs opened after waiting on the server.
    let payTab: Window | null = method !== 'stripe' ? openPaymentTab() : null
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

      // The choices made on this page are what the reservation is created with.
      pendingReservation = { ...pendingReservation, paymentMode, paymentPlan, teamSize }

      if (method === 'stripe' && paymentMode === 'split') throw new Error('Split payments are paid with GCash or QR Ph; card payment covers the whole amount.')
      if (isXendit && xenditEnabled !== true) throw new Error('Online payment is not available right now. Please try again later.')

      let reservationId = localStorage.getItem('pending_reservation_id') || ''
      let serverReservation: any
      if (!reservationId) {
        const reservationResult = await apiPost<{ ok: boolean; insertedId?: string; data?: any }>('/api/reservations', pendingReservation)
        reservationId = String(reservationResult?.data?.id ?? reservationResult?.insertedId ?? reservationResult?.data?._id ?? '')
        if (reservationId) localStorage.setItem('pending_reservation_id', reservationId)
        serverReservation = reservationResult?.data
      }
      setChoicesLocked(true)
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
      // The reservation's saved choices win (it may have been created on an earlier attempt).
      const serverMode: PaymentMode = String(serverReservation.paymentMode || 'self').toLowerCase() === 'split' ? 'split' : 'self'
      setPaymentMode(serverMode)
      if (serverReservation.paymentPlan === 'full' || serverReservation.paymentPlan === 'cash_balance') setPaymentPlan(serverReservation.paymentPlan)
      if (serverMode === 'split' && (!Number.isInteger(Number(serverReservation.teamSize)) || Number(serverReservation.teamSize) < 2)) {
        throw new Error('The server could not verify your group payment settings.')
      }
      const amount = serverMode === 'split'
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

      if (isXendit) {
        // Off to the (demo) payment page. The reservation now holds the slot, so the draft and the
        // pending booking data are no longer needed; the payment is verified when the player returns.
        const checkout = await apiPost<{ ok: boolean; data: { ref: string } }>('/api/demo-pay/checkout', { reservationId: String(reservationId), channel: method })
        successRef.current = true
        localStorage.removeItem('pending_reservation')
        localStorage.removeItem('pending_reservation_id')
        clearPackagePrefill()
        clearBookingDraft(user.id)
        sendToPaymentTab(payTab, checkout.data.ref, (url) => navigate(url))
        payTab = null
        return
      }
      // Card: the reservation now holds the slot; the card form below completes the payment.
      const intent = await apiPost<{ ok: boolean; clientSecret: string; paymentIntentId: string; amount: number }>('/api/create-payment-intent', { reservationId: String(reservationId) })
      setStripeSession({ clientSecret: intent.clientSecret, paymentIntentId: intent.paymentIntentId, reservationId: String(reservationId), amount: Number(intent.amount) })
    } catch (e: any) {
      payTab?.close()
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
        <p className="text-muted text-sm">
          Pay online with GCash, QR Ph, or a card. The payment is checked automatically and your reservation is confirmed as soon as it goes through. If you chose the downpayment, the rest is paid at the field by cash, GCash, or bank transfer.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_0.9fr]">
        <Card className="p-4 md:p-6">
          {/* Who pays only matters with teammates to split with; a solo booking skips it. */}
          {showWhoPays && (<>
          <div className="text-xs uppercase tracking-widest text-muted">Who pays</div>
          <p className="mt-1 text-xs text-muted">
            {choicesLocked ? 'These were saved with your reservation and can no longer be changed.' : 'Choose who pays for this reservation.'}
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {([
              ['self', "I'll pay for everyone", 'This player pays the full reservation.'],
              ['split', 'Split among the team', canSplit
                ? 'Divide the total equally among you and your selected teammates.'
                : 'Add at least one registered teammate when booking to split the payment.'],
            ] as const).map(([mode, title, description]) => (
              <button
                key={mode}
                type="button"
                disabled={choicesLocked || (mode === 'split' && !canSplit)}
                onClick={() => updateChoice({ paymentMode: mode })}
                className={[
                  'w-full rounded-2xl border px-4 py-3 text-left transition disabled:cursor-not-allowed',
                  paymentMode === mode ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25' : 'border-white/10 bg-white/5 hover:bg-white/8',
                  paymentMode !== mode && (choicesLocked || (mode === 'split' && !canSplit)) ? 'opacity-50' : '',
                ].join(' ')}
              >
                <div className="text-sm font-bold">{title}</div>
                <div className="mt-1 text-xs text-muted">{description}</div>
              </button>
            ))}
          </div>
          </>)}

          <div className={[showWhoPays ? 'mt-5' : '', 'text-xs uppercase tracking-widest text-muted'].join(' ')}>How you'll pay</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {([
              ['full', 'Pay in full online', 'Pay the whole amount now. Nothing to pay at the field.'],
              ['cash_balance', '50% online + rest at the field', 'Pay the 50% downpayment online now, then the rest at the counter on game day by cash, GCash, or bank transfer.'],
            ] as const).map(([plan, title, description]) => (
              <button
                key={plan}
                type="button"
                disabled={choicesLocked}
                onClick={() => updateChoice({ paymentPlan: plan })}
                className={[
                  'w-full rounded-2xl border px-4 py-3 text-left transition disabled:cursor-not-allowed',
                  paymentPlan === plan ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25' : 'border-white/10 bg-white/5 hover:bg-white/8',
                  paymentPlan !== plan && choicesLocked ? 'opacity-50' : '',
                ].join(' ')}
              >
                <div className="text-sm font-bold">{title}</div>
                <div className="mt-1 text-xs text-muted">{description}</div>
              </button>
            ))}
          </div>

          <div className="mt-6 flex items-center justify-between gap-3">
            <div className="text-xs uppercase tracking-widest text-muted">Payment method</div>
            <div className="hidden md:flex items-center gap-2 text-[11px] text-muted">
              <FiLock />
              <span>Secured submission</span>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {([
              { key: 'gcash', title: 'GCash', hint: 'Pay with your GCash app', unavailable: '' },
              { key: 'qrph', title: 'QR Ph', hint: 'Scan with any bank or e-wallet app', unavailable: '' },
              {
                key: 'stripe',
                title: 'Card',
                hint: 'Visa or Mastercard via Stripe',
                unavailable: !stripeConfig.enabled ? 'Not available right now' : paymentMode === 'split' ? 'Not for split payments' : '',
              },
            ] as Array<{ key: PaymentMethod; title: string; hint: string; unavailable: string }>).map((option) => (
              <button
                key={option.key}
                type="button"
                disabled={Boolean(stripeSession) || Boolean(option.unavailable)}
                onClick={() => setMethod(option.key)}
                className={[
                  'w-full text-left rounded-2xl border px-4 py-3 transition disabled:cursor-not-allowed disabled:opacity-50',
                  method === option.key
                    ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25'
                    : 'border-white/10 bg-white/5 hover:bg-white/8',
                ].join(' ')}
              >
                <div className="text-sm font-bold">{option.title}</div>
                <div className="mt-1 text-xs text-muted">{option.unavailable || option.hint}</div>
              </button>
            ))}
          </div>


          <div className="mt-6 rounded-2xl border border-white/10 bg-black/15 p-4">
            <div className="flex items-center gap-2 text-sm font-bold">
              <FiInfo className="text-gold" />
              <span>Submission rules</span>
            </div>
            {method === 'stripe' ? (
              <ul className="mt-2 space-y-1 text-xs text-muted list-disc pl-5">
                <li>Enter your card in Stripe's secure form. Card details go straight to Stripe and are never stored by Chill Shooters.</li>
                <li>Your reservation is confirmed automatically once the server verifies the payment with Stripe.</li>
                <li>Card payment covers the whole online amount; split payments are paid with GCash or QR Ph.</li>
                <li>Test mode: no real money is charged.</li>
              </ul>
            ) : (
              <ul className="mt-2 space-y-1 text-xs text-muted list-disc pl-5">
                <li>{method === 'qrph'
                  ? "You'll get a QR Ph code to scan with any bank or e-wallet app, then confirm the payment."
                  : "You'll get a GCash QR code and a GCash screen to send the payment."}</li>
                <li>Your reservation is confirmed automatically as soon as the payment goes through. No proof to upload and no staff review.</li>
                <li>Demo mode: no real money is sent. Any mobile number and MPIN work on the GCash screen.</li>
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
              {method === 'stripe' ? (
                stripeSession ? (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <StripeCardPayment
                      publishableKey={stripeConfig.publishableKey}
                      clientSecret={stripeSession.clientSecret}
                      paymentIntentId={stripeSession.paymentIntentId}
                      reservationId={stripeSession.reservationId}
                      amount={stripeSession.amount}
                      onPaid={(payment) => {
                        setReceiptReference(payment.id || stripeSession.paymentIntentId)
                        setAmountPaid(stripeSession.amount)
                        localStorage.removeItem('pending_reservation')
                        localStorage.removeItem('pending_reservation_id')
                        clearPackagePrefill()
                        if (user?.id) clearBookingDraft(user.id)
                        setSuccess(true)
                        toast.success('Card payment received. Your reservation is confirmed.')
                      }}
                    />
                  </div>
                ) : (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-xs text-muted">
                    Press Continue to card payment to save your reservation and open the secure card form.
                  </div>
                )
              ) : null}
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
              <div className="text-xs uppercase tracking-widest text-muted">Receipt Preview</div>
              <div className="mt-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-muted">Method</div>
                  <div className="text-xs font-bold">{METHOD_LABELS[method]}</div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="text-xs text-muted">Reference</div>
                  <div className="text-xs font-bold">{isXendit ? (method === 'qrph' ? 'Issued by QR Ph' : 'Issued by GCash') : 'Issued by Stripe'}</div>
                </div>
                <div className="mt-3 h-px bg-white/10" />
                {(breakdown.itemized.length > 0 ? breakdown.itemized : [
                  { label: 'Field reservation', amount: breakdown.field },
                  { label: 'Weapons & gear', amount: breakdown.equipment },
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
                  <div className="mt-2 text-[11px] text-muted">The rest is paid at the counter on game day by cash, GCash, or bank transfer.</div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button variant="primary" disabled={!canSubmit} onClick={submit}>
              {submitting ? (isXendit ? 'Opening payment…' : 'Submitting…') : success ? 'Paid' : isXendit ? 'Continue to payment' : 'Continue to card payment'}
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
                <FiCheck /> Payment Received
              </div>
              <div className="mt-2 text-xs text-muted">
                Your card payment was verified with Stripe and your reservation is confirmed.
                {paymentMode === 'split'
                  ? ' Your teammates have been notified of their shares. Track who has paid under Split Payment in the menu — the team has 24 hours to pay. Teammates who have not paid get reminders, and if not every share is in by then, the booking is released for anyone to take.'
                  : ''}
              </div>

              <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted">Receipt</span>
                  <span className="text-xs font-bold">
                    {receiptReference || '—'}
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
                <Button variant="ghost" onClick={() => navigate('/app/my-reservations')}>
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
              { label: 'Weapons & gear', amount: breakdown.equipment },
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
                <span className="text-muted">Balance: pay at the field (cash, GCash, or bank transfer)</span>
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
      <PaymentPageContent />
    </PaymentPageErrorBoundary>
  )
}