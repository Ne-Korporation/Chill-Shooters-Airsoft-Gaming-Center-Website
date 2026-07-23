import React, { useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  FiAlertTriangle,
  FiCheck,
  FiChevronRight,
  FiShield,
  FiUser,
} from 'react-icons/fi'



import { Card } from '../../components/ui/Card'

import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { apiPost } from '../../utils/apiClient'
import { useAuth } from '../../context/AuthContext'

type WaiverState = {
  fullName: string
  age: number
  guardianName: string
  guardianConsent: boolean
  consent: boolean
  termsAccepted: boolean
}

type SignaturePoint = { x: number; y: number }

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function drawStroke(ctx: CanvasRenderingContext2D, pts: SignaturePoint[]) {
  if (pts.length < 2) return
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  ctx.stroke()
}

export function WaiverPage({
  variant = 'full',
  onSubmitted,
}: {
  variant?: 'full' | 'embedded'
  onSubmitted?: () => void
}) {
  const [state, setState] = useState<WaiverState>({
    fullName: '',
    age: 16,
    guardianName: '',
    guardianConsent: false,
    consent: false,
    termsAccepted: false,
  })
  const [ageInput, setAgeInput] = useState('16')

  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [hasSignature, setHasSignature] = useState(false)
  const { user } = useAuth()

  const isMinor = state.age < 18

  const errors = useMemo(() => {
    const e: Record<string, string> = {}
    if (!state.fullName.trim()) e.fullName = 'Full name is required.'
    if (!Number.isFinite(state.age) || state.age <= 0) e.age = 'Enter a valid age.'

    if (isMinor) {
      if (!state.guardianName.trim()) e.guardianName = 'Guardian name is required for minors.'
      if (!state.guardianConsent) e.guardianConsent = 'Guardian consent is required.'
    }

    if (!state.termsAccepted) e.termsAccepted = 'You must accept the terms to continue.'
    if (!state.consent) e.consent = 'Consent acknowledgement is required.'
    if (!hasSignature) e.signature = 'Signature is required.'

    return e
  }, [hasSignature, isMinor, state])

  const canSubmit = Object.keys(errors).length === 0 && !submitting

  const scrollToPayment = () => {
    const paymentSection = document.getElementById('payment-section')
    if (paymentSection) {
      paymentSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  // signature capture
  const strokeRef = useRef<SignaturePoint[]>([])
  const drawingRef = useRef(false)

  const getCtx = () => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    return ctx
  }

  const setupCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    // HiDPI scaling
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    const w = Math.max(320, rect.width)
    const h = Math.max(160, rect.height)

    canvas.width = Math.floor(w * dpr)
    canvas.height = Math.floor(h * dpr)

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // background
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = 'rgba(255,255,255,0.03)'
    ctx.fillRect(0, 0, w, h)

    ctx.strokeStyle = 'rgba(197,163,90,0.95)'
    ctx.lineWidth = 2.4
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = clamp(e.clientX - rect.left, 0, rect.width)
    const y = clamp(e.clientY - rect.top, 0, rect.height)

    const ctx = getCtx()
    if (!ctx) return

    drawingRef.current = true
    strokeRef.current = [{ x, y }]
    setHasSignature(false)

    // Start path dot
    ctx.beginPath()
    ctx.arc(x, y, 0.8, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(197,163,90,0.95)'
    ctx.fill()
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()

    const x = clamp(e.clientX - rect.left, 0, rect.width)
    const y = clamp(e.clientY - rect.top, 0, rect.height)

    strokeRef.current.push({ x, y })

    const ctx = getCtx()
    if (!ctx) return

    const pts = strokeRef.current
    if (pts.length >= 2) {
      // Incremental drawing
      const lastTwo = pts.slice(-2)
      drawStroke(ctx, lastTwo)
    }
  }

  const handlePointerUp = () => {
    if (!drawingRef.current) return
    drawingRef.current = false
    setHasSignature(strokeRef.current.length >= 2)
  }

  const clearSignature = () => {
    setupCanvas()
    strokeRef.current = []
    setHasSignature(false)
  }

  const [termsOpen, setTermsOpen] = useState(true)

  const waiverText = useMemo(() => {
    return {
      general: [
        'I understand that airsoft activity involves risks including, but not limited to, injury and property damage.',
        'I agree to follow marshals’ instructions, safety rules, and field procedures at all times.',
        'I acknowledge that protective gear is mandatory and that non-compliance may result in removal from the field.',
      ],
      minor: [
        'As a parent/guardian, I provide consent for my minor to participate.',
        'I understand the same safety requirements apply and agree to uphold compliance.',
      ],
      acknowledgment: [
        'I acknowledge that I have read and understood the waiver terms above.',
        'I confirm that my signature is voluntary and for the session I am reserving.',
      ],
    }
  }, [])

  const onSubmit = async () => {
    setSubmitting(true)
    try {
      await apiPost('/api/waivers', {
        id: `WAIV-${Date.now()}`,
        userId: user?.id || '',
        reservationId: localStorage.getItem('active_reservation_id') || '',
        fullName: state.fullName.trim(),
        age: state.age,
        guardianName: state.guardianName.trim(),
        guardianConsent: state.guardianConsent,
        consent: state.consent,
        termsAccepted: state.termsAccepted,
        isMinor,
        hasSignature,
        status: 'pending',
        submittedAtISO: new Date().toISOString(),
        createdAtISO: new Date().toISOString(),
      })
      setSubmitted(true)
      try {
        localStorage.setItem('waiver_submitted', '1')
      } catch (e) {
        // ignore
      }
      if (onSubmitted) onSubmitted()
    } finally {
      setSubmitting(false)
    }
  }

  const isEmbedded = variant === 'embedded'

  return (
    <div className={['space-y-4', isEmbedded ? 'max-w-none' : ''].filter(Boolean).join(' ')}>
      {!isEmbedded ? (
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-xs text-muted border border-white/5">
            <span className="h-2.5 w-2.5 rounded-full bg-accent" />
            <span className="uppercase tracking-[0.18em]">Waiver</span>
          </div>
          <h1 className="text-3xl font-bold">Online Waiver</h1>
          <p className="text-muted text-sm">Digital waiver with signature pad + guardian consent (prototype only).</p>
        </div>
      ) : null}


      <div className={['grid gap-4', isEmbedded ? '' : 'lg:grid-cols-3'].filter(Boolean).join(' ')}>
        <div className="lg:col-span-2 space-y-4">
          <Card className="p-4 md:p-6">
            <div className="flex items-center gap-2 text-sm font-bold">
              <FiShield /> <span>Participant Details</span>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <Input
                label="Full Name"
                placeholder="e.g., Ramil Santos"
                value={state.fullName}
                onChange={(e) => setState((s) => ({ ...s, fullName: e.target.value }))}
                error={errors.fullName}
              />

              <Input
                label="Age"
                type="number"
                min={1}
                inputMode="numeric"
                value={ageInput}
                onChange={(e) => {
                  const raw = e.target.value
                  if (raw === '') {
                    setAgeInput('')
                    setState((s) => ({ ...s, age: 0 }))
                    return
                  }

                  if (!/^\d+$/.test(raw)) return

                  const nextValue = Number(raw)
                  setAgeInput(raw)
                  setState((s) => ({ ...s, age: nextValue }))
                }}
                onBlur={() => {
                  const currentValue = Number(ageInput)
                  if (!ageInput || Number.isNaN(currentValue) || currentValue <= 0) {
                    setAgeInput('1')
                    setState((s) => ({ ...s, age: 1 }))
                    return
                  }

                  const safeValue = clamp(currentValue, 1, 120)
                  setAgeInput(String(safeValue))
                  setState((s) => ({ ...s, age: safeValue }))
                }}
                error={errors.age}
              />
            </div>

            {isMinor ? (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="mt-5 rounded-2xl border border-danger/25 bg-danger/10 p-4"
              >
                <div className="flex items-center gap-2 text-sm font-bold text-danger">
                  <FiAlertTriangle /> <span>Minor Consent Required</span>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <Input
                    label="Guardian Name"
                    placeholder="e.g., Maria Santos"
                    value={state.guardianName}
                    onChange={(e) => setState((s) => ({ ...s, guardianName: e.target.value }))}
                    error={errors.guardianName}
                  />

                  <div className="flex items-end">
                    <label className="w-full rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={state.guardianConsent}
                          onChange={(e) => setState((s) => ({ ...s, guardianConsent: e.target.checked }))}
                          className="mt-1 h-4 w-4"
                        />
                        <div>
                          <div className="text-sm font-bold">I confirm guardian consent</div>
                          {errors.guardianConsent ? (
                            <div className="mt-1 text-xs font-semibold text-danger">{errors.guardianConsent}</div>
                          ) : (
                            <div className="mt-1 text-xs text-muted">Required to submit waiver.</div>
                          )}
                        </div>
                      </div>
                    </label>
                  </div>
                </div>
              </motion.div>
            ) : null}

            <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-bold flex items-center gap-2">
                    <FiUser /> <span>Consent Acknowledgements</span>
                  </div>
                  <div className="mt-1 text-xs text-muted">Required confirmations before signature submission.</div>
                </div>
                <button
                  type="button"
                  onClick={() => setTermsOpen((v) => !v)}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-muted hover:bg-white/8 transition"
                >
                  {termsOpen ? 'Hide terms' : 'Show terms'}
                </button>
              </div>

              {termsOpen ? (
                <div className="mt-4 grid gap-3">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">General Terms</div>
                    <ul className="mt-2 list-disc space-y-2 pl-5 text-xs text-muted">
                      {waiverText.general.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  </div>

                  {isMinor ? (
                    <div>
                      <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Guardian Consent</div>
                      <ul className="mt-2 list-disc space-y-2 pl-5 text-xs text-muted">
                        {waiverText.minor.map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div>
                    <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Acknowledgement</div>
                    <ul className="mt-2 list-disc space-y-2 pl-5 text-xs text-muted">
                      {waiverText.acknowledgment.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={state.termsAccepted}
                      onChange={(e) => setState((s) => ({ ...s, termsAccepted: e.target.checked }))}
                      className="mt-1 h-4 w-4"
                    />
                    <div>
                      <div className="text-sm font-bold">Accept terms & safety rules</div>
                      {errors.termsAccepted ? (
                        <div className="mt-1 text-xs font-semibold text-danger">{errors.termsAccepted}</div>
                      ) : (
                        <div className="mt-1 text-xs text-muted">Required.</div>
                      )}
                    </div>
                  </div>
                </label>

                <label className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={state.consent}
                      onChange={(e) => setState((s) => ({ ...s, consent: e.target.checked }))}
                      className="mt-1 h-4 w-4"
                    />
                    <div>
                      <div className="text-sm font-bold">Consent acknowledgement</div>
                      {errors.consent ? (
                        <div className="mt-1 text-xs font-semibold text-danger">{errors.consent}</div>
                      ) : (
                        <div className="mt-1 text-xs text-muted">Required.</div>
                      )}
                    </div>
                  </div>
                </label>
              </div>
            </div>
          </Card>

          <Card className="p-4 md:p-6">
            <div className="flex items-center gap-2 text-sm font-bold">
              <span className="grid h-10 w-10 place-items-center rounded-2xl bg-accent/10 ring-1 ring-accent/25">
                <FiUser className="text-gold" />
              </span>
              <span>Digital Signature</span>
            </div>

            <p className="mt-1 text-xs text-muted">Draw inside the box. This is a prototype signature pad using canvas.</p>

            <div className="mt-4">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
                  <canvas
                    ref={canvasRef}
                    className="h-48 w-full touch-none"
                    onPointerDown={(e) => {
                      setupCanvas()
                      handlePointerDown(e)
                    }}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                    onPointerLeave={handlePointerUp}
                  />
                </div>

                {errors.signature ? (
                  <div className="mt-2 text-xs font-semibold text-danger flex items-center gap-2">
                    <FiAlertTriangle /> <span>{errors.signature}</span>
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-muted flex items-center gap-2">
                    {hasSignature ? <FiCheck className="text-success" /> : <FiChevronRight className="text-muted" />}
                    <span>{hasSignature ? 'Signature captured.' : 'Waiting for signature input.'}</span>
                  </div>
                )}

                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <Button variant="ghost" onClick={clearSignature} disabled={submitting || submitted}>
                    Clear
                  </Button>
                  <div className="text-[11px] text-muted">
                    TIP: Use finger on mobile or mouse on desktop.
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <Button
                variant="primary"
                disabled={!canSubmit}
                onClick={onSubmit}
              >
                {submitting ? 'Submitting…' : submitted ? 'Submitted' : 'Submit Waiver'}
                <FiChevronRight />
              </Button>

              {isEmbedded ? (
                <Button variant="ghost" disabled={!submitted} onClick={scrollToPayment}>
                  Proceed to Payment
                  <FiChevronRight />
                </Button>
              ) : null}
            </div>

            {submitted ? (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="mt-4 rounded-2xl border border-success/25 bg-success/10 p-4"
              >
                <div className="flex items-center gap-2 text-sm font-bold text-success">
                  <FiCheck /> <span>Waiver accepted</span>
                </div>
                <div className="mt-2 text-xs text-muted">
                  Reservation complete. Please wait for verification.
                </div>
              </motion.div>
            ) : null}

          </Card>

        </div>

        <div className="lg:col-span-1 space-y-4">
          <Card className="p-4 md:p-6">
            <div className="flex items-center gap-2 text-sm font-bold">
              <FiShield /> <span>Submission Readiness</span>
            </div>

            <div className="mt-4 space-y-3">
              {[
                { label: 'Participant name', ok: !!state.fullName.trim() },
                { label: 'Age provided', ok: Number.isFinite(state.age) && state.age > 0 },
                { label: 'Terms accepted', ok: state.termsAccepted },
                { label: 'Consent acknowledged', ok: state.consent },
                { label: 'Signature captured', ok: hasSignature },
                ...(isMinor ? [{ label: 'Guardian consent', ok: state.guardianConsent }] : []),
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="text-xs font-bold text-muted">{item.label}</div>
                  <div className={['text-xs font-bold rounded-xl px-3 py-1', item.ok ? 'bg-success/15 text-success' : 'bg-white/5 text-muted'].join(' ')}>
                    {item.ok ? 'OK' : 'WAIT'}
                  </div>
                </div>
              ))}
            </div>

            {!canSubmit && !submitted ? (
              <div className="mt-4 rounded-2xl border border-danger/25 bg-danger/10 p-4">
                <div className="flex items-start gap-2 text-sm font-bold text-danger">
                  <FiAlertTriangle className="mt-0.5" /> <span>Incomplete submission</span>
                </div>
                <div className="mt-2 text-xs text-muted">Fill missing fields and provide signature to enable the submit button.</div>
              </div>
            ) : null}
          </Card>

          <Card className="p-4 md:p-6">
            <div className="text-xs uppercase tracking-widest text-muted">What’s next</div>
            <div className="mt-3 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-accent/10 ring-1 ring-accent/25">
                <FiChevronRight className="text-gold" />
              </div>
              <div>
                <div className="text-sm font-bold">Waiver → Payment</div>
                <div className="mt-1 text-xs text-muted">After acceptance, continue to GCash/bank transfer.</div>
              </div>
            </div>
          </Card>
        </div>
        </div>

       
      </div>
  )
}


