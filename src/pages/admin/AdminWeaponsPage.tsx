import React from 'react'
import toast from 'react-hot-toast'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { apiGet, apiPost, apiPut, apiDelete } from '../../utils/apiClient'
import { sendRoleNotifications, useNotifications } from '../../context/NotificationContext'

type WeaponCategory = 'rifles' | 'pistols' | 'snipers' | 'mg' | 'shotguns'

type WeaponStatus = 'available' | 'rented' | 'needs-check'

type WeaponItem = {
  partnerId?: string
  id: string
  _id?: any
  name: string
  category: WeaponCategory
  status: WeaponStatus
  note: string
  description?: string
  price: number
  quantity: number
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

function generateWeaponId(name: string, existingIds: string[]): string {
  // Extract first letter of each word in the name (up to 2 letters)
  // e.g. "Rifle Alpha" → "RA", "Viper" → "V", "MG Atlas" → "MA"
  const words = (name || '').trim().split(/\s+/).filter(Boolean)
  let prefix = ''
  if (words.length >= 2) {
    prefix = (words[0].charAt(0) + words[1].charAt(0)).toUpperCase()
  } else if (words.length === 1) {
    prefix = words[0].charAt(0).toUpperCase()
  }
  if (!prefix || !/[A-Z]/.test(prefix)) return `W-XX-001`

  // Find the highest sequence number for this prefix (e.g. W-RA-XXX)
  let maxSeq = 0
  const pattern = new RegExp(`^W-${prefix}-(\\d{3})$`)
  for (const existingId of existingIds) {
    const match = existingId.match(pattern)
    if (match) {
      const seq = parseInt(match[1], 10)
      if (seq > maxSeq) maxSeq = seq
    }
  }

  const nextSeq = maxSeq + 1
  return `W-${prefix}-${String(nextSeq).padStart(3, '0')}`
}

const emptyForm = () => ({ name: '', description: '', category: 'rifles' as WeaponCategory, status: 'available' as WeaponStatus, price: '0', quantity: '1', partnerId: '' })

// Rental units of this model on hand; legacy records without a count are one unit.
function readQuantity(d: any) {
  const value = Number(d.quantity ?? d.qty ?? d.stock ?? 1)
  return Number.isInteger(value) && value >= 0 ? value : 0
}

function parseQuantityInput(value: string) {
  const quantity = Number(value)
  return Number.isInteger(quantity) && quantity >= 0 ? quantity : null
}

export function AdminWeaponsPage() {
  const [category, setCategory] = React.useState<WeaponCategory | 'all'>('all')
  const [status, setStatus] = React.useState<WeaponStatus | 'all'>('all')
  const [sourceFilter, setSourceFilter] = React.useState<'all' | 'business' | 'player'>('all')
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
        quantity: readQuantity(d),
        createdAtISO: d.createdAtISO || null,
        submittedBy: d.submittedBy,
        source: (d.source || (d.submittedBy ? 'player' : 'business')) as 'business' | 'player',
        approvalStatus: (d.approvalStatus || (d.source === 'player' || d.submittedBy ? 'pending' : 'approved')) as 'pending' | 'approved' | 'rejected',
        rejectionReason: d.rejectionReason || '',
        partnerId: d.partnerId || '',
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

  const filtered = weapons.filter((weapon) => {
    if (weapon.source === 'player' && weapon.approvalStatus === 'rejected') return false
    const matchCategory = category === 'all' ? true : weapon.category === category
    const matchStatus = status === 'all' ? true : weapon.status === status
    const matchSource = sourceFilter === 'all' ? true : weapon.source === sourceFilter
    return matchCategory && matchStatus && matchSource
  })

  const activeCategoryMeta = category === 'all' ? null : categoryOptions.find((item) => item.key === category)
  const maintenanceQueue = weapons.filter((weapon) => weapon.status === 'needs-check')
  const maintenanceCount = maintenanceQueue.length
  const pendingPlayerWeapons = weapons.filter((weapon) => weapon.source === 'player' && weapon.approvalStatus === 'pending')
  const pendingPlayerWeaponsCount = pendingPlayerWeapons.length

  const existingIds = weapons.map((w) => w.id).filter(Boolean) as string[]

  const addWeapon = async () => {
    if (!form.name.trim()) {
      toast.error('Weapon name is required')
      return
    }
    const quantity = parseQuantityInput(form.quantity)
    if (quantity === null) {
      toast.error('Stock must be a whole number (0 or more).')
      return
    }

    setSaving(true)
    try {
      const newId = generateWeaponId(form.name, existingIds)
      const newWeapon = {
        id: newId,
        name: form.name.trim(),
        category: form.category,
        status: form.status,
        price: Number(form.price) || 0,
        quantity,
        description: form.description.trim(),
        note: form.description.trim() || 'Added through the admin inventory review.',
        createdAtISO: new Date().toISOString(),
        source: 'business',
        approvalStatus: 'approved',
        partnerId: form.partnerId,
      }

      const res = await apiPost<any>('/api/weapons', newWeapon)
      if (!res?.ok) throw new Error(res?.error || 'Failed to create weapon')

      toast.success(`Weapon "${form.name.trim()}" created as ${newId}`)
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
      quantity: String(weapon.quantity),
      partnerId: weapon.partnerId || '',
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

    if (!form.name.trim()) {
      toast.error('Weapon name is required')
      return
    }
    const quantity = parseQuantityInput(form.quantity)
    if (quantity === null) {
      toast.error('Stock must be a whole number (0 or more).')
      return
    }

    setSaving(true)
    try {
      await apiPut<any>(`/api/weapons/${encodeURIComponent(selectedWeaponId)}`, {
        name: form.name.trim(),
        category: form.category,
        status: form.status,
        price: Number(form.price) || 0,
        quantity,
        description: form.description.trim(),
        note: form.description.trim() || 'Updated from admin inventory.',
        partnerId: form.partnerId,
        updatedAtISO: new Date().toISOString(),
      })
      toast.success('Weapon updated')
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
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">View source</div>
          {[
            { value: 'all', label: 'All' },
            { value: 'business', label: 'Business' },
            { value: 'player', label: 'Player' },
          ].map((option) => (
            <button
              key={option.value}
              onClick={() => setSourceFilter(option.value as 'all' | 'business' | 'player')}
              className={
                'rounded-full border px-3 py-2 text-sm transition ' +
                (sourceFilter === option.value
                  ? 'bg-accent/20 text-accent border-accent/40'
                  : 'bg-white/5 text-muted hover:bg-white/8')
              }
            >
              <span>{option.label}</span>
              {option.value === 'player' && pendingPlayerWeaponsCount > 0 ? (
                <span className="ml-1 rounded-full bg-warning/20 px-1.5 py-0.5 text-[10px] text-warning">
                  {pendingPlayerWeaponsCount}
                </span>
              ) : null}
            </button>
          ))}
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

      <Card className="p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted">{category === 'all' ? 'All categories' : category.toUpperCase()}</div>
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
                    {option.key.charAt(0).toUpperCase() + option.key.slice(1)}
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

        <div className="mt-4 overflow-x-auto rounded-2xl border border-white/5">
          <div className="min-w-[920px]">
            <div className="grid grid-cols-12 bg-white/5 px-3 py-2 text-xs uppercase tracking-widest text-muted">
              <div className="col-span-2">ID</div>
              <div className="col-span-3">Weapon</div>
              <div className="col-span-1 text-right">Stock</div>
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
                  </div>
                  <div className="col-span-1 text-right text-sm font-semibold">{weapon.source === 'player' ? '—' : weapon.quantity}</div>
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

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="p-4 bg-white/5/60">
            <div className="text-xs uppercase tracking-widest text-muted">Add a weapon</div>
            <div className="mt-2 text-sm text-muted">Create a new entry with the right category and readiness state.</div>
            <div className="mt-4 grid gap-3">
              <label className="block">
                <div className="mb-2 text-sm font-semibold text-text">Weapon name</div>
                <input
                  ref={nameRef}
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                  className="w-full rounded-xl border border-white/10 bg-transparent px-4 py-3 text-sm text-text placeholder:text-muted"
                  placeholder="e.g. Rifle Delta"
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

              <label className="block">
                <div className="mb-2 text-sm font-semibold text-text">Stock (rental units)</div>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.quantity}
                  onChange={(event) => setForm((prev) => ({ ...prev, quantity: event.target.value }))}
                  placeholder="e.g. 40"
                  className="w-full rounded-xl border border-white/10 bg-transparent px-4 py-3 text-sm text-text placeholder:text-muted"
                />
                <div className="mt-1 text-xs text-muted">How many of this weapon can be rented out in the same time slot.</div>
              </label>

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
                    onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value as WeaponCategory }))}
                    className="w-full rounded-xl border border-white/10 glass px-4 py-3 text-sm text-text"
                  >
                    {categoryOptions.map((option) => (
                      <option key={option.key} value={option.key}>{option.key.toUpperCase()}</option>
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
                  {saving ? 'Saving...' : 'Register weapon'}
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

