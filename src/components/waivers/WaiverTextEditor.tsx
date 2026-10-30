import React, { useState } from 'react'
import toast from 'react-hot-toast'
import { FiEdit2 } from 'react-icons/fi'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { apiPut } from '../../utils/apiClient'
import { useCurrentWaiverText, type WaiverText } from '../../utils/waiverText'

const textareaClass = 'w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-accent/40'

type Draft = Omit<WaiverText, 'clauses'> & { clauses: string }

const toDraft = (text: WaiverText): Draft => ({ ...text, clauses: text.clauses.join('\n\n') })
const fromDraft = (draft: Draft): WaiverText => ({
  ...draft,
  // Clauses are separated by a blank line so a clause can still wrap onto several lines.
  clauses: draft.clauses.split(/\n\s*\n/).map((clause) => clause.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean),
})

function Area({ label, value, rows, onChange, hint }: { label: string; value: string; rows: number; onChange: (value: string) => void; hint?: string }) {
  return (
    <label className="block">
      <div className="mb-1 text-sm font-semibold">{label}</div>
      <textarea value={value} rows={rows} onChange={(e) => onChange(e.target.value)} className={textareaClass} />
      {hint ? <div className="mt-1 text-xs text-muted">{hint}</div> : null}
    </label>
  )
}

// Admin editor for the waiver players sign. Waivers already signed keep the text they agreed to.
export function WaiverTextEditor() {
  const { text, updatedAtISO, reload } = useCurrentWaiverText()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const set = (field: keyof Draft) => (value: string) => setDraft((current) => (current ? { ...current, [field]: value } : current))

  const save = async (body: { text?: WaiverText; reset?: true }) => {
    setSaving(true)
    try {
      await apiPut('/api/waiver-text', body)
      await reload()
      setDraft(null)
      toast.success(body.reset ? 'Waiver text reset to the official version.' : 'Waiver text saved. New waivers will use it.')
    } catch (e: any) {
      toast.error(String(e?.message || 'Could not save the waiver text.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="p-4 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted">Waiver text</div>
          <div className="mt-1 text-sm text-muted">
            {updatedAtISO ? `Edited ${new Date(updatedAtISO).toLocaleString()}.` : 'Using the official Chill Shooters text.'}{' '}
            Changes apply to new waivers; signed waivers keep the text they were signed with.
          </div>
        </div>
        {draft ? null : (
          <Button variant="ghost" onClick={() => setDraft(toDraft(text))}>
            <FiEdit2 /> Edit waiver text
          </Button>
        )}
      </div>

      {draft ? (
        <div className="mt-4 space-y-4">
          <Input label="Title" value={draft.title} onChange={(e) => set('title')(e.target.value)} />
          <Area label="Opening statement" rows={4} value={draft.preamble} onChange={set('preamble')} />
          <Area label="Introduction" rows={2} value={draft.intro} onChange={set('intro')} />
          <Area label="Clauses" rows={14} value={draft.clauses} onChange={set('clauses')} hint="Leave a blank line between clauses. They are numbered automatically." />
          <Area label="Closing statement" rows={3} value={draft.closing} onChange={set('closing')} />
          <Input label="Guardian section title" value={draft.guardianTitle} onChange={(e) => set('guardianTitle')(e.target.value)} />
          <Area label="Guardian certification (shown to players under 18)" rows={4} value={draft.guardianCertification} onChange={set('guardianCertification')} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button
              variant="ghost"
              disabled={saving || !updatedAtISO}
              onClick={() => window.confirm('Go back to the official Chill Shooters waiver text for new waivers?') && void save({ reset: true })}
            >
              Reset to official text
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" disabled={saving} onClick={() => setDraft(null)}>Cancel</Button>
              <Button disabled={saving} onClick={() => void save({ text: fromDraft(draft) })}>{saving ? 'Saving…' : 'Save waiver text'}</Button>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  )
}
