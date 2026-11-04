import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FiAlertTriangle, FiCheckCircle, FiChevronLeft, FiLoader, FiLock, FiX } from 'react-icons/fi'

import { apiGet, apiPost } from '../../utils/apiClient'
import { DEMO_PAY_CHANNEL } from '../../utils/xendit'

// Capstone demo of paying with GCash or QR Ph, opened in its own tab like a wallet app. Nothing
// is sent to a real wallet or bank: the screens are a mock, and pressing Pay asks our server to
// record the payment, which confirms the reservation exactly like a real online payment would.
// The tab that opened this one is told over a BroadcastChannel and moves on by itself.

type Channel = 'GCASH' | 'QRPH'
type Checkout = { ref: string; amount: number; channel: Channel; status: string; reservationId: string; reservationLabel: string }
type Stage = 'start' | 'confirm' | 'processing' | 'done'

const MERCHANT = 'Chill Shooters Airsoft'
const BANKS = ['GCash', 'Maya', 'BPI', 'BDO', 'UnionBank', 'Metrobank', 'LANDBANK', 'Security Bank']

const THEME: Record<Channel, { name: string; bg: string; brand: string; soft: string }> = {
  GCASH: { name: 'GCash', bg: 'linear-gradient(180deg,#0a6cff 0%,#0047c7 100%)', brand: '#0a5cff', soft: '#e8f0ff' },
  QRPH: { name: 'QR Ph', bg: 'linear-gradient(180deg,#22305a 0%,#121a33 100%)', brand: '#1f2a50', soft: '#eef1f8' },
}

