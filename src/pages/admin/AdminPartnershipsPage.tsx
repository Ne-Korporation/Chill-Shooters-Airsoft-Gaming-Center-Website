import React, { useCallback, useEffect, useState } from 'react'
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
  // Share of rental income owed to an equipment partner for their items (percent)
  revenueSharePercent?: number
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
  revenueSharePercent: 50,
  notes: '',
}

type PartnerIncome = {
  partnerId: string
  name: string
  revenueSharePercent: number
  rentalIncome: number
  partnerShare: number
  itemCount: number
  rentals: Array<{ reservationId: string; reservationDate: string; itemName: string; quantity: number; unitPrice: number; income: number }>
}

function formatPHP(value: number) {
  return `₱${Number(value || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`
}

function monthStartISO() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

export function AdminPartnershipsPage() {
  const [items, setItems] = useState<Partnership[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(initialForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [income, setIncome] = useState<PartnerIncome[]>([])
  const [incomeStart, setIncomeStart] = useState(monthStartISO())
  const [incomeEnd, setIncomeEnd] = useState(new Date().toISOString().slice(0, 10))
  const [expandedPartner, setExpandedPartner] = useState<string | null>(null)

  const loadIncome = useCallback(async () => {
    try {
      const res = await apiGet<{ ok: boolean; data: PartnerIncome[] }>(
        `/api/partner-income?start=${encodeURIComponent(incomeStart)}&end=${encodeURIComponent(incomeEnd)}`,
      )
      setIncome((res.data || []).filter((entry) => entry.itemCount > 0 || entry.rentalIncome > 0))
    } catch (err: any) {
      setError(err?.message || 'Unable to load partner income')
    }
  }, [incomeStart, incomeEnd])

  useEffect(() => {
    void loadIncome()
  }, [loadIncome])

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
        revenueSharePercent: form.type === 'equipment_partner'
          ? Math.min(100, Math.max(0, Number(form.revenueSharePercent) || 0))
          : undefined,
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
      revenueSharePercent: item.revenueSharePercent ?? 50,
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
              <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })} className="w-full rounded-xl border border-white/10 bg-background px-3 py-2 text-sm outline-none focus:border-accent/40 [&>option]:bg-background">
                <option value="sponsor">Sponsor</option>
                <option value="equipment_partner">Equipment partner (income sharing)</option>
                <option value="school">School</option>
                <option value="community">Community</option>
                <option value="institution">Institution</option>
                <option value="other">Other</option>
              </select>
            </div>
            {form.type === 'equipment_partner' ? (
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-[0.18em] text-muted">Partner's share of rental income (%)</label>
                <input type="number" min={0} max={100} value={form.revenueSharePercent ?? ''} onChange={(event) => setForm({ ...form, revenueSharePercent: Number(event.target.value) })} className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-accent/40" />
                <p className="mt-1 text-xs text-muted">Tag this partner's weapons and equipment on the Weapons and Equipment pages.</p>
              </div>
            ) : null}
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
              <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as Partnership['status'] })} className="w-full rounded-xl border border-white/10 bg-background px-3 py-2 text-sm outline-none focus:border-accent/40 [&>option]:bg-background">
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
                      <div className="mt-1 text-xs text-muted">
                        {item.type === 'equipment_partner' ? `Equipment partner · ${item.revenueSharePercent ?? 0}% share` : item.type} · {item.status}
                      </div>
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

      <Card className="p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted">Partner equipment income sharing</div>
            <p className="mt-1 text-sm text-muted">Rental income from partner-owned items on confirmed and completed reservations.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-muted">
            <label>From <input type="date" value={incomeStart} onChange={(e) => setIncomeStart(e.target.value)} className="ml-1 rounded-xl border border-white/10 bg-background px-3 py-2 text-sm text-text" /></label>
            <label>To <input type="date" value={incomeEnd} onChange={(e) => setIncomeEnd(e.target.value)} className="ml-1 rounded-xl border border-white/10 bg-background px-3 py-2 text-sm text-text" /></label>
          </div>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-widest text-muted">
              <tr>
                <th className="py-2 pr-4">Partner</th>
                <th className="py-2 pr-4 text-right">Items</th>
                <th className="py-2 pr-4 text-right">Share</th>
                <th className="py-2 pr-4 text-right">Rental income</th>
                <th className="py-2 pr-4 text-right">Owed to partner</th>
                <th className="py-2 text-right">Center keeps</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {income.length === 0 ? (
                <tr><td colSpan={6} className="py-3 text-muted">No partner-owned items or rentals in this period.</td></tr>
              ) : income.map((entry) => (
                <React.Fragment key={entry.partnerId}>
                  <tr className="cursor-pointer" onClick={() => setExpandedPartner((c) => (c === entry.partnerId ? null : entry.partnerId))}>
                    <td className="py-2 pr-4 font-semibold">{entry.name}</td>
                    <td className="py-2 pr-4 text-right">{entry.itemCount}</td>
                    <td className="py-2 pr-4 text-right">{entry.revenueSharePercent}%</td>
                    <td className="py-2 pr-4 text-right">{formatPHP(entry.rentalIncome)}</td>
                    <td className="py-2 pr-4 text-right text-gold">{formatPHP(entry.partnerShare)}</td>
                    <td className="py-2 text-right">{formatPHP(entry.rentalIncome - entry.partnerShare)}</td>
                  </tr>
                  {expandedPartner === entry.partnerId ? entry.rentals.map((rental, index) => (
                    <tr key={`${rental.reservationId}-${index}`} className="text-xs text-muted">
                      <td className="py-1 pl-4 pr-4" colSpan={3}>{rental.reservationDate} · {rental.reservationId}</td>
                      <td className="py-1 pr-4 text-right" colSpan={3}>{rental.quantity} × {rental.itemName} @ {formatPHP(rental.unitPrice)} = {formatPHP(rental.income)}</td>
                    </tr>
                  )) : null}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
