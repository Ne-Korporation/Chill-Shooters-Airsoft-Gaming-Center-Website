import React from 'react'
import { confirmDialog } from '../../components/ui/ConfirmDialog'
import { FiCheck, FiEdit2, FiPlus, FiTrash2, FiX } from 'react-icons/fi'
import toast from 'react-hot-toast'
import { ActionGroup, Button } from '../../components/ui/Button'
import { FilterTabs } from '../../components/ui/FilterTabs'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { apiGet, apiGetAll, apiPost, apiPut, apiDelete } from '../../utils/apiClient'
import { useAuth } from '../../context/AuthContext'
import { Pagination, usePagination } from '../../components/ui/Pagination'
import { ModelSummaryStrip } from '../../components/inventory/ModelSummaryStrip'
import { BulkUpdateModal, InventoryToolbar, SelectBox, forEachPiece, type BulkChange } from '../../components/inventory/BulkActionBar'
import { DEFAULT_LOW_STOCK_GRAMS, ammoLowLevel, isAmmo, isLowOnAmmo, modelOf, summarizeModels } from '../../utils/inventoryModels'

// Rental gear is only masks, vests, and ammo.
type EquipmentCategory = 'masks' | 'vests' | 'ammo'

type EquipmentStatus = 'available' | 'rented' | 'maintenance'

type InventoryItem = {
  partnerId?: string
  id: string
  _id?: any
  name: string
  category: EquipmentCategory
  status: EquipmentStatus
  model: string
  unitNumber: number
  price: number
  // Grams of BBs in stock; only used for ammo
  stockGrams: number
  // Below this many grams the ammo is low (DEFAULT_LOW_STOCK_GRAMS when not set).
  lowStockGrams?: number
  replacementValue?: number
  note: string
  description?: string
  createdAtISO?: string
  submittedBy?: string
  source?: 'business' | 'player'
  approvalStatus?: 'pending' | 'approved' | 'rejected'
  rejectionReason?: string
}

const categoryMeta: Record<EquipmentCategory, { subtitle: string }> = {
  masks: { subtitle: 'Face protection and field-ready headgear' },
  vests: { subtitle: 'Body armor and protective carriers' },
  ammo: { subtitle: 'BB packs and magazines (e.g. 2 magazines / 600 rounds)' },
}

