import React from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { apiBase, apiGet, apiPost, apiPut, getApiAuthHeaders } from '../../utils/apiClient'
import { PartnershipDiscountCard } from './PartnershipDiscountCard'
import { useAuth } from '../../context/AuthContext'

type PlayerProfileDoc = {
  id?: string
  name?: string
  email?: string
  role?: string
  experience?: number
  createdAtISO?: string
  identityVerificationStatus?: string
  identityDocumentUrl?: string
  profileImageUrl?: string
  emailVerified?: boolean
  equipmentIds?: string[]
  equipment?: Array<{ id?: string; name?: string; category?: string }>
  partnershipInstitution?: string
  partnershipEligibilityStatus?: string
  partnershipReviewReason?: string
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
  const { user, updateUser } = useAuth()
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
  const [isEditing, setIsEditing] = React.useState(false)
  const [editName, setEditName] = React.useState('')
  const [editEmail, setEditEmail] = React.useState('')
  const [equipmentList, setEquipmentList] = React.useState<EquipmentItem[]>([])
  const [equipmentLoading, setEquipmentLoading] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
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

  React.useEffect(() => {
    if (player) {
      setEditName(player.name || '')
      setEditEmail(player.email || '')
    }
  }, [player])

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

  const uploadIdentityImage = async (file: File | Blob, filename: string): Promise<boolean> => {
    const lookupId = playerId || user?.id
    if (!lookupId) return false

    setUploading(true)
    setScanStatus('scanning')
    setError(null)

    try {
      const formData = new FormData()
      formData.append('file', file, filename)
      formData.append('userId', lookupId)

      const uploadRes = await fetch(`${apiBase}/api/scan-id`, {
        method: 'POST',
        headers: getApiAuthHeaders(),
        body: formData,
      })
      const uploadJson = await uploadRes.json().catch(() => null)
      if (!uploadRes.ok || !uploadJson?.ok) {
        throw new Error(uploadJson?.error || 'ID scan failed')
      }

      const scanSummary = uploadJson?.scan?.summary || 'ID captured successfully.'
      const cardDetected = Boolean(uploadJson?.scan?.cardDetected)
      const serverUser = uploadJson?.user as PlayerProfileDoc | null
      setScanStatus('success')
      setPlayer((current) => {
        if (serverUser) {
          return serverUser
        }
        return current ? {
          ...current,
          identityVerificationStatus: cardDetected ? 'verified' : 'pending_review',
          identityDocumentUrl: uploadJson.url,
          identityScanStatus: cardDetected ? 'detected' : 'not_detected',
          identityScanProvider: uploadJson?.scan?.provider,
          identityScanSummary: scanSummary,
          identityScanDetected: cardDetected,
        } : null
      })

      if (cardDetected) {
        toast.success('Identity verified successfully.')
        stopCamera()
      }

      return true
    } catch (e: any) {
      setScanStatus('error')
      setError(String(e?.message || e))
      return false
    } finally {
      setUploading(false)
    }
  }

  const isVerified = player?.identityVerificationStatus === 'verified'

  const handleIdentityUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (isVerified) return
    const file = event.target.files?.[0]
    if (!file) return
    await uploadIdentityImage(file, file.name)
    event.target.value = ''
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

  const openIdentityCapture = async () => {
    if (isVerified) return
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera access is not supported in this browser.')
      return
    }

    try {
      stopCamera()
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

  const captureIdentityPhoto = async () => {
    if (!videoRef.current || !cameraStream) return
    setScanStatus('scanning')

    const video = videoRef.current
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 1280
    canvas.height = video.videoHeight || 720
    const context = canvas.getContext('2d')
    if (!context) return

    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(async (blob) => {
      if (!blob) return
      const success = await uploadIdentityImage(blob, 'id-capture.jpg')
      if (success) {
        stopCamera()
      }
    }, 'image/jpeg', 0.95)
  }

  const handleRetakeCapture = async () => {
    if (isVerified) return
    setError(null)
    setScanStatus('idle')
    setPlayer((current) => current ? {
      ...current,
      identityDocumentUrl: undefined,
    } : current)
    await openIdentityCapture()
  }

  const openEditProfile = () => {
    setError(null)
    setIsEditing(true)
  }

  const handleProfileImageChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

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
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setProfileImageUploading(false)
      event.target.value = ''
    }
  }

  const handleSaveProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const lookupId = playerId || user?.id
    const nextName = editName.trim()
    const nextEmail = editEmail.trim().toLowerCase()
    if (!lookupId || !nextName || !nextEmail) {
      setError('Name and email are required.')
      return
    }

    try {
      setSavingProfile(true)
      setError(null)

      const res = await apiPut<{ ok: boolean; data: PlayerProfileDoc }>(`/api/user_accounts/${encodeURIComponent(lookupId)}`, {
        name: nextName,
        email: nextEmail,
      })
      const updated = res?.data
      const merged = { ...(player || {}), ...updated, name: nextName, email: nextEmail }
      setPlayer(merged)
      updateUser({ name: nextName, email: nextEmail })

      if (player?.email && nextEmail !== player.email.toLowerCase()) {
        try {
          await apiPost('/api/auth/send-otp', { email: nextEmail })
          toast.success('Verification code sent to your new email.')
        } catch (otpErr: any) {
          toast.error(String(otpErr?.message || otpErr))
        }
      }

      toast.success('Profile updated successfully.')
      setIsEditing(false)
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setSavingProfile(false)
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
      await apiPost('/api/auth/send-otp', { email: emailToUse })
      toast.success('Verification code sent for password reset.')
      setIsEditing(false)
      navigate(`/otp?email=${encodeURIComponent(emailToUse)}&flow=reset`)
    } catch (e: any) {
      setError(String(e?.message || e))
    }
  }

  const displayName = player?.name || user?.name || (playerId ? `Player ${playerId}` : 'Unnamed player')
  const displayEmail = player?.email || user?.email || '—'
  const displayRole = player?.role || user?.role || 'user'
  const displayExperience = player?.experience ?? 0
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
    : player?.identityVerificationStatus === 'verified'
      ? 'Verified'
      : 'Not Submitted'

  return (
    <div className="space-y-4">
      {mounted && cameraActive
        ? createPortal(
            <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm">
              <div className="w-full max-w-4xl rounded-3xl border border-white/10 bg-background p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_30px_80px_rgba(0,0,0,0.65)]">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">Scan Government ID</div>
                    <div className="text-sm text-muted">Position the ID clearly in the camera view.</div>
                  </div>
                  <Button type="button" variant="ghost" onClick={stopCamera}>
                    Close
                  </Button>
                </div>
                <div className="space-y-3">
                  <div className="relative">
                    <video ref={videoRef} autoPlay playsInline muted className="h-[60vh] w-full rounded-2xl bg-black object-cover" />
                    <div className={`absolute inset-0 rounded-2xl border-2 transition ${scanStatus === 'success' ? 'border-success' : scanStatus === 'scanning' ? 'border-amber-400' : 'border-danger/80'}`} />
                    <div className={`absolute left-4 top-4 rounded-full px-3 py-1 text-xs font-semibold ${scanStatus === 'success' ? 'bg-success/20 text-success' : scanStatus === 'scanning' ? 'bg-amber-200 text-amber-700' : 'bg-danger/20 text-danger'}`}>
                      {scanStatus === 'success'
                        ? 'Card Detected'
                        : scanStatus === 'scanning'
                          ? 'Scanning...'
                          : scanStatus === 'error'
                            ? 'Scan Failed'
                            : 'Ready to Scan'}
                    </div>
                  </div>
                  {error ? (
                    <div className="rounded-2xl border border-danger/20 bg-danger/10 p-3 text-sm text-danger">{error}</div>
                  ) : null}
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button type="button" className="flex-1" onClick={captureIdentityPhoto} disabled={uploading}>
                      {uploading ? 'Scanning…' : 'Scan Now'}
                    </Button>
                    <Button type="button" variant="ghost" className="flex-1" onClick={stopCamera}>
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {isEditing ? createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="relative z-[100000] w-full max-w-xl rounded-3xl border border-white/10 bg-background p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_30px_80px_rgba(0,0,0,0.65)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Edit Profile</div>
                <div className="text-sm text-muted">Update your public details and profile photo.</div>
              </div>
              <Button type="button" variant="ghost" onClick={() => setIsEditing(false)}>
                Close
              </Button>
            </div>

            <form className="mt-4 space-y-4" onSubmit={handleSaveProfile}>
              <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 sm:flex-row sm:items-center">
                <div className="h-16 w-16 overflow-hidden rounded-2xl border border-white/10 bg-background">
                  {player?.profileImageUrl ? (
                    <img src={player.profileImageUrl} alt="Profile" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-muted">IMG</div>
                  )}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-semibold">Profile photo</div>
                  <div className="mt-1 text-xs text-muted">Upload a new profile image to replace the current photo.</div>
                  <Button type="button" variant="ghost" className="mt-3" onClick={() => profileImageInputRef.current?.click()} disabled={profileImageUploading}>
                    {profileImageUploading ? 'Uploading…' : 'Upload profile photo'}
                  </Button>
                  <input ref={profileImageInputRef} type="file" accept="image/*" onChange={handleProfileImageChange} className="hidden" />
                </div>
              </div>

              <Input
                label="Full name"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                placeholder="Full name"
                disabled={player?.emailVerified === true}
                readOnly={player?.emailVerified === true}
              />

              <Input
                label="Email"
                type="email"
                value={editEmail}
                onChange={(event) => setEditEmail(event.target.value)}
                placeholder="your@email.com"
              />

              {error ? <div className="rounded-2xl border border-danger/20 bg-danger/10 p-3 text-sm text-danger">{error}</div> : null}

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="submit" className="flex-1" disabled={savingProfile}>
                  {savingProfile ? 'Saving…' : 'Save changes'}
                </Button>
                <Button type="button" variant="ghost" className="flex-1" onClick={handlePasswordReset}>
                  Change password
                </Button>
              </div>
            </form>
          </div>
        </div>
      , document.body) : null}

      <div className="space-y-2">
        <div className="text-sm font-medium text-accent">Player</div>
        <h1 className="text-3xl font-bold">Player Profile</h1>
        <p className="text-muted text-sm">Profile details for ID: {playerId ?? '—'}</p>
      </div>

      {loading ? (
        <Card className="p-4 text-sm text-muted">Loading profile…</Card>
      ) : error ? (
        <Card className="p-4 text-sm text-danger">{error}</Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="p-4">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 overflow-hidden rounded-2xl border border-white/10 bg-white/5">
              {player?.profileImageUrl ? (
                <img src={player.profileImageUrl} alt={displayName} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted">IMG</div>
              )}
            </div>
            <div>
              <div className="text-lg font-bold">{displayName}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${player?.identityVerificationStatus === 'verified' ? 'border-success/30 bg-success/20 text-success' : player?.identityVerificationStatus === 'pending_review' ? 'border-accent/30 bg-accent/20 text-accent' : 'border-danger/30 bg-danger/20 text-danger'}`}>
                  {player?.identityVerificationStatus === 'verified' ? 'Verified' : player?.identityVerificationStatus === 'pending_review' ? 'Verification pending' : 'Verification required'}
                </span>
              </div>
              <div className="text-sm text-muted">Role: {displayRole}</div>
              <div className="text-sm text-muted">Experience: {displayExperience}</div>
              <div className="text-sm text-muted">Email: {displayEmail}</div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl bg-white/5 border border-white/10 p-4">
            <div className="text-xs uppercase tracking-widest text-muted">Equipment Owned</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {equipmentLoading ? (
                <span className="text-sm text-muted">Loading equipment…</span>
              ) : ownedEquipment.length > 0 ? (
                ownedEquipment.map((item) => (
                  <span key={item.id || item.name} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-text">
                    {item.name || 'Unnamed equipment'}
                  </span>
                ))
              ) : (
                <span className="text-sm text-muted">No equipment assigned yet.</span>
              )}
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <Button className="w-full" onClick={() => {}}>View Reservation History</Button>
            <Button
              variant="ghost"
              className="w-full bg-white/5 border border-white/10"
              onClick={openEditProfile}
            >
              Edit Profile
            </Button>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-widest text-muted">Identity Verification</div>
              <div className="mt-1 text-sm font-semibold">{verificationLabel}</div>
              <div className="mt-1 text-sm text-muted">Upload or scan a government-issued ID for review.</div>
            </div>
            <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${player?.identityVerificationStatus === 'verified' ? 'border-success/30 bg-success/20 text-success' : player?.identityVerificationStatus === 'pending_review' ? 'border-accent/30 bg-accent/20 text-accent' : 'border-white/10 bg-white/5 text-muted'}`}>
              {verificationLabel}
            </span>
          </div>

          <div className="mt-4 space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" className="flex-1" onClick={openIdentityCapture} disabled={isVerified}>
                {isVerified ? 'Verified' : cameraActive ? 'Camera Open' : 'Scan ID Capture'}
              </Button>
              <Button type="button" variant="ghost" className="flex-1" onClick={() => fileInputRef.current?.click()} disabled={isVerified}>
                {isVerified ? 'Verified' : player?.identityDocumentUrl ? 'Reupload Image' : 'Upload Image'}
              </Button>
            </div>

            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleIdentityUpload} className="hidden" />

            {uploading ? <div className="text-sm text-muted">Uploading ID…</div> : null}

            {player?.identityDocumentUrl ? (
              <>
                <div className="overflow-hidden rounded-2xl border border-white/10">
                  <img src={player.identityDocumentUrl} alt="Uploaded ID" className="h-auto max-h-80 w-full object-contain" />
                </div>
                <Button type="button" variant="ghost" className="w-full" onClick={handleRetakeCapture} disabled={isVerified}>
                  Retake Capture
                </Button>
              </>
            ) : null}
          </div>
        </Card>

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