const peso = (value: number) => `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function broadcast(message: { type: 'paid' | 'cancelled'; ref: string }) {
  if (typeof BroadcastChannel === 'undefined') return
  const channel = new BroadcastChannel(DEMO_PAY_CHANNEL)
  channel.postMessage(message)
  channel.close()
}

// A QR-looking code drawn from the payment reference (same ref, same picture). It is for show:
// scanning it does nothing, since no real payment is made.
function DemoQr({ seed, color }: { seed: string; color: string }) {
  const size = 29
  const cells = useMemo(() => {
    let h = 2166136261
    for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
    const next = () => {
      h ^= h << 13; h ^= h >>> 17; h ^= h << 5
      return (h >>> 0) / 4294967296
    }
    const grid: boolean[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => next() > 0.5))
    const finder = (r0: number, c0: number) => {
      for (let r = -1; r <= 7; r += 1) {
        for (let c = -1; c <= 7; c += 1) {
          const rr = r0 + r
          const cc = c0 + c
          if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue
          const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3))
          grid[rr][cc] = ring !== 2 && ring !== 4
        }
      }
    }
    finder(0, 0)
    finder(0, size - 7)
    finder(size - 7, 0)
    for (let i = 8; i < size - 8; i += 1) { grid[6][i] = i % 2 === 0; grid[i][6] = i % 2 === 0 }
    return grid
  }, [seed])

  return (
    <svg viewBox={`-2 -2 ${size + 4} ${size + 4}`} className="h-full w-full" role="img" aria-label="Payment QR code (demo)">
      <rect x={-2} y={-2} width={size + 4} height={size + 4} fill="#ffffff" />
      {cells.flatMap((row, r) => row.map((on, c) => (on ? <rect key={`${r}-${c}`} x={c} y={r} width={1.02} height={1.02} fill={color} /> : null)))}
    </svg>
  )
}

export function DemoPaymentPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const ref = params.get('ref') || ''
  const [checkout, setCheckout] = useState<Checkout | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [channel, setChannel] = useState<Channel>('GCASH')
  const [stage, setStage] = useState<Stage>('start')
  const [mobile, setMobile] = useState('')
  const [mpin, setMpin] = useState('')
  const [bank, setBank] = useState(BANKS[0])
  const [txnRef, setTxnRef] = useState('')
  const openedFromApp = typeof window !== 'undefined' && Boolean(window.opener)

  useEffect(() => {
    if (!ref) {
      setError('This page needs a payment reference.')
      return
    }
    apiGet<{ ok: boolean; data: Checkout }>(`/api/demo-pay/${encodeURIComponent(ref)}`)
      .then((res) => {
        setCheckout(res.data)
        setChannel(res.data.channel === 'QRPH' ? 'QRPH' : 'GCASH')
        if (res.data.status === 'paid') setStage('done')
      })
      .catch((e: any) => setError(e?.message || 'Could not load this payment.'))
  }, [ref])

  useEffect(() => {
    document.title = `${THEME[channel].name} · Pay ${MERCHANT}`
  }, [channel])

  // Done: the opening tab moves on by itself, so this tab closes. Opened directly (no opener),
  // it goes to the confirmation page instead.
  useEffect(() => {
    if (stage !== 'done') return
    const timer = window.setTimeout(() => {
      if (openedFromApp) window.close()
      else navigate(`/app/payment/complete?ref=${encodeURIComponent(ref)}`)
    }, 3000)
    return () => window.clearTimeout(timer)
  }, [stage, openedFromApp, navigate, ref])

  const pay = async () => {
    setStage('processing')
    setError(null)
    try {
      // A short pause so the mock feels like a wallet processing the transfer.
      await new Promise((resolve) => window.setTimeout(resolve, 1500))
      await apiPost(`/api/demo-pay/${encodeURIComponent(ref)}/pay`, { channel: channel === 'QRPH' ? 'qrph' : 'gcash' })
      setTxnRef(`${channel === 'GCASH' ? '9' : '7'}${Date.now().toString().slice(-12)}`)
      setStage('done')
      broadcast({ type: 'paid', ref })
    } catch (e: any) {
      setError(e?.message || 'The payment could not be completed.')
      setStage('confirm')
    }
  }

  const cancel = () => {
    broadcast({ type: 'cancelled', ref })
    if (openedFromApp) window.close()
    else navigate(`/app/payment/complete?ref=${encodeURIComponent(ref)}&cancelled=1`)
  }

  const theme = THEME[channel]
  const gcash = channel === 'GCASH'
  const mobileValid = /^09\d{9}$/.test(mobile)
  const mpinValid = /^\d{4}$/.test(mpin)
  const locked = stage === 'processing' || stage === 'done'

  return (
    <div className="min-h-screen w-full text-slate-900" style={{ background: theme.bg }}>
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-4 pb-8 pt-4">
        {/* Top bar like a wallet app */}
        <div className="flex items-center justify-between text-white">
          <button type="button" onClick={cancel} disabled={locked} className="rounded-full p-2 hover:bg-white/10 disabled:opacity-40" aria-label="Cancel payment">
            <FiChevronLeft className="h-6 w-6" />
          </button>
          <div className="text-xl font-black tracking-tight">{theme.name}</div>
          <button type="button" onClick={cancel} disabled={locked} className="rounded-full p-2 hover:bg-white/10 disabled:opacity-40" aria-label="Close">
            <FiX className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-2 rounded-full bg-yellow-300 px-3 py-1 text-center text-[11px] font-bold text-yellow-900">
          DEMO ONLY · no real money is sent
        </div>

        {error && !checkout ? (
          <div className="mt-6 rounded-3xl bg-white p-6 text-center shadow-xl">
            <FiAlertTriangle className="mx-auto h-10 w-10 text-red-500" />
            <div className="mt-3 text-lg font-bold">Payment unavailable</div>
            <p className="mt-1 text-sm text-slate-500">{error}</p>
          </div>
        ) : !checkout ? (
          <div className="mt-16 flex items-center justify-center gap-2 text-white"><FiLoader className="animate-spin" /> Loading…</div>
        ) : (
          <>
            {/* Method switch */}
            <div className="mt-4 grid grid-cols-2 gap-1 rounded-full bg-white/15 p-1" role="tablist" aria-label="Payment method">
              {(['GCASH', 'QRPH'] as Channel[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="tab"
                  aria-selected={channel === option}
                  disabled={locked}
                  onClick={() => { setChannel(option); setStage('start'); setError(null) }}
                  className={['rounded-full py-2 text-sm font-bold transition disabled:cursor-not-allowed', channel === option ? 'bg-white text-slate-900' : 'text-white/80 hover:text-white'].join(' ')}
                >
                  {THEME[option].name}
                </button>
              ))}
            </div>

            <div className="mt-4 overflow-hidden rounded-3xl bg-white shadow-2xl">
              {/* Merchant and amount */}
              <div className="px-5 pb-4 pt-5 text-center" style={{ background: theme.soft }}>
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-full text-lg font-black text-white" style={{ background: theme.brand }}>CS</div>
                <div className="mt-2 text-sm font-bold">{MERCHANT}</div>
                {checkout.reservationLabel ? <div className="text-[11px] text-slate-500">{checkout.reservationLabel}</div> : null}
                <div className="mt-2 text-3xl font-black">{peso(checkout.amount)}</div>
              </div>

              <div className="space-y-4 p-5 text-sm">
                {stage === 'start' && (
                  <>
                    <div className="mx-auto w-48">
                      <div className="aspect-square overflow-hidden rounded-2xl border-4 p-1" style={{ borderColor: theme.brand }}>
                        <DemoQr seed={`${checkout.ref}-${channel}`} color={gcash ? theme.brand : '#111827'} />
                      </div>
                      <div className="mt-2 text-center text-[11px] text-slate-500">
                        {gcash ? 'Scan to pay with GCash' : 'Scan with any bank or e-wallet app'}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 text-[11px] text-slate-400">
                      <div className="h-px flex-1 bg-slate-200" /> or pay here <div className="h-px flex-1 bg-slate-200" />
                    </div>

                    {gcash ? (
                      <>
                        <label className="block">
                          <span className="text-xs font-semibold text-slate-500">GCash mobile number</span>
                          <div className="mt-1 flex items-center rounded-xl border border-slate-300 focus-within:border-blue-500">
                            <span className="pl-3 text-slate-500">+63</span>
                            <input
                              value={mobile}
                              onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 11))}
                              placeholder="09XX XXX XXXX"
                              inputMode="numeric"
                              className="w-full rounded-xl px-2 py-2.5 outline-none"
                            />
                          </div>
                        </label>
                        <label className="block">
                          <span className="text-xs font-semibold text-slate-500">Enter your 4-digit MPIN</span>
                          <input
                            value={mpin}
                            onChange={(e) => setMpin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                            type="password"
                            inputMode="numeric"
                            placeholder="••••"
                            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-center text-lg tracking-[0.6em] outline-none focus:border-blue-500"
                          />
                        </label>
                        <button
                          type="button"
                          disabled={!mobileValid || !mpinValid}
                          onClick={() => setStage('confirm')}
                          className="w-full rounded-full py-3 font-bold text-white disabled:opacity-40"
                          style={{ background: theme.brand }}
                        >
                          Next
                        </button>
                        <p className="text-center text-[11px] text-slate-400">Demo: any number starting with 09 (11 digits) and any 4 digits.</p>
                      </>
                    ) : (
                      <>
                        <label className="block">
                          <span className="text-xs font-semibold text-slate-500">Pay from</span>
                          <select
                            value={bank}
                            onChange={(e) => setBank(e.target.value)}
                            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 outline-none"
                          >
                            {BANKS.map((name) => <option key={name}>{name}</option>)}
                          </select>
                        </label>
                        <button type="button" onClick={() => setStage('confirm')} className="w-full rounded-full py-3 font-bold text-white" style={{ background: theme.brand }}>
                          I scanned the QR
                        </button>
                      </>
                    )}
                  </>
                )}

                {(stage === 'confirm' || stage === 'processing') && (
                  <>
                    <div className="text-center text-xs font-semibold uppercase tracking-wider text-slate-500">Confirm payment</div>
                    <div className="space-y-2 rounded-2xl bg-slate-50 p-4 text-xs">
                      <div className="flex justify-between"><span className="text-slate-500">Pay to</span><span className="font-semibold">{MERCHANT}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">From</span><span className="font-semibold">{gcash ? `GCash ${mobile.slice(0, 4)} ••• ${mobile.slice(-4)}` : bank}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Amount</span><span className="font-semibold">{peso(checkout.amount)}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Fee</span><span className="font-semibold">₱0.00</span></div>
                      <div className="h-px bg-slate-200" />
                      <div className="flex justify-between text-sm"><span className="font-bold">Total</span><span className="font-black">{peso(checkout.amount)}</span></div>
                    </div>
                    {error ? <div className="rounded-xl bg-red-50 p-3 text-xs text-red-700">{error}</div> : null}
                    <button
                      type="button"
                      disabled={stage === 'processing'}
                      onClick={() => void pay()}
                      className="flex w-full items-center justify-center gap-2 rounded-full py-3 font-bold text-white disabled:opacity-70"
                      style={{ background: theme.brand }}
                    >
                      {stage === 'processing' ? <><FiLoader className="animate-spin" /> Processing…</> : `Pay ${peso(checkout.amount)}`}
                    </button>
                    {stage === 'confirm' ? (
                      <button type="button" onClick={() => setStage('start')} className="w-full text-center text-xs font-semibold text-slate-500">Back</button>
                    ) : null}
                  </>
                )}

                {stage === 'done' && (
                  <div className="py-4 text-center">
                    <FiCheckCircle className="mx-auto h-14 w-14 text-green-500" />
                    <div className="mt-3 text-lg font-black">Payment successful</div>
                    <div className="text-3xl font-black">{peso(checkout.amount)}</div>
                    <div className="mt-1 text-xs text-slate-500">sent to {MERCHANT}</div>
                    <div className="mt-4 space-y-1 rounded-2xl bg-slate-50 p-3 text-left text-xs">
                      {txnRef ? <div className="flex justify-between"><span className="text-slate-500">Ref. No.</span><span className="font-semibold">{txnRef}</span></div> : null}
                      <div className="flex justify-between"><span className="text-slate-500">Date</span><span className="font-semibold">{new Date().toLocaleString('en-PH')}</span></div>
                    </div>
                    <div className="mt-4 text-xs text-slate-500">
                      {openedFromApp ? 'Your booking tab has been updated. This tab closes by itself.' : 'Taking you back to Chill Shooters…'}
                    </div>
                    {openedFromApp ? (
                      <button type="button" onClick={() => window.close()} className="mt-3 w-full rounded-full py-3 font-bold text-white" style={{ background: theme.brand }}>
                        Close
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-white/70">
              <FiLock /> Demo checkout · no wallet or bank details are stored
            </div>
          </>
        )}
      </div>
    </div>
  )
}
