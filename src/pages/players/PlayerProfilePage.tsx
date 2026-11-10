import React from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { apiBase, apiGet, apiPost, apiPut, getApiAuthHeaders } from '../../utils/apiClient'
import { PlayerStatsCard } from '../../components/players/PlayerStatsCard'
import { PartnershipDiscountCard } from './PartnershipDiscountCard'
import { useAuth } from '../../context/AuthContext'
import { ageFromBirthDate, isValidBirthDate, maxAdultBirthDate } from '../../utils/age'
import { composeFullName, splitFullName } from '../../utils/names'
import { formatPhPhone } from '../../utils/phone'
import { IDENTITY_ID_TYPES, idTypeNeedsBack } from '../../utils/idTypes'
import { MinorsOnProfile } from '../waiver/MinorsOnAccount'
import { ProfilePhotoCropModal } from '../../components/profile/ProfilePhotoCropModal'
import { FiEdit2 } from 'react-icons/fi'

type IdSide = 'front' | 'back'
type IdPhoto = { blob: Blob; name: string; preview: string }

type PlayerProfileDoc = {
  id?: string
  name?: string
  firstName?: string
  middleInitial?: string
  lastName?: string
  nickname?: string
  email?: string
  role?: string
  experience?: number
  createdAtISO?: string
  identityVerificationStatus?: string
  identityIdType?: string
  identityDocumentUrl?: string
  identityDocumentBackUrl?: string
  // A verified ID counts for a year; while a newer one is reviewed the previous one still counts.
  identityValidUntilISO?: string
  identityPreviousValidUntilISO?: string
  profileImageUrl?: string
  emailVerified?: boolean
  equipmentIds?: string[]
  equipment?: Array<{ id?: string; name?: string; category?: string }>
  partnershipInstitution?: string
  partnershipEligibilityStatus?: string
  partnershipReviewReason?: string
  birthDate?: string
  // A minor's profile under a parent's account (no login of its own).
  isChildProfile?: boolean
  guardianId?: string
  guardianName?: string
}

type ProfileWaiver = {
  id?: string
  status?: string
  archived?: boolean
  isMinor?: boolean
  age?: number
  guardianName?: string
  guardianEmail?: string
  guardianPhone?: string
  approvedAtISO?: string
  createdAtISO?: string
  submittedAtISO?: string
}

type EquipmentItem = {
  id?: string
  name?: string
  category?: string
  status?: string
}

