import React from 'react'
import toast from 'react-hot-toast'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { apiGet, apiPost, apiPut, apiDelete } from '../../utils/apiClient'
import { ModelSummaryStrip } from '../../components/inventory/ModelSummaryStrip'
import { modelOf, summarizeModels } from '../../utils/inventoryModels'
import { sendRoleNotifications, useNotifications } from '../../context/NotificationContext'

type WeaponCategory = 'rifles' | 'pistols' | 'snipers' | 'mg' | 'shotguns' | 'gel_blasters' | 'photoshoot'

type WeaponStatus = 'available' | 'rented' | 'needs-check'

type WeaponItem = {
  partnerId?: string
  fpsClass?: string
  fpsLimit?: number
  id: string
  _id?: any
  name: string
  category: WeaponCategory
  status: WeaponStatus
  note: string
  description?: string
  price: number
  model: string
  unitNumber: number
  createdAtISO?: string
  submittedBy?: string
  source?: 'business' | 'player'
  approvalStatus?: 'pending' | 'approved' | 'rejected'
  rejectionReason?: string
}

const categoryOptions: { key: WeaponCategory; subtitle: string }[] = [
  { key: 'rifles', subtitle: 'Standard long-range platforms for regular bookings' },
  { key: 'pistols', subtitle: 'Sidearms and compact builds for quick turns' },
  { key: 'snipers', subtitle: 'Precision class weapons with heavier upkeep' },
  { key: 'mg', subtitle: 'Support weapons with limited stock and stricter control' },
  { key: 'shotguns', subtitle: 'Close-quarters spread style gear' },
  { key: 'gel_blasters', subtitle: 'Low-sting gel ball blasters for kids and first-timers' },
  { key: 'photoshoot', subtitle: 'Private rifles rented for photoshoots' },
]

