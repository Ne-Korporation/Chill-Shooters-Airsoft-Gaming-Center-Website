import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { FiPaperclip, FiPlus, FiTrash2 } from 'react-icons/fi'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { apiBase, apiGet, apiPost, apiPut, getApiAuthHeaders } from '../../utils/apiClient'

type LoanDocument = { label: string; url: string }

type LoanItem = { description: string; quantity: number; collection?: string; itemId?: string; conditionOut?: string }

type Loan = {
  id: string
  partnerId: string
  partnerName: string
  direction: 'borrowed_from_partner' | 'lent_to_partner'
  borrowedOn: string
  dueOn?: string
  items: LoanItem[]
  documents: LoanDocument[]
  notes?: string
  status: 'out' | 'returned'
  returnedOn?: string
  conditionIn?: string
  returnNotes?: string
  createdBy?: { actorEmail?: string }
}

type InventoryOption = { key: string; label: string }

const fieldClass = 'w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-accent/40'
const selectClass = 'w-full rounded-xl border border-white/10 bg-background px-3 py-2 text-sm outline-none focus:border-accent/40 [&>option]:bg-background'

function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())
}

async function uploadDocument(file: File): Promise<LoanDocument> {
  const formData = new FormData()
  formData.append('file', file, file.name)
  const res = await fetch(`${apiBase}/api/upload-document`, { method: 'POST', headers: getApiAuthHeaders(), body: formData })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.url) throw new Error(json?.error || 'Upload failed')
  return { label: json.name || file.name, url: json.url }
}

function DocumentPicker({ documents, onChange }: { documents: LoanDocument[]; onChange: (next: LoanDocument[]) => void }) {
  const [uploading, setUploading] = useState(false)
  return (
    <div className="space-y-2">
      {documents.map((doc, index) => (
        <div key={doc.url} className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs">
          <a href={doc.url} target="_blank" rel="noreferrer" className="truncate text-accent hover:underline">{doc.label}</a>
          <button type="button" onClick={() => onChange(documents.filter((_, i) => i !== index))} className="text-muted hover:text-danger" aria-label="Remove document">
            <FiTrash2 />
          </button>
        </div>
      ))}
      <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-accent">
        <FiPaperclip /> {uploading ? 'Uploading…' : 'Attach agreement, slip, or photo (image or PDF)'}
        <input
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          disabled={uploading}
          onChange={async (event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            setUploading(true)
            try {
              onChange([...documents, await uploadDocument(file)])
            } catch (err: any) {
              toast.error(err?.message || 'Upload failed')
            } finally {
              setUploading(false)
            }
          }}
        />
      </label>
    </div>
  )
}

const emptyItem = { description: '', quantity: '1', inventoryKey: '', condition: '' }

