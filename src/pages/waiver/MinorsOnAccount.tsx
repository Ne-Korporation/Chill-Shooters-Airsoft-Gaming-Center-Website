import React, { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { FiAlertCircle, FiCheckCircle, FiChevronRight, FiMail, FiPlus, FiRefreshCw, FiUserPlus } from 'react-icons/fi'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { apiGet, apiPost } from '../../utils/apiClient'
import { ageFromBirthDate, maxBirthDate } from '../../utils/age'
import { composeFullName } from '../../utils/names'
import { useAuth } from '../../context/AuthContext'
import { WaiverPage, type ChildProfile } from './WaiverPage'

export type ChildSummary = ChildProfile & {
  age: number | null
  guardianConfirmed: boolean
  waiverStatus: string
  waiverApproved: boolean
}

// Minimum birth date for a child profile: under 18 today.
function minChildBirthDate() {
  const [year, month, day] = maxBirthDate().split('-').map(Number)
  const date = new Date(Date.UTC(year - 18, month - 1, day + 1))
  return date.toISOString().slice(0, 10)
}

const statusChip = (child: ChildSummary) => {
  if (!child.guardianConfirmed) return { label: 'Confirm by email', className: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400' }
  if (child.waiverApproved) return { label: 'Ready to play', className: 'border-success/30 bg-success/10 text-success' }
  if (child.waiverStatus === 'pending') return { label: 'Waiver in review', className: 'border-accent/30 bg-accent/10 text-accent' }
  if (child.waiverStatus === 'denied') return { label: 'Waiver denied', className: 'border-danger/30 bg-danger/10 text-danger' }
  return { label: 'Waiver needed', className: 'border-white/10 bg-white/5 text-muted' }
}

function useChildren() {
  const [children, setChildren] = useState<ChildSummary[]>([])
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    try {
      const res = await apiGet<{ ok: boolean; data: ChildSummary[] }>('/api/children')
      setChildren(Array.isArray(res?.data) ? res.data : [])
    } catch (e: any) {
      toast.error(e?.message || 'Could not load the minors on your account')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void load()
    // Coming back from the confirmation email in another tab.
    const onFocus = () => { void load() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])
  return { children, loading, load }
}

function GuardianEmailActions({ child, onConfirmed }: { child: ChildSummary; onConfirmed: () => void }) {
  const resend = async () => {
    try {
      const res = await apiPost<{ ok: boolean; data: { emailedTo?: string; alreadyConfirmed?: boolean } }>(`/api/children/${encodeURIComponent(child.id)}/confirmation-email`, {})
      if (res.data.alreadyConfirmed) onConfirmed()
      else toast.success(`Sent again to ${res.data.emailedTo || 'your email'}.`)
    } catch (e: any) {
      toast.error(e?.message || 'Could not send the email')
    }
  }
  return (
    <>
      <Button size="xs" variant="ghost" onClick={resend}><FiMail /> Resend email</Button>
      <Button size="xs" variant="ghost" onClick={onConfirmed}><FiRefreshCw /> I've confirmed</Button>
    </>
  )
}

// Profile: a parent adds each child here (minors can't have their own account). Each child gets a
// waiver to answer on the Waivers page once the parent confirms by email that they're the guardian.
export function MinorsOnProfile({ canAdd, blockedReason, onChanged }: { canAdd: boolean; blockedReason?: string; onChanged?: () => void }) {
  const { user } = useAuth()
  const { children, loading, load } = useChildren()
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ firstName: '', middleInitial: '', lastName: '', birthDate: '' })
  const [saving, setSaving] = useState(false)
  const [emailedTo, setEmailedTo] = useState('')

  const addChild = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      const res = await apiPost<{ ok: boolean; data: ChildSummary; emailedTo: string }>('/api/children', form)
      const name = composeFullName(form)
      setEmailedTo(res.emailedTo || user?.email || '')
      setForm({ firstName: '', middleInitial: '', lastName: '', birthDate: '' })
      setAdding(false)
      toast.success(`${name} was added. Confirm the email we sent, then answer their waiver on the Waivers page.`)
      await load()
      onChanged?.()
    } catch (e: any) {
      toast.error(e?.message || 'Could not add the minor')
    } finally {
      setSaving(false)
    }
  }

  const childAge = ageFromBirthDate(form.birthDate)
  const waitingForEmail = children.some((child) => !child.guardianConfirmed)

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted">Minors on your account</div>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Players under 18 play under your account. Add each child, confirm by email that you're their guardian, then answer their waiver on the Waivers page.
          </p>
        </div>
        {!adding ? (
          <Button size="sm" disabled={!canAdd} onClick={() => setAdding(true)}><FiUserPlus /> Add a minor</Button>
        ) : null}
      </div>

      {!canAdd && blockedReason ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-muted">{blockedReason}</div>
      ) : null}

      {waitingForEmail ? (
        <div className="mt-3 flex items-start gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <FiMail className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            We sent an email{emailedTo ? ` to ${emailedTo}` : ''} to confirm you're the guardian. Open the link in it; the child's waiver opens on the Waivers page after that.
          </div>
        </div>
      ) : null}

      {adding ? (
        <form onSubmit={addChild} className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_5.5rem_1fr]">
            <Input label="First name" autoComplete="off" value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} />
            <Input label="M.I." maxLength={2} autoComplete="off" value={form.middleInitial} onChange={(e) => setForm((f) => ({ ...f, middleInitial: e.target.value.replace(/[^A-Za-zÀ-ÿÑñ.]/g, '').slice(0, 2) }))} />
            <Input label="Last name" autoComplete="off" value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} />
          </div>
          <Input
            label="Birthday"
            type="date"
            required
            min={minChildBirthDate()}
            max={maxBirthDate()}
            value={form.birthDate}
            onChange={(e) => setForm((f) => ({ ...f, birthDate: e.target.value }))}
            hint={childAge !== null ? `Age: ${childAge}${childAge >= 18 ? ' — 18 and older need their own account.' : ''}` : 'Required. Must be under 18.'}
          />
          <div className="text-xs text-muted">
            Use the child's name exactly as on their ID or birth certificate. Their waiver is filled in as{' '}
            <span className="font-semibold text-text">{composeFullName(form) || 'First M. Last'}</span>.
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={saving || !form.firstName.trim() || !form.lastName.trim() || childAge === null || childAge >= 18}>
              <FiPlus /> {saving ? 'Adding…' : 'Add and send confirmation email'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </form>
      ) : null}

      <div className="mt-4 space-y-2">
        {loading ? <div className="text-sm text-muted">Loading…</div> : null}
        {!loading && children.length === 0 && !adding ? <div className="text-sm text-muted">No minors added yet.</div> : null}
        {children.map((child) => {
          const chip = statusChip(child)
          const waiverToAnswer = child.guardianConfirmed && !child.waiverApproved && child.waiverStatus !== 'pending'
          return (
            <div key={child.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/5 p-3">
              <div>
                <div className="text-sm font-semibold">{child.name}</div>
                <div className="text-xs text-muted">Age {child.age ?? '—'}{child.birthDate ? ` · born ${child.birthDate}` : ''}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${chip.className}`}>{chip.label}</span>
                {!child.guardianConfirmed ? (
                  <GuardianEmailActions child={child} onConfirmed={() => { void load() }} />
                ) : waiverToAnswer ? (
                  <Link to="/app/waiver#minors-waivers" className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:text-text">
                    Answer waiver <FiChevronRight />
                  </Link>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// Waivers page: the waiver of each minor added on the profile, answered by the parent as guardian.
export function MinorsWaivers({ ownWaiverApproved }: { ownWaiverApproved: boolean }) {
  const { user } = useAuth()
  const { children, loading, load } = useChildren()
  const [openWaiverId, setOpenWaiverId] = useState<string | null>(null)

  useEffect(() => {
    if (loading || window.location.hash !== '#minors-waivers') return
    document.getElementById('minors-waivers')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [loading])

  return (
    <div id="minors-waivers" className="scroll-mt-24">
      <Card className="p-4 md:p-6">
        <div className="text-xs uppercase tracking-widest text-muted">Minors' waivers</div>
        <div className="mt-1 text-lg font-semibold">Waivers for the children on your account</div>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Each child you add on your profile gets a waiver here. Confirm the guardian email first, then fill it in and sign as their guardian.
        </p>

        {!ownWaiverApproved && children.length > 0 ? (
          <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
            Your own waiver must be approved before you can sign as a guardian.
          </div>
        ) : null}

        <div className="mt-4 space-y-3">
          {loading ? <div className="text-sm text-muted">Loading…</div> : null}
          {!loading && children.length === 0 ? (
            <div className="text-sm text-muted">
              No minors yet.{' '}
              {user?.id ? (
                <Link to={`/app/players/${encodeURIComponent(user.id)}`} className="font-semibold text-accent hover:text-text">Add one on your profile</Link>
              ) : null}
            </div>
          ) : null}
          {children.map((child) => {
            const chip = statusChip(child)
            const canFillWaiver = ownWaiverApproved && child.guardianConfirmed && !child.waiverApproved && child.waiverStatus !== 'pending'
            const canView = child.guardianConfirmed && (child.waiverStatus === 'pending' || child.waiverApproved)
            return (
              <div key={child.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">{child.name}</div>
                    <div className="text-xs text-muted">Age {child.age ?? '—'}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${chip.className}`}>{chip.label}</span>
                    {!child.guardianConfirmed ? (
                      <GuardianEmailActions child={child} onConfirmed={() => { void load() }} />
                    ) : canFillWaiver || canView ? (
                      <Button size="xs" variant={canFillWaiver ? 'accent-soft' : 'ghost'} onClick={() => setOpenWaiverId(openWaiverId === child.id ? null : child.id)}>
                        {canFillWaiver ? <FiAlertCircle /> : <FiCheckCircle />} {openWaiverId === child.id ? 'Hide waiver' : canFillWaiver ? 'Fill in waiver' : 'View waiver'}
                      </Button>
                    ) : null}
                  </div>
                </div>
                {!child.guardianConfirmed ? (
                  <div className="mt-2 text-xs text-muted">Open the confirmation link we emailed you to unlock this waiver.</div>
                ) : null}
                {openWaiverId === child.id ? (
                  <div className="mt-4">
                    <WaiverPage
                      variant="embedded"
                      child={child}
                      onSubmitted={() => {
                        toast.success(`${child.name}'s waiver was sent for review.`)
                        void load()
                      }}
                    />
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
