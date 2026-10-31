import React, { useState } from 'react'
import toast from 'react-hot-toast'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { apiPost, apiPut } from '../../utils/apiClient'

export type ReachProgram = {
  id: string
  title: string
  dateISO: string
  status: 'planned' | 'completed' | 'cancelled'
  venue?: string
  beneficiaries?: string
  participants?: number
  partnerOrganization?: string
  description?: string
  spent: number
}

const emptyForm = {
  title: '',
  dateISO: '',
  status: 'planned' as ReachProgram['status'],
  venue: '',
  beneficiaries: '',
  participants: '',
  partnerOrganization: '',
  description: '',
}

function formatPHP(value: number) {
  return `₱${Number(value || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`
}

const STATUS_STYLES: Record<ReachProgram['status'], string> = {
  planned: 'border-gold/30 text-gold',
  completed: 'border-success/30 text-success',
  cancelled: 'border-white/10 text-muted',
}

// Records of the community outreach activities the REACH fund supports.
export function ReachProgramsCard({ programs, onChanged }: { programs: ReachProgram[]; onChanged: () => void }) {
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      const payload = { ...form, participants: Number(form.participants) || 0 }
      if (editingId) await apiPut(`/api/reach-programs/${encodeURIComponent(editingId)}`, payload)
      else await apiPost('/api/reach-programs', payload)
      toast.success(editingId ? 'Program updated.' : 'Program added.')
      setForm(emptyForm)
      setEditingId(null)
      onChanged()
    } catch (err: any) {
      toast.error(err?.message || 'Unable to save the program')
    } finally {
      setSaving(false)
    }
  }

  const edit = (program: ReachProgram) => {
    setEditingId(program.id)
    setForm({
      title: program.title,
      dateISO: program.dateISO,
      status: program.status,
      venue: program.venue || '',
      beneficiaries: program.beneficiaries || '',
      participants: program.participants ? String(program.participants) : '',
      partnerOrganization: program.partnerOrganization || '',
      description: program.description || '',
    })
  }

  return (
    <Card className="p-4 md:p-5">
      <div className="text-xs uppercase tracking-widest text-muted">Outreach programs</div>
      <p className="mt-1 text-sm text-muted">Each community activity: when and where, who benefited, and what the fund spent on it (link expenditures below).</p>
      <div className="mt-4 grid gap-6 xl:grid-cols-[380px,1fr]">
        <form className="space-y-2" onSubmit={submit}>
          <Input label="Program" placeholder="e.g. Barangay youth safety day" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <Input label="Date" type="date" value={form.dateISO} onChange={(e) => setForm({ ...form, dateISO: e.target.value })} />
            <label className="block">
              <div className="mb-2 text-sm font-semibold text-text">Status</div>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as ReachProgram['status'] })}
                className="w-full rounded-xl border border-white/10 bg-background px-4 py-3 text-sm text-text focus:outline-none [&>option]:bg-background"
              >
                <option value="planned">Planned</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
          </div>
          <Input label="Venue" value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} />
          <Input label="Beneficiaries" placeholder="e.g. Grade 10 students of Salawag NHS" value={form.beneficiaries} onChange={(e) => setForm({ ...form, beneficiaries: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <Input label="People reached" type="number" min={0} value={form.participants} onChange={(e) => setForm({ ...form, participants: e.target.value })} />
            <Input label="Partner (optional)" value={form.partnerOrganization} onChange={(e) => setForm({ ...form, partnerOrganization: e.target.value })} />
          </div>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={3}
            placeholder="What happened, outcomes, notes"
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={saving || !form.title.trim() || !form.dateISO}>{editingId ? 'Update program' : 'Add program'}</Button>
            {editingId ? <Button variant="ghost" onClick={() => { setEditingId(null); setForm(emptyForm) }}>Cancel</Button> : null}
          </div>
        </form>

        <div className="space-y-3">
          {programs.length === 0 ? <div className="rounded-xl border border-white/5 bg-white/5 px-3 py-6 text-sm text-muted">No outreach programs recorded yet.</div> : null}
          {programs.map((program) => (
            <div key={program.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">{program.title}</div>
                  <div className="mt-0.5 text-xs text-muted">
                    {program.id} · {program.dateISO}{program.venue ? ` · ${program.venue}` : ''}{program.partnerOrganization ? ` · with ${program.partnerOrganization}` : ''}
                  </div>
                </div>
                <span className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-widest ${STATUS_STYLES[program.status]}`}>{program.status}</span>
              </div>
              <div className="mt-2 grid gap-1 text-xs text-muted sm:grid-cols-3">
                <div>Beneficiaries: <span className="text-text">{program.beneficiaries || '—'}</span></div>
                <div>People reached: <span className="text-text">{program.participants || 0}</span></div>
                <div>Fund spent: <span className="text-danger">{formatPHP(program.spent)}</span></div>
              </div>
              {program.description ? <div className="mt-2 text-xs text-muted">{program.description}</div> : null}
              <button type="button" onClick={() => edit(program)} className="mt-2 text-[11px] font-semibold text-accent hover:underline">Edit</button>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}
