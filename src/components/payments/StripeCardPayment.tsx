import React, { useMemo, useState } from 'react'
import { loadStripe, type Stripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { FiLock } from 'react-icons/fi'
import { Button } from '../ui/Button'
import { apiPost } from '../../utils/apiClient'

// Test-mode Stripe card form for a reservation's online payment. The card is entered in Stripe's
// own fields (the server never sees card numbers); after Stripe confirms, the server re-checks the
// PaymentIntent against the reservation and records the payment.

const stripePromises = new Map<string, Promise<Stripe | null>>()
function stripeFor(publishableKey: string) {
  if (!stripePromises.has(publishableKey)) stripePromises.set(publishableKey, loadStripe(publishableKey))
  return stripePromises.get(publishableKey)!
}

type Props = {
  publishableKey: string
  clientSecret: string
  paymentIntentId: string
  reservationId: string
  amount: number
  onPaid: (payment: { id?: string }) => void
}

function CardForm({ paymentIntentId, reservationId, amount, onPaid }: Omit<Props, 'publishableKey' | 'clientSecret'>) {
  const stripe = useStripe()
  const elements = useElements()
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState('')

  const pay = async () => {
    if (!stripe || !elements) return
    setPaying(true)
    setError('')
    try {
      const result = await stripe.confirmPayment({ elements, redirect: 'if_required' })
      if (result.error) throw new Error(result.error.message || 'The card payment did not go through.')
      if (result.paymentIntent?.status !== 'succeeded') throw new Error(`Payment is ${result.paymentIntent?.status || 'not complete'}. Try another card.`)
      const confirmed = await apiPost<{ ok: boolean; data: { id?: string } }>('/api/payments/stripe-confirm', { reservationId, paymentIntentId })
      onPaid(confirmed.data || {})
    } catch (err: any) {
      setError(err?.message || 'The card payment did not go through.')
    } finally {
      setPaying(false)
    }
  }

  return (
    <div className="space-y-3">
      <PaymentElement options={{ layout: 'tabs' }} />
      {error ? <div className="rounded-xl border border-danger/20 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div> : null}
      <Button className="w-full" onClick={pay} disabled={!stripe || paying}>
        <FiLock /> {paying ? 'Processing…' : `Pay ₱${amount.toLocaleString()} by card`}
      </Button>
      <div className="text-[11px] text-muted">Test mode: use card 4242 4242 4242 4242, any future date, any CVC. No real money is charged.</div>
    </div>
  )
}

export function StripeCardPayment({ publishableKey, clientSecret, ...rest }: Props) {
  const stripePromise = useMemo(() => stripeFor(publishableKey), [publishableKey])
  return (
    <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'night' } }}>
      <CardForm {...rest} />
    </Elements>
  )
}
