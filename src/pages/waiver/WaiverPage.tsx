import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  FiAlertTriangle,
  FiCheck,
  FiCheckCircle,
  FiChevronRight,
  FiPrinter,
  FiShield,
  FiUser,
  FiX,
} from 'react-icons/fi'

import { Card } from '../../components/ui/Card'

import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { IdUpload } from './IdUpload'
import { SignaturePad } from './SignaturePad'
import { apiGet, apiPost } from '../../utils/apiClient'
import { OFFICIAL_WAIVER_TEXT } from '../../utils/waiverText'
import { printWaiverDocument } from '../../utils/waiverPrint'
import { useAuth } from '../../context/AuthContext'
import { ageFromBirthDate, isValidBirthDate, maxBirthDate } from '../../utils/age'
import { sendRoleNotifications, useNotifications } from '../../context/NotificationContext'

type WaiverState = {
  fullName: string
  birthDate: string
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
  birthDate?: string
  email?: string
  guardianEmail?: string
  guardianName?: string
  guardianConsent?: boolean
  consent?: boolean
  termsAccepted?: boolean
  isMinor?: boolean
  hasSignature?: boolean
  signatureImage?: string
  signatureMethod?: string
  guardianPhone?: string
  guardianIdImage?: string
  guardianSignatureImage?: string
  status?: string
  validUntilISO?: string
  submittedAtISO?: string
  createdAtISO?: string
}

// ---------------------------------------------------------------------
// Official waiver text (Chill Shooters)
// ---------------------------------------------------------------------
const WAIVER_TEXT = OFFICIAL_WAIVER_TEXT

function WaiverTermsBody({
  isMinor,
  textClass,
  headingClass,
}: {
  isMinor: boolean
  textClass: string
  headingClass: string
}) {
  return (
    <div className={['space-y-3 text-xs leading-relaxed', textClass].join(' ')}>
      <p className="font-semibold">{WAIVER_TEXT.preamble}</p>
      <p>{WAIVER_TEXT.intro}</p>

      <ol className="list-decimal space-y-3 pl-5">
        {WAIVER_TEXT.clauses.map((clause, index) => (
          <li key={index}>{clause}</li>
        ))}
      </ol>

      <p className="font-semibold">{WAIVER_TEXT.closing}</p>

      {isMinor ? (
        <div className="pt-1">
          <div className={['text-[11px] font-bold uppercase tracking-[0.18em]', headingClass].join(' ')}>
            {WAIVER_TEXT.guardianTitle}
          </div>
          <p className="mt-2">{WAIVER_TEXT.guardianCertification}</p>
        </div>
      ) : null}
    </div>
  )
}

// 10 to 13 digits (e.g. 09171234567 or +63 917 123 4567)
function isValidPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 13
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