// Equipment borrowed from (or lent to) partner organizations, with the paperwork for each.
export function PartnerLoansCard({ partners }: { partners: Array<{ id: string; name: string }> }) {
  const [loans, setLoans] = useState<Loan[]>([])
  const [inventory, setInventory] = useState<InventoryOption[]>([])
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    partnerId: '',
    direction: 'borrowed_from_partner' as Loan['direction'],
    borrowedOn: todayISO(),
    dueOn: '',
    notes: '',
    items: [{ ...emptyItem }],
    documents: [] as LoanDocument[],
  })
  const [returning, setReturning] = useState<{ id: string; returnedOn: string; conditionIn: string; notes: string; documents: LoanDocument[] } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await apiGet<{ ok: boolean; data: Loan[] }>('/api/partner-loans')
      setLoans(res.data || [])
    } catch (err: any) {
      toast.error(err?.message || 'Unable to load partner loans')
    }
  }, [])

  useEffect(() => {
    void load()
    Promise.all([
      apiGet<{ ok: boolean; data: any[] }>('/api/weapons?limit=500'),
      apiGet<{ ok: boolean; data: any[] }>('/api/equipments?limit=500'),
    ]).then(([weapons, equipment]) => {
      const toOptions = (docs: any[], collection: string) => docs
        .filter((doc) => doc.source !== 'player')
        .map((doc) => ({ key: `${collection}:${doc.id || doc._id}`, label: `${doc.name || 'Unnamed'} (${doc.status || 'available'})` }))
      setInventory([...toOptions(weapons.data || [], 'weapons'), ...toOptions(equipment.data || [], 'equipments')])
    }).catch(() => null)
  }, [load])

  useEffect(() => {
    if (!form.partnerId && partners[0]) setForm((current) => ({ ...current, partnerId: partners[0].id }))
  }, [partners, form.partnerId])

  const setItem = (index: number, patch: Partial<typeof emptyItem>) =>
    setForm((current) => ({ ...current, items: current.items.map((item, i) => (i === index ? { ...item, ...patch } : item)) }))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await apiPost('/api/partner-loans', {
        partnerId: form.partnerId,
        direction: form.direction,
        borrowedOn: form.borrowedOn,
        dueOn: form.dueOn,
        notes: form.notes,
        documents: form.documents,
        items: form.items.map((item) => {
          const [collection, itemId] = item.inventoryKey ? item.inventoryKey.split(':') : ['', '']
          return { description: item.description, quantity: Number(item.quantity), collection, itemId, condition: item.condition }
        }),
      })
      toast.success('Loan recorded.')
      setForm((current) => ({ ...current, dueOn: '', notes: '', items: [{ ...emptyItem }], documents: [] }))
      await load()
    } catch (err: any) {
      toast.error(err?.message || 'Unable to record the loan')
    } finally {
      setSaving(false)
    }
  }

  const submitReturn = async () => {
    if (!returning) return
    setSaving(true)
    try {
      await apiPut(`/api/partner-loans/${encodeURIComponent(returning.id)}/return`, returning)
      toast.success('Return recorded.')
      setReturning(null)
      await load()
    } catch (err: any) {
      toast.error(err?.message || 'Unable to record the return')
    } finally {
      setSaving(false)
    }
  }

  const today = todayISO()

  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-widest text-muted">Partner equipment borrowing</div>
      <p className="mt-1 text-sm text-muted">
        Record equipment borrowed from or lent to partner organizations, its condition each way, and the signed paperwork.
        Center pieces lent out can't be booked until they are returned.
      </p>

      <div className="mt-4 grid gap-6 xl:grid-cols-[420px,1fr]">
        <form className="space-y-3" onSubmit={submit}>
          <div className="grid grid-cols-2 gap-2">
            <select value={form.partnerId} onChange={(e) => setForm({ ...form, partnerId: e.target.value })} className={selectClass}>
              {partners.length === 0 ? <option value="">Add a partnership first</option> : null}
              {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value as Loan['direction'] })} className={selectClass}>
              <option value="borrowed_from_partner">Borrowed from partner</option>
              <option value="lent_to_partner">Lent to partner</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs text-muted">
            <label>Handed over<input type="date" value={form.borrowedOn} onChange={(e) => setForm({ ...form, borrowedOn: e.target.value })} className={`${fieldClass} mt-1 text-text`} /></label>
            <label>Due back (optional)<input type="date" value={form.dueOn} min={form.borrowedOn} onChange={(e) => setForm({ ...form, dueOn: e.target.value })} className={`${fieldClass} mt-1 text-text`} /></label>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Items</div>
            {form.items.map((item, index) => (
              <div key={index} className="space-y-2 rounded-xl border border-white/10 bg-black/10 p-2">
                <select value={item.inventoryKey} onChange={(e) => setItem(index, { inventoryKey: e.target.value })} className={selectClass}>
                  <option value="">Not in our inventory (describe below)</option>
                  {inventory.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                </select>
                <div className="grid grid-cols-[1fr,80px,auto] gap-2">
                  {item.inventoryKey ? (
                    <div className="self-center text-xs text-muted">One linked piece</div>
                  ) : (
                    <input value={item.description} onChange={(e) => setItem(index, { description: e.target.value })} placeholder="e.g. M4 rifles (partner-owned)" className={fieldClass} />
                  )}
                  <input type="number" min={1} value={item.inventoryKey ? '1' : item.quantity} disabled={Boolean(item.inventoryKey)} onChange={(e) => setItem(index, { quantity: e.target.value })} className={fieldClass} aria-label="Quantity" />
                  <button type="button" disabled={form.items.length === 1} onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== index) })} className="px-1 text-muted hover:text-danger disabled:opacity-30" aria-label="Remove item">
                    <FiTrash2 />
                  </button>
                </div>
                <input value={item.condition} onChange={(e) => setItem(index, { condition: e.target.value })} placeholder="Condition when handed over" className={fieldClass} />
              </div>
            ))}
            <button type="button" onClick={() => setForm({ ...form, items: [...form.items, { ...emptyItem }] })} className="inline-flex items-center gap-1 text-xs font-semibold text-accent">
              <FiPlus /> Add item
            </button>
          </div>

          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Terms, contact at handover, notes…" className={fieldClass} />
          <DocumentPicker documents={form.documents} onChange={(documents) => setForm({ ...form, documents })} />
          <Button type="submit" className="w-full" disabled={saving || !form.partnerId}>{saving ? 'Saving…' : 'Record loan'}</Button>
        </form>

        <div className="space-y-3">
          {loans.length === 0 ? <div className="rounded-xl border border-white/5 bg-white/5 px-3 py-6 text-sm text-muted">No partner loans recorded yet.</div> : null}
          {loans.map((loan) => {
            const overdue = loan.status === 'out' && loan.dueOn && loan.dueOn < today
            return (
              <div key={loan.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">
                      {loan.direction === 'borrowed_from_partner' ? 'Borrowed from' : 'Lent to'} {loan.partnerName}
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      {loan.id} · {loan.borrowedOn}{loan.dueOn ? ` → due ${loan.dueOn}` : ''}{loan.returnedOn ? ` · returned ${loan.returnedOn}` : ''}
                    </div>
                  </div>
                  <span className={['rounded-full border px-2 py-1 text-[10px] uppercase tracking-widest', overdue ? 'border-danger/30 text-danger' : loan.status === 'out' ? 'border-gold/30 text-gold' : 'border-success/30 text-success'].join(' ')}>
                    {overdue ? 'Overdue' : loan.status === 'out' ? 'Out' : 'Returned'}
                  </span>
                </div>
                <ul className="mt-2 space-y-0.5 text-xs text-muted">
                  {loan.items.map((item, index) => (
                    <li key={index}>{item.quantity} × {item.description}{item.conditionOut ? ` — out: ${item.conditionOut}` : ''}</li>
                  ))}
                </ul>
                {loan.notes ? <div className="mt-1 text-xs text-muted">Notes: {loan.notes}</div> : null}
                {loan.conditionIn ? <div className="mt-1 text-xs text-muted">Condition on return: {loan.conditionIn}</div> : null}
                {loan.documents?.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {loan.documents.map((doc) => (
                      <a key={doc.url} href={doc.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-accent hover:underline">
                        <FiPaperclip /> {doc.label}
                      </a>
                    ))}
                  </div>
                ) : null}

                {loan.status === 'out' ? (
                  returning?.id === loan.id ? (
                    <div className="mt-3 space-y-2 rounded-xl border border-white/10 bg-black/10 p-3">
                      <input type="date" value={returning.returnedOn} min={loan.borrowedOn} onChange={(e) => setReturning({ ...returning, returnedOn: e.target.value })} className={fieldClass} />
                      <input value={returning.conditionIn} onChange={(e) => setReturning({ ...returning, conditionIn: e.target.value })} placeholder="Condition on return" className={fieldClass} />
                      <input value={returning.notes} onChange={(e) => setReturning({ ...returning, notes: e.target.value })} placeholder="Notes (optional)" className={fieldClass} />
                      <DocumentPicker documents={returning.documents} onChange={(documents) => setReturning({ ...returning, documents })} />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={submitReturn} disabled={saving}>Save return</Button>
                        <Button size="sm" variant="ghost" onClick={() => setReturning(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <Button size="sm" variant="ghost" className="mt-2" onClick={() => setReturning({ id: loan.id, returnedOn: today, conditionIn: '', notes: '', documents: [] })}>
                      Record return
                    </Button>
                  )
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}
