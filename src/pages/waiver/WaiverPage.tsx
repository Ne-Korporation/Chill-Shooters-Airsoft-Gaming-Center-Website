import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import {
  FiAlertTriangle,
  FiCheck,
  FiChevronRight,
  FiPrinter,
  FiShield,
  FiUser,
  FiX,
} from 'react-icons/fi'



import { Card } from '../../components/ui/Card'

import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { apiGet, apiPost } from '../../utils/apiClient'
import { useAuth } from '../../context/AuthContext'
import { sendRoleNotifications, useNotifications } from '../../context/NotificationContext'

type WaiverState = {
  fullName: string
  age: number
  guardianName: string
  guardianConsent: boolean
  consent: boolean
  termsAccepted: boolean
}

type SignaturePoint = { x: number; y: number }

type SubmittedWaiver = {
  id?: string
  _id?: string
  userId?: string
  reservationId?: string
  fullName?: string
  age?: number
  guardianName?: string
  guardianConsent?: boolean
  consent?: boolean
  termsAccepted?: boolean
  isMinor?: boolean
  hasSignature?: boolean
  status?: string
  submittedAtISO?: string
  createdAtISO?: string
}

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
  const [waiverStatus, setWaiverStatus] = useState<string | undefined>()
  const [submittedWaiver, setSubmittedWaiver] = useState<SubmittedWaiver | null>(null)
  const [viewWaiverOpen, setViewWaiverOpen] = useState(false)
  const [viewWaiverLoading, setViewWaiverLoading] = useState(false)
  const [viewWaiverError, setViewWaiverError] = useState<string | null>(null)
  const [viewWaiverInfo, setViewWaiverInfo] = useState<string | null>(null)
  const [checkingSubmission, setCheckingSubmission] = useState(true)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [hasSignature, setHasSignature] = useState(false)
  const { user } = useAuth()
  const { addNotification } = useNotifications()

  const waiverStorageKey = user?.id ? `waiver_submitted:${user.id}` : ''
  const waiverIdKey = user?.id ? `last_waiver_id:${user.id}` : ''

  useEffect(() => {
    if (!user?.id) {
      setCheckingSubmission(false)
      return
    }

    let cancelled = false
    setCheckingSubmission(true)
    const localWaiverId = waiverIdKey ? localStorage.getItem(waiverIdKey) : null
    const reservationId = localStorage.getItem('active_reservation_id') || null

    const matchesCurrentUser = (waiver?: SubmittedWaiver) => {
      if (!waiver) return false
      if (!user?.id) return false
      return String(waiver.userId) === String(user.id)
    }

    const loadWaiver = async () => {
      try {
        const candidates: SubmittedWaiver[] = []

        if (localWaiverId) {
          const response = await apiGet<{ ok: boolean; data: SubmittedWaiver }>(`/api/waivers/${encodeURIComponent(localWaiverId)}`)
          if (response?.data) candidates.push(response.data)
        }

        if (user?.id) {
          const response = await apiGet<{ ok: boolean; data: SubmittedWaiver[] }>(
            `/api/waivers?q=${encodeURIComponent(JSON.stringify({ userId: user.id }))}&limit=200`,
          )
          if (Array.isArray(response?.data)) candidates.push(...response.data)
        }

        if (reservationId) {
          const response = await apiGet<{ ok: boolean; data: SubmittedWaiver[] }>(
            `/api/waivers?q=${encodeURIComponent(JSON.stringify({ reservationId }))}&limit=200`,
          )
          if (Array.isArray(response?.data)) candidates.push(...response.data)
        }

        const existingWaiver = candidates
          .filter(matchesCurrentUser)
          .filter(Boolean)
          .sort((a, b) => {
            const aDate = String(a.submittedAtISO || a.createdAtISO || '')
            const bDate = String(b.submittedAtISO || b.createdAtISO || '')
            return bDate.localeCompare(aDate)
          })[0] || null

        if (!cancelled) {
          if (existingWaiver) {
            setState((current) => ({
              ...current,
              fullName: existingWaiver.fullName || current.fullName,
              age: existingWaiver.age || current.age,
              guardianName: existingWaiver.guardianName || current.guardianName,
              guardianConsent: Boolean(existingWaiver.guardianConsent),
              consent: Boolean(existingWaiver.consent),
              termsAccepted: Boolean(existingWaiver.termsAccepted),
            }))
            setAgeInput(String(existingWaiver.age || 16))
            setHasSignature(Boolean(existingWaiver.hasSignature))
            setWaiverStatus(existingWaiver.status)
            setSubmittedWaiver(existingWaiver)
            setSubmitted(true)
            if (waiverStorageKey) localStorage.setItem(waiverStorageKey, '1')
            if (waiverIdKey && existingWaiver.id) localStorage.setItem(waiverIdKey, existingWaiver.id)
          } else {
            setSubmitted(false)
            setWaiverStatus(undefined)
            setSubmittedWaiver(null)
            if (waiverStorageKey) localStorage.removeItem(waiverStorageKey)
            if (waiverIdKey) localStorage.removeItem(waiverIdKey)
          }
        }
      } catch (error) {
        if (!cancelled) setSubmitted(false)
      } finally {
        if (!cancelled) setCheckingSubmission(false)
      }
    }

    loadWaiver()

    return () => {
      cancelled = true
    }
  }, [user?.id, waiverIdKey, waiverStorageKey])

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
    if (submitted) return
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
    if (submitted || submitting) return
    setSubmitting(true)
    try {
      const response = await apiPost<{ ok: boolean; insertedId: string; data: SubmittedWaiver }>('/api/waivers', {
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
      sendRoleNotifications(addNotification, {
        roles: ['admin', 'registrar', 'marshal'],
        type: 'waiver_submitted',
        title: 'New Waiver Submitted',
        message: `A new waiver was submitted by ${user?.name || user?.id || 'a player'}.`,
        linkedResourceId: response?.data?.id,
      })

      setSubmitted(true)
      setWaiverStatus(response?.data?.status)
      setSubmittedWaiver(response?.data || null)
      try {
        if (waiverStorageKey) localStorage.setItem(waiverStorageKey, '1')
        if (waiverIdKey && response?.data?.id) localStorage.setItem(waiverIdKey, response.data.id)
      } catch (e) {
        // ignore
      }
      if (onSubmitted) onSubmitted()
    } finally {
      setSubmitting(false)
    }
  }

  const isEmbedded = variant === 'embedded'

  const loadSubmittedWaiver = async () => {
    if (submittedWaiver) return submittedWaiver

    const localWaiverId = waiverIdKey ? localStorage.getItem(waiverIdKey) : null
    const reservationId = localStorage.getItem('active_reservation_id') || null

    const tryFetchByQuery = async (query: Record<string, string>) => {
      const response = await apiGet<{ ok: boolean; data: SubmittedWaiver[] }>(
        `/api/waivers?q=${encodeURIComponent(JSON.stringify(query))}&limit=1`,
      )
      return response.data?.[0] || null
    }

    try {
      const matchesCurrentUser = (waiver?: SubmittedWaiver) => {
        if (!waiver) return false
        if (!user?.id) return false
        return String(waiver.userId) === String(user.id)
      }

      if (localWaiverId) {
        const response = await apiGet<{ ok: boolean; data: SubmittedWaiver }>(`/api/waivers/${encodeURIComponent(localWaiverId)}`)
        if (response.data && matchesCurrentUser(response.data)) {
          setSubmittedWaiver(response.data)
          return response.data
        }
      }

      if (user?.id) {
        const existingWaiver = await tryFetchByQuery({ userId: user.id })
        if (existingWaiver) {
          setSubmittedWaiver(existingWaiver)
          return existingWaiver
        }
      }

      if (reservationId) {
        const existingWaiver = await tryFetchByQuery({ reservationId })
        if (existingWaiver && matchesCurrentUser(existingWaiver)) {
          setSubmittedWaiver(existingWaiver)
          return existingWaiver
        }
      }
    } catch (error) {
      // ignore
    }

    return null
  }

  const handleViewWaiver = async () => {
    if (viewWaiverLoading) return
    console.log('handleViewWaiver clicked', { submitted, submittedWaiver, checkingSubmission, viewWaiverLoading })
    setViewWaiverError(null)
    setViewWaiverInfo('Clicked — loading your waiver...')
    setViewWaiverLoading(true)
    try {
      const waiver = await loadSubmittedWaiver()
      if (waiver) {
        setViewWaiverOpen(true)
        setViewWaiverInfo(null)
      } else {
        setViewWaiverError('Unable to load your submitted waiver. Please refresh the page or contact support.')
        setViewWaiverInfo(null)
      }
    } finally {
      setViewWaiverLoading(false)
    }
  }

  const printWaiver = () => {
    if (!submitted || checkingSubmission) return
    const clearPrintState = () => document.body.classList.remove('printing-waiver')
    document.body.classList.add('printing-waiver')
    window.addEventListener('afterprint', clearPrintState, { once: true })
    window.print()
  }

  return (
    <div className={['waiver-page space-y-4', submitted ? 'submitted-waiver' : '', isEmbedded ? 'max-w-none' : ''].filter(Boolean).join(' ')}>
      {!isEmbedded ? (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-xs text-muted border border-white/5">
                <span className="h-2.5 w-2.5 rounded-full bg-accent" />
                <span className="uppercase tracking-[0.18em]">Waiver</span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-bold">Online Waiver</h1>
                {waiverStatus ? (
                (() => {
                  const normalizedStatus = String(waiverStatus).trim().toLowerCase()
                  const isApproved = normalizedStatus === 'approved'
                  const isDenied = normalizedStatus === 'denied'
                  return (
                    <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${isApproved ? 'border-success/30 bg-success/10 text-success' : isDenied ? 'border-danger/30 bg-danger/10 text-danger' : 'border-accent/30 bg-accent/10 text-accent'}`}>
                      {isApproved ? 'Approved' : isDenied ? 'Denied' : 'Pending'}
                    </span>
                  )
                })()
              ) : null}
              </div>
              <p className="text-muted text-sm">Digital waiver with signature pad + guardian consent (prototype only).</p>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="ghost" disabled={viewWaiverLoading} onClick={handleViewWaiver}>
                <FiPrinter />
                {viewWaiverLoading ? 'Loading waiver…' : 'View my waiver'}
              </Button>
            </div>
          </div>
          <div className="mt-3 text-sm text-muted">
            {checkingSubmission
              ? 'Checking for an existing waiver…'
              : submittedWaiver
              ? 'Saved waiver ready to view.'
              : 'No waiver loaded yet. Click View my waiver to search.'}
          </div>
          {viewWaiverLoading ? (
            <div className="mt-3 rounded-2xl border border-accent/15 bg-accent/10 px-4 py-3 text-sm text-accent">
              {viewWaiverInfo}
            </div>
          ) : viewWaiverError ? (
            <div className="mt-3 rounded-2xl border border-danger/15 bg-danger/10 px-4 py-3 text-sm text-danger">
              {viewWaiverError}
            </div>
          ) : null}
        </>
      ) : null}

      {submitted && !isEmbedded ? (
        <div className="rounded-2xl border border-success/25 bg-success/10 p-4 text-sm text-success">
          {String(waiverStatus || '').trim().toLowerCase() === 'approved'
            ? 'Waiver approved. Your waiver is cleared for play and ready to print.'
            : 'Waiver submitted successfully. The form is closed. Use View my waiver to see your submitted waiver.'}
        </div>
      ) : null}

      {viewWaiverOpen && submittedWaiver ? createPortal(
        <div className="fixed inset-0 z-[9999] grid place-items-center bg-black/60 p-4">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto bg-white text-slate-950 dark:bg-slate-950 dark:text-white p-6 shadow-2xl">
            <div className="flex flex-col gap-4 border-b border-slate-200/70 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs uppercase tracking-widest text-slate-500">Waiver document</div>
                <h2 id="waiver-details-title" className="mt-1 text-2xl font-semibold">{submittedWaiver.fullName || 'Unnamed player'}</h2>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">This is your submitted waiver record.</p>
              </div>
              <div className="flex items-center gap-2 self-start sm:self-auto">
                <Button variant="secondary" onClick={printWaiver}>
                  <FiPrinter />
                  Print waiver
                </Button>
                <button
                  type="button"
                  onClick={() => setViewWaiverOpen(false)}
                  className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                  aria-label="Close waiver view"
                >
                  <FiX />
                </button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 pt-5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              <div>
                <div className="text-[11px] uppercase tracking-widest text-slate-500">Waiver ID</div>
                <p className="mt-1 font-medium">{submittedWaiver.id || submittedWaiver._id || '-'}</p>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-widest text-slate-500">Submitted</div>
                <p className="mt-1 font-medium">{submittedWaiver.submittedAtISO ? new Date(submittedWaiver.submittedAtISO).toLocaleString() : '-'}</p>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-widest text-slate-500">Player ID</div>
                <p className="mt-1 font-medium">{submittedWaiver.userId || 'Guest submission'}</p>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-widest text-slate-500">Status</div>
                <p className="mt-1 font-medium">{submittedWaiver.status || 'pending'}</p>
              </div>
            </div>

            <div className="pt-6 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              <p className="uppercase tracking-widest text-[11px] text-slate-500">Participant details</p>
              <p className="mt-3"><span className="font-semibold">Name:</span> {submittedWaiver.fullName || '-'}</p>
              <p className="mt-2"><span className="font-semibold">Age:</span> {submittedWaiver.age ?? '-'}</p>
              <p className="mt-2"><span className="font-semibold">Reservation:</span> {submittedWaiver.reservationId || '-'}</p>

              <p className="mt-6 uppercase tracking-widest text-[11px] text-slate-500">Guardian information</p>
              {submittedWaiver.isMinor ? (
                <>
                  <p className="mt-3"><span className="font-semibold">Guardian name:</span> {submittedWaiver.guardianName || '-'}</p>
                  <p className="mt-2"><span className="font-semibold">Guardian consent:</span> {submittedWaiver.guardianConsent ? 'Yes' : 'No'}</p>
                </>
              ) : (
                <p className="mt-3">Not required for participants 18 or older.</p>
              )}

              <p className="mt-6 uppercase tracking-widest text-[11px] text-slate-500">Consent summary</p>
              <ul className="mt-3 list-disc space-y-2 pl-5">
                <li>Terms accepted: {submittedWaiver.termsAccepted ? 'Yes' : 'No'}</li>
                <li>Participation consent: {submittedWaiver.consent ? 'Yes' : 'No'}</li>
                <li>Signature captured: {submittedWaiver.hasSignature ? 'Yes' : 'No'}</li>
              </ul>

              <p className="mt-6 uppercase tracking-widest text-[11px] text-slate-500">Waiver terms</p>
              <div className="mt-3 space-y-3">
                <p>I understand that airsoft activity involves risks including, but not limited to, injury and property damage.</p>
                <p>I agree to follow marshals’ instructions, safety rules, and field procedures at all times.</p>
                <p>I acknowledge that protective gear is mandatory and that non-compliance may result in removal from the field.</p>
                {submittedWaiver.isMinor ? <p>As a parent/guardian, I provide consent for my minor to participate and agree to uphold compliance with safety requirements.</p> : null}
              </div>
            </div>

            <div className="mt-8 border-t border-slate-200/70 pt-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p><span className="font-semibold text-slate-700 dark:text-slate-200">Document reference:</span> {submittedWaiver.id || submittedWaiver._id || '-'}</p>
                  <p className="mt-2"><span className="font-semibold text-slate-700 dark:text-slate-200">Displayed as:</span> waiver document view</p>
                </div>
                <Button variant="ghost" onClick={printWaiver}>
                  <FiPrinter />
                  Print waiver
                </Button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
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
                disabled={submitted || submitting}
                onChange={(e) => setState((s) => ({ ...s, fullName: e.target.value }))}
                error={errors.fullName}
              />

              <Input
                label="Age"
                type="number"
                min={1}
                inputMode="numeric"
                value={ageInput}
                disabled={submitted || submitting}
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
                    disabled={submitted || submitting}
                    onChange={(e) => setState((s) => ({ ...s, guardianName: e.target.value }))}
                    error={errors.guardianName}
                  />

                  <div className="flex items-end">
                    <label className="w-full rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={state.guardianConsent}
                          disabled={submitted || submitting}
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
                  disabled={submitted || submitting}
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
                      disabled={submitted || submitting}
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
                      disabled={submitted || submitting}
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
                disabled={!canSubmit || submitted}
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