const StatusBadge = ({ status, onToggle }: { status: WeaponStatus; onToggle?: () => void }) => {
  const cls =
    status === 'available'
      ? 'bg-success/20 text-success border-success/30'
      : status === 'rented'
        ? 'bg-accent/20 text-accent border-accent/30'
        : 'bg-danger/20 text-danger border-danger/30'

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onToggle?.()
      }}
      className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold transition ${cls} ${onToggle ? 'cursor-pointer hover:opacity-80' : ''}`}
    >
      {status.toUpperCase()}
    </button>
  )
}

// Standard rental prices: a rifle is ₱500 (it comes with 2 magazines / 600 BBs). Picking the
// category fills in the price; the admin can still change it.
const DEFAULT_CATEGORY_PRICES: Partial<Record<WeaponCategory, number>> = { rifles: 500 }

const emptyForm = () => ({ name: '', description: '', category: 'rifles' as WeaponCategory, status: 'available' as WeaponStatus, price: String(DEFAULT_CATEGORY_PRICES.rifles), pieces: '1', applyToModel: true, partnerId: '', fpsClass: '', fpsLimit: '' })

// Blank class follows the category (snipers are sniper class); blank limit uses the class default.
function fpsFields(form: { fpsClass: string; fpsLimit: string }) {
  return { fpsClass: form.fpsClass, fpsLimit: Number(form.fpsLimit) > 0 ? Number(form.fpsLimit) : 0 }
}

export function AdminWeaponsPage() {
  const [category, setCategory] = React.useState<WeaponCategory | 'all'>('all')
  const [status, setStatus] = React.useState<WeaponStatus | 'all'>('all')
  const [sourceFilter, setSourceFilter] = React.useState<'business' | 'player'>('business')
  const [ownerNames, setOwnerNames] = React.useState<Record<string, string>>({})
  const [weapons, setWeapons] = React.useState<WeaponItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [form, setForm] = React.useState(emptyForm())
  const [selectedWeaponId, setSelectedWeaponId] = React.useState<string | null>(null)
  const [rejectionTargetId, setRejectionTargetId] = React.useState<string | null>(null)
  const [rejectionReason, setRejectionReason] = React.useState('')
  const nameRef = React.useRef<HTMLInputElement | null>(null)

  const [partners, setPartners] = React.useState<Array<{ id: string; name: string }>>([])

  React.useEffect(() => {
    // Only admins can read partnerships; other roles just see center-owned items.
    apiGet<{ ok: boolean; data: any[] }>('/api/partnerships?limit=200')
      .then((res) => setPartners((res.data || [])
        .filter((p: any) => p.type === 'equipment_partner')
        .map((p: any) => ({ id: String(p.id || p._id), name: String(p.name || 'Partner') }))))
      .catch(() => setPartners([]))
  }, [])

  const refresh = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiGet<{ ok: boolean; data: any[] }>('/api/weapons?limit=200')
      const docs = Array.isArray(res?.data) ? res.data : []
      const normalized = docs.map((d: any) => ({
        id: d.id ?? (d._id ? String(d._id) : undefined),
        _id: d._id,
        name: d.name || 'Unnamed weapon',
        category: (d.category || 'rifles') as WeaponCategory,
        status: (d.status || 'available') as WeaponStatus,
        note: d.note || d.description || '',
        description: d.description || d.note || '',
        price: typeof d.price === 'number' ? d.price : 0,
        model: modelOf(d),
        unitNumber: Number(d.unitNumber) || 0,
        createdAtISO: d.createdAtISO || null,
        submittedBy: d.submittedBy,
        source: (d.source || (d.submittedBy ? 'player' : 'business')) as 'business' | 'player',
        approvalStatus: (d.approvalStatus || (d.source === 'player' || d.submittedBy ? 'pending' : 'approved')) as 'pending' | 'approved' | 'rejected',
        rejectionReason: d.rejectionReason || '',
        partnerId: d.partnerId || '',
        fpsClass: d.fpsClass || '',
        fpsLimit: Number(d.fpsLimit) || 0,
      }))
      setWeapons(normalized)
    } catch (e: any) {
      toast.error(String(e?.message || e))
      setWeapons([])
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { refresh() }, [refresh])

  React.useEffect(() => {
    if (sourceFilter !== 'player' || Object.keys(ownerNames).length > 0) return
    apiGet<{ ok: boolean; data: any[] }>('/api/user_accounts?limit=500')
      .then((res) => setOwnerNames(Object.fromEntries((res.data || []).map((u: any) => [String(u.id || u._id), String(u.name || u.email || '')]))))
      .catch(() => setOwnerNames({}))
  }, [sourceFilter, ownerNames])

  const filtered = weapons.filter((weapon) => {
    if (weapon.source === 'player' && weapon.approvalStatus === 'rejected') return false
    const matchCategory = category === 'all' ? true : weapon.category === category
    const matchStatus = status === 'all' ? true : weapon.status === status
    const matchSource = weapon.source === sourceFilter
    return matchCategory && matchStatus && matchSource
  })

  const activeCategoryMeta = category === 'all' ? null : categoryOptions.find((item) => item.key === category)
  const maintenanceQueue = weapons.filter((weapon) => weapon.status === 'needs-check')
  const maintenanceCount = maintenanceQueue.length
  const pendingPlayerWeapons = weapons.filter((weapon) => weapon.source === 'player' && weapon.approvalStatus === 'pending')
  const pendingPlayerWeaponsCount = pendingPlayerWeapons.length

  const models = summarizeModels(weapons)

  // Each physical weapon is its own record: adding 20 creates 20 pieces with their own IDs.
  const addWeapon = async () => {
    if (!form.name.trim()) {
      toast.error('Weapon name is required')
      return
    }
    const count = Number(form.pieces)
    if (!Number.isInteger(count) || count < 1 || count > 200) {
      toast.error('Add between 1 and 200 pieces at a time.')
      return
    }

    setSaving(true)
    try {
      const res = await apiPost<{ ok: boolean; data: Array<{ id: string }> }>('/api/inventory/weapons/pieces', {
        model: form.name.trim(),
        count,
        category: form.category,
        status: form.status,
        price: Number(form.price) || 0,
        description: form.description.trim(),
        note: form.description.trim() || 'Added through the admin inventory review.',
        partnerId: form.partnerId,
        ...fpsFields(form),
      })
      const ids = res.data.map((piece) => piece.id)
      toast.success(count === 1 ? `Added ${ids[0]}` : `Added ${count} pieces (${ids[0]} – ${ids[ids.length - 1]})`)
      setForm(emptyForm())
      await refresh()
    } catch (e: any) {
      toast.error(String(e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  const handleSelect = (weapon: WeaponItem) => {
    setSelectedWeaponId(weapon.id)
    setForm({
      name: weapon.name,
      description: weapon.description || weapon.note || '',
      category: weapon.category,
      status: weapon.status,
      price: String(weapon.price),
      pieces: '1',
      applyToModel: true,
      partnerId: weapon.partnerId || '',
      fpsClass: weapon.fpsClass || '',
      fpsLimit: weapon.fpsLimit ? String(weapon.fpsLimit) : '',
    })
  }

  React.useEffect(() => {
    if (selectedWeaponId) requestAnimationFrame(() => nameRef.current?.focus())
  }, [selectedWeaponId])

  const handleUpdate = async () => {
    if (!selectedWeaponId) {
      await addWeapon()
      return
    }

    const piece = weapons.find((w) => w.id === selectedWeaponId)
    setSaving(true)
    try {
      // Status and notes belong to this one piece.
      await apiPut<any>(`/api/weapons/${encodeURIComponent(selectedWeaponId)}`, {
        status: form.status,
        description: form.description.trim(),
        note: form.description.trim() || 'Updated from admin inventory.',
        ...(form.applyToModel ? {} : { price: Number(form.price) || 0, category: form.category, partnerId: form.partnerId, ...fpsFields(form) }),
        updatedAtISO: new Date().toISOString(),
      })
      // Price, category, owner, and FPS rules are shared by every piece of the model.
      if (form.applyToModel && piece) {
        await apiPut<any>('/api/inventory/weapons/models', {
          model: piece.model,
          price: Number(form.price) || 0,
          category: form.category,
          partnerId: form.partnerId,
          ...fpsFields(form),
        })
      }
      toast.success(form.applyToModel && piece ? `Updated ${piece.name} and all ${piece.model} pieces` : 'Weapon updated')
      setSelectedWeaponId(null)
      setForm(emptyForm())
      await refresh()
    } catch (e: any) {
      toast.error(String(e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  const handleFlag = async (id: string) => {
    try {
      await apiPut<any>(`/api/weapons/${encodeURIComponent(id)}`, {
        status: 'needs-check',
        updatedAtISO: new Date().toISOString(),
      })
      toast.success('Weapon flagged for check')
      await refresh()
    } catch (e: any) {
      toast.error(String(e?.message || e))
    }
  }

  const handleToggleFlag = async (id: string) => {
    const weapon = weapons.find((w) => w.id === id)
    if (!weapon) return
    const newStatus = weapon.status === 'needs-check' ? 'available' : 'needs-check'
    try {
      await apiPut<any>(`/api/weapons/${encodeURIComponent(id)}`, {
        status: newStatus,
        updatedAtISO: new Date().toISOString(),
      })
      await refresh()
    } catch (e: any) {
      toast.error(String(e?.message || e))
    }
  }

  const handleStatusToggle = async (id: string) => {
    const weapon = weapons.find((w) => w.id === id)
    if (!weapon) return
    const newStatus = weapon.status === 'available' ? 'rented' : weapon.status === 'rented' ? 'available' : weapon.status
    try {
      await apiPut<any>(`/api/weapons/${encodeURIComponent(id)}`, {
        status: newStatus,
        updatedAtISO: new Date().toISOString(),
      })
      await refresh()
    } catch (e: any) {
      toast.error(String(e?.message || e))
    }
  }

  const handleRemove = async (id: string) => {
    try {
      await apiDelete(`/api/weapons/${encodeURIComponent(id)}`)
      toast.success('Weapon removed')
      if (selectedWeaponId === id) {
        setSelectedWeaponId(null)
        setForm(emptyForm())
      }
      await refresh()
    } catch (e: any) {
      toast.error(String(e?.message || e))
    }
  }

  const { addNotification } = useNotifications()

  const handleApprovePlayerWeapon = async (id: string) => {
    try {
      await apiPut<any>(`/api/weapons/${encodeURIComponent(id)}`, {
        approvalStatus: 'approved',
        status: 'available',
        updatedAtISO: new Date().toISOString(),
      })
      sendRoleNotifications(addNotification, {
        roles: ['admin', 'registrar', 'marshal'],
        type: 'weapon_approved',
        title: 'Weapon Approved',
        message: `Weapon ${id} was approved for use.`,
        linkedResourceId: id,
      })
      toast.success('Player weapon approved')
      await refresh()
    } catch (e: any) {
      toast.error(String(e?.message || e))
    }
  }

  const openRejectDialog = (id: string) => {
    setRejectionTargetId(id)
    setRejectionReason('')
  }

  const handleRejectPlayerWeapon = async () => {
    if (!rejectionTargetId || !rejectionReason.trim()) {
      toast.error('Please enter a rejection reason')
      return
    }
    try {
      await apiPut<any>(`/api/weapons/${encodeURIComponent(rejectionTargetId)}`, {
        approvalStatus: 'rejected',
        rejectionReason: rejectionReason.trim(),
        updatedAtISO: new Date().toISOString(),
      })
      sendRoleNotifications(addNotification, {
        roles: ['admin', 'registrar', 'marshal'],
        type: 'weapon_rejected',
        title: 'Weapon Rejected',
        message: `Weapon ${rejectionTargetId} was rejected.`,
        linkedResourceId: rejectionTargetId,
      })
      toast.success('Player weapon rejected')
      setRejectionTargetId(null)
      setRejectionReason('')
      await refresh()
    } catch (e: any) {
      toast.error(String(e?.message || e))
    }
  }

  const resetForm = () => {
    setSelectedWeaponId(null)
    setForm(emptyForm())
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Weapons</h1>
          <p className="mt-1 text-sm text-muted">Manage the weapon catalog, inspect conditions, and keep the maintenance queue current.</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Weapons in catalog</div>
          <div className="mt-2 text-2xl font-bold text-accent">{weapons.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Currently rented</div>
          <div className="mt-2 text-2xl font-bold text-danger">{weapons.filter((weapon) => weapon.status === 'rented').length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Needs check</div>
          <div className="mt-2 text-2xl font-bold text-success">{maintenanceCount}</div>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setSourceFilter('business')} className={`rounded-full px-3 py-1 text-xs font-semibold transition ${sourceFilter === 'business' ? 'bg-accent/20 text-accent' : 'bg-white/5 text-muted'}`}>Rental weapons</button>
        <button type="button" onClick={() => setSourceFilter('player')} className={`rounded-full px-3 py-1 text-xs font-semibold transition ${sourceFilter === 'player' ? 'bg-accent/20 text-accent' : 'bg-white/5 text-muted'}`}>
          Players' weapons
          {pendingPlayerWeaponsCount > 0 ? (
            <span className="ml-1 rounded-full bg-warning/20 px-1.5 py-0.5 text-[10px] text-warning">{pendingPlayerWeaponsCount}</span>
          ) : null}
        </button>
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted">{sourceFilter === 'player' ? "Players' registered weapons · " : ''}{category === 'all' ? 'All categories' : category.replace('_', ' ').toUpperCase()}</div>
            <div className="mt-2 text-sm text-muted">{activeCategoryMeta?.subtitle || 'All weapon categories'}</div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">Category</div>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value as WeaponCategory | 'all')}
                className="min-w-[170px] rounded-full border border-white/10 bg-background px-3 py-2 text-sm text-text outline-none"
              >
                <option value="all">All categories</option>
                {categoryOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.key.charAt(0).toUpperCase() + option.key.slice(1).replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">Status</div>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as WeaponStatus | 'all')}
                className="min-w-[170px] rounded-full border border-white/10 bg-background px-3 py-2 text-sm text-text outline-none"
              >
                <option value="all">All statuses</option>
                <option value="available">Available</option>
                <option value="rented">Rented</option>
                <option value="needs-check">Needs check</option>
              </select>
            </div>
          </div>
        </div>

        {sourceFilter === 'player' && pendingPlayerWeaponsCount > 0 ? (
          <div className="mt-4 rounded-2xl border border-accent/20 bg-accent/10 p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">Pending player submissions</div>
                <div className="mt-1 text-sm text-text">These weapons are waiting for your approval before they are treated as active inventory.</div>
              </div>
              <div className="rounded-full border border-accent/20 bg-background/50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                {pendingPlayerWeaponsCount} awaiting review
              </div>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {pendingPlayerWeapons.map((weapon) => (
                <div key={weapon.id} className="rounded-xl border border-white/10 bg-background/50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold">{weapon.name}</div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(event) => { event.stopPropagation(); handleApprovePlayerWeapon(weapon.id) }}
                        className="rounded-lg border border-success/30 bg-success/10 px-2.5 py-1 text-[11px] font-semibold text-success"
                      >
                        Approve
                      </button>
                      <button
                        onClick={(event) => { event.stopPropagation(); openRejectDialog(weapon.id) }}
                        className="rounded-lg border border-danger/30 bg-danger/10 px-2.5 py-1 text-[11px] font-semibold text-danger"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-muted">{weapon.description || weapon.note}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {sourceFilter === 'business' ? <ModelSummaryStrip models={models} unit="piece" /> : null}

        <div className="mt-4 overflow-x-auto rounded-2xl border border-white/5">
          <div className="min-w-[920px]">
            <div className="grid grid-cols-12 bg-white/5 px-3 py-2 text-xs uppercase tracking-widest text-muted">
              <div className="col-span-2">ID</div>
              <div className="col-span-3">Weapon</div>
              <div className="col-span-1 text-right">Piece</div>
              <div className="col-span-1 text-right">Price</div>
              <div className="col-span-2 text-right">Status</div>
              <div className="col-span-3 text-right">Actions</div>
            </div>

            <div className="divide-y divide-white/5">
            {loading ? (
              <div className="p-6 text-sm text-muted">Loading weapons...</div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-sm text-muted">No weapons match this filter.</div>
            ) : (
              filtered.map((weapon) => (
                <div key={weapon.id} className={"grid grid-cols-12 items-center px-3 py-3 " + (selectedWeaponId === weapon.id ? 'bg-white/6 ring-2 ring-white/10' : '')}>
                  <div className="col-span-2 text-sm font-semibold">{weapon.id}</div>
                  <div className="col-span-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold">{weapon.name}</div>
                      {weapon.source === 'player' ? (
                        <span className="rounded-full border border-accent/20 bg-accent/10 px-2 py-1 text-[10px] uppercase tracking-[0.15em] text-accent">
                          Player owned
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs text-muted">{weapon.description || weapon.note}</div>
                    {weapon.source === 'player' ? (
                      <div className="mt-1 text-xs text-muted">
                        Owner: {ownerNames[String(weapon.submittedBy)] || weapon.submittedBy || 'Unknown'} · <span className="capitalize">{weapon.approvalStatus}</span>
                      </div>
                    ) : null}
                  </div>
                  <div className="col-span-1 text-right text-sm font-semibold">{weapon.source === 'player' || !weapon.unitNumber ? '—' : `#${weapon.unitNumber}`}</div>
                  <div className="col-span-1 text-right text-sm text-muted">₱{weapon.price}</div>
                  <div className="col-span-2 text-right">
                    <StatusBadge status={weapon.status} onToggle={() => handleStatusToggle(weapon.id)} />
                  </div>
                  <div className="col-span-3 text-right">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {weapon.source === 'player' && weapon.approvalStatus === 'pending' ? (
                        <>
                          <button
                            onClick={(event) => { event.stopPropagation(); handleApprovePlayerWeapon(weapon.id) }}
                            className="rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-xs text-success transition hover:bg-success/20"
                          >
                            Approve
                          </button>
                          <button
                            onClick={(event) => { event.stopPropagation(); openRejectDialog(weapon.id) }}
                            className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger transition hover:bg-danger/20"
                          >
                            Reject
                          </button>
                        </>
                      ) : null}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleSelect(weapon) }}
                        className="rounded-xl border border-white/5 bg-white/5 px-3 py-2 text-xs text-muted transition hover:bg-white/8 active:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/10 cursor-pointer"
                      >
                        Edit
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleToggleFlag(weapon.id) }}
                        className={"rounded-xl border px-3 py-2 text-xs font-semibold transition " + (weapon.status === 'needs-check' ? 'border-white/5 bg-white/5 text-text hover:bg-white/8' : 'border-danger/30 bg-danger/10 text-danger hover:bg-danger/15')}
                      >
                        {weapon.status === 'needs-check' ? 'Unflag' : 'Flag'}
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); handleRemove(weapon.id) }} className="rounded-xl border border-white/5 bg-white/5 px-3 py-2 text-xs text-muted transition hover:bg-white/6">
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
            </div>
          </div>
        </div>

        {sourceFilter === 'business' ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="p-4 bg-white/5/60">
            <div className="text-xs uppercase tracking-widest text-muted">{selectedWeaponId ? `Edit ${selectedWeaponId}` : 'Add weapons'}</div>
            <div className="mt-2 text-sm text-muted">
              {selectedWeaponId ? 'Update this piece, or every piece of the same model.' : 'Every physical weapon is its own piece with its own ID.'}
            </div>
            <div className="mt-4 grid gap-3">
              <label className="block">
                <div className="mb-2 text-sm font-semibold text-text">Weapon name</div>
                <input
                  ref={nameRef}
                  value={form.name}
                  readOnly={Boolean(selectedWeaponId)}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                  className="w-full rounded-xl border border-white/10 bg-transparent px-4 py-3 text-sm text-text placeholder:text-muted read-only:opacity-70"
                  placeholder="e.g. M4 Rifle"
                />
              </label>

              <label className="block">
                <div className="mb-2 text-sm font-semibold text-text">Price (₱)</div>
                <input
                  type="number"
                  min="0"
                  value={form.price}
                  onChange={(event) => setForm((prev) => ({ ...prev, price: event.target.value }))}
                  placeholder="e.g. 150"
                  className="w-full rounded-xl border border-white/10 bg-transparent px-4 py-3 text-sm text-text placeholder:text-muted"
                />
              </label>

              {selectedWeaponId ? (
                <label className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm">
                  <input
                    type="checkbox"
                    checked={form.applyToModel}
                    onChange={(event) => setForm((prev) => ({ ...prev, applyToModel: event.target.checked }))}
                    className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
                  />
                  <span>
                    Apply price, category, owner, and FPS settings to every {weapons.find((w) => w.id === selectedWeaponId)?.model || 'matching'} piece
                    <span className="block text-xs text-muted">Status and notes always change only this piece.</span>
                  </span>
                </label>
              ) : (
                <label className="block">
                  <div className="mb-2 text-sm font-semibold text-text">Pieces to add</div>
                  <input
                    type="number"
                    min="1"
                    max="200"
                    step="1"
                    value={form.pieces}
                    onChange={(event) => setForm((prev) => ({ ...prev, pieces: event.target.value }))}
                    className="w-full rounded-xl border border-white/10 bg-transparent px-4 py-3 text-sm text-text placeholder:text-muted"
                  />
                  <div className="mt-1 text-xs text-muted">Each piece gets its own ID and number (e.g. M4 Rifle #1, #2, …) so players can pick a specific one.</div>
                </label>
              )}

              <label className="block">
                <div className="mb-2 text-sm font-semibold text-text">Short description</div>
                <input
                  value={form.description}
                  onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                  placeholder="e.g. Ready for the 2:30 PM group booking."
                  className="w-full rounded-xl border border-white/10 bg-transparent px-4 py-3 text-sm text-text placeholder:text-muted"
                />
              </label>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <div className="mb-2 text-sm font-semibold text-text">Category</div>
                  <select
                    value={form.category}
                    onChange={(event) => {
                      const nextCategory = event.target.value as WeaponCategory
                      const defaultPrice = DEFAULT_CATEGORY_PRICES[nextCategory]
                      setForm((prev) => ({
                        ...prev,
                        category: nextCategory,
                        ...(defaultPrice !== undefined ? { price: String(defaultPrice) } : {}),
                      }))
                    }}
                    className="w-full rounded-xl border border-white/10 glass px-4 py-3 text-sm text-text"
                  >
                    {categoryOptions.map((option) => (
                      <option key={option.key} value={option.key}>{option.key.replace('_', ' ').toUpperCase()}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <div className="mb-2 text-sm font-semibold text-text">Status</div>
                  <select
                    value={form.status}
                    onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value as WeaponStatus }))}
                    className="w-full rounded-xl border border-white/10 glass px-4 py-3 text-sm text-text"
                  >
                    <option value="available">Available</option>
                    <option value="rented">Rented</option>
                    <option value="needs-check">Damage</option>
                  </select>
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <div className="mb-2 text-sm font-semibold text-text">FPS classification</div>
                  <select
                    value={form.fpsClass}
                    onChange={(event) => setForm((prev) => ({ ...prev, fpsClass: event.target.value }))}
                    className="w-full rounded-xl border border-white/10 glass px-4 py-3 text-sm text-text"
                  >
                    <option value="">From category ({form.category === 'snipers' ? 'sniper / VSR' : 'AEG'})</option>
                    <option value="aeg">AEG / rifle / pistol (450 FPS)</option>
                    <option value="sniper">Sniper / VSR (550 FPS, 0.20g BBs)</option>
                  </select>
                </label>
                <label className="block">
                  <div className="mb-2 text-sm font-semibold text-text">FPS limit override</div>
                  <input
                    type="number"
                    min="0"
                    value={form.fpsLimit}
                    onChange={(event) => setForm((prev) => ({ ...prev, fpsLimit: event.target.value }))}
                    placeholder="Blank = class limit"
                    className="w-full rounded-xl border border-white/10 bg-transparent px-4 py-3 text-sm text-text placeholder:text-muted"
                  />
                </label>
              </div>
              {partners.length > 0 ? (
            <label className="mt-3 block">
              <div className="mb-2 text-sm font-semibold text-text">Owned by partner</div>
              <select
                value={form.partnerId}
                onChange={(event) => setForm((prev) => ({ ...prev, partnerId: event.target.value }))}
                className="w-full rounded-xl border border-white/10 bg-background px-4 py-3 text-sm text-text [&>option]:bg-background"
              >
                <option value="">Center-owned</option>
                {partners.map((partner) => (
                  <option key={partner.id} value={partner.id}>{partner.name}</option>
                ))}
              </select>
              <div className="mt-1 text-xs text-muted">Partner-owned items count toward that partner's income share.</div>
            </label>
              ) : null}
            </div>
            <div className="mt-4">
              {selectedWeaponId ? (
                <div className="flex items-center gap-2">
                  <Button onClick={handleUpdate} disabled={saving}>
                    {saving ? 'Saving...' : 'Update weapon'}
                  </Button>
                  <Button variant="ghost" onClick={resetForm}>New</Button>
                </div>
              ) : (
                <Button onClick={addWeapon} disabled={saving}>
                  {saving ? 'Saving...' : Number(form.pieces) > 1 ? `Add ${form.pieces} pieces` : 'Add weapon'}
                </Button>
              )}
            </div>
          </Card>

          <Card className="p-4 bg-white/5/60">
            <div className="text-xs uppercase tracking-widest text-muted">Maintenance queue</div>
            <div className="mt-2 text-sm text-muted">Weapons that need servicing or re-inspection are surfaced here.</div>
            <div className="mt-4 space-y-2">
              {maintenanceQueue.length === 0 ? (
                <div className="rounded-xl border border-white/5 bg-white/5 px-3 py-3 text-sm text-muted">
                  No weapons currently need inspection.
                </div>
              ) : (
                maintenanceQueue.map((weapon) => (
                  <div key={weapon.id} className="rounded-xl border border-white/5 bg-white/5 px-3 py-3">
                    <div className="text-sm font-semibold">{weapon.name}</div>
                    <div className="mt-1 text-xs text-muted">{weapon.description || weapon.note || 'Marked for inspection.'}</div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
        ) : null}
      </Card>
      {rejectionTargetId ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="weapon-rejection-title">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-background p-5 shadow-2xl">
            <div id="weapon-rejection-title" className="text-lg font-bold">Reject player weapon</div>
            <p className="mt-1 text-sm text-muted">Add a comment explaining why this submission was rejected.</p>
            <textarea
              autoFocus
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
              placeholder="Reason for rejection"
              rows={4}
              className="mt-4 w-full resize-y rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text outline-none focus:border-danger/50"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setRejectionTargetId(null)}>Cancel</Button>
              <Button onClick={handleRejectPlayerWeapon} disabled={!rejectionReason.trim()}>Reject weapon</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

