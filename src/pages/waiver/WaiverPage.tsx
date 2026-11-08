import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  FiAlertTriangle,
  FiCheck,
  FiCheckCircle,
  FiChevronDown,
  FiChevronRight,
  FiLock,
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
import { apiGet, apiPost, apiPut } from '../../utils/apiClient'
import { formatPhPhone, isValidPhPhone, PH_PHONE_PLACEHOLDER, toStoredPhPhone } from '../../utils/phone'
import { signedWaiverText, useCurrentWaiverText, type WaiverText } from '../../utils/waiverText'
import { printWaiverDocument } from '../../utils/waiverPrint'
import { useAuth } from '../../context/AuthContext'
import { MinorsWaivers } from './MinorsOnAccount'
import { ageFromBirthDate, isValidBirthDate, maxAdultBirthDate, maxBirthDate } from '../../utils/age'
import { composeFullName, splitFullName, type NameParts } from '../../utils/names'

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
  idType?: string
  idImage?: string
  idImageBack?: string
  autoApproved?: boolean
  guardianIdType?: string
  waiverText?: WaiverText | null
  status?: string
  validUntilISO?: string
  submittedAtISO?: string
  createdAtISO?: string
  archived?: boolean
}

// ---------------------------------------------------------------------
// Official waiver text (Chill Shooters)
// ---------------------------------------------------------------------
function WaiverTermsBody({
  text: WAIVER_TEXT,
  isMinor,
  textClass,
  headingClass,
}: {
  text: WaiverText
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

// A minor on a parent's account (routes/children.js). Passing one makes this form the child's
// waiver: the parent fills it in and signs as the guardian.
export type ChildProfile = { id: string; name: string; firstName: string; lastName: string; birthDate: string }

export function WaiverPage({
  variant = 'full',
  onSubmitted,
  child,
}: {
  variant?: 'full' | 'embedded'
  onSubmitted?: () => void
  child?: ChildProfile
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
  // The participant's name is entered in parts and signed as "First M. Last", the order staff
  // compare against the ID. It starts from the name on the player's profile.
  const [nameParts, setNameParts] = useState<NameParts>({ firstName: '', middleInitial: '', lastName: '' })
  const composedName = composeFullName(nameParts)
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
  const [guardianIdType, setGuardianIdType] = useState('')
  const [idType, setIdType] = useState('')
  const [idImage, setIdImage] = useState('')
  // New waivers are signed with the admin's current text; a submitted one shows what was signed.
  const { text: currentWaiverText } = useCurrentWaiverText()
  const [guardianSignatureImage, setGuardianSignatureImage] = useState('')
  const [signatureMethod, setSignatureMethod] = useState<'drawn' | 'uploaded'>('drawn')
  const [signatureMode, setSignatureMode] = useState<'draw' | 'upload'>('draw')
  const [signatureError, setSignatureError] = useState<string | null>(null)
  const { user } = useAuth()
  // Whose waiver this is: the signed-in adult, or one of their children.
  const subjectId = child?.id || user?.id || ''
  // The minors list reloads (a new child object) whenever the window regains focus, e.g. after the
  // file picker closes. Effects key on the child's id so that doesn't wipe what was just filled in.
  const childId = child?.id || ''

  // A player's own waiver opens once their ID is verified on their profile; the verified name,
  // birthday and ID are then filled in and the signed waiver is approved straight away.
  const [identity, setIdentity] = useState<{ status: string; idType: string; nameParts: NameParts; photoUrl: string; idFront: string; idBack: string } | null>(null)
  const [identityLoaded, setIdentityLoaded] = useState(false)
  useEffect(() => {
    if (child || !user?.id) {
      setIdentityLoaded(true)
      return
    }
    let alive = true
    setIdentityLoaded(false)
    apiGet<{ ok: boolean; data: { name?: string; firstName?: string; middleInitial?: string; lastName?: string; birthDate?: string; identityVerificationStatus?: string; identityIdType?: string; identityValidUntilISO?: string; profileImageUrl?: string; identityDocumentUrl?: string; identityDocumentBackUrl?: string; identityPreviousValidUntilISO?: string; identityPreviousIdType?: string; identityPreviousDocumentUrl?: string; identityPreviousDocumentBackUrl?: string } }>(`/api/user_accounts/${encodeURIComponent(user.id)}`)
      .then((res) => {
        const account = res?.data
        if (!alive || !account) return
        // A verification older than a year counts as expired even before the server marks it.
        const expiredByDate = Boolean(account.identityValidUntilISO && Date.parse(account.identityValidUntilISO) <= Date.now())
        const rawStatus = String(account.identityVerificationStatus || 'not_submitted')
        // While a newer ID waits for review, the previously verified one still counts, so the
        // waiver stays open with that ID.
        const previousCounts = rawStatus !== 'verified' && Date.parse(account.identityPreviousValidUntilISO || '') > Date.now()
        const status = rawStatus === 'verified' && expiredByDate ? 'expired' : previousCounts ? 'verified' : rawStatus
        const parts = account.firstName || account.lastName
          ? { firstName: account.firstName || '', middleInitial: account.middleInitial || '', lastName: account.lastName || '' }
          : splitFullName(account.name || '')
        setIdentity({
          status,
          idType: (previousCounts ? account.identityPreviousIdType : account.identityIdType) || '',
          nameParts: parts,
          photoUrl: account.profileImageUrl || '',
          idFront: (previousCounts ? account.identityPreviousDocumentUrl : account.identityDocumentUrl) || '',
          idBack: (previousCounts ? account.identityPreviousDocumentBackUrl : account.identityDocumentBackUrl) || '',
        })
        if (status === 'verified') {
          setNameParts(parts)
          if (account.birthDate) setState((current) => ({ ...current, birthDate: account.birthDate || current.birthDate }))
        }
      })
      .catch(() => { if (alive) setIdentity(null) })
      .finally(() => { if (alive) setIdentityLoaded(true) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childId, user?.id])
  const identityVerified = !child && identity?.status === 'verified'

  // A child's waiver: the parent is the guardian. Their name, email, verified ID and the signature on
  // their own approved waiver are filled in (the server copies the same details onto the waiver).
  const [guardianOnFile, setGuardianOnFile] = useState<{ name: string; email: string; idType: string; idFront: string; idBack: string; signature: string } | null>(null)
  const [guardianDetailsOpen, setGuardianDetailsOpen] = useState(false)
  useEffect(() => {
    if (!child || !user?.id) return
    let alive = true
    const parentId = encodeURIComponent(user.id)
    const approvedQuery = encodeURIComponent(JSON.stringify({ userId: String(user.id), archived: { $ne: true }, status: 'approved' }))
    Promise.all([
      apiGet<{ ok: boolean; data: { name?: string; identityIdType?: string; identityDocumentUrl?: string; identityDocumentBackUrl?: string } }>(`/api/user_accounts/${parentId}`).catch(() => null),
      apiGet<{ ok: boolean; data: Array<{ signatureImage?: string; idType?: string; idImage?: string }> }>(`/api/waivers?q=${approvedQuery}&limit=5`).catch(() => null),
    ]).then(([accountRes, waiverRes]) => {
      if (!alive) return
      const account = accountRes?.data
      const ownWaiver = Array.isArray(waiverRes?.data) ? waiverRes.data[0] : undefined
      setGuardianOnFile({
        name: account?.name || user?.name || '',
        email: user?.email || '',
        idType: account?.identityIdType || ownWaiver?.idType || '',
        idFront: account?.identityDocumentUrl || ownWaiver?.idImage || '',
        idBack: account?.identityDocumentBackUrl || '',
        signature: ownWaiver?.signatureImage || '',
      })
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childId, user?.id, user?.name, user?.email])

  const waiverStorageKey = subjectId ? `waiver_submitted:${subjectId}` : ''
  const waiverIdKey = subjectId ? `last_waiver_id:${subjectId}` : ''

  useEffect(() => {
    if (!user?.id) {
      setCheckingSubmission(false)
      return
    }

    let cancelled = false
    setCheckingSubmission(true)
    const localWaiverId = waiverIdKey ? localStorage.getItem(waiverIdKey) : null
    const reservationId = child ? null : localStorage.getItem('active_reservation_id') || null

    const matchesCurrentUser = (waiver?: SubmittedWaiver) => {
      if (!waiver) return false
      if (!subjectId) return false
      return String(waiver.userId) === String(subjectId)
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

        if (subjectId) {
          const response = await apiGet<{ ok: boolean; data: SubmittedWaiver[] }>(
            `/api/waivers?q=${encodeURIComponent(JSON.stringify({ userId: subjectId }))}&limit=200`,
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

        // Archived waivers (replaced by a resubmission, or archived by staff) are history only.
        const existingWaiver = candidates
          .filter(matchesCurrentUser)
          .filter((waiver) => !waiver.archived)
          .sort((a, b) => {
            const aDate = String(a.submittedAtISO || a.createdAtISO || '')
            const bDate = String(b.submittedAtISO || b.createdAtISO || '')
            return bDate.localeCompare(aDate)
          })[0] || null

        if (!cancelled) {
          if (existingWaiver && ['denied', 'expired'].includes(String(existingWaiver.status || '').trim().toLowerCase())) {
            // Denied or expired (older than 12 months): reopen the form so the player answers it again.
            // Name/age are prefilled; terms, consent and signature must be redone.
            setNameParts(splitFullName(existingWaiver.fullName || ''))
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
            // Guardian phone, email and both IDs are kept; signatures must be redone.
            setGuardianPhone(formatPhPhone(existingWaiver.guardianPhone || ''))
            setGuardianEmail(existingWaiver.guardianEmail || '')
            setGuardianIdImage(existingWaiver.guardianIdImage || '')
            setGuardianIdType(existingWaiver.guardianIdType || '')
            setIdType(existingWaiver.idType || '')
            setIdImage(existingWaiver.idImage || '')
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
            setGuardianPhone(formatPhPhone(existingWaiver.guardianPhone || ''))
            setGuardianEmail(existingWaiver.guardianEmail || '')
            setGuardianIdImage(existingWaiver.guardianIdImage || '')
            setGuardianIdType(existingWaiver.guardianIdType || '')
            setIdType(existingWaiver.idType || '')
            setIdImage(existingWaiver.idImage || '')
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
            setGuardianIdType('')
            setIdType('')
            setIdImage('')
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, subjectId, childId, waiverIdKey, waiverStorageKey])

  // A child's waiver starts from the child's profile, with the parent as the guardian.
  useEffect(() => {
    if (!child || submitted || checkingSubmission) return
    setNameParts((current) => (current.firstName || current.lastName ? current : { firstName: child.firstName, middleInitial: '', lastName: child.lastName }))
    setState((current) => ({
      ...current,
      birthDate: current.birthDate || child.birthDate,
      guardianName: current.guardianName || user?.name || '',
    }))
    setGuardianEmail((current) => current || user?.email || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childId, submitted, checkingSubmission, user?.name, user?.email])

  // Age always comes from the birthday, so it can't drift from what the player entered.
  const age = ageFromBirthDate(state.birthDate)
  const isMinor = age !== null && age < 18

  const errors = useMemo(() => {
    const e: Record<string, string> = {}
    if (!nameParts.firstName.trim()) e.firstName = 'First name is required.'
    if (!nameParts.lastName.trim()) e.lastName = 'Last name is required.'
    if (!state.birthDate) e.birthDate = 'Birthday is required.'
    else if (!isValidBirthDate(state.birthDate)) e.birthDate = 'Enter a valid birthday.'
    // A verified profile ID is attached by the server.
    if (!identityVerified) {
      if (!child && !idType) e.idType = 'Choose which ID you are attaching.'
      if (!idImage) e.idImage = child ? "A photo of the child's ID is required." : 'A photo of your ID is required.'
    }

    if (isMinor && child) {
      if (!state.guardianConsent) e.guardianConsent = 'Your consent as the guardian is required.'
    } else if (isMinor) {
      if (!state.guardianName.trim()) e.guardianName = 'Guardian name is required for minors.'
      if (!state.guardianConsent) e.guardianConsent = 'Guardian consent is required.'
      if (!guardianEmail.trim()) e.guardianEmail = 'Guardian email is required.'
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guardianEmail.trim())) e.guardianEmail = 'Enter a valid email address.'
      else if (!child && guardianEmail.trim().toLowerCase() === String(user?.email || '').toLowerCase()) e.guardianEmail = "Use your parent or guardian's own email, not yours."
      if (!guardianIdType) e.guardianIdType = "Choose which ID the guardian is attaching."
      if (!guardianIdImage) e.guardianIdImage = 'A photo of the guardian\'s ID is required.'
      if (!guardianSignatureImage) e.guardianSignature = 'Guardian signature is required.'
    }

    // Your own waiver is for adults; children are added by their parent instead.
    if (!child && isMinor) e.birthDate = 'You must be 18 or older. A parent or guardian adds players under 18 on their own account.'

    if (!state.termsAccepted) e.termsAccepted = 'You must accept the terms to continue.'
    if (!state.consent) e.consent = 'Consent acknowledgement is required.'
    if (!hasSignature) e.signature = 'Signature is required.'

    return e
  }, [hasSignature, isMinor, state, nameParts, guardianPhone, guardianEmail, guardianIdImage, guardianIdType, guardianSignatureImage, idType, idImage, user?.email, child, identityVerified])

  // Prefill the name parts from the player's profile when the form starts empty.
  useEffect(() => {
    if (child || !user?.id || submitted || nameParts.firstName || nameParts.lastName) return
    let alive = true
    apiGet<{ ok: boolean; data: { name?: string; firstName?: string; middleInitial?: string; lastName?: string } }>(`/api/user_accounts/${encodeURIComponent(user.id)}`)
      .then((res) => {
        const account = res?.data
        if (!alive || !account) return
        const parts = account.firstName || account.lastName
          ? { firstName: account.firstName || '', middleInitial: account.middleInitial || '', lastName: account.lastName || '' }
          : splitFullName(account.name || user?.name || '')
        setNameParts((current) => (current.firstName || current.lastName ? current : parts))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [child, user?.id, user?.name, submitted, nameParts.firstName, nameParts.lastName])

  // Prefill the birthday from the player's profile when the form starts empty.
  useEffect(() => {
    if (child || !user?.id || submitted || state.birthDate) return
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
  }, [child, user?.id, submitted, state.birthDate])

  // Until the profile ID is verified, a player's own waiver is shown but can't be filled in.
  const waiverLocked = !child && !submitted && !checkingSubmission && identityLoaded && !identityVerified
  const canSubmit = Object.keys(errors).length === 0 && !submitting && !waiverLocked
  const shownErrors: Record<string, string> = showErrors ? errors : {}


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
      const [compressedPlayerId, compressedGuardianId, compressedGuardianSig, compressedPlayerSig] = await Promise.all([
        identityVerified ? Promise.resolve('') : compressImage(idImage, 1000, 0.75),
        isMinor && !child ? compressImage(guardianIdImage, 1000, 0.75) : Promise.resolve(''),
        isMinor ? compressImage(guardianSignatureImage, 600, 0.85) : Promise.resolve(''),
        compressImage(signatureImage, 600, 0.85),
      ])

      const response = await apiPost<{ ok: boolean; insertedId: string; data: SubmittedWaiver }>('/api/waivers', {
        id: `WAIV-${Date.now()}`,
        userId: subjectId,
        ...(child ? { forChildId: child.id } : {}),
        reservationId: child ? '' : localStorage.getItem('active_reservation_id') || '',
        fullName: composedName,
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

        guardianEmail: isMinor ? guardianEmail.trim().toLowerCase() : '',
        guardianIdImage: isMinor ? compressedGuardianId : '',
        guardianIdType: isMinor ? guardianIdType : '',
        // A verified profile ID is copied on by the server.
        ...(identityVerified ? {} : { ...(child ? {} : { idType }), idImage: compressedPlayerId }),
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

      // Keep the profile's name in step with the name on the waiver staff will verify.
      // (A verified ID already fixes the name on both.)
      if (user?.id && !child && !identityVerified) {
        void apiPut(`/api/user_accounts/${encodeURIComponent(user.id)}`, {
          firstName: nameParts.firstName.trim(),
          middleInitial: nameParts.middleInitial.trim(),
          lastName: nameParts.lastName.trim(),
        }).catch(() => {})
      }

      toast.success(String(response.data?.status || '').toLowerCase() === 'approved' ? 'Waiver signed and approved. You can book a game now.' : 'Waiver submitted')
      onSubmitted?.()
    } catch (err: any) {
      console.error('Waiver submit failed:', err)
      toast.error(String(err?.message || 'Could not submit the waiver. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  const isEmbedded = variant === 'embedded'
  // A player's own approved waiver: nothing left to fill in, so the page shows a short summary
  // (the full record is under "View my waiver") and the header offers adding a minor instead.
  const approvedOwn = !child && !isEmbedded && submitted && String(waiverStatus || '').trim().toLowerCase() === 'approved'

  const handlePlayerSignatureChange = (dataUrl: string) => {
    setSignatureImage(dataUrl)
    setHasSignature(Boolean(dataUrl))
    setSignatureMethod(dataUrl.startsWith('data:image/jpeg') ? 'uploaded' : dataUrl ? 'drawn' : 'drawn')
  }

  const loadSubmittedWaiver = async () => {
    if (submittedWaiver) return submittedWaiver

    const localWaiverId = waiverIdKey ? localStorage.getItem(waiverIdKey) : null
    const reservationId = localStorage.getItem('active_reservation_id') || null

    const tryFetchByQuery = async (query: Record<string, unknown>) => {
      // Newest current waiver first: after a resubmission the denied one must not be picked.
      const response = await apiGet<{ ok: boolean; data: SubmittedWaiver[] }>(
        `/api/waivers?q=${encodeURIComponent(JSON.stringify({ ...query, archived: { $ne: true } }))}&sort=${encodeURIComponent(JSON.stringify({ createdAtISO: -1 }))}&limit=1`,
      )
      return response.data?.[0] || null
    }

    try {
      const matchesCurrentUser = (waiver?: SubmittedWaiver) => {
        if (!waiver) return false
        if (!subjectId) return false
        return String(waiver.userId) === String(subjectId)
      }

      if (localWaiverId) {
        const response = await apiGet<{ ok: boolean; data: SubmittedWaiver }>(`/api/waivers/${encodeURIComponent(localWaiverId)}`)
        if (response.data && matchesCurrentUser(response.data)) {
          setSubmittedWaiver(response.data)
          return response.data
        }
      }

      if (subjectId) {
        const existingWaiver = await tryFetchByQuery({ userId: subjectId })
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
              <p className="text-muted text-sm">Sign once before your first game. This waiver is for players 18 and older; once it's approved, parents can add their children below.</p>
            </div>
            <div className="flex items-center gap-3">
              {/* Once approved, "View my waiver" sits on the summary card below. */}
              {!approvedOwn ? (
                <Button variant="ghost" disabled={viewWaiverLoading} onClick={handleViewWaiver}>
                  <FiPrinter />
                  {viewWaiverLoading ? 'Loading waiver…' : 'View my waiver'}
                </Button>
              ) : null}
            </div>
          </div>
          {!approvedOwn ? (
            <div className="mt-3 text-sm text-muted">
              {checkingSubmission
                ? 'Checking for an existing waiver…'
                : submittedWaiver
                ? 'Saved waiver ready to view.'
                : 'No waiver loaded yet. Click View my waiver to search.'}
            </div>
          ) : null}
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

      {submitted && !isEmbedded && !approvedOwn ? (
        <div className="rounded-2xl border border-success/25 bg-success/10 p-4 text-sm text-success">
          {String(waiverStatus || '').trim().toLowerCase() === 'approved'
            ? `Waiver approved. Your waiver is cleared for play and ready to print.${submittedWaiver?.validUntilISO ? ` Valid until ${new Date(submittedWaiver.validUntilISO).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}.` : ''}`
            : 'Waiver submitted successfully. The form is closed. Use View my waiver to see your submitted waiver.'}
        </div>
      ) : null}

      {viewWaiverOpen && submittedWaiver ? createPortal(
        <div className="waiver-print-overlay fixed inset-0 z-[9999] grid place-items-center bg-black/60 p-3 sm:p-4">
          <div className="waiver-print-sheet flex max-h-[90dvh] w-full max-w-5xl flex-col overflow-hidden bg-white text-slate-950 dark:bg-slate-950 dark:text-white shadow-2xl">
            {/* The title row sits above the scrolling area, so the close button stays in reach and no text slides under it. */}
            <div className="flex shrink-0 flex-col gap-4 border-b border-slate-200/70 bg-white px-6 pb-4 pt-6 dark:bg-slate-950 sm:flex-row sm:items-center sm:justify-between">
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

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6">
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
              <p className="mt-2"><span className="font-semibold">ID type:</span> {submittedWaiver.idType || '-'}</p>
              {submittedWaiver.idImage ? (
                <div className="mt-1 inline-block rounded-lg border border-slate-200 bg-white p-2">
                  <img src={submittedWaiver.idImage} alt="Your ID" className="block h-24 object-contain" />
                </div>
              ) : null}

              <p className="mt-6 uppercase tracking-widest text-[11px] text-slate-500">Guardian information</p>
              {submittedWaiver.isMinor ? (
                <>
                  <p className="mt-3"><span className="font-semibold">Guardian name:</span> {submittedWaiver.guardianName || '-'}</p>
                  <p className="mt-2"><span className="font-semibold">Guardian consent:</span> {submittedWaiver.guardianConsent ? 'Yes' : 'No'}</p>
                  {submittedWaiver.guardianPhone ? <p className="mt-2"><span className="font-semibold">Guardian phone:</span> {formatPhPhone(submittedWaiver.guardianPhone)}</p> : null}
                  <p className="mt-2"><span className="font-semibold">Guardian ID type:</span> {submittedWaiver.guardianIdType || '-'}</p>
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

              <p className="mt-6 uppercase tracking-widest text-[11px] text-slate-500">{signedWaiverText(submittedWaiver).title}</p>
              <div className="waiver-print-terms mt-3">
                <WaiverTermsBody
                  text={signedWaiverText(submittedWaiver)}
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
          </div>
        </div>,
        document.body,
      ) : null}

      {approvedOwn ? (
        <Card className="p-4 md:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-white/5">
                {identity?.photoUrl ? (
                  <img src={identity.photoUrl} alt={submittedWaiver?.fullName || 'Profile photo'} className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full w-full place-items-center text-xl font-bold text-muted">
                    {(submittedWaiver?.fullName || user?.name || '?').trim().charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate text-lg font-bold">{submittedWaiver?.fullName || user?.name}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2.5 py-0.5 font-semibold text-success">
                    <FiCheckCircle /> Waiver approved
                  </span>
                  {submittedWaiver?.validUntilISO ? (
                    <span className="text-muted">
                      Valid until {new Date(submittedWaiver.validUntilISO).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 text-xs text-muted">You're cleared to book a game.</div>
              </div>
            </div>
            <Button variant="ghost" className="shrink-0" disabled={viewWaiverLoading} onClick={handleViewWaiver}>
              <FiPrinter />
              {viewWaiverLoading ? 'Loading waiver…' : 'View my waiver'}
            </Button>
          </div>
        </Card>
      ) : (
      <>
      {waiverLocked ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <FiLock className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <div className="text-sm font-bold text-amber-600 dark:text-amber-400">Complete your profile details first</div>
              <div className="mt-1 text-xs text-muted">
                {identity?.status === 'pending_review'
                  ? 'Your ID is waiting for staff review. The waiver opens as soon as it is verified, with your name, birthday and ID filled in.'
                  : identity?.status === 'rejected'
                    ? 'Your ID was not accepted. Submit a clearer photo on your profile; the waiver opens once it is verified.'
                    : identity?.status === 'expired'
                      ? 'Your ID verification is over a year old and has expired. Submit your ID again on your profile to sign a new waiver.'
                    : 'Add your birthday and verify your ID on your profile. Once staff verify it, this waiver opens with your details filled in.'}
              </div>
            </div>
          </div>
          {user?.id ? (
            <Link
              to={`/app/players/${encodeURIComponent(user.id)}`}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white transition hover:brightness-110"
            >
              Go to my profile <FiChevronRight />
            </Link>
          ) : null}
        </div>
      ) : null}

      <fieldset
        disabled={waiverLocked || (!child && !submitted && !identityLoaded)}
        aria-disabled={waiverLocked}
        className={waiverLocked ? 'pointer-events-none select-none opacity-50' : ''}
      >
      <div className={['grid gap-4', isEmbedded ? '' : 'lg:grid-cols-3'].filter(Boolean).join(' ')}>
        <div className="lg:col-span-2 space-y-4">
          <Card className="p-4 md:p-6">
            <div className="flex items-center gap-2 text-sm font-bold">
              <FiShield /> <span>Participant Details</span>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {submitted ? (
                <Input label="Full Name" value={submittedWaiver?.fullName || state.fullName} readOnly disabled />
              ) : identityVerified && identity ? (
                <div className="md:col-span-2">
                  <Input label="Full Name" value={composeFullName(identity.nameParts)} readOnly disabled hint="From your verified ID on your profile." />
                </div>
              ) : (
                <div className="md:col-span-2">
                  <div className="grid gap-3 sm:grid-cols-[1fr_5.5rem_1fr]">
                    <Input
                      label="First Name"
                      placeholder="e.g., Ramil"
                      value={nameParts.firstName}
                      autoComplete="given-name"
                      disabled={submitting}
                      onChange={(e) => setNameParts((parts) => ({ ...parts, firstName: e.target.value }))}
                      error={shownErrors.firstName}
                    />
                    <Input
                      label="M.I."
                      placeholder="e.g., D"
                      value={nameParts.middleInitial}
                      maxLength={2}
                      autoComplete="additional-name"
                      disabled={submitting}
                      onChange={(e) => setNameParts((parts) => ({ ...parts, middleInitial: e.target.value.replace(/[^A-Za-zÀ-ÿÑñ.]/g, '').slice(0, 2) }))}
                    />
                    <Input
                      label="Last Name"
                      placeholder="e.g., Santos"
                      value={nameParts.lastName}
                      autoComplete="family-name"
                      disabled={submitting}
                      onChange={(e) => setNameParts((parts) => ({ ...parts, lastName: e.target.value }))}
                      error={shownErrors.lastName}
                    />
                  </div>
                  <div className="mt-2 text-xs text-muted">
                    Filled in from your profile. Use your name exactly as it is on your ID. It will be signed as{' '}
                    <span className="font-semibold text-text">{composedName || 'First M. Last'}</span>.
                  </div>
                </div>
              )}

              <Input
                label="Email"
                type="email"
                value={submittedWaiver?.email || user?.email || ''}
                readOnly
                disabled
                hint={child ? "The guardian's email (your account)." : 'Taken from your account.'}
              />

              <Input
                label="Birthday"
                type="date"
                max={child ? maxBirthDate() : maxAdultBirthDate()}
                value={state.birthDate}
                disabled={submitted || submitting || Boolean(child) || identityVerified}
                hint={child ? "From the child's profile." : identityVerified ? 'From your verified ID on your profile.' : undefined}
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

            <div className="mt-4">
              {identityVerified && !submitted ? (
                <div className="flex items-start gap-3 rounded-2xl border border-success/25 bg-success/10 p-4">
                  <FiCheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                  <div>
                    <div className="text-sm font-bold">Your ID is verified</div>
                    <div className="mt-1 text-xs text-muted">
                      {identity?.idType ? `${identity.idType}, ` : ''}checked by staff on your profile. It is attached to this waiver for you, so once you sign, the waiver is approved and you can book a game.
                    </div>
                    {identity?.idFront || identity?.idBack ? (
                      <div className="mt-3 flex flex-wrap gap-3">
                        {[{ label: 'Front', url: identity.idFront }, { label: 'Back', url: identity.idBack }].filter((side) => side.url).map((side) => (
                          <a key={side.label} href={side.url} target="_blank" rel="noreferrer" className="group block">
                            <div className="text-[11px] uppercase tracking-widest text-muted">{side.label}</div>
                            <img
                              src={side.url}
                              alt={`Your verified ID (${side.label.toLowerCase()})`}
                              className="mt-1 h-28 max-w-[14rem] rounded-xl border border-white/10 bg-white object-contain transition group-hover:brightness-95"
                            />
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
              <IdUpload
                label={child ? "Child's ID" : 'Your ID'}
                value={idImage}
                onChange={setIdImage}
                // A child picks no ID type: any valid ID or school ID is accepted.
                {...(child ? {} : { idType, onIdTypeChange: setIdType, idTypeError: shownErrors.idType })}
                disabled={submitted || submitting}
                error={shownErrors.idImage}
                helper={child ? "Valid IDs or school IDs are accepted. Staff check the child's ID before approving the waiver." : 'Photo of your valid government or school ID. Staff check it before approving your waiver.'}
              />
              )}
            </div>

            {isMinor ? (
              <div className="surface mt-5 rounded-2xl">
                {/* Closed at first: the details are on file from the guardian's own account. */}
                <button
                  type="button"
                  onClick={() => setGuardianDetailsOpen((open) => !open)}
                  aria-expanded={guardianDetailsOpen}
                  className="flex w-full items-center justify-between gap-3 p-4 text-left"
                >
                  <span className="flex items-center gap-2 text-sm font-bold text-accent">
                    <FiShield /> Guardian details
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted">
                    {guardianDetailsOpen ? 'Hide' : 'Show'}
                    <FiChevronDown className={`h-4 w-4 transition ${guardianDetailsOpen ? 'rotate-180' : ''}`} />
                  </span>
                </button>
                {guardianDetailsOpen ? (
                  <div className="space-y-4 border-t border-white/10 p-4">
                    <div className="text-xs text-muted">
                      Filled in from your account: you sign this waiver as {child?.name || 'the child'}'s parent or guardian.
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Input label="Guardian name" value={(submitted ? submittedWaiver?.guardianName : guardianOnFile?.name) || ''} readOnly disabled />
                      <Input label="Guardian email" value={(submitted ? submittedWaiver?.guardianEmail : guardianOnFile?.email) || ''} readOnly disabled hint="We email this address to approve each booking for the child." />
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <div className="mb-2 text-sm font-semibold text-text">
                          Guardian ID{(submitted ? submittedWaiver?.guardianIdType : guardianOnFile?.idType) ? ` · ${submitted ? submittedWaiver?.guardianIdType : guardianOnFile?.idType}` : ''}
                        </div>
                        {(submitted ? submittedWaiver?.guardianIdImage : guardianOnFile?.idFront) ? (
                          <div className="flex flex-wrap gap-2">
                            {[submitted ? submittedWaiver?.guardianIdImage : guardianOnFile?.idFront, submitted ? '' : guardianOnFile?.idBack].filter(Boolean).map((src) => (
                              <img key={src} src={src} alt="Guardian ID" className="h-24 rounded-lg border border-white/10 bg-white object-contain p-1" />
                            ))}
                          </div>
                        ) : (
                          <div className="text-xs text-muted">Your verified ID from your profile is attached.</div>
                        )}
                      </div>
                      <div>
                        <div className="mb-2 text-sm font-semibold text-text">Guardian signature</div>
                        {(submitted ? submittedWaiver?.guardianSignatureImage : guardianOnFile?.signature) ? (
                          <img src={(submitted ? submittedWaiver?.guardianSignatureImage : guardianOnFile?.signature) || ''} alt="Guardian signature" className="h-24 rounded-lg border border-white/10 bg-white object-contain p-1" />
                        ) : (
                          <div className="text-xs text-muted">The signature on your approved waiver is used.</div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-bold flex items-center gap-2">
                    <FiUser /> <span>{currentWaiverText.title}</span>
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
                    text={currentWaiverText}
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

              <div className={`mt-4 grid gap-3 ${isMinor ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
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

                {isMinor ? (
                  <label className={['rounded-2xl border border-white/10 bg-white/5 p-4', checkboxesLocked ? 'cursor-not-allowed opacity-60' : ''].join(' ')}>
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={state.guardianConsent}
                        disabled={checkboxesLocked}
                        onChange={(e) => setState((s) => ({ ...s, guardianConsent: e.target.checked }))}
                        className="mt-1 h-4 w-4"
                      />
                      <div>
                        <div className="text-sm font-bold">I consent as a guardian to let my child play</div>
                        {shownErrors.guardianConsent ? (
                          <div className="mt-1 text-xs font-semibold text-danger">{shownErrors.guardianConsent}</div>
                        ) : (
                          <div className="mt-1 text-xs text-muted">Required.</div>
                        )}
                      </div>
                    </div>
                  </label>
                ) : null}
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


            </div>

            {submitted ? (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="mt-4 rounded-2xl border border-success/25 bg-success/10 p-4"
              >
                <div className="flex items-center gap-2 text-sm font-bold text-success">
                  <FiCheck /> <span>{String(waiverStatus || '').toLowerCase() === 'approved' ? 'Waiver approved' : 'Waiver accepted'}</span>
                </div>
                <div className="mt-2 text-xs text-muted">
                  {String(waiverStatus || '').toLowerCase() === 'approved'
                    ? 'You are cleared to book a game.'
                    : 'Reservation complete. Please wait for verification.'}
                </div>
              </motion.div>
            ) : null}

          </Card>

        </div>

        <div className="lg:col-span-1 space-y-4">
          <Card className="p-5 md:p-5">
            {(() => {
              const steps = [
                { label: "Your name", ok: Boolean(nameParts.firstName.trim() && nameParts.lastName.trim()) || submitted },
                { label: "Your birthday", ok: !errors.birthDate },
                { label: child ? "Child's ID" : "Your ID", ok: identityVerified || ((child || !!idType) && !!idImage) },
                ...(isMinor
                  ? [
                      { label: "Guardian consent", ok: state.guardianConsent },
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
                    Next: once your waiver is approved, you can book and pay online with GCash, Maya, your bank, or a card.
                  </p>
                </>
              )
            })()}
          </Card>
        </div>
      </div>

      </fieldset>
      </>
      )}

      {/* Minors are added on the profile; their waivers are answered here by the parent. */}
      {!isEmbedded && !child ? <MinorsWaivers ownWaiverApproved={String(waiverStatus || '').toLowerCase() === 'approved'} /> : null}
    </div>
  )
}