import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { FiAlertCircle, FiCheckCircle, FiMail, FiPlus, FiRefreshCw, FiUserPlus } from 'react-icons/fi'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { apiGet, apiPost } from '../../utils/apiClient'
import { ageFromBirthDate, maxBirthDate } from '../../utils/age'
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
  if (!child.guardianConfirmed) return { label: 'Confirm by email', className: 'border-warning/30 bg-warning/10 text-warning' }
  if (child.waiverApproved) return { label: 'Ready to play', className: 'border-success/30 bg-success/10 text-success' }
  if (child.waiverStatus === 'pending') return { label: 'Waiver in review', className: 'border-accent/30 bg-accent/10 text-accent' }
  if (child.waiverStatus === 'denied') return { label: 'Waiver denied', className: 'border-danger/30 bg-danger/10 text-danger' }
  return { label: 'Waiver needed', className: 'border-white/10 bg-white/5 text-muted' }
}

// Minors don't have accounts: a parent with an approved waiver adds each child here, confirms by
// email that they are the guardian, then fills in the child's (minor) waiver.
export function MinorsOnAccount() {
  const { user } = useAuth()
  const [children, setChildren] = useState<ChildSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ firstName: '', middleInitial: '', lastName: '', birthDate: '' })
  const [saving, setSaving] = useState(false)
  const [openWaiverId, setOpenWaiverId] = useState<string | null>(null)
  const [emailedTo, setEmailedTo] = useState('')

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
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load])

  const addChild = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      const res = await apiPost<{ ok: boolean; data: ChildSummary; emailedTo: string }>('/api/children', form)
      setEmailedTo(res.emailedTo || user?.email || '')
      setForm({ firstName: '', middleInitial: '', lastName: '', birthDate: '' })
      setAdding(false)
      await load()
    } catch (e: any) {
      toast.error(e?.message || 'Could not add the minor')
    } finally {
      setSaving(false)
    }
  }

  const resend = async (child: ChildSummary) => {
    try {
      const res = await apiPost<{ ok: boolean; data: { emailedTo?: string; alreadyConfirmed?: boolean } }>(`/api/children/${encodeURIComponent(child.id)}/confirmation-email`, {})
      if (res.data.alreadyConfirmed) await load()
      else toast.success(`Sent again to ${res.data.emailedTo || 'your email'}.`)
    } catch (e: any) {
      toast.error(e?.message || 'Could not send the email')
    }
  }

  const childAge = ageFromBirthDate(form.birthDate)
  const waitingForEmail = children.some((child) => !child.guardianConfirmed)

  return (
    <Card className="p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted">Minors on your account</div>
          <div className="mt-1 text-lg font-semibold">Children who play with you</div>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Players under 18 can't have their own account. Add your child here, confirm by email that you are their guardian,
            then fill in their waiver. Each child keeps their own games and progress.
          </p>
        </div>
        {!adding ? (
          <Button onClick={() => setAdding(true)}><FiUserPlus /> Add a minor</Button>
        ) : null}
      </div>

      {waitingForEmail ? (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-warning/30 bg-warning/10 p-3 text-sm">
          <FiMail className="mt-0.5 shrink-0 text-warning" />
          <div>
            We sent an email{emailedTo ? ` to ${emailedTo}` : ''} to confirm you are the guardian. Open the link in it before
            filling in the child's waiver, then come back here.
          </div>
        </div>
      ) : null}

      {adding ? (
        <form onSubmit={addChild} className="mt-4 grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 sm:grid-cols-[1fr_5.5rem_1fr]">
          <Input label="First name" value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} />
          <Input label="M.I." maxLength={2} value={form.middleInitial} onChange={(e) => setForm((f) => ({ ...f, middleInitial: e.target.value.replace(/[^A-Za-zÀ-ÿÑñ.]/g, '').slice(0, 2) }))} />
          <Input label="Last name" value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} />
          <Input
            label="Birthday"
            type="date"
            min={minChildBirthDate()}
            max={maxBirthDate()}
            value={form.birthDate}
            onChange={(e) => setForm((f) => ({ ...f, birthDate: e.target.value }))}
            hint={childAge !== null ? `Age: ${childAge}` : 'Under 18.'}
          />
          <div className="flex items-end gap-2 sm:col-span-2">
            <Button type="submit" disabled={saving || !form.firstName.trim() || !form.lastName.trim() || childAge === null || childAge >= 18}>
              <FiPlus /> {saving ? 'Adding…' : 'Add and send confirmation email'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </form>
      ) : null}

      <div className="mt-4 space-y-3">
        {loading ? <div className="text-sm text-muted">Loading…</div> : null}
        {!loading && children.length === 0 && !adding ? <div className="text-sm text-muted">No minors added yet.</div> : null}
        {children.map((child) => {
          const chip = statusChip(child)
          const canFillWaiver = child.guardianConfirmed && !child.waiverApproved && child.waiverStatus !== 'pending'
          return (
            <div key={child.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">{child.name}</div>
                  <div className="text-xs text-muted">Age {child.age ?? '—'} · {child.id}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${chip.className}`}>{chip.label}</span>
                  {!child.guardianConfirmed ? (
                    <>
                      <Button size="xs" variant="ghost" onClick={() => resend(child)}><FiMail /> Resend email</Button>
                      <Button size="xs" variant="ghost" onClick={() => load()}><FiRefreshCw /> I've confirmed</Button>
                    </>
                  ) : canFillWaiver || child.waiverStatus === 'pending' || child.waiverApproved ? (
                    <Button size="xs" variant={canFillWaiver ? 'accent-soft' : 'ghost'} onClick={() => setOpenWaiverId(openWaiverId === child.id ? null : child.id)}>
                      {canFillWaiver ? <FiAlertCircle /> : <FiCheckCircle />} {openWaiverId === child.id ? 'Hide waiver' : canFillWaiver ? 'Fill in waiver' : 'View waiver'}
                    </Button>
                  ) : null}
                </div>
              </div>
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
  )
}