const StatusBadge = ({ status }: { status: EquipmentStatus }) => {
  const cls =
    status === 'available'
      ? 'bg-success/20 text-success border-success/30'
      : status === 'rented'
        ? 'bg-accent/20 text-accent border-accent/30'
        : 'bg-danger/20 text-danger border-danger/30'

  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${cls}`}>
      {status.toUpperCase()}
    </span>
  )
}

// Ammo is one record per BB type, stocked in grams and priced per refill.
const AMMO_PRICE_PER_REFILL = '50'

const emptyForm = () => ({ name: '', description: '', pieces: '1', grams: '', lowGrams: '', applyToModel: true, price: '0', replacementValue: '', status: 'available' as EquipmentStatus, category: 'masks' as EquipmentCategory, partnerId: '' })

export function AdminEquipmentPage() {
  const [activeCategory, setActiveCategory] = React.useState<EquipmentCategory | 'all'>('all')
  const [status, setStatus] = React.useState<EquipmentStatus | 'all'>('all')
  const [inventory, setInventory] = React.useState<InventoryItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [sourceFilter, setSourceFilter] = React.useState<'business' | 'player'>('business')
  const [form, setForm] = React.useState(emptyForm())
  const [selectedItemId, setSelectedItemId] = React.useState<string | null>(null)
  // The add/edit form opens in a pop-up.
  const [formOpen, setFormOpen] = React.useState(false)
  const [rejectionTargetId, setRejectionTargetId] = React.useState<string | null>(null)
  const [rejectionReason, setRejectionReason] = React.useState('')

  const refresh = React.useCallback(async () => {
    setLoading(true)
    try {
      const equipmentDocs = await apiGetAll<any>('equipments')

      const equipmentItems = equipmentDocs.map((d: any) => ({
        id: d.id ?? (d._id ? String(d._id) : undefined),
        _id: d._id,
        name: d.name || 'Unnamed gear',
        category: (d.category || 'gear') as EquipmentCategory,
        status: (d.status || 'available') as EquipmentStatus,
        model: modelOf(d),
        unitNumber: Number(d.unitNumber) || 0,
        price: typeof d.price === 'number' ? d.price : 0,
        stockGrams: Number(d.stockGrams) || 0,
        lowStockGrams: Number(d.lowStockGrams) || undefined,
        replacementValue: Number(d.replacementValue) || 0,
        note: d.note || d.description || '',
        description: d.description || d.note || '',
        createdAtISO: d.createdAtISO || null,
        submittedBy: d.submittedBy,
        source: (d.source || (d.submittedBy ? 'player' : 'business')) as 'business' | 'player',
        approvalStatus: (d.approvalStatus || (d.source === 'player' || d.submittedBy ? 'pending' : 'approved')) as 'pending' | 'approved' | 'rejected',
        rejectionReason: d.rejectionReason || '',
        partnerId: d.partnerId || '',
      }))

      setInventory(equipmentItems)
    } catch (e: any) {
      toast.error(String(e?.message || e))
      setInventory([])
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { refresh() }, [refresh])

  const [search, setSearch] = React.useState('')
  // Filters run over the whole inventory first, then the result is paged 10 at a time, so a
  // match is never hidden on a page that isn't showing.
  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase()
    return inventory.filter((item) => {
      if (item.source === 'player' && item.approvalStatus === 'rejected') return false
      const matchesCategory = activeCategory === 'all' ? true : item.category === activeCategory
      const matchesStatus = status === 'all' ? true : item.status === status
      const matchesSource = item.source === sourceFilter
      const matchesSearch = !term || [item.id, item.name, item.model, item.description].some((value) => String(value || '').toLowerCase().includes(term))
      return matchesCategory && matchesStatus && matchesSource && matchesSearch
    })
  }, [inventory, activeCategory, status, sourceFilter, search])
  const { page, setPage, pageCount, pageItems, total } = usePagination(filtered, undefined, `${activeCategory}|${status}|${sourceFilter}|${search}`)

  const rentalPieces = inventory.filter((item) => item.source !== 'player')
  const totalInStock = rentalPieces.length
  // BB ammo below its warning level (center stock only).
  const lowAmmo = inventory.filter((item) => item.source !== 'player' && isLowOnAmmo(item))
  const models = summarizeModels(inventory)
  const maintenanceCount = inventory.filter((item) => item.status === 'maintenance').length
  const rentedCount = inventory.filter((item) => item.status === 'rented').length
  const pendingPlayerItems = inventory.filter((item) => item.source === 'player' && item.approvalStatus === 'pending')
  const pendingPlayerItemsCount = pendingPlayerItems.length

  // Each physical item is its own record: adding 5 masks creates Mask #1 … #5 with their own IDs.
  const handleCreate = async () => {
    if (!form.name.trim()) {
      toast.error('Item name is required')
      return
    }
    const ammo = isAmmo(form)
    const grams = Number(form.grams)
    if (ammo && (!Number.isFinite(grams) || grams <= 0)) {
      toast.error('Enter the grams of BBs in stock.')
      return
    }
    // Ammo is a single record holding its grams; everything else is one record per piece.
    const count = ammo ? 1 : Number(form.pieces)
    if (!Number.isInteger(count) || count < 1 || count > 200) {
      toast.error('Add between 1 and 200 pieces at a time.')
      return
    }

    setSaving(true)
    try {
      const res = await apiPost<{ ok: boolean; data: Array<{ id: string }> }>('/api/inventory/equipments/pieces', {
        model: form.name.trim(),
        count,
        category: form.category,
        status: form.status,
        price: Number(form.price) || 0,
        replacementValue: Number(form.replacementValue) || 0, 
        ...(ammo ? { stockGrams: Math.round(grams), lowStockGrams: Math.max(0, Math.round(Number(form.lowGrams) || 0)) } : {}),
        description: form.description.trim(),
        note: form.description.trim() || 'Newly entered from admin inventory.',
        partnerId: form.partnerId,
      })
      const ids = res.data.map((piece) => piece.id)
      toast.success(ammo ? `Added ${ids[0]} (${Math.round(grams).toLocaleString()} g)` : count === 1 ? `Added ${ids[0]}` : `Added ${count} pieces (${ids[0]} – ${ids[ids.length - 1]})`)
      setForm(emptyForm())
      setFormOpen(false)
      await refresh()
    } catch (e: any) {
      toast.error(String(e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  const handleSelect = (item: InventoryItem) => {
    setSelectedItemId(item.id)
    setFormOpen(true)
    setForm({
      name: item.name,
      description: item.description || item.note || '',
      pieces: '1',
      grams: item.stockGrams ? String(item.stockGrams) : '',
      lowGrams: item.lowStockGrams ? String(item.lowStockGrams) : '',
      applyToModel: true,
      price: String(item.price),
      replacementValue: item.replacementValue ? String(item.replacementValue) : '',
      status: item.status,
      category: item.category,
      partnerId: item.partnerId || '',
    })
  }

  const nameRef = React.useRef<HTMLInputElement | null>(null)

  const [partners, setPartners] = React.useState<Array<{ id: string; name: string }>>([])

  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  React.useEffect(() => {
    // Only admins can read partnerships; other roles just see center-owned items, so they
    // don't ask (asking only got a "Forbidden" error).
    if (!isAdmin) return
    apiGet<{ ok: boolean; data: any[] }>('/api/partnerships?limit=200')
      .then((res) => setPartners((res.data || [])
        .filter((p: any) => p.type === 'equipment_partner')
        .map((p: any) => ({ id: String(p.id || p._id), name: String(p.name || 'Partner') }))))
      .catch(() => setPartners([]))
  }, [isAdmin])

  React.useEffect(() => {
    if (selectedItemId) {
      requestAnimationFrame(() => nameRef.current?.focus())
    }
  }, [selectedItemId])

  const handleRemove = async (id: string) => {
    const name = inventory.find((item) => item.id === id)?.name || id
    if (!(await confirmDialog({ title: `Remove "${name}"?`, message: 'It will be removed from the gear list. This cannot be undone.', confirmLabel: 'Remove', danger: true }))) return
    try {
      await apiDelete(`/api/equipments/${encodeURIComponent(id)}`)
      toast.success('Gear removed')
      if (selectedItemId === id) {
        setSelectedItemId(null)
        setForm(emptyForm())
      }
      await refresh()
    } catch (e: any) {
      toast.error(String(e?.message || e))
    }
  }


  // Bulk selection: tick rows (or every row matching the filters) and change them together.
  const [selectedIds, setSelectedIds] = React.useState<string[]>([])
  const [bulkBusy, setBulkBusy] = React.useState(false)
  // Tick boxes appear only after "Select items"; "Update" opens the bulk changes pop-up.
  const [selecting, setSelecting] = React.useState(false)
  const [bulkOpen, setBulkOpen] = React.useState(false)
  React.useEffect(() => setSelectedIds([]), [activeCategory, status, sourceFilter, search])
  const stopSelecting = () => {
    setSelecting(false)
    setSelectedIds([])
    setBulkOpen(false)
  }
  const allFilteredSelected = filtered.length > 0 && filtered.every((item) => selectedIds.includes(item.id))
  const toggleSelected = (id: string) =>
    setSelectedIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]))
  const toggleAll = () => setSelectedIds(allFilteredSelected ? [] : filtered.map((item) => item.id))

  const applyBulk = async (change: BulkChange) => {
    setBulkBusy(true)
    const failed = await forEachPiece(selectedIds, (id) =>
      apiPut(`/api/equipments/${encodeURIComponent(id)}`, { ...change, updatedAtISO: new Date().toISOString() }))
    setBulkBusy(false)
    if (failed) toast.error(`${failed} of ${selectedIds.length} items could not be updated.`)
    else toast.success(`Updated ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'}.`)
    stopSelecting()
    await refresh()
  }

  const removeBulk = async () => {
    if (!(await confirmDialog({ title: `Remove ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'}?`, message: 'They will be removed from the gear list. This cannot be undone.', confirmLabel: 'Remove', danger: true }))) return
    setBulkBusy(true)
    const failed = await forEachPiece(selectedIds, (id) => apiDelete(`/api/equipments/${encodeURIComponent(id)}`))
    setBulkBusy(false)
    if (failed) toast.error(`${failed} of ${selectedIds.length} items could not be removed.`)
    else toast.success(`Removed ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'}.`)
    stopSelecting()
    await refresh()
  }

  const handleApprovePlayerItem = async (id: string) => {
    try {
      await apiPut<any>(`/api/equipments/${encodeURIComponent(id)}`, {
        approvalStatus: 'approved',
        status: 'available',
        updatedAtISO: new Date().toISOString(),
      })
      toast.success('Player item approved')
      await refresh()
    } catch (e: any) {
      toast.error(String(e?.message || e))
    }
  }

  const openRejectDialog = (id: string) => {
    setRejectionTargetId(id)
    setRejectionReason('')
  }

  const handleRejectPlayerItem = async () => {
    if (!rejectionTargetId || !rejectionReason.trim()) {
      toast.error('Please enter a rejection reason')
      return
    }
    try {
      await apiPut<any>(`/api/equipments/${encodeURIComponent(rejectionTargetId)}`, {
        approvalStatus: 'rejected',
        rejectionReason: rejectionReason.trim(),
        updatedAtISO: new Date().toISOString(),
      })
      toast.success('Player item rejected')
      setRejectionTargetId(null)
      setRejectionReason('')
      await refresh()
    } catch (e: any) {
      toast.error(String(e?.message || e))
    }
  }

  const handleUpdate = async () => {
    if (!selectedItemId) {
      await handleCreate()
      return
    }

    const piece = inventory.find((item) => item.id === selectedItemId)
    const ammo = isAmmo(form)
    const grams = Number(form.grams)
    if (ammo && (!Number.isFinite(grams) || grams < 0)) {
      toast.error('Enter the grams of BBs in stock.')
      return
    }
    setSaving(true)
    try {
      // Status and notes belong to this one piece.
      await apiPut<any>(`/api/equipments/${encodeURIComponent(selectedItemId)}`, {
        status: form.status,
        description: form.description.trim(),
        note: form.description.trim() || 'Updated from admin inventory.',
        ...(ammo ? { stockGrams: Math.round(grams), lowStockGrams: Math.max(0, Math.round(Number(form.lowGrams) || 0)) } : {}),
        ...(form.applyToModel ? {} : { price: Number(form.price) || 0, replacementValue: Number(form.replacementValue) || 0, category: form.category, partnerId: form.partnerId }),
        updatedAtISO: new Date().toISOString(),
      })
      // Price, category, and owner are shared by every piece of the model.
      if (form.applyToModel && piece) {
        await apiPut<any>('/api/inventory/equipments/models', {
          model: piece.model,
          price: Number(form.price) || 0,
          replacementValue: Number(form.replacementValue) || 0, 
          category: form.category,
          partnerId: form.partnerId,
        })
      }
      toast.success(form.applyToModel && piece ? `Updated ${piece.name} and all ${piece.model} pieces` : 'Gear updated')
      setSelectedItemId(null)
      setForm(emptyForm())
      setFormOpen(false)
      await refresh()
    } catch (e: any) {
      toast.error(String(e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  const resetForm = () => {
    setSelectedItemId(null)
    setForm(emptyForm())
  }

  const openAddForm = () => {
    resetForm()
    setFormOpen(true)
  }

  const closeForm = () => {
    resetForm()
    setFormOpen(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Gear</h1>
          <p className="mt-1 text-sm text-muted">Track inventory by category, condition, and ownership source.</p>
        </div>
      </div>

      {lowAmmo.length > 0 ? (
        <Card className="border-danger/30 p-4">
          <div className="text-sm font-bold text-danger">BB ammo running low</div>
          <ul className="mt-2 space-y-1.5 text-sm">
            {lowAmmo.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="font-semibold">{item.name}</span>
                  <span className="text-muted"> · {item.stockGrams.toLocaleString()} g left (warns below {ammoLowLevel(item).toLocaleString()} g)</span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => handleSelect(item)}>Restock</Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <Card className="rounded-xl px-3 py-2 md:px-3 md:py-2">
          <div className="truncate text-[10px] uppercase tracking-wider text-muted">Rental pieces</div>
          <div className="mt-0.5 text-base font-bold text-accent">{totalInStock}</div>
        </Card>
        <Card className="rounded-xl px-3 py-2 md:px-3 md:py-2">
          <div className="truncate text-[10px] uppercase tracking-wider text-muted">Rented right now</div>
          <div className="mt-0.5 text-base font-bold text-danger">{rentedCount}</div>
        </Card>
        <Card className="rounded-xl px-3 py-2 md:px-3 md:py-2">
          <div className="truncate text-[10px] uppercase tracking-wider text-muted">Pending player items</div>
          <div className="mt-0.5 text-base font-bold text-success">{pendingPlayerItemsCount}</div>
        </Card>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterTabs
          ariaLabel="Show rental gear or players' gear"
          value={sourceFilter}
          onChange={setSourceFilter}
          options={[
            { value: 'business', label: 'Rental gear' },
            { value: 'player', label: "Players' gear", ...(pendingPlayerItemsCount > 0 ? { count: pendingPlayerItemsCount } : {}) },
          ]}
        />
        <InventoryToolbar
          selecting={selecting}
          selectedCount={selectedIds.length}
          allSelected={allFilteredSelected}
          addLabel="Add gear"
          onStartSelecting={() => setSelecting(true)}
          onToggleAll={toggleAll}
          onCancel={stopSelecting}
          onUpdate={() => setBulkOpen(true)}
          onAdd={openAddForm}
        />
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted">{activeCategory === 'all' ? 'All categories' : activeCategory.toUpperCase()}</div>
            <div className="mt-2 text-sm text-muted">{activeCategory === 'all' ? 'Browse every item in one place.' : categoryMeta[activeCategory].subtitle}</div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">Search</div>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="ID, name, or model"
                className="w-full sm:min-w-[200px] rounded-full border border-white/10 bg-background px-4 py-2 text-sm text-text outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">Category</div>
              <select
                value={activeCategory}
                onChange={(event) => setActiveCategory(event.target.value as EquipmentCategory | 'all')}
                className="w-full sm:w-auto sm:min-w-[170px] rounded-full border border-white/10 bg-background px-3 py-2 text-sm text-text outline-none"
              >
                <option value="all">All categories</option>
                {(Object.keys(categoryMeta) as EquipmentCategory[]).map((cat) => (
                  <option key={cat} value={cat}>
                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">Status</div>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as EquipmentStatus | 'all')}
                className="w-full sm:w-auto sm:min-w-[170px] rounded-full border border-white/10 bg-background px-3 py-2 text-sm text-text outline-none"
              >
                <option value="all">All statuses</option>
                <option value="available">Available</option>
                <option value="rented">Rented</option>
                <option value="maintenance">Maintenance</option>
              </select>
            </div>
          </div>
        </div>

        {sourceFilter === 'player' && pendingPlayerItemsCount > 0 ? (
          <div className="mt-4 rounded-2xl border border-accent/20 bg-accent/10 p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">Pending player submissions</div>
                <div className="mt-1 text-sm text-text">These items are waiting for your approval before they are treated as active inventory.</div>
              </div>
              <div className="rounded-full border border-accent/20 bg-background/50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                {pendingPlayerItemsCount} awaiting review
              </div>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {pendingPlayerItems.map((item) => (
                <div key={item.id} className="rounded-xl border border-white/10 bg-background/50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 text-sm font-semibold">{item.name}</div>
                    <ActionGroup>
                      <Button size="xs" variant="success-soft" onClick={(e) => { e.stopPropagation(); handleApprovePlayerItem(item.id) }}>
                        <FiCheck /> Approve
                      </Button>
                      <Button size="xs" variant="danger-soft" onClick={(e) => { e.stopPropagation(); openRejectDialog(item.id) }}>
                        <FiX /> Reject
                      </Button>
                    </ActionGroup>
                  </div>
                  <div className="mt-1 text-xs text-muted">{item.description || item.note}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {sourceFilter === 'business' ? <ModelSummaryStrip models={models} unit="piece" /> : null}

        {bulkOpen ? (
          <BulkUpdateModal
            count={selectedIds.length}
            noun={selectedIds.length === 1 ? 'item' : 'items'}
            statuses={[{ value: 'available', label: 'Available' }, { value: 'rented', label: 'Rented' }, { value: 'maintenance', label: 'Maintenance' }]}
            categories={(Object.keys(categoryMeta) as EquipmentCategory[]).map((value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) }))}
            busy={bulkBusy}
            onApply={applyBulk}
            onRemove={removeBulk}
            onClose={() => setBulkOpen(false)}
          />
        ) : null}

        <div className="mt-4 overflow-hidden rounded-2xl border border-white/5">
          <div className="stack-head grid grid-cols-12 gap-3 bg-white/5 px-3 py-2 text-xs uppercase tracking-widest text-muted">
            <div className="col-span-2">ID</div>
            <div className="col-span-3">Gear</div>
            <div className="col-span-1 text-right">Piece</div>
            <div className="col-span-1 text-right">Price</div>
            <div className="col-span-2 pl-4">Status</div>
            <div className="col-span-3 text-right">Actions</div>
          </div>

          <div className="divide-y divide-white/5">
            {loading ? (
              <div className="p-6 text-sm text-muted">Loading equipment...</div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-sm text-muted">No gear matches this filter.</div>
            ) : (
              pageItems.map((item) => (
                <div key={item.id} className={"stack-row grid grid-cols-12 items-center gap-3 px-3 py-3 " + (selectedItemId === item.id ? 'bg-white/6 ring-2 ring-white/10' : '')}>
                  <div data-label="ID" className="col-span-2 flex items-center gap-2 text-sm font-semibold">
                    {selecting ? <SelectBox checked={selectedIds.includes(item.id)} onChange={() => toggleSelected(item.id)} label={`Select ${item.id}`} /> : null}
                    {item.id}
                  </div>
                  <div data-label="Gear" className="stack-wide col-span-3 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold">{item.name}</div>
                      <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.15em] text-muted">
                        {item.category}
                      </span>
                      {item.source === 'player' ? (
                        <span className="rounded-full border border-accent/20 bg-accent/10 px-2 py-1 text-[10px] uppercase tracking-[0.15em] text-accent">
                          Player owned
                        </span>
                      ) : null}
                      {item.source === 'player' && item.approvalStatus === 'pending' ? (
                        <span className="rounded-full border border-warning/20 bg-warning/10 px-2 py-1 text-[10px] uppercase tracking-[0.15em] text-warning">
                          Pending review
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs text-muted md:truncate">{item.description || item.note}</div>
                  </div>
                  <div data-label="Piece" className="col-span-1 text-right text-sm font-semibold">
                    {isAmmo(item) ? `${item.stockGrams.toLocaleString()} g` : item.source === 'player' || !item.unitNumber ? '—' : `#${item.unitNumber}`}
                    {isLowOnAmmo(item) ? <span className="mt-0.5 block text-[10px] font-semibold uppercase text-danger">Low stock</span> : null}
                  </div>
                  <div data-label="Price" className="col-span-1 text-right text-sm text-accent">₱{item.price}{isAmmo(item) ? <span className="block text-[10px] text-muted">per refill</span> : null}</div>
                  <div data-label="Status" className="col-span-2 pl-4">
                    <StatusBadge status={item.status} />
                  </div>
                  <div className="stack-wide col-span-3">
                    <ActionGroup>
                      <Button size="xs" variant="ghost" onClick={(e) => { e.stopPropagation(); handleSelect(item) }}>
                        <FiEdit2 /> Edit
                      </Button>
                      {item.source === 'player' && item.approvalStatus === 'pending' ? (
                        <>
                          <Button size="xs" variant="success-soft" onClick={(e) => { e.stopPropagation(); handleApprovePlayerItem(item.id) }}>
                            <FiCheck /> Approve
                          </Button>
                          <Button size="xs" variant="danger-soft" onClick={(e) => { e.stopPropagation(); openRejectDialog(item.id) }}>
                            <FiX /> Reject
                          </Button>
                        </>
                      ) : null}
                      <Button size="xs" variant="danger-soft" onClick={(e) => { e.stopPropagation(); handleRemove(item.id) }}>
                        <FiTrash2 /> Remove
                      </Button>
                    </ActionGroup>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        <Pagination page={page} pageCount={pageCount} total={total} onPageChange={setPage} />

        {formOpen ? (
          <Modal eyebrow="Gear" title={selectedItemId ? `Edit ${selectedItemId}` : 'Add gear'} onClose={closeForm}>
            <div className="text-sm text-muted">
              {isAmmo(form)
                ? 'Ammo is tracked by the grams of BBs in stock and priced per refill. Package bookings take their grams out of stock automatically; cancelled bookings put them back.'
                : selectedItemId ? 'Update this piece, or every piece of the same model.' : 'Every physical item is its own piece with its own ID (e.g. Mask #1, Mask #2).'}
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Input
                ref={nameRef}
                label="Item name"
                value={form.name}
                readOnly={Boolean(selectedItemId)}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="e.g. Mask"
              />
              {selectedItemId ? (
                <label className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm">
                  <input
                    type="checkbox"
                    checked={form.applyToModel}
                    onChange={(event) => setForm((prev) => ({ ...prev, applyToModel: event.target.checked }))}
                    className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
                  />
                  <span>
                    Apply price, category, and owner to every {inventory.find((item) => item.id === selectedItemId)?.model || 'matching'} piece
                    <span className="block text-xs text-muted">Status and notes change only this piece.</span>
                  </span>
                </label>
              ) : isAmmo(form) ? (
                <Input
                  label="Grams of BBs in stock"
                  type="number"
                  min="1"
                  value={form.grams}
                  onChange={(event) => setForm((prev) => ({ ...prev, grams: event.target.value }))}
                  placeholder="e.g. 5000"
                />
              ) : (
                <Input
                  label="Pieces to add"
                  type="number"
                  min="1"
                  max="200"
                  value={form.pieces}
                  onChange={(event) => setForm((prev) => ({ ...prev, pieces: event.target.value }))}
                />
              )}
            </div>

            {selectedItemId && isAmmo(form) ? (
              <div className="mt-3">
                <Input
                  label="Grams of BBs in stock"
                  type="number"
                  min="0"
                  value={form.grams}
                  onChange={(event) => setForm((prev) => ({ ...prev, grams: event.target.value }))}
                  placeholder="e.g. 5000"
                />
              </div>
            ) : null}
            {isAmmo(form) ? (
              <div className="mt-3">
                <Input
                  label="Warn me when stock is below (grams)"
                  hint={`Admins and marshals get a notice when the BBs drop below this. Leave blank for ${DEFAULT_LOW_STOCK_GRAMS.toLocaleString()} g.`}
                  type="number"
                  min="0"
                  value={form.lowGrams}
                  onChange={(event) => setForm((prev) => ({ ...prev, lowGrams: event.target.value }))}
                  placeholder={String(DEFAULT_LOW_STOCK_GRAMS)}
                />
              </div>
            ) : null}

            <div className="mt-3">
              <label className="block text-sm font-semibold text-text">{isAmmo(form) ? 'Price per refill (₱)' : 'Price (₱)'}</label>
              <input
                type="number"
                min="0"
                value={form.price}
                onChange={(event) => setForm((prev) => ({ ...prev, price: event.target.value }))}
                placeholder="e.g. 200"
                className="mt-2 w-full rounded-xl border border-white/10 bg-transparent px-4 py-3 text-sm text-text placeholder:text-muted"
              />
            </div>

            <div className="mt-3">
              <label className="block text-sm font-semibold text-text">Replacement value (₱)</label>
              <input
                type="number"
                min="0"
                value={form.replacementValue}
                onChange={(event) => setForm((prev) => ({ ...prev, replacementValue: event.target.value }))}
                placeholder="What it costs to replace if lost"
                className="mt-2 w-full rounded-xl border border-white/10 bg-transparent px-4 py-3 text-sm text-text placeholder:text-muted"
              />
            </div>

            <div className="mt-3">
              <label className="block text-sm font-semibold text-text">Short description</label>
              <input
                value={form.description}
                onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="e.g. Recently inspected; lens coating intact."
                className="mt-2 w-full rounded-xl border border-white/10 bg-transparent px-4 py-3 text-sm text-text placeholder:text-muted"
              />
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <label className="block text-sm font-semibold text-text">Category</label>
                <select
                  value={form.category}
                  onChange={(event) => {
                    const category = event.target.value as EquipmentCategory
                    // Ammo starts at the standard ₱50 per refill.
                    setForm((prev) => ({ ...prev, category, price: category === 'ammo' && (prev.price === '0' || prev.price === '') ? AMMO_PRICE_PER_REFILL : prev.price }))
                  }}
                  className="mt-2 w-full rounded-xl border border-white/10 glass px-4 py-3 text-sm text-text"
                >
                  <option value="masks">Masks</option>
                  <option value="vests">Vests</option>
                  <option value="ammo">Ammo</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-text">Status</label>
                <select
                  value={form.status}
                  onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value as EquipmentStatus }))}
                  className="mt-2 w-full rounded-xl border border-white/10 glass px-4 py-3 text-sm text-text"
                >
                  <option value="available">Available</option>
                  <option value="rented">Rented</option>
                  <option value="maintenance">Maintenance</option>
                </select>
              </div>
            </div>
            {partners.length > 0 ? (
            <label className="mt-3 block">
              <div className="block text-sm font-semibold text-text">Owned by partner</div>
              <select
                value={form.partnerId}
                onChange={(event) => setForm((prev) => ({ ...prev, partnerId: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-white/10 bg-background px-4 py-3 text-sm text-text [&>option]:bg-background"
              >
                <option value="">Center-owned</option>
                {partners.map((partner) => (
                  <option key={partner.id} value={partner.id}>{partner.name}</option>
                ))}
              </select>
              <div className="mt-1 text-xs text-muted">Partner-owned items count toward that partner's income share.</div>
            </label>
            ) : null}

            <div className="mt-4 flex items-center gap-2">
              {selectedItemId ? (
                <Button onClick={handleUpdate} disabled={saving}>
                  {saving ? 'Saving...' : 'Update inventory item'}
                </Button>
              ) : (
                <Button onClick={handleCreate} disabled={saving}>
                  {saving ? 'Saving...' : !isAmmo(form) && Number(form.pieces) > 1 ? `Add ${form.pieces} pieces` : 'Add item'}
                </Button>
              )}
            </div>
          </Modal>
        ) : null}

        <div className="mt-4">
          <Card className="p-4 bg-white/5/60">
            <div className="text-xs uppercase tracking-widest text-muted">Reservation impact</div>
            <div className="mt-2 text-sm text-muted">This category is currently supporting the next three scheduled sessions.</div>
            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-white/5 bg-white/5 px-3 py-3">
                <div className="text-[11px] uppercase tracking-widest text-muted">Upcoming demand</div>
                <div className="mt-1 text-sm font-semibold">High for weekend package reservations</div>
              </div>
              <div className="rounded-xl border border-white/5 bg-white/5 px-3 py-3">
                <div className="text-[11px] uppercase tracking-widest text-muted">Next review</div>
                <div className="mt-1 text-sm font-semibold">Maintenance check scheduled tomorrow at 10:00 AM</div>
              </div>
            </div>
          </Card>
        </div>
      </Card>
      {rejectionTargetId ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-3 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="equipment-rejection-title">
          <div className="max-h-[90dvh] overflow-y-auto overscroll-contain w-full max-w-lg rounded-2xl border border-white/10 bg-background p-5 shadow-2xl">
            <div id="equipment-rejection-title" className="text-lg font-bold">Reject player gear</div>
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
              <Button onClick={handleRejectPlayerItem} disabled={!rejectionReason.trim()}>Reject gear</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