export function PlayerProfilePage() {
  const { playerId } = useParams()
  const navigate = useNavigate()
  const { user, updateUser, replaceToken, remember } = useAuth()
  const [player, setPlayer] = React.useState<PlayerProfileDoc | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [uploading, setUploading] = React.useState(false)
  const [savingProfile, setSavingProfile] = React.useState(false)
  const [profileImageUploading, setProfileImageUploading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [cameraActive, setCameraActive] = React.useState(false)
  const [cameraStream, setCameraStream] = React.useState<MediaStream | null>(null)
  const [mounted, setMounted] = React.useState(false)
  const [scanStatus, setScanStatus] = React.useState<'idle' | 'scanning' | 'success' | 'error'>('idle')
  // Identity verification: the ID type decides whether a photo of the back is needed too.
  const [idTypeChoice, setIdTypeChoice] = React.useState('')
  const [idPhotos, setIdPhotos] = React.useState<Partial<Record<IdSide, IdPhoto>>>({})
  const [captureSide, setCaptureSide] = React.useState<IdSide>('front')
  const [replacingId, setReplacingId] = React.useState(false)
  const [isEditing, setIsEditing] = React.useState(false)
  // Open crop pop-up: a newly picked file, or null file to re-crop the current photo.
  const [photoCrop, setPhotoCrop] = React.useState<{ file: File | null } | null>(null)
  const [editFirstName, setEditFirstName] = React.useState('')
  const [editMiddleInitial, setEditMiddleInitial] = React.useState('')
  const [editLastName, setEditLastName] = React.useState('')
  const [editNickname, setEditNickname] = React.useState('')
  const [approvedWaiver, setApprovedWaiver] = React.useState<ProfileWaiver | null>(null)
  const [editEmail, setEditEmail] = React.useState('')
  // Changing the email: the new address is confirmed with a code sent to it before it's saved.
  const [emailChange, setEmailChange] = React.useState<{ open: boolean; newEmail: string; codeSent: boolean; code: string; busy: boolean; error: string }>(
    { open: false, newEmail: '', codeSent: false, code: '', busy: false, error: '' },
  )
  const [editBirthDate, setEditBirthDate] = React.useState('')
  const [equipmentList, setEquipmentList] = React.useState<EquipmentItem[]>([])
  const [equipmentLoading, setEquipmentLoading] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const fileSideRef = React.useRef<IdSide>('front')
  const profileImageInputRef = React.useRef<HTMLInputElement | null>(null)
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const cameraStreamRef = React.useRef<MediaStream | null>(null)

  React.useEffect(() => {
    const lookupId = playerId || user?.id
    if (!lookupId) {
      setLoading(false)
      return
    }

    let alive = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await apiGet<{ ok: boolean; data: PlayerProfileDoc }>('/api/user_accounts/' + encodeURIComponent(lookupId))
        if (!alive) return
        setPlayer(res?.data || null)
      } catch (e: any) {
        if (!alive) return
        setPlayer(null)
        if (String(e?.message || e).includes('not found')) {
          setError(null)
        } else {
          setError(String(e?.message || e))
        }
      } finally {
        if (alive) setLoading(false)
      }
    })()

    return () => {
      alive = false
    }
  }, [playerId, user?.id])

  // The player's current approved waiver: it locks the legal name, and a minor's waiver holds
  // the parent/guardian details shown on the profile.
  React.useEffect(() => {
    const lookupId = playerId || user?.id
    if (!lookupId) return
    let alive = true
    const query = encodeURIComponent(JSON.stringify({ userId: String(lookupId), archived: { $ne: true } }))
    apiGet<{ ok: boolean; data: ProfileWaiver[] }>(`/api/waivers?q=${query}&limit=50`)
      .then((res) => {
        if (!alive) return
        const approved = (Array.isArray(res?.data) ? res.data : [])
          .filter((waiver) => String(waiver.status || '').toLowerCase() === 'approved')
          .sort((a, b) => String(b.approvedAtISO || b.submittedAtISO || '').localeCompare(String(a.approvedAtISO || a.submittedAtISO || '')))[0]
        setApprovedWaiver(approved || null)
      })
      .catch(() => {
        if (alive) setApprovedWaiver(null)
      })
    return () => {
      alive = false
    }
  }, [playerId, user?.id])

  // Fill the edit form from the saved profile, but not while it's open: saving a new photo updates
  // the profile and must not wipe details typed but not saved yet.
  React.useEffect(() => {
    if (player && !isEditing) {
      // Older accounts only have a full name: split it as a starting point.
      const parts = player.firstName || player.lastName
        ? { firstName: player.firstName || '', middleInitial: player.middleInitial || '', lastName: player.lastName || '' }
        : splitFullName(player.name || '')
      setEditFirstName(parts.firstName)
      setEditMiddleInitial(parts.middleInitial)
      setEditLastName(parts.lastName)
      setEditNickname(player.nickname || '')
      setEditEmail(player.email || (String(player.id || '') === String(user?.id || '') ? user?.email || '' : ''))
      setEditBirthDate(player.birthDate || '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, isEditing])

  React.useEffect(() => {
    let alive = true
    ;(async () => {
      setEquipmentLoading(true)
      try {
        const res = await apiGet<{ ok: boolean; data: EquipmentItem[] }>('/api/equipments?limit=200')
        if (!alive) return
        setEquipmentList(Array.isArray(res?.data) ? res.data : [])
      } catch {
        if (alive) setEquipmentList([])
      } finally {
        if (alive) setEquipmentLoading(false)
      }
    })()

    return () => {
      alive = false
    }
  }, [])

  const stopCamera = React.useCallback(() => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
    cameraStreamRef.current = null
    setCameraStream(null)
    setCameraActive(false)
    setScanStatus('idle')
  }, [])

  React.useEffect(() => {
    setMounted(true)
    return () => {
      stopCamera()
      setMounted(false)
    }
  }, [stopCamera])

  React.useEffect(() => {
    document.body.style.overflow = cameraActive ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [cameraActive])

  // Previews are object URLs: release them when they are replaced or the page closes.
  const idPhotosRef = React.useRef(idPhotos)
  idPhotosRef.current = idPhotos
  React.useEffect(() => () => {
    Object.values(idPhotosRef.current).forEach((photo) => photo && URL.revokeObjectURL(photo.preview))
  }, [])

  const setIdPhoto = (side: IdSide, blob: Blob | null, name = '') => {
    setIdPhotos((current) => {
      const previous = current[side]
      if (previous) URL.revokeObjectURL(previous.preview)
      const next = { ...current }
      if (blob) next[side] = { blob, name, preview: URL.createObjectURL(blob) }
      else delete next[side]
      return next
    })
  }

  const chooseIdType = (name: string) => {
    setIdTypeChoice(name)
    setError(null)
    // A front-only ID has no back photo.
    if (!idTypeNeedsBack(name)) setIdPhoto('back', null)
  }

  const needsBack = idTypeNeedsBack(idTypeChoice)
  const idPhotosReady = Boolean(idTypeChoice && idPhotos.front && (!needsBack || idPhotos.back))

  const submitIdentity = async () => {
    const lookupId = playerId || user?.id
    if (!lookupId || !idPhotosReady || !idPhotos.front) return

    setUploading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('userId', lookupId)
      formData.append('idType', idTypeChoice)
      formData.append('front', idPhotos.front.blob, idPhotos.front.name || 'id-front.jpg')
      if (needsBack && idPhotos.back) formData.append('back', idPhotos.back.blob, idPhotos.back.name || 'id-back.jpg')

      const uploadRes = await fetch(`${apiBase}/api/scan-id`, {
        method: 'POST',
        headers: getApiAuthHeaders(),
        body: formData,
      })
      const uploadJson = await uploadRes.json().catch(() => null)
      if (!uploadRes.ok || !uploadJson?.ok) {
        throw new Error(uploadJson?.error || 'ID submission failed')
      }

      const serverUser = uploadJson?.user as PlayerProfileDoc | null
      setPlayer((current) => serverUser || (current ? {
        ...current,
        identityVerificationStatus: 'pending_review',
        identityIdType: idTypeChoice,
        identityDocumentUrl: uploadJson.url,
        identityDocumentBackUrl: uploadJson.backUrl || '',
      } : null))
      setIdPhoto('front', null)
      setIdPhoto('back', null)
      setReplacingId(false)
      toast.success('ID submitted. Staff will verify it shortly.')
      setIsEditing(false)
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setUploading(false)
    }
  }

  const idValidUntilMs = Date.parse(player?.identityValidUntilISO || '')
  const idPastValidity = Number.isFinite(idValidUntilMs) && idValidUntilMs <= Date.now()
  const isVerified = player?.identityVerificationStatus === 'verified' && !idPastValidity
  const idExpired = player?.identityVerificationStatus === 'expired' || (player?.identityVerificationStatus === 'verified' && idPastValidity)
  // Counts for adding minors: a current verification, or the previous one while a newer ID is reviewed.
  const hasValidIdentity = isVerified || Date.parse(player?.identityPreviousValidUntilISO || '') > Date.now()

  const handleIdentityUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (isVerified) return
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Only image files are allowed (PNG, JPG or WEBP).')
      return
    }
    setError(null)
    setIdPhoto(fileSideRef.current, file, file.name)
  }

  const pickIdFile = (side: IdSide) => {
    fileSideRef.current = side
    fileInputRef.current?.click()
  }

  const uploadProfileImage = async (file: File): Promise<string> => {
    const formData = new FormData()
    formData.append('file', file, file.name)

    const uploadRes = await fetch(`${apiBase}/api/upload-image`, {
      method: 'POST',
      headers: getApiAuthHeaders(),
      body: formData,
    })
    const uploadJson = await uploadRes.json().catch(() => null)
    if (!uploadRes.ok || !uploadJson?.ok) {
      throw new Error(uploadJson?.error || 'Image upload failed')
    }
    return uploadJson.url
  }

  const openIdentityCapture = async (side: IdSide) => {
    if (isVerified) return
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera access is not supported in this browser.')
      return
    }

    try {
      stopCamera()
      setCaptureSide(side)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      })
      cameraStreamRef.current = stream
      setCameraStream(stream)
      setCameraActive(true)
      setError(null)
      setScanStatus('idle')
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {})
        }
      })
    } catch (e: any) {
      setError(String(e?.message || e))
    }
  }

  const captureIdentityPhoto = () => {
    if (!videoRef.current || !cameraStream) return
    setScanStatus('scanning')

    const video = videoRef.current
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 1280
    canvas.height = video.videoHeight || 720
    const context = canvas.getContext('2d')
    if (!context) return

    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => {
      if (!blob) {
        setScanStatus('error')
        return
      }
      setIdPhoto(captureSide, blob, `id-${captureSide}.jpg`)
      stopCamera()
    }, 'image/jpeg', 0.95)
  }

  const openEditProfile = () => {
    setError(null)
    setIsEditing(true)
  }

  // Picking a photo opens the crop pop-up first; the cropped photo is what gets uploaded.
  const handleProfileImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) setPhotoCrop({ file })
  }

  const saveCroppedPhoto = async (file: File) => {
    try {
      setProfileImageUploading(true)
      setError(null)
      const imageUrl = await uploadProfileImage(file)
      const lookupId = playerId || user?.id
      if (!lookupId) return

      const res = await apiPut<{ ok: boolean; data: PlayerProfileDoc }>(`/api/user_accounts/${encodeURIComponent(lookupId)}`, {
        profileImageUrl: imageUrl,
      })
      const updated = res?.data
      setPlayer((current) => current ? { ...current, ...updated, profileImageUrl: imageUrl } : current)
      updateUser({ name: updated?.name || user?.name || '', email: updated?.email || user?.email || '' })
      toast.success('Profile photo updated.')
      setPhotoCrop(null)
    } catch (e: any) {
      toast.error(String(e?.message || e))
    } finally {
      setProfileImageUploading(false)
    }
  }

  const handleSaveProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const lookupId = playerId || user?.id
    const nameParts = { firstName: editFirstName.trim(), middleInitial: editMiddleInitial.trim(), lastName: editLastName.trim() }
    const nextName = composeFullName(nameParts)
    if (!lookupId || !nameParts.firstName || !nameParts.lastName) {
      setError('First name and last name are required.')
      return
    }
    if (editBirthDate && !isValidBirthDate(editBirthDate)) {
      setError('Enter a valid birthday.')
      return
    }

    try {
      setSavingProfile(true)
      setError(null)

      const res = await apiPut<{ ok: boolean; data: PlayerProfileDoc }>(`/api/user_accounts/${encodeURIComponent(lookupId)}`, {
        // The legal name is locked once a waiver is approved under it.
        ...(nameLocked ? {} : nameParts),
        nickname: editNickname.trim(),
        ...(editBirthDate && !birthDateLocked ? { birthDate: editBirthDate } : {}),
      })
      const updated = res?.data
      const merged = {
        ...(player || {}),
        ...updated,
        ...(nameLocked ? {} : { ...nameParts, name: nextName }),
        nickname: editNickname.trim(),
        ...(editBirthDate ? { birthDate: editBirthDate } : {}),
      }
      setPlayer(merged)
      if (viewingOwn) updateUser({ name: merged.name || nextName })

      toast.success('Profile updated successfully.')
      setIsEditing(false)
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setSavingProfile(false)
    }
  }

  const resetEmailChange = () => setEmailChange({ open: false, newEmail: '', codeSent: false, code: '', busy: false, error: '' })

  const sendEmailChangeCode = async () => {
    const newEmail = emailChange.newEmail.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      setEmailChange((current) => ({ ...current, error: 'Enter a valid email address.' }))
      return
    }
    if (newEmail === editEmail.trim().toLowerCase()) {
      setEmailChange((current) => ({ ...current, error: 'That is already your email.' }))
      return
    }
    setEmailChange((current) => ({ ...current, busy: true, error: '' }))
    try {
      const res = await apiPost<{ ok: boolean; message?: string }>('/api/auth/change-email/request', { newEmail })
      setEmailChange((current) => ({ ...current, newEmail, codeSent: true, code: '', busy: false }))
      toast.success(res?.message || `Code sent to ${newEmail}.`)
    } catch (e: any) {
      setEmailChange((current) => ({ ...current, busy: false, error: String(e?.message || e) }))
    }
  }

  const confirmEmailChange = async () => {
    const code = emailChange.code.trim()
    if (!/^\d{6}$/.test(code)) {
      setEmailChange((current) => ({ ...current, error: 'Enter the 6-digit code from the email.' }))
      return
    }
    setEmailChange((current) => ({ ...current, busy: true, error: '' }))
    try {
      const res = await apiPost<{ ok: boolean; token: string; user: { email: string } }>('/api/auth/change-email/verify', { otp: code, remember })
      const nextEmail = res.user.email
      replaceToken(res.token, { email: nextEmail })
      setEditEmail(nextEmail)
      setPlayer((current) => (current ? { ...current, email: nextEmail } : current))
      resetEmailChange()
      toast.success(`Your email is now ${nextEmail}.`)
    } catch (e: any) {
      setEmailChange((current) => ({ ...current, busy: false, error: String(e?.message || e) }))
    }
  }

  const handlePasswordReset = async () => {
    const emailToUse = (player?.email || user?.email || '').trim()
    if (!emailToUse) {
      setError('No email is available for password reset.')
      return
    }

    try {
      setError(null)
      await apiPost('/api/auth/forgot-password', { email: emailToUse })
      toast.success('We emailed you a 6-digit code to reset your password.')
      setIsEditing(false)
      navigate(`/otp?email=${encodeURIComponent(emailToUse)}&flow=reset`)
    } catch (e: any) {
      setError(String(e?.message || e))
    }
  }

  const displayName = player?.name || user?.name || (playerId ? `Player ${playerId}` : 'Unnamed player')
  // The verified ID (and an approved waiver) carry the legal name and birthday.
  const nameLocked = Boolean(approvedWaiver) || isVerified
  const birthDateLocked = isVerified
  const isMinorPlayer = Boolean(approvedWaiver && (approvedWaiver.isMinor || Number(approvedWaiver.age) < 18))
    || (ageFromBirthDate(player?.birthDate) ?? 99) < 18
  const displayEmail = player?.email || user?.email || '—'
  const displayRole = player?.role || user?.role || 'user'
  // Admin, marshal and registrar accounts don't verify an ID.
  const isPlayerAccount = String(displayRole).toLowerCase() === 'user'
  // A parent looking at one of their children's profiles: same page, the child's own progress.
  const viewingChild = Boolean(player?.isChildProfile && String(player.guardianId) === String(user?.id))
  const viewingOwn = !playerId || String(playerId) === String(user?.id)
  const ownedEquipment = React.useMemo(() => {
    const selectedIds = Array.isArray(player?.equipmentIds) && player.equipmentIds.length > 0
      ? player.equipmentIds
      : []

    if (selectedIds.length > 0) {
      return equipmentList.filter((item) => selectedIds.includes(item.id || ''))
    }

    if (Array.isArray(player?.equipment) && player.equipment.length > 0) {
      return player.equipment.filter((item) => Boolean(item?.name))
    }

    return []
  }, [equipmentList, player?.equipment, player?.equipmentIds])

  const verificationLabel = player?.identityVerificationStatus === 'pending_review'
    ? 'Pending Review'
    : isVerified
      ? 'Verified'
      : idExpired
        ? 'Expired'
        : player?.identityVerificationStatus === 'rejected'
          ? 'Not Accepted'
          : 'Not Submitted'
  const hasBirthday = Boolean(player?.birthDate)
  const idSubmitted = player?.identityVerificationStatus === 'pending_review' || isVerified
  const showIdForm = isPlayerAccount && hasBirthday && (replacingId || !idSubmitted)
  const formatLongDate = (iso?: string) => (iso
    ? new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
    : '')

  // Identity verification: on the profile until the ID is verified, then inside Edit Profile
  // (read-only there; it comes back out when it expires after a year).
  const identitySection = (
    <>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-widest text-muted">Identity Verification</div>
              <div className="mt-1 text-sm font-semibold">{verificationLabel}</div>
              <div className="mt-1 text-sm text-muted">
                {isVerified
                  ? `Your ID is verified${player?.identityValidUntilISO ? ` until ${formatLongDate(player.identityValidUntilISO)}` : ''}. You'll submit it again once a year to keep signing waivers.`
                  : idExpired
                    ? 'Your ID verification is over a year old. Submit your ID again to keep signing waivers and joining teams.'
                    : 'Submit a government-issued ID for staff to verify. Your waiver opens once it is verified.'}
              </div>
            </div>
            <span className={`shrink-0 rounded-full border px-3 py-1 text-[11px] font-semibold ${isVerified ? 'border-success/30 bg-success/20 text-success' : player?.identityVerificationStatus === 'pending_review' ? 'border-accent/30 bg-accent/20 text-accent' : idExpired ? 'border-danger/30 bg-danger/15 text-danger' : 'border-white/10 bg-white/5 text-muted'}`}>
              {verificationLabel}
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {!hasBirthday ? (
              // The ID is checked against the birthday, so it comes first.
              <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-4 text-sm">
                <div className="font-semibold">Add your birthday first</div>
                <div className="mt-1 text-xs text-muted">Your ID is checked against the birthday on your profile. Add it, then you can submit your ID.</div>
                {!viewingChild && (viewingOwn || user?.role === 'admin') ? (
                  <Button type="button" className="mt-3 w-full" onClick={openEditProfile}>Add birthday</Button>
                ) : null}
              </div>
            ) : null}

            {hasBirthday && idSubmitted && !replacingId ? (
              <div className="space-y-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm">
                  <div className="text-xs text-muted">ID submitted</div>
                  <div className="font-semibold">{player?.identityIdType || 'Government ID'}</div>
                  {!isVerified ? (
                    <div className="mt-1 text-xs text-muted">
                      Waiting for staff to verify it.
                      {Date.parse(player?.identityPreviousValidUntilISO || '') > Date.now()
                        ? ` Your previous ID still counts until ${formatLongDate(player?.identityPreviousValidUntilISO)}.`
                        : ''}
                    </div>
                  ) : player?.identityValidUntilISO ? (
                    <div className="mt-1 text-xs text-muted">Valid until {formatLongDate(player.identityValidUntilISO)}</div>
                  ) : null}
                </div>
                {player?.identityDocumentUrl || player?.identityDocumentBackUrl ? (
                  <div className={`grid gap-2 ${player?.identityDocumentBackUrl ? 'sm:grid-cols-2' : ''}`}>
                    {([['Front', player?.identityDocumentUrl], ['Back', player?.identityDocumentBackUrl]] as const).map(([side, url]) => url ? (
                      <a
                        key={side}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="group block overflow-hidden rounded-2xl border border-white/10 bg-black/20 transition hover:border-accent/40"
                        title={`Open the ${side.toLowerCase()} of your ID in full size`}
                      >
                        <img src={url} alt={`Your ID (${side.toLowerCase()})`} className="h-auto max-h-60 w-full object-contain" />
                        <div className="flex items-center justify-between px-3 py-2 text-xs">
                          <span className="font-semibold">{side}</span>
                          <span className="text-muted group-hover:text-text">View full size</span>
                        </div>
                      </a>
                    ) : null)}
                  </div>
                ) : (
                  <div className="text-xs text-muted">Your ID photo isn't available to preview.</div>
                )}
                {/* A verified ID can't be changed: it is submitted again only once it expires after a year,
                    when the waiver is renewed too. */}
                {isVerified ? (
                  <div className="text-[11px] text-muted">
                    Your verified ID can't be changed. You'll submit it again when it expires{player?.identityValidUntilISO ? ` on ${formatLongDate(player.identityValidUntilISO)}` : ' after a year'}, together with your yearly waiver.
                  </div>
                ) : (
                  <Button type="button" variant="ghost" className="w-full" onClick={() => setReplacingId(true)}>
                    Submit a different ID
                  </Button>
                )}
              </div>
            ) : null}

            {showIdForm ? (
              <div className="space-y-3">
                {idExpired ? (
                  <div className="rounded-2xl border border-danger/20 bg-danger/10 p-3 text-xs text-danger">
                    Your ID verification expired after a year. Submit your current ID to verify again.
                  </div>
                ) : null}
                {player?.identityVerificationStatus === 'rejected' ? (
                  <div className="rounded-2xl border border-danger/20 bg-danger/10 p-3 text-xs text-danger">
                    Your last ID was not accepted. Please submit a clear photo of a valid ID.
                  </div>
                ) : null}
                <label className="block">
                  <div className="mb-1 text-xs font-semibold text-muted">Which ID are you submitting?</div>
                  <select
                    value={idTypeChoice}
                    onChange={(event) => chooseIdType(event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-background px-4 py-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/40 [&>option]:bg-background [&>optgroup]:bg-background"
                  >
                    <option value="">Select the ID type…</option>
                    <optgroup label="Front side only">
                      {IDENTITY_ID_TYPES.filter((type) => type.sides === 'front').map((type) => <option key={type.name} value={type.name}>{type.name}</option>)}
                    </optgroup>
                    <optgroup label="Front and back">
                      {IDENTITY_ID_TYPES.filter((type) => type.sides === 'front_back').map((type) => <option key={type.name} value={type.name}>{type.name}</option>)}
                    </optgroup>
                  </select>
                  {idTypeChoice ? (
                    <div className="mt-1 text-xs text-muted">
                      {needsBack ? 'Needs photos of the front and the back. ' : 'Only the front is needed. '}
                      {IDENTITY_ID_TYPES.find((type) => type.name === idTypeChoice)?.note}
                    </div>
                  ) : null}
                </label>

                {idTypeChoice ? (
                  <div className={`grid gap-3 ${needsBack ? 'sm:grid-cols-2' : ''}`}>
                    {(needsBack ? (['front', 'back'] as const) : (['front'] as const)).map((side) => {
                      const photo = idPhotos[side]
                      return (
                        <div key={side} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                          <div className="text-xs font-bold uppercase tracking-widest text-muted">{side === 'front' ? 'Front' : 'Back'}</div>
                          {photo ? (
                            <div className="mt-2 overflow-hidden rounded-xl border border-white/10">
                              <img src={photo.preview} alt={`ID ${side}`} className="h-auto max-h-48 w-full object-contain" />
                            </div>
                          ) : (
                            <div className="mt-2 grid h-24 place-items-center rounded-xl border border-dashed border-white/15 bg-black/20 text-xs text-muted">
                              No photo yet
                            </div>
                          )}
                          <div className="mt-2 flex gap-2">
                            <Button type="button" size="sm" className="flex-1" onClick={() => openIdentityCapture(side)}>
                              {photo ? 'Retake' : 'Camera'}
                            </Button>
                            <Button type="button" size="sm" variant="ghost" className="flex-1" onClick={() => pickIdFile(side)}>
                              {photo ? 'Replace' : 'Upload'}
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : null}

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button type="button" className="sm:flex-1" onClick={submitIdentity} disabled={!idPhotosReady || uploading}>
                    {uploading ? 'Submitting…' : isVerified ? 'Submit new ID for verification' : 'Submit ID for verification'}
                  </Button>
                  {replacingId ? (
                    <Button type="button" variant="ghost" className="flex-1" onClick={() => setReplacingId(false)} disabled={uploading}>
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

          </div>
    </>
  )


  return (
    <div className="space-y-4">
      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleIdentityUpload} className="hidden" />
      {mounted && cameraActive
        ? createPortal(
            <div className="fixed inset-0 z-[100002] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm">
              <div className="max-h-[90dvh] overflow-y-auto overscroll-contain w-full max-w-4xl rounded-3xl border border-white/10 bg-background p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_30px_80px_rgba(0,0,0,0.65)]">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">Capture the {captureSide} of your {idTypeChoice || 'ID'}</div>
                    <div className="text-sm text-muted">Position the ID clearly in the camera view, with all four corners showing.</div>
                  </div>
                  <Button type="button" variant="ghost" onClick={stopCamera}>
                    Close
                  </Button>
                </div>
                <div className="space-y-3">
                  <div className="relative">
                    <video ref={videoRef} autoPlay playsInline muted className="h-[45dvh] w-full rounded-2xl bg-black object-cover sm:h-[60dvh]" />
                    <div className={`absolute inset-0 rounded-2xl border-2 transition ${scanStatus === 'success' ? 'border-success' : scanStatus === 'scanning' ? 'border-amber-400' : 'border-danger/80'}`} />
                    <div className={`absolute left-4 top-4 rounded-full px-3 py-1 text-xs font-semibold ${scanStatus === 'success' ? 'bg-success/20 text-success' : scanStatus === 'scanning' ? 'bg-amber-200 text-amber-700' : 'bg-danger/20 text-danger'}`}>
                      {scanStatus === 'scanning'
                        ? 'Capturing...'
                        : scanStatus === 'error'
                          ? 'Capture failed'
                          : `Ready: ${captureSide} side`}
                    </div>
                  </div>
                  {error ? (
                    <div className="rounded-2xl border border-danger/20 bg-danger/10 p-3 text-sm text-danger">{error}</div>
                  ) : null}
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button type="button" className="sm:flex-1" onClick={captureIdentityPhoto} disabled={scanStatus === 'scanning'}>
                      Capture {captureSide}
                    </Button>
                    <Button type="button" variant="ghost" className="sm:flex-1" onClick={stopCamera}>
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {photoCrop ? (
        <ProfilePhotoCropModal
          initialFile={photoCrop.file}
          currentUrl={player?.profileImageUrl}
          saving={profileImageUploading}
          onClose={() => setPhotoCrop(null)}
          onSave={(file) => { void saveCroppedPhoto(file) }}
        />
      ) : null}

      {isEditing ? createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 p-3 sm:p-4 backdrop-blur-sm">
          <div className="relative z-[100000] max-h-[90dvh] overflow-y-auto overscroll-contain w-full max-w-xl rounded-3xl border border-white/10 bg-background p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_30px_80px_rgba(0,0,0,0.65)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Edit Profile</div>
                <div className="text-sm text-muted">Update your public details and profile photo.</div>
              </div>
              <Button type="button" variant="ghost" onClick={() => { setIsEditing(false); resetEmailChange() }}>
                Close
              </Button>
            </div>

            <form className="mt-4 space-y-4" onSubmit={handleSaveProfile}>
              <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 sm:flex-row sm:items-center">
                <div className="relative h-16 w-16 shrink-0">
                  <div className="h-16 w-16 overflow-hidden rounded-2xl border border-white/10 bg-background">
                    {player?.profileImageUrl ? (
                      <img src={player.profileImageUrl} alt="Profile" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-muted">IMG</div>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label="Edit profile photo"
                    title="Edit profile photo"
                    disabled={profileImageUploading}
                    onClick={() => setPhotoCrop({ file: null })}
                    className="absolute -bottom-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-accent text-xs text-white shadow-soft transition hover:brightness-110 disabled:opacity-50"
                  >
                    <FiEdit2 />
                  </button>
                </div>
                <div className="flex-1">
                  <div className="text-sm font-semibold">Profile photo</div>
                  <div className="mt-1 text-xs text-muted">Upload a new photo, or tap the pencil to crop your current one. You crop it before it's saved.</div>
                  <Button type="button" variant="ghost" className="mt-3" onClick={() => profileImageInputRef.current?.click()} disabled={profileImageUploading}>
                    {profileImageUploading ? 'Uploading…' : 'Upload profile photo'}
                  </Button>
                  <input ref={profileImageInputRef} type="file" accept="image/*" onChange={handleProfileImageChange} className="hidden" />
                </div>
              </div>

              <div>
                <div className="grid gap-3 sm:grid-cols-[1fr_5rem_1fr]">
                  <Input
                    label="First name"
                    value={editFirstName}
                    onChange={(event) => setEditFirstName(event.target.value)}
                    placeholder="Juan"
                    autoComplete="given-name"
                    disabled={nameLocked}
                    readOnly={nameLocked}
                  />
                  <Input
                    label="M.I."
                    value={editMiddleInitial}
                    maxLength={2}
                    onChange={(event) => setEditMiddleInitial(event.target.value.replace(/[^A-Za-zÀ-ÿÑñ.]/g, '').slice(0, 2))}
                    placeholder="D"
                    autoComplete="additional-name"
                    disabled={nameLocked}
                    readOnly={nameLocked}
                  />
                  <Input
                    label="Last name"
                    value={editLastName}
                    onChange={(event) => setEditLastName(event.target.value)}
                    placeholder="Dela Cruz"
                    autoComplete="family-name"
                    disabled={nameLocked}
                    readOnly={nameLocked}
                  />
                </div>
                <div className="mt-2 text-xs text-muted">
                  {nameLocked
                    ? isVerified
                      ? 'Your name is locked because your ID was verified under it. Ask staff if it needs correcting.'
                      : 'Your name is locked because your waiver was approved under it. Ask staff if it needs correcting.'
                    : `Use your name exactly as it appears on your ID. Your waiver is filled in as "${composeFullName({ firstName: editFirstName, middleInitial: editMiddleInitial, lastName: editLastName }) || 'First M. Last'}".`}
                </div>
              </div>

              <Input
                label="Nickname (optional)"
                value={editNickname}
                maxLength={30}
                onChange={(event) => setEditNickname(event.target.value)}
                placeholder="What teammates call you on the field"
                hint="Shown on your profile next to your name. Waivers and receipts always use your legal name."
              />

              <div>
                {/* Shown as plain text, not a field: the email only changes through "Change email". */}
                <div className="mb-2 text-sm font-semibold text-text">Email</div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="break-all text-sm font-medium text-text">{editEmail || '—'}</div>
                    {viewingOwn ? <div className="mt-1 text-xs text-muted">Your current sign-in email.</div> : null}
                  </div>
                  {viewingOwn && !emailChange.open ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setEmailChange((current) => ({ ...current, open: true, error: '' }))}>
                      Change email
                    </Button>
                  ) : null}
                </div>

                {viewingOwn && emailChange.open ? (
                  <div className="mt-2 space-y-3 rounded-2xl border border-white/10 bg-white/5 p-3">
                    <div className="text-sm font-semibold">Change email</div>
                    {!emailChange.codeSent ? (
                      <>
                        <Input
                          label="New email"
                          type="email"
                          value={emailChange.newEmail}
                          autoComplete="email"
                          placeholder="new@email.com"
                          onChange={(event) => setEmailChange((current) => ({ ...current, newEmail: event.target.value, error: '' }))}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              void sendEmailChangeCode()
                            }
                          }}
                          hint="We'll email a 6-digit code to this address. Your email only changes once you enter it."
                        />
                        <div className="flex gap-2">
                          <Button type="button" className="flex-1" onClick={sendEmailChangeCode} disabled={emailChange.busy || !emailChange.newEmail.trim()}>
                            {emailChange.busy ? 'Sending…' : 'Send code'}
                          </Button>
                          <Button type="button" variant="ghost" className="flex-1" onClick={resetEmailChange} disabled={emailChange.busy}>Cancel</Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-xs text-muted">
                          Enter the code we sent to <span className="font-semibold text-text">{emailChange.newEmail}</span>. It expires in 10 minutes.
                        </div>
                        <Input
                          label="Verification code"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={6}
                          value={emailChange.code}
                          placeholder="123456"
                          onChange={(event) => setEmailChange((current) => ({ ...current, code: event.target.value.replace(/\D/g, '').slice(0, 6), error: '' }))}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              void confirmEmailChange()
                            }
                          }}
                        />
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Button type="button" className="sm:flex-1" onClick={confirmEmailChange} disabled={emailChange.busy || emailChange.code.length !== 6}>
                            {emailChange.busy ? 'Verifying…' : 'Verify & change email'}
                          </Button>
                          <Button type="button" variant="ghost" className="sm:flex-1" onClick={sendEmailChangeCode} disabled={emailChange.busy}>Resend code</Button>
                          <Button type="button" variant="ghost" className="flex-1" onClick={resetEmailChange} disabled={emailChange.busy}>Cancel</Button>
                        </div>
                        <button
                          type="button"
                          className="text-xs text-accent hover:text-text"
                          onClick={() => setEmailChange((current) => ({ ...current, codeSent: false, code: '', error: '' }))}
                        >
                          Use a different email
                        </button>
                      </>
                    )}
                    {emailChange.error ? <div className="rounded-xl border border-danger/20 bg-danger/10 p-2 text-xs text-danger">{emailChange.error}</div> : null}
                  </div>
                ) : null}
              </div>

              <Input
                label="Birthday"
                type="date"
                value={editBirthDate}
                max={maxAdultBirthDate()}
                disabled={birthDateLocked}
                readOnly={birthDateLocked}
                onChange={(event) => setEditBirthDate(event.target.value)}
                hint={birthDateLocked
                  ? 'Locked because your ID was verified with it. Ask staff if it needs correcting.'
                  : ageFromBirthDate(editBirthDate) !== null
                    ? `Age: ${ageFromBirthDate(editBirthDate)}. Needed before you can verify your ID.`
                    : 'Needed before you can verify your ID. Also fills in your age on waivers.'}
              />

              {!viewingChild && isPlayerAccount && isVerified ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  {identitySection}
                </div>
              ) : null}

              {error ? <div className="rounded-2xl border border-danger/20 bg-danger/10 p-3 text-sm text-danger">{error}</div> : null}

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="submit" className="sm:flex-1" disabled={savingProfile}>
                  {savingProfile ? 'Saving…' : 'Save changes'}
                </Button>
                <Button type="button" variant="ghost" className="sm:flex-1" onClick={handlePasswordReset}>
                  Change password
                </Button>
              </div>
            </form>
          </div>
        </div>
      , document.body) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <div className="text-sm font-medium text-accent">{viewingChild ? `Minor on your account` : 'Player'}</div>
          <h1 className="text-3xl font-bold">{viewingChild ? `${player?.name || 'Child'}'s Profile` : 'Player Profile'}</h1>
          <p className="text-muted text-sm">Profile details for ID: {playerId ?? '—'}</p>
        </div>
        {/* Minors don't have profiles of their own; a parent opened an old link to one. */}
        {viewingChild ? (
          <Button variant="ghost" onClick={() => navigate(`/app/players/${encodeURIComponent(String(user?.id || ''))}`)}>
            Back to my profile
          </Button>
        ) : null}
      </div>

      {loading ? (
        <Card className="p-4 text-sm text-muted">Loading profile…</Card>
      ) : error ? (
        <Card className="p-4 text-sm text-danger">{error}</Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="p-4">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-white/5">
              {player?.profileImageUrl ? (
                <img src={player.profileImageUrl} alt={displayName} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted">IMG</div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-lg font-bold">
                {displayName}
                {player?.nickname ? <span className="ml-2 text-sm font-semibold text-accent">“{player.nickname}”</span> : null}
              </div>
              {isPlayerAccount ? (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${isVerified ? 'border-success/30 bg-success/20 text-success' : player?.identityVerificationStatus === 'pending_review' ? 'border-accent/30 bg-accent/20 text-accent' : 'border-danger/30 bg-danger/20 text-danger'}`}>
                    {isVerified ? 'Verified' : player?.identityVerificationStatus === 'pending_review' ? 'Verification pending' : idExpired ? 'ID expired' : 'Verification required'}
                  </span>
                </div>
              ) : null}
              <div className="text-sm text-muted">Role: {displayRole}</div>
              <div className="text-sm text-muted">Email: {displayEmail}</div>
              <div className="text-sm text-muted">
                Age: {ageFromBirthDate(player?.birthDate) ?? '—'}
                {player?.birthDate ? ` (born ${new Date(`${player.birthDate}T00:00:00`).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })})` : ''}
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl bg-white/5 border border-white/10 p-4">
            <div className="text-xs uppercase tracking-widest text-muted">Gear Owned</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {equipmentLoading ? (
                <span className="text-sm text-muted">Loading gear…</span>
              ) : ownedEquipment.length > 0 ? (
                ownedEquipment.map((item) => (
                  <span key={item.id || item.name} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-text">
                    {item.name || 'Unnamed gear'}
                  </span>
                ))
              ) : (
                <span className="text-sm text-muted">No gear assigned yet.</span>
              )}
            </div>
          </div>

          {displayRole === 'user' && isMinorPlayer ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-widest text-muted">Parent / guardian</div>
              {approvedWaiver && (approvedWaiver.guardianName || approvedWaiver.guardianEmail) ? (
                <>
                  <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
                    <div>
                      <div className="text-xs text-muted">Name</div>
                      <div className="font-semibold">{approvedWaiver.guardianName || '—'}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs text-muted">Email</div>
                      <div className="truncate font-semibold">{approvedWaiver.guardianEmail || '—'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted">Contact number</div>
                      <div className="font-semibold">{approvedWaiver.guardianPhone ? formatPhPhone(approvedWaiver.guardianPhone) : '—'}</div>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-muted">
                    From the approved waiver. This parent or guardian is responsible for the player at every game.
                  </div>
                </>
              ) : (
                <div className="mt-2 text-sm text-muted">
                  Your parent or guardian's details appear here once your waiver is approved. They are entered when you sign the waiver.
                </div>
              )}
            </div>
          ) : null}

          {(playerId || user?.id) && displayRole === 'user' ? (
            <div className="mt-4">
              <PlayerStatsCard playerId={String(playerId || user?.id)} canAdjust={user?.role === 'admin'} />
            </div>
          ) : null}

          <div className="mt-4 space-y-2">
            {(!playerId || playerId === user?.id) && user?.role === 'user' ? (
              <Button className="w-full" onClick={() => navigate('/app/my-reservations')}>View Reservation History</Button>
            ) : null}
            {!viewingChild ? (
              <Button
                variant="ghost"
                className="w-full bg-white/5 border border-white/10"
                onClick={openEditProfile}
              >
                Edit Profile
              </Button>
            ) : null}
          </div>
        </Card>

        {!viewingChild && isPlayerAccount && !isVerified ? (
        <Card className="p-4">
          {identitySection}
        </Card>
        ) : null}

        {viewingOwn && !viewingChild && user?.role === 'user' && isPlayerAccount ? (
          <MinorsOnProfile
            canAdd={hasValidIdentity}
            blockedReason={hasValidIdentity ? undefined : 'Verify your ID first. Once staff verify it, you can add the children who play with you.'}
          />
        ) : null}

        {user?.role === 'user' && String(player?.id || '') === String(user.id) ? (
          <PartnershipDiscountCard
            institution={player?.partnershipInstitution}
            status={player?.partnershipEligibilityStatus}
            reviewReason={player?.partnershipReviewReason}
            onSubmitted={(next) => setPlayer((current) => (current ? { ...current, ...next } : current))}
          />
        ) : null}
      </div>
    </div>
  )
}
