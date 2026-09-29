import React, { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { apiDelete, apiGet, apiPost, apiPut } from '../../utils/apiClient'

type Partnership = {
  _id?: string
  id?: string
  name: string
  type: string
  contactName: string
  contactEmail: string
  status: 'active' | 'pending' | 'inactive'
  notes?: string
  createdAtISO?: string
  updatedAtISO?: string
}

const initialForm: Omit<Partnership, '_id'> = {
  name: '',
  type: 'sponsor',
  contactName: '',
  contactEmail: '',
  status: 'pending',
  notes: '',
}

export function AdminPartnershipsPage() {
  const [items, setItems] = useState<Partnership[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(initialForm)
  const [editingId, setEditingId] = useState<string | null>(null)

  const loadData = async () => {
    try {
      setLoading(true)
      const res = await apiGet<{ ok: boolean; data: Partnership[] }>('/api/partnerships?limit=200')
      setItems(Array.isArray(res?.data) ? res.data : [])
      setError('')
    } catch (err: any) {
      setError(err?.message || 'Unable to load partnerships')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  const resetForm = () => {
    setForm(initialForm)
    setEditingId(null)
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')

    try {
      const payload = {
        ...form,
        name: form.name.trim(),
        type: form.type.trim(),
        contactName: form.contactName.trim(),
        contactEmail: form.contactEmail.trim(),
        notes: form.notes?.trim() || '',
      }

      if (!payload.name || !payload.contactName || !payload.contactEmail) {
        throw new Error('Partnership name, contact name, and contact email are required.')
      }

      if (editingId) {
        const updated = await apiPut<{ ok: boolean; data: Partnership }>(`/api/partnerships/${editingId}`, payload)
        setItems((current) => current.map((item) => (item.id === editingId || item._id === editingId ? updated.data : item)))
      } else {
        const created = await apiPost<{ ok: boolean; data: Partnership }>('/api/partnerships', payload)
        setItems((current) => [created.data, ...current])
      }

      resetForm()
    } catch (err: any) {
      setError(err?.message || 'Unable to save partnership.')
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (item: Partnership) => {
    setEditingId(item.id ?? item._id ?? null)
    setForm({
      name: item.name || '',
      type: item.type || 'sponsor',
      contactName: item.contactName || '',
      contactEmail: item.contactEmail || '',
      status: item.status || 'pending',
      notes: item.notes || '',
    })
  }

  const handleDelete = async (item: Partnership) => {
    const id = item.id ?? item._id
    if (!id) return

    try {
      await apiDelete(`/api/partnerships/${id}`)
      setItems((current) => current.filter((entry) => (entry.id ?? entry._id) !== id))
      if (editingId === id) resetForm()
    } catch (err: any) {
      setError(err?.message || 'Unable to delete partnership')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Partnerships</h1>
        <p className="mt-1 text-sm text-muted">Track sponsors, community partners, and institutional collaborations.</p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[420px,1fr]">
        <Card className="p-4">
          <div className="mb-3 text-xs uppercase tracking-widest text-muted">{editingId ? 'Edit partnership' : 'New partnership'}</div>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-[0.18em] text-muted">Partnership name</label>
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-accent/40" placeholder="e.g. Local School Program" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-[0.18em] text-muted">Type</label>
              <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })} className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-accent/40">
                <option value="sponsor">Sponsor</option>
                <option value="school">School</option>
                <option value="community">Community</option>
                <option value="institution">Institution</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-[0.18em] text-muted">Contact person</label>
              <input value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })} className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-accent/40" placeholder="Jane Cruz" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-[0.18em] text-muted">Contact email</label>
              <input type="email" value={form.contactEmail} onChange={(event) => setForm({ ...form, contactEmail: event.target.value })} className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-accent/40" placeholder="partner@example.com" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-[0.18em] text-muted">Status</label>
              <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as Partnership['status'] })} className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-accent/40">
                <option value="pending">Pending</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-[0.18em] text-muted">Notes</label>
              <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} rows={4} className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-accent/40" placeholder="Terms, agreements, or notes..." />
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={saving} className="flex-1">{saving ? 'Saving...' : editingId ? 'Update partnership' : 'Save partnership'}</Button>
              {editingId && (
                <Button type="button" variant="ghost" onClick={resetForm}>Cancel</Button>
              )}
            </div>
          </form>
        </Card>

        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-xs uppercase tracking-widest text-muted">Current partnerships</div>
            <div className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-muted">{items.length} total</div>
          </div>

          {loading ? (
            <div className="rounded-xl border border-white/5 bg-white/5 px-3 py-6 text-sm text-muted">Loading partnerships…</div>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-white/5 bg-white/5 px-3 py-6 text-sm text-muted">No partnerships recorded yet.</div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.id ?? item._id ?? `${item.name}-${item.contactEmail}`} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-base font-semibold">{item.name}</div>
                      <div className="mt-1 text-xs text-muted">{item.type} · {item.status}</div>
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-widest text-muted">{item.status}</span>
                  </div>

                  <div className="mt-3 space-y-1 text-sm text-muted">
                    <div>Contact: {item.contactName}</div>
                    <div>Email: {item.contactEmail}</div>
                    {item.notes ? <div>Notes: {item.notes}</div> : null}
                  </div>

                  <div className="mt-3 flex gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => handleEdit(item)}>Edit</Button>
                    <Button type="button" variant="danger" size="sm" onClick={() => handleDelete(item)}>Delete</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