// Shrinks a data-URL image so the submit payload stays small (prevents 413 errors on minors' waivers)
function compressImage(dataUrl: string, maxW = 1000, quality = 0.75): Promise<string> {
  return new Promise((resolve) => {
    if (!dataUrl || !dataUrl.startsWith('data:image/')) {
      resolve(dataUrl)
      return
    }
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width)
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(img.width * scale))
      c.height = Math.max(1, Math.round(img.height * scale))
      const ctx = c.getContext('2d')
      if (!ctx) {
        resolve(dataUrl)
        return
      }
      // White background so transparent PNGs don't turn black as JPEG
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, c.width, c.height)
      ctx.drawImage(img, 0, 0, c.width, c.height)
      const out = c.toDataURL('image/jpeg', quality)
      // Only use the compressed version if it is actually smaller
      resolve(out.length < dataUrl.length ? out : dataUrl)
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
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
    birthDate: '',
    guardianName: '',
    guardianConsent: false,
    consent: false,
    termsAccepted: false,
  })

  const [submitting, setSubmitting] = useState(false)
  // Field errors stay hidden until the first submit attempt so the form starts calm.
  const [showErrors, setShowErrors] = useState(false)
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
  const [signatureImage, setSignatureImage] = useState('')
  const [guardianPhone, setGuardianPhone] = useState('')
  const [guardianEmail, setGuardianEmail] = useState('')
  const [guardianIdImage, setGuardianIdImage] = useState('')
  const [guardianSignatureImage, setGuardianSignatureImage] = useState('')
  const [signatureMethod, setSignatureMethod] = useState<'drawn' | 'uploaded'>('drawn')
  const [signatureMode, setSignatureMode] = useState<'draw' | 'upload'>('draw')
  const [signatureError, setSignatureError] = useState<string | null>(null)
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

        // Each lookup is isolated: a deleted waiver (404) must not stop the other lookups.
        if (localWaiverId) {
          try {
            const response = await apiGet<{ ok: boolean; data: SubmittedWaiver }>(`/api/waivers/${encodeURIComponent(localWaiverId)}`)
            if (response?.data) candidates.push(response.data)
          } catch {
            // waiver was deleted or is unavailable
          }
        }

        if (user?.id) {
          const response = await apiGet<{ ok: boolean; data: SubmittedWaiver[] }>(
            `/api/waivers?q=${encodeURIComponent(JSON.stringify({ userId: user.id }))}&limit=200`,
          )
          if (Array.isArray(response?.data)) candidates.push(...response.data)
        }

        if (reservationId) {
          try {
            const response = await apiGet<{ ok: boolean; data: SubmittedWaiver[] }>(
              `/api/waivers?q=${encodeURIComponent(JSON.stringify({ reservationId }))}&limit=200`,
            )
            if (Array.isArray(response?.data)) candidates.push(...response.data)
          } catch {
            // ignore
          }
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
          if (existingWaiver && ['denied', 'expired'].includes(String(existingWaiver.status || '').trim().toLowerCase())) {
            // Denied or expired (older than 12 months): reopen the form so the player answers it again.
            // Name/age are prefilled; terms, consent and signature must be redone.
            setState({
              fullName: existingWaiver.fullName || '',
              birthDate: existingWaiver.birthDate || '',
              guardianName: existingWaiver.guardianName || '',
              guardianConsent: false,
              consent: false,
              termsAccepted: false,
            })
            strokesRef.current = []
            setHasSignature(false)
            setSignatureImage('')
            // Guardian phone, email and ID photo are kept; signatures must be redone.
            setGuardianPhone(existingWaiver.guardianPhone || '')
            setGuardianEmail(existingWaiver.guardianEmail || '')
            setGuardianIdImage(existingWaiver.guardianIdImage || '')
            setGuardianSignatureImage('')
            setWaiverStatus(String(existingWaiver.status).trim().toLowerCase())
            setSubmittedWaiver(existingWaiver)
            setSubmitted(false)
            if (waiverStorageKey) localStorage.removeItem(waiverStorageKey)
          } else if (existingWaiver) {
            setState((current) => ({
              ...current,
              fullName: existingWaiver.fullName || current.fullName,
              birthDate: existingWaiver.birthDate || current.birthDate,
              guardianName: existingWaiver.guardianName || current.guardianName,
              guardianConsent: Boolean(existingWaiver.guardianConsent),
              consent: Boolean(existingWaiver.consent),
              termsAccepted: Boolean(existingWaiver.termsAccepted),
            }))
            setHasSignature(Boolean(existingWaiver.hasSignature))
            setSignatureImage(existingWaiver.signatureImage || '')
            setGuardianPhone(existingWaiver.guardianPhone || '')
            setGuardianEmail(existingWaiver.guardianEmail || '')
            setGuardianIdImage(existingWaiver.guardianIdImage || '')
            setGuardianSignatureImage(existingWaiver.guardianSignatureImage || '')
            setWaiverStatus(existingWaiver.status)
            setSubmittedWaiver(existingWaiver)
            setSubmitted(true)
            if (waiverStorageKey) localStorage.setItem(waiverStorageKey, '1')
            if (waiverIdKey && existingWaiver.id) localStorage.setItem(waiverIdKey, existingWaiver.id)
          } else {
            // No waiver on the server (never submitted, or an admin deleted it): clear the player's copy.
            setSubmitted(false)
            setWaiverStatus(undefined)
            setSubmittedWaiver(null)
            setViewWaiverOpen(false)
            setState((current) => ({ fullName: '', birthDate: current.birthDate, guardianName: '', guardianConsent: false, consent: false, termsAccepted: false }))
            strokesRef.current = []
            setHasSignature(false)
            setSignatureImage('')
            setGuardianPhone('')
            setGuardianEmail('')
            setGuardianIdImage('')
            setGuardianSignatureImage('')
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

  // Age always comes from the birthday, so it can't drift from what the player entered.
  const age = ageFromBirthDate(state.birthDate)
  const isMinor = age !== null && age < 18

  const errors = useMemo(() => {
    const e: Record<string, string> = {}
    if (!state.fullName.trim()) e.fullName = 'Full name is required.'
    if (!state.birthDate) e.birthDate = 'Birthday is required.'
    else if (!isValidBirthDate(state.birthDate)) e.birthDate = 'Enter a valid birthday.'

    if (isMinor) {
      if (!state.guardianName.trim()) e.guardianName = 'Guardian name is required for minors.'
      if (!state.guardianConsent) e.guardianConsent = 'Guardian consent is required.'
      if (!guardianPhone.trim()) e.guardianPhone = 'Guardian phone number is required.'
      else if (!isValidPhone(guardianPhone)) e.guardianPhone = 'Enter a valid phone number.'
      if (!guardianEmail.trim()) e.guardianEmail = 'Guardian email is required so they can approve your bookings.'
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guardianEmail.trim())) e.guardianEmail = 'Enter a valid email address.'
      else if (guardianEmail.trim().toLowerCase() === String(user?.email || '').toLowerCase()) e.guardianEmail = "Use your parent or guardian's own email, not yours."
      if (!guardianIdImage) e.guardianIdImage = 'A photo of the guardian\'s ID is required.'
      if (!guardianSignatureImage) e.guardianSignature = 'Guardian signature is required.'
    }

    if (!state.termsAccepted) e.termsAccepted = 'You must accept the terms to continue.'
    if (!state.consent) e.consent = 'Consent acknowledgement is required.'
    if (!hasSignature) e.signature = 'Signature is required.'

    return e
  }, [hasSignature, isMinor, state, guardianPhone, guardianEmail, guardianIdImage, guardianSignatureImage, user?.email])

  // Prefill the birthday from the player's profile when the form starts empty.
  useEffect(() => {
    if (!user?.id || submitted || state.birthDate) return
    let alive = true
    apiGet<{ ok: boolean; data: { birthDate?: string } }>(`/api/user_accounts/${encodeURIComponent(user.id)}`)
      .then((res) => {
        const birthDate = res?.data?.birthDate
        if (alive && birthDate) setState((s) => (s.birthDate ? s : { ...s, birthDate }))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [user?.id, submitted, state.birthDate])

  const canSubmit = Object.keys(errors).length === 0 && !submitting
  const shownErrors: Record<string, string> = showErrors ? errors : {}

  const scrollToPayment = () => {
    const paymentSection = document.getElementById('payment-section')
    if (paymentSection) {
      paymentSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  // ---------------------------------------------------------------------
  // Signature: multi-stroke drawing OR uploaded image. Both end up as an image (data URL).
  // ---------------------------------------------------------------------
  const strokesRef = useRef<SignaturePoint[][]>([])
  const currentStrokeRef = useRef<SignaturePoint[]>([])
  const drawingRef = useRef(false)
  const sigSizeRef = useRef({ w: 320, h: 192 })
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const SIG_OUT_W = 600
  const SIG_OUT_H = 200
  const SIG_STROKE_COLOR = 'rgba(197,163,90,0.95)' // on-screen pad
  const ALLOWED_SIGNATURE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
  const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024

  const getCtx = () => {
    const canvas = canvasRef.current
    if (!canvas) return null
    return canvas.getContext('2d')
  }

  const setupCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    // HiDPI scaling
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    const w = rect.width || 320
    const h = rect.height || 192
    sigSizeRef.current = { w, h }

    canvas.width = Math.floor(w * dpr)
    canvas.height = Math.floor(h * dpr)

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = 'rgba(255,255,255,0.03)'
    ctx.fillRect(0, 0, w, h)

    ctx.strokeStyle = SIG_STROKE_COLOR
    ctx.lineWidth = 2.4
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
  }

  const paintStroke = (ctx: CanvasRenderingContext2D, pts: SignaturePoint[], fill: string) => {
    if (pts.length === 1) {
      ctx.beginPath()
      ctx.arc(pts[0].x, pts[0].y, 1.2, 0, Math.PI * 2)
      ctx.fillStyle = fill
      ctx.fill()
      return
    }
    drawStroke(ctx, pts)
  }

  // Clears the pad and repaints every saved stroke (used by undo / mode switch)
  const redrawCanvas = () => {
    setupCanvas()
    const ctx = getCtx()
    if (!ctx) return
    strokesRef.current.forEach((pts) => paintStroke(ctx, pts, SIG_STROKE_COLOR))
  }

  // Render all strokes to a clean dark-on-white PNG so it prints well
  const exportDrawnSignature = (): string => {
    const strokes = strokesRef.current
    if (!strokes.length) return ''
    const { w, h } = sigSizeRef.current
    const scale = Math.min(SIG_OUT_W / w, SIG_OUT_H / h)

    const out = document.createElement('canvas')
    out.width = SIG_OUT_W
    out.height = SIG_OUT_H
    const ctx = out.getContext('2d')
    if (!ctx) return ''

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, SIG_OUT_W, SIG_OUT_H)
    ctx.translate((SIG_OUT_W - w * scale) / 2, (SIG_OUT_H - h * scale) / 2)
    ctx.scale(scale, scale)
    ctx.strokeStyle = '#111111'
    ctx.lineWidth = 2.4
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    strokes.forEach((pts) => paintStroke(ctx, pts, '#111111'))

    return out.toDataURL('image/png')
  }

  const commitStrokes = () => {
    const hasRealStroke = strokesRef.current.some((pts) => pts.length >= 2)
    if (!hasRealStroke) {
      setSignatureImage('')
      setHasSignature(false)
      return
    }
    setSignatureImage(exportDrawnSignature())
    setSignatureMethod('drawn')
    setHasSignature(true)
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (submitted || submitting) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = clamp(e.clientX - rect.left, 0, rect.width)
    const y = clamp(e.clientY - rect.top, 0, rect.height)

    const ctx = getCtx()
    if (!ctx) return

    try {
      canvas.setPointerCapture(e.pointerId)
    } catch {
      // ignore
    }

    drawingRef.current = true
    currentStrokeRef.current = [{ x, y }]
    paintStroke(ctx, currentStrokeRef.current, SIG_STROKE_COLOR)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()

    const x = clamp(e.clientX - rect.left, 0, rect.width)
    const y = clamp(e.clientY - rect.top, 0, rect.height)

    currentStrokeRef.current.push({ x, y })

    const ctx = getCtx()
    if (!ctx) return

    const pts = currentStrokeRef.current
    if (pts.length >= 2) {
      drawStroke(ctx, pts.slice(-2))
    }
  }

  const handlePointerUp = () => {
    if (!drawingRef.current) return
    drawingRef.current = false
    if (currentStrokeRef.current.length > 0) {
      strokesRef.current.push(currentStrokeRef.current)
    }
    currentStrokeRef.current = []
    commitStrokes()
  }

  const undoStroke = () => {
    if (submitted || submitting) return
    strokesRef.current.pop()
    redrawCanvas()
    commitStrokes()
  }

  const clearSignature = () => {
    strokesRef.current = []
    currentStrokeRef.current = []
    redrawCanvas()
    setSignatureImage('')
    setHasSignature(false)
    setSignatureError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const changeSignatureMode = (mode: 'draw' | 'upload') => {
    if (mode === signatureMode) return
    // Switching method starts fresh so the saved image always matches what's on screen
    clearSignature()
    setSignatureMode(mode)
  }

  // Repaint the pad whenever it (re)appears
  useEffect(() => {
    if (submitted || signatureMode !== 'draw') return
    redrawCanvas()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signatureMode, submitted])

  const handleSignatureFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow picking the same file again
    if (!file) return
    setSignatureError(null)

    if (!ALLOWED_SIGNATURE_TYPES.includes(file.type)) {
      setSignatureError('Only image files are allowed (PNG, JPG or WEBP).')
      return
    }
    if (file.size > MAX_SIGNATURE_BYTES) {
      setSignatureError('The image must be 2 MB or smaller.')
      return
    }

    const reader = new FileReader()
    reader.onerror = () => setSignatureError('That file could not be read. Please try another image.')
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => setSignatureError('That file is not a valid image.')
      img.onload = () => {
        // Normalize to a small white-background image (keeps the upload payload light)
        const out = document.createElement('canvas')
        out.width = SIG_OUT_W
        out.height = SIG_OUT_H
        const ctx = out.getContext('2d')
        if (!ctx) {
          setSignatureError('Could not process the image in this browser.')
          return
        }
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, SIG_OUT_W, SIG_OUT_H)
        const scale = Math.min(SIG_OUT_W / img.width, SIG_OUT_H / img.height)
        const dw = img.width * scale
        const dh = img.height * scale
        ctx.drawImage(img, (SIG_OUT_W - dw) / 2, (SIG_OUT_H - dh) / 2, dw, dh)

        strokesRef.current = []
        setSignatureImage(out.toDataURL('image/jpeg', 0.9))
        setSignatureMethod('uploaded')
        setHasSignature(true)
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  }

  const [termsOpen, setTermsOpen] = useState(true)

  // Must scroll through the whole waiver before the checkboxes unlock
  const [hasReadTerms, setHasReadTerms] = useState(false)
  const termsScrollRef = useRef<HTMLDivElement | null>(null)

  // Changing between minor/adult changes the waiver text (guardian certification), so require reading again
  useEffect(() => {
    if (submitted) return
    setHasReadTerms(false)
    setState((s) => ({ ...s, termsAccepted: false, consent: false }))
  }, [isMinor])

  // Unlock automatically if already submitted, or if the text fits without scrolling
  useEffect(() => {
    if (submitted) {
      setHasReadTerms(true)
      return
    }
    const el = termsScrollRef.current
    if (!el) return
    if (el.scrollHeight - el.clientHeight <= 8) setHasReadTerms(true)
  }, [termsOpen, isMinor, submitted])

  const handleTermsScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (hasReadTerms) return
    const el = e.currentTarget
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) setHasReadTerms(true)
  }

  const checkboxesLocked = submitted || submitting || !hasReadTerms

  const onSubmit = async () => {
    if (submitted || submitting) return
    setSubmitting(true)
    try {
      // Compress images first so the request body stays small (minors send an ID photo + 2 signatures)
      const [compressedGuardianId, compressedGuardianSig, compressedPlayerSig] = await Promise.all([
        isMinor ? compressImage(guardianIdImage, 1000, 0.75) : Promise.resolve(''),
        isMinor ? compressImage(guardianSignatureImage, 600, 0.85) : Promise.resolve(''),
        compressImage(signatureImage, 600, 0.85),
      ])

      const response = await apiPost<{ ok: boolean; insertedId: string; data: SubmittedWaiver }>('/api/waivers', {
        id: `WAIV-${Date.now()}`,
        userId: user?.id || '',
        reservationId: localStorage.getItem('active_reservation_id') || '',
        fullName: state.fullName.trim(),
        email: user?.email || '',
        birthDate: state.birthDate,
        age,
        guardianName: state.guardianName.trim(),
        guardianConsent: state.guardianConsent,
        consent: state.consent,
        termsAccepted: state.termsAccepted,
        isMinor,
        hasSignature,
        signatureImage: compressedPlayerSig,
        signatureMethod,
        guardianPhone: isMinor ? guardianPhone.trim() : '',
        guardianEmail: isMinor ? guardianEmail.trim().toLowerCase() : '',
        guardianIdImage: isMinor ? compressedGuardianId : '',
        guardianSignatureImage: isMinor ? compressedGuardianSig : '',
        status: 'pending',
        submittedAtISO: new Date().toISOString(),
        createdAtISO: new Date().toISOString(),
      })

      if (!response?.ok) throw new Error('The server did not confirm the waiver was saved.')

      setSubmitted(true)
      setWaiverStatus(response.data?.status)
      setSubmittedWaiver(response.data || null)
      try {
        if (waiverStorageKey) localStorage.setItem(waiverStorageKey, '1')
        if (waiverIdKey && response.data?.id) localStorage.setItem(waiverIdKey, response.data.id)
      } catch {
        // ignore
      }

      // Notifications must never block or undo a successful submit
      try {
        sendRoleNotifications(addNotification, {
          roles: ['admin', 'registrar', 'marshal'],
          type: 'waiver_submitted',
          title: 'New Waiver Submitted',
          message: `A new waiver was submitted by ${user?.name || user?.id || 'a player'}.`,
          linkedResourceId: response.data?.id,
        })
      } catch (err) {
        console.warn('Notification failed', err)
      }

      toast.success('Waiver submitted')
      onSubmitted?.()
    } catch (err: any) {
      console.error('Waiver submit failed:', err)
      toast.error(String(err?.message || 'Could not submit the waiver. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  const isEmbedded = variant === 'embedded'

  const handlePlayerSignatureChange = (dataUrl: string) => {
    setSignatureImage(dataUrl)
    setHasSignature(Boolean(dataUrl))
    setSignatureMethod(dataUrl.startsWith('data:image/jpeg') ? 'uploaded' : dataUrl ? 'drawn' : 'drawn')
  }

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

  // Prints the saved record as its own one-page A4 document (same output as the admin print)
  const printWaiver = () => {
    if (!submittedWaiver) return
    printWaiverDocument(submittedWaiver)
  }

  return (
    <div className={['waiver-page space-y-4', submitted ? 'submitted-waiver' : '', isEmbedded ? 'max-w-none' : ''].filter(Boolean).join(' ')}>
      {!isEmbedded ? (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-2">
              <div className="text-sm font-medium text-accent">Waiver</div>
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
              <p className="text-muted text-sm">Sign once before your first game. Players under 18 need a guardian to sign too.</p>
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

      {!submitted && String(waiverStatus || '').trim().toLowerCase() === 'denied' ? (
        <div className="rounded-2xl border border-danger/25 bg-danger/10 p-4 text-sm text-danger">
          <div className="flex items-center gap-2 font-bold"><FiAlertTriangle /> <span>Your waiver was denied</span></div>
          <div className="mt-1 text-xs">Please review the waiver, then fill it out and sign it again to resubmit.</div>
        </div>
      ) : null}

      {!submitted && String(waiverStatus || '').trim().toLowerCase() === 'expired' ? (
        <div className="rounded-2xl border border-warning/25 bg-warning/10 p-4 text-sm text-warning">
          <div className="flex items-center gap-2 font-bold"><FiAlertTriangle /> <span>Your waiver has expired</span></div>
          <div className="mt-1 text-xs">Waivers are valid for 12 months. Please answer and sign it again to keep booking games.</div>
        </div>
      ) : null}

      {submitted && !isEmbedded ? (
        <div className="rounded-2xl border border-success/25 bg-success/10 p-4 text-sm text-success">
          {String(waiverStatus || '').trim().toLowerCase() === 'approved'
            ? `Waiver approved. Your waiver is cleared for play and ready to print.${submittedWaiver?.validUntilISO ? ` Valid until ${new Date(submittedWaiver.validUntilISO).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}.` : ''}`
            : 'Waiver submitted successfully. The form is closed. Use View my waiver to see your submitted waiver.'}
        </div>
      ) : null}

      {viewWaiverOpen && submittedWaiver ? createPortal(
        <div className="waiver-print-overlay fixed inset-0 z-[9999] grid place-items-center bg-black/60 p-4">
          <div className="waiver-print-sheet max-h-[90vh] w-full max-w-5xl overflow-y-auto bg-white text-slate-950 dark:bg-slate-950 dark:text-white p-6 shadow-2xl">
            <div className="flex flex-col gap-4 border-b border-slate-200/70 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs uppercase tracking-widest text-slate-500">Waiver document</div>
                <h2 id="waiver-details-title" className="mt-1 text-2xl font-semibold">{submittedWaiver.fullName || 'Unnamed player'}</h2>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">This is your submitted waiver record.</p>
              </div>
              <div className="waiver-print-controls flex items-center gap-2 self-start sm:self-auto">
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

            <div className="waiver-print-body pt-6 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              <p className="uppercase tracking-widest text-[11px] text-slate-500">Participant details</p>
              <p className="mt-3"><span className="font-semibold">Name:</span> {submittedWaiver.fullName || '-'}</p>
              <p className="mt-2"><span className="font-semibold">Age:</span> {submittedWaiver.age ?? '-'}</p>
              <p className="mt-2"><span className="font-semibold">Reservation:</span> {submittedWaiver.reservationId || '-'}</p>

              <p className="mt-6 uppercase tracking-widest text-[11px] text-slate-500">Guardian information</p>
              {submittedWaiver.isMinor ? (
                <>
                  <p className="mt-3"><span className="font-semibold">Guardian name:</span> {submittedWaiver.guardianName || '-'}</p>
                  <p className="mt-2"><span className="font-semibold">Guardian consent:</span> {submittedWaiver.guardianConsent ? 'Yes' : 'No'}</p>
                  <p className="mt-2"><span className="font-semibold">Guardian phone:</span> {submittedWaiver.guardianPhone || '-'}</p>
                  <div className="mt-2 flex flex-wrap gap-4">
                    {submittedWaiver.guardianIdImage ? (
                      <div>
                        <span className="font-semibold">Guardian ID:</span>
                        <div className="mt-1 inline-block rounded-lg border border-slate-200 bg-white p-2">
                          <img src={submittedWaiver.guardianIdImage} alt="Guardian ID" className="block h-24 object-contain" />
                        </div>
                      </div>
                    ) : null}
                    {submittedWaiver.guardianSignatureImage ? (
                      <div>
                        <span className="font-semibold">Guardian signature:</span>
                        <div className="mt-1 inline-block rounded-lg border border-slate-200 bg-white p-2">
                          <img src={submittedWaiver.guardianSignatureImage} alt="Guardian signature" className="block h-24 object-contain" />
                        </div>
                      </div>
                    ) : null}
                  </div>
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

              <p className="mt-6 uppercase tracking-widest text-[11px] text-slate-500">{WAIVER_TEXT.title}</p>
              <div className="waiver-print-terms mt-3">
                <WaiverTermsBody
                  isMinor={Boolean(submittedWaiver.isMinor)}
                  textClass="text-slate-700 dark:text-slate-300"
                  headingClass="text-slate-500"
                />
              </div>

              <div className="mt-6 border-t border-slate-200/70 pt-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Signature</p>
                {submittedWaiver.signatureImage ? (
                  <div className="mt-2 inline-block rounded-lg border border-slate-200 bg-white p-2">
                    <img src={submittedWaiver.signatureImage} alt="Participant signature" className="h-20 object-contain" />
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-slate-500">No signature image submitted.</div>
                )}
                <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">{submittedWaiver.fullName || '-'}</p>
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
                error={shownErrors.fullName}
              />

              <Input
                label="Email"
                type="email"
                value={submittedWaiver?.email || user?.email || ''}
                readOnly
                disabled
                hint="Taken from your account."
              />

              <Input
                label="Birthday"
                type="date"
                max={maxBirthDate()}
                value={state.birthDate}
                disabled={submitted || submitting}
                onChange={(e) => setState((s) => ({ ...s, birthDate: e.target.value }))}
                error={shownErrors.birthDate}
              />

              <Input
                label="Age"
                value={age !== null ? String(age) : ''}
                placeholder="Filled in from your birthday"
                readOnly
                disabled
              />
            </div>

            {isMinor ? (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="surface mt-5 rounded-2xl p-4"
              >
                <div className="flex items-center gap-2 text-sm font-bold text-accent">
                  <FiShield /> <span>Guardian consent (under 18)</span>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <Input
                    label="Guardian Name"
                    placeholder="e.g., Maria Santos"
                    value={state.guardianName}
                    disabled={submitted || submitting}
                    onChange={(e) => setState((s) => ({ ...s, guardianName: e.target.value }))}
                    error={shownErrors.guardianName}
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
                          {shownErrors.guardianConsent ? (
                            <div className="mt-1 text-xs font-semibold text-danger">{shownErrors.guardianConsent}</div>
                          ) : (
                            <div className="mt-1 text-xs text-muted">Required to submit waiver.</div>
                          )}
                        </div>
                      </div>
                    </label>
                  </div>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <Input
                    label="Guardian Phone Number"
                    type="tel"
                    inputMode="tel"
                    placeholder="e.g., 0917 123 4567"
                    value={guardianPhone}
                    disabled={submitted || submitting}
                    onChange={(e) => setGuardianPhone(e.target.value)}
                    error={shownErrors.guardianPhone}
                  />
                  <Input
                    label="Guardian Email"
                    type="email"
                    placeholder="e.g., maria.santos@gmail.com"
                    value={guardianEmail}
                    disabled={submitted || submitting}
                    onChange={(e) => setGuardianEmail(e.target.value)}
                    hint="Every time you book, we email your guardian to approve it."
                    error={shownErrors.guardianEmail}
                  />
                  <IdUpload
                    label="Guardian ID"
                    value={guardianIdImage}
                    onChange={setGuardianIdImage}
                    disabled={submitted || submitting}
                    error={shownErrors.guardianIdImage}
                  />
                </div>

                <div className="mt-4">
                  <SignaturePad
                    title="Guardian Signature"
                    value={guardianSignatureImage}
                    onChange={setGuardianSignatureImage}
                    disabled={submitted || submitting}
                    error={shownErrors.guardianSignature}
                  />
                </div>
              </motion.div>
            ) : null}

            <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-bold flex items-center gap-2">
                    <FiUser /> <span>{WAIVER_TEXT.title}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted">Read the full waiver below before confirming. Required before signature submission.</div>
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
                <div
                  ref={termsScrollRef}
                  onScroll={handleTermsScroll}
                  className="mt-4 max-h-80 overflow-y-auto rounded-2xl border border-white/10 bg-white/5 p-4 pr-3"
                >
                  <WaiverTermsBody
                    isMinor={isMinor}
                    textClass="text-muted"
                    headingClass="text-muted"
                  />
                </div>
              ) : null}

              {!submitted ? (
                <div className={['mt-3 flex items-center gap-2 text-xs font-semibold', hasReadTerms ? 'text-success' : 'text-muted'].join(' ')}>
                  {hasReadTerms ? <FiCheck /> : <FiChevronRight />}
                  <span>
                    {hasReadTerms
                      ? 'You have read the full waiver. The checkboxes are unlocked.'
                      : termsOpen
                        ? 'Scroll to the end of the waiver to unlock the checkboxes.'
                        : 'Show the terms and scroll to the end to unlock the checkboxes.'}
                  </span>
                </div>
              ) : null}

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className={['rounded-2xl border border-white/10 bg-white/5 p-4', checkboxesLocked ? 'cursor-not-allowed opacity-60' : ''].join(' ')}>
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={state.termsAccepted}
                      disabled={checkboxesLocked}
                      onChange={(e) => setState((s) => ({ ...s, termsAccepted: e.target.checked }))}
                      className="mt-1 h-4 w-4"
                    />
                    <div>
                      <div className="text-sm font-bold">Accept terms & release of liability</div>
                      {shownErrors.termsAccepted ? (
                        <div className="mt-1 text-xs font-semibold text-danger">{shownErrors.termsAccepted}</div>
                      ) : (
                        <div className="mt-1 text-xs text-muted">I have read and agree to the waiver above. Required.</div>
                      )}
                    </div>
                  </div>
                </label>

                <label className={['rounded-2xl border border-white/10 bg-white/5 p-4', checkboxesLocked ? 'cursor-not-allowed opacity-60' : ''].join(' ')}>
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={state.consent}
                      disabled={checkboxesLocked}
                      onChange={(e) => setState((s) => ({ ...s, consent: e.target.checked }))}
                      className="mt-1 h-4 w-4"
                    />
                    <div>
                      <div className="text-sm font-bold">Consent acknowledgement</div>
                      {shownErrors.consent ? (
                        <div className="mt-1 text-xs font-semibold text-danger">{shownErrors.consent}</div>
                      ) : (
                        <div className="mt-1 text-xs text-muted">I understand I have given up substantial rights and sign freely and voluntarily. Required.</div>
                      )}
                    </div>
                  </div>
                </label>
              </div>
            </div>
          </Card>

          <Card className="p-4 md:p-6">
            <SignaturePad
              title="Digital Signature"
              value={signatureImage}
              onChange={handlePlayerSignatureChange}
              disabled={submitted || submitting}
              error={shownErrors.signature}
            />

            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <Button
                variant="primary"
                disabled={submitting || submitted}
                onClick={() => {
                  if (!canSubmit) {
                    setShowErrors(true)
                    toast.error("Please complete the highlighted fields.")
                    return
                  }
                  void onSubmit()
                }}
              >
                {submitting
                  ? 'Submitting…'
                  : submitted
                    ? 'Submitted'
                    : String(waiverStatus || '').trim().toLowerCase() === 'denied'
                      ? 'Resubmit Waiver'
                      : 'Submit Waiver'}
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
          <Card className="p-5 md:p-5">
            {(() => {
              const steps = [
                { label: "Your name", ok: !!state.fullName.trim() },
                { label: "Your birthday", ok: !errors.birthDate },
                ...(isMinor
                  ? [
                      { label: "Guardian details & consent", ok: state.guardianConsent && !!state.guardianName.trim() && !errors.guardianPhone && !errors.guardianEmail },
                      { label: "Guardian ID photo", ok: !!guardianIdImage },
                      { label: "Guardian signature", ok: !!guardianSignatureImage },
                    ]
                  : []),
                { label: "Read & accept the terms", ok: state.termsAccepted && state.consent },
                { label: "Your signature", ok: hasSignature },
              ]
              const done = steps.filter((step) => step.ok).length
              return (
                <>
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="text-base font-semibold">Your progress</h2>
                    <span className="text-sm text-muted">
                      {done} of {steps.length}
                    </span>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[rgba(var(--text),0.08)]">
                    <div className="h-full rounded-full bg-success transition-all" style={{ width: `${(done / steps.length) * 100}%` }} />
                  </div>
                  <ul className="mt-4 space-y-2.5">
                    {steps.map((step) => (
                      <li key={step.label} className="flex items-center gap-2.5 text-sm">
                        {step.ok ? (
                          <FiCheckCircle className="h-4 w-4 shrink-0 text-success" />
                        ) : (
                          <span className="h-4 w-4 shrink-0 rounded-full border-2 border-[rgba(var(--text),0.2)]" />
                        )}
                        <span className={step.ok ? "text-muted line-through" : ""}>{step.label}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="divider mt-4 border-t pt-4 text-xs text-muted">
                    Next: once your waiver is approved, you can book and pay by GCash or bank transfer.
                  </p>
                </>
              )
            })()}
          </Card>
        </div>
      </div>
    </div>
  )
}