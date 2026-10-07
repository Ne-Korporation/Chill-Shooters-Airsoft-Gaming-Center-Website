import React from 'react'
import toast from 'react-hot-toast'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { apiGet, apiPost, apiPut, apiDelete } from '../../utils/apiClient'
import { formatDiscountTargetLabel, resolvePackageDiscountConfig, type PackageDiscountMode, type PackageDiscountTarget } from '../../utils/packagePricing'

type PackageStatus = 'active' | 'draft' | 'archived'

type RentalPackage = {
  id: string
  _id?: any
  name: string
  discountPct: number
  discountMode?: PackageDiscountMode
  discountValue?: number
  equipmentCount: number
  status: PackageStatus
  description: string
  weaponIds: string[]
  equipmentIds: string[]
  basePrice: number
  minPlayers: number
}

type WeaponItem = {
  id: string
  _id?: any
  name: string
  category: string
  status: string
  price: number
  note: string
  description?: string
}

type EquipmentItem = {
  id: string
  _id?: any
  name: string
  category: string
  status: string
  qty: number
  price: number
  note: string
  description?: string
}

const statusTone: Record<PackageStatus, 'accent' | 'success' | 'danger' | 'muted'> = {
  active: 'success',
  draft: 'accent',
  archived: 'danger',
}

const StatusPill = ({ status }: { status: PackageStatus }) => {
  const tone = statusTone[status]
  const cls =
    tone === 'success'
      ? 'bg-success/20 text-success border-success/30'
      : tone === 'accent'
        ? 'bg-accent/20 text-accent border-accent/30'
        : tone === 'danger'
          ? 'bg-danger/20 text-danger border-danger/30'
          : 'bg-white/5 text-text'

  return <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${cls}`}>{status.toUpperCase()}</span>
}

const DISCOUNT_TARGET_OPTIONS: Array<{ value: PackageDiscountTarget; label: string }> = [
  { value: 'package_total', label: 'Package total' },
  { value: 'weapons', label: 'Weapons' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'entrance', label: 'Entrance fee' },
]

export function AdminRentalPackagesPage() {
  const [status, setStatus] = React.useState<PackageStatus | 'all'>('all')
  const [packages, setPackages] = React.useState<RentalPackage[]>([])
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  // Inventory data for selection
  const [weapons, setWeapons] = React.useState<WeaponItem[]>([])
  const [equipment, setEquipment] = React.useState<EquipmentItem[]>([])
  const [inventoryLoading, setInventoryLoading] = React.useState(true)

  const [selectedPackageId, setSelectedPackageId] = React.useState<string | null>(null)
  const [form, setForm] = React.useState({
    name: '',
    discountMode: 'percent' as PackageDiscountMode,
    discountValue: '0',
    discountTargets: ['package_total'] as PackageDiscountTarget[],
    description: '',
    basePrice: '0',
    minPlayers: '1',
    weaponIds: [] as string[],
    equipmentIds: [] as string[],
  })
  const [isAdding, setIsAdding] = React.useState(false)
  const [errors, setErrors] = React.useState<{ name?: string; discountValue?: string }>({})

  // Fetch packages, weapons, and equipment
  const refresh = React.useCallback(async () => {
    setLoading(true)
    setInventoryLoading(true)
    try {
      const [pkgRes, wepRes, eqRes] = await Promise.all([
        apiGet<{ ok: boolean; data: any[] }>('/api/packages?limit=200'),
        apiGet<{ ok: boolean; data: any[] }>('/api/weapons?limit=200'),
        apiGet<{ ok: boolean; data: any[] }>('/api/equipments?limit=200'),
      ])

      // Normalize packages
      const pkgDocs = Array.isArray(pkgRes?.data) ? pkgRes.data : []
      const normalized = pkgDocs.map((d: any) => {
        const customId = d.id || null
        const objectId = d._id ? String(d._id) : undefined
        let displayId = customId
        if (displayId) {
          if (!displayId.startsWith('PKG-')) {
            const num = displayId.replace(/[^0-9]/g, '')
            displayId = num ? `PKG-${num.padStart(3, '0')}` : displayId
          }
        } else {
          displayId = objectId || undefined
        }
        return {
          id: displayId,
          _id: d._id,
          name: d.name || 'Unnamed package',
          discountPct: typeof d.discountPct === 'number' ? d.discountPct : 0,
          discountMode: d.discountMode === 'amount' ? 'amount' : d.discountMode === 'percent' ? 'percent' : undefined as PackageDiscountMode | undefined,
          discountValue: typeof d.discountValue === 'number' ? d.discountValue : undefined,
          discountTargets: Array.isArray(d.discountTargets) ? d.discountTargets : undefined,
          equipmentCount: (d.weaponIds?.length || 0) + (d.equipmentIds?.length || 0),
          status: (d.status || 'draft') as PackageStatus,
          description: d.description || '',
          weaponIds: Array.isArray(d.weaponIds) ? d.weaponIds : [],
          equipmentIds: Array.isArray(d.equipmentIds) ? d.equipmentIds : [],
          basePrice: typeof d.basePrice === 'number' ? d.basePrice : 0,
          minPlayers: typeof d.minPlayers === 'number' ? d.minPlayers : 1,
        }
      })
      setPackages(normalized)

      // Normalize weapons (include price from inventory)
      const wepDocs = Array.isArray(wepRes?.data) ? wepRes.data : []
      setWeapons(wepDocs.map((d: any) => ({
        id: d.id ?? (d._id ? String(d._id) : undefined),
        _id: d._id,
        name: d.name || 'Unnamed weapon',
        category: d.category || 'rifles',
        status: d.status || 'available',
        price: typeof d.price === 'number' ? d.price : 0,
        note: d.note || d.description || '',
        description: d.description || d.note || '',
      })))

      // Normalize equipment (include price from inventory)
      const eqDocs = Array.isArray(eqRes?.data) ? eqRes.data : []
      setEquipment(eqDocs.map((d: any) => ({
        id: d.id ?? (d._id ? String(d._id) : undefined),
        _id: d._id,
        name: d.name || 'Unnamed equipment',
        category: d.category || 'gear',
        status: d.status || 'available',
        qty: typeof d.qty === 'number' ? d.qty : 1,
        price: typeof d.price === 'number' ? d.price : 0,
        note: d.note || d.description || '',
        description: d.description || d.note || '',
      })))
    } catch (e: any) {
      toast.error(String(e?.message || e))
      setPackages([])
      setWeapons([])
      setEquipment([])
    } finally {
      setLoading(false)
      setInventoryLoading(false)
    }
  }, [])

  React.useEffect(() => { refresh() }, [refresh])

  const filtered = packages.filter((pkg) => {
    const matchStatus = status === 'all' ? true : pkg.status === status
    return matchStatus
  })

  const selectedPackage = selectedPackageId ? packages.find((pkg) => pkg.id === selectedPackageId) : undefined
  const selectedDiscount = selectedPackage ? resolvePackageDiscountConfig(selectedPackage) : null
  const selectedDiscountTargets = form.discountTargets
  const showWeaponInventory = selectedDiscountTargets.includes('weapons') && !selectedDiscountTargets.includes('package_total')
  const showEquipmentInventory = selectedDiscountTargets.includes('equipment') && !selectedDiscountTargets.includes('package_total')

  React.useEffect(() => {
    if (!isAdding && selectedPackage) {
      const discount = resolvePackageDiscountConfig(selectedPackage)
      setForm({
        name: selectedPackage.name,
        discountMode: discount.mode,
        discountValue: String(discount.value),
        discountTargets: discount.targets,
        description: selectedPackage.description,
        basePrice: String(selectedPackage.basePrice),
        minPlayers: String(selectedPackage.minPlayers),
        weaponIds: [...selectedPackage.weaponIds],
        equipmentIds: [...selectedPackage.equipmentIds],
      })
      setErrors({})
    }
  }, [selectedPackageId, isAdding])

  const editorRef = React.useRef<HTMLDivElement | null>(null)

  // Use _id for API calls to avoid "not found" due to ID formatting
  function getApiId(pkg: RentalPackage): string {
    return pkg._id ? String(pkg._id) : encodeURIComponent(pkg.id)
  }

  const handleSave = async () => {
    if (!selectedPackage) return

    const newErrors: typeof errors = {}
    if (!form.name || form.name.trim().length === 0) newErrors.name = 'Package name is required.'
    const discountValue = Number(form.discountValue)
    if (Number.isNaN(discountValue) || discountValue < 0) newErrors.discountValue = 'Enter a valid discount value.'
    if (form.discountTargets.length === 0) newErrors.discountValue = 'Pick at least one discount target.'

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    setSaving(true)
    try {
      const totalItems = form.weaponIds.length + form.equipmentIds.length
      const payload = {
        name: form.name.trim(),
        discountPct: form.discountMode === 'percent' && form.discountTargets.includes('package_total') ? Math.round(discountValue) || 0 : 0,
        discountMode: form.discountMode,
        discountValue: form.discountMode === 'amount' ? Math.round(discountValue) || 0 : Math.round(discountValue * 100) / 100,
        discountTargets: form.discountTargets,
        description: form.description.trim(),
        basePrice: Number(form.basePrice) || 0,
        minPlayers: Number(form.minPlayers) || 1,
        weaponIds: form.weaponIds,
        equipmentIds: form.equipmentIds,
        equipmentCount: totalItems,
        updatedAtISO: new Date().toISOString(),
      }

      await apiPut<any>(`/api/packages/${getApiId(selectedPackage)}`, payload)

      toast.success('Package saved')
      setErrors({})
      await refresh()
    } catch (e: any) {
      toast.error(String(e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  const handleAddPackage = () => {
    setIsAdding(true)
    setSelectedPackageId(null)
    setForm({ name: '', discountMode: 'percent', discountValue: '0', discountTargets: ['package_total'], description: '', basePrice: '0', minPlayers: '1', weaponIds: [], equipmentIds: [] })
    setErrors({})
    setTimeout(() => {
      try {
        editorRef?.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } catch (e) {
        // ignore in non-DOM environments
      }
    }, 60)
  }

  const handleCreatePackage = async () => {
    const newErrors: typeof errors = {}
    if (!form.name || form.name.trim().length === 0) newErrors.name = 'Package name is required.'
    const discountValue = Number(form.discountValue)
    if (Number.isNaN(discountValue) || discountValue < 0) newErrors.discountValue = 'Enter a valid discount value.'
    if (form.discountTargets.length === 0) newErrors.discountValue = 'Pick at least one discount target.'

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    setSaving(true)
    try {
      // Generate sequential PKG-XXXX ID
      let maxSeq = 0
      for (const pkg of packages) {
        if (pkg.id && pkg.id.startsWith('PKG-')) {
          const num = parseInt(pkg.id.replace('PKG-', ''), 10)
          if (Number.isFinite(num) && num > maxSeq) maxSeq = num
        }
      }
      const newId = `PKG-${String(maxSeq + 1).padStart(4, '0')}`

      const totalItems = form.weaponIds.length + form.equipmentIds.length
      const payload = {
        id: newId,
        name: form.name.trim(),
        discountPct: form.discountMode === 'percent' && form.discountTargets.includes('package_total') ? Math.round(discountValue) || 0 : 0,
        discountMode: form.discountMode,
        discountValue: form.discountMode === 'amount' ? Math.round(discountValue) || 0 : Math.round(discountValue * 100) / 100,
        discountTargets: form.discountTargets,
        description: form.description.trim(),
        basePrice: Number(form.basePrice) || 0,
        minPlayers: Number(form.minPlayers) || 1,
        weaponIds: form.weaponIds,
        equipmentIds: form.equipmentIds,
        equipmentCount: totalItems,
        status: 'active',
        createdAtISO: new Date().toISOString(),
      }

      const res = await apiPost<{ ok: boolean; data?: any; error?: string }>('/api/packages', payload)
      if (!res?.ok) throw new Error(res?.error || 'Failed to create package')

      toast.success(`Package "${form.name.trim()}" created`)
      await refresh()
      setStatus('all')
      setIsAdding(false)
      setErrors({})

      // Select the newly created package
      if (res.data?.id) {
        setSelectedPackageId(res.data.id)
      }
    } catch (e: any) {
      toast.error(String(e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  const handleCancelAdd = () => {
    setIsAdding(false)
    setSelectedPackageId(packages[0]?.id ?? null)
    setErrors({})
  }

  const handleDelete = async (pkg: RentalPackage) => {
    try {
      await apiDelete(`/api/packages/${getApiId(pkg)}`)
      toast.success('Package deleted')
      if (selectedPackageId === pkg.id) {
        setSelectedPackageId(null)
      }
      await refresh()
    } catch (e: any) {
      toast.error(String(e?.message || e))
    }
  }

  const handleArchive = async (pkg: RentalPackage) => {
    try {
      await apiPut<any>(`/api/packages/${getApiId(pkg)}`, {
        status: 'archived',
        updatedAtISO: new Date().toISOString(),
      })
      toast.success('Package archived')
      await refresh()
    } catch (e: any) {
      toast.error(String(e?.message || e))
    }
  }

  // Toggle weapon selection
  const toggleWeapon = (weaponId: string) => {
    setForm((prev) => ({
      ...prev,
      weaponIds: prev.weaponIds.includes(weaponId)
        ? prev.weaponIds.filter((id) => id !== weaponId)
        : [...prev.weaponIds, weaponId],
    }))
  }

  // Toggle equipment selection
  const toggleEquipment = (eqId: string) => {
    setForm((prev) => ({
      ...prev,
      equipmentIds: prev.equipmentIds.includes(eqId)
        ? prev.equipmentIds.filter((id) => id !== eqId)
        : [...prev.equipmentIds, eqId],
    }))
  }

  // Get weapon details from the weapons array
  const getWeaponById = (id: string) => weapons.find((w) => w.id === id)

  // Get equipment details from the equipment array
  const getEquipmentById = (id: string) => equipment.find((e) => e.id === id)

  // Calculate total price from selected inventory items (prices come from weapons/equipment modules)
  const totalItemPrice = React.useMemo(() => {
    const weaponTotal = form.weaponIds.reduce((sum, wid) => {
      const weapon = getWeaponById(wid)
      return sum + (weapon?.price || 0)
    }, 0)
    const equipmentTotal = form.equipmentIds.reduce((sum, eid) => {
      const eq = getEquipmentById(eid)
      return sum + (eq?.price || 0)
    }, 0)
    return weaponTotal + equipmentTotal
  }, [form.weaponIds, form.equipmentIds, weapons, equipment])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Package Recommendation</h1>
          <p className="mt-1 text-sm text-muted">Review package offerings, manage pricing, and align included equipment with booking tiers.</p>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={handleAddPackage} variant="ghost">Add Package</Button>
        </div>
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted">Package filters</div>
            <div className="mt-2 text-sm text-muted">Review the offerings by booking tier and current state.</div>
          </div>

            <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-4">
              <div>
                <div className="text-[10px] text-muted">Status</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(['all', 'active', 'archived'] as const).map((item) => (
                    <button
                      key={item}
                      onClick={() => setStatus(item)}
                      className={
                        'rounded-xl border px-3 py-2 text-sm transition ' +
                        (status === item
                          ? 'bg-white/8 text-text border-accent/30'
                          : 'bg-white/5 text-muted hover:bg-white/6')
                      }
                    >
                      {item === 'all' ? 'ALL' : item.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-white/5">
          <div className="grid grid-cols-12 bg-white/5 px-3 py-2 text-xs uppercase tracking-widest text-muted">
            <div className="col-span-2">ID</div>
            <div className="col-span-3">Package</div>
            <div className="col-span-2 text-right">Discount rule</div>
            <div className="col-span-2 text-right">Players</div>
            <div className="col-span-2 text-right">Includes</div>
            <div className="col-span-1 text-right">Status</div>
          </div>

          <div className="divide-y divide-white/5">
            {loading ? (
              <div className="p-6 text-sm text-muted">Loading packages...</div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-sm text-muted">No packages found for selected filters.</div>
            ) : (
              filtered.map((pkg) => {
                const pkgDiscount = resolvePackageDiscountConfig(pkg)
                const discountSummary = `${pkgDiscount.mode === 'percent' ? `${pkgDiscount.value}%` : `₱${Math.round(pkgDiscount.value).toLocaleString()}`} off ${formatDiscountTargetLabel(pkgDiscount.targets)}`

                return (
                  <div
                    key={pkg.id}
                    onClick={() => {
                      setIsAdding(false)
                      setSelectedPackageId(pkg.id)
                      setForm({
                        name: pkg.name,
                        discountMode: pkgDiscount.mode,
                        discountValue: String(pkgDiscount.value),
                        discountTargets: pkgDiscount.targets,
                        description: pkg.description,
                        basePrice: String(pkg.basePrice),
                        minPlayers: String(pkg.minPlayers),
                        weaponIds: [...pkg.weaponIds],
                        equipmentIds: [...pkg.equipmentIds],
                      })
                    }}
                    className={`grid grid-cols-12 items-center px-3 py-3 cursor-pointer ${pkg.id === selectedPackageId ? 'bg-white/3' : ''}`}
                  >
                    <div className="col-span-2 text-sm font-semibold">{pkg.id}</div>
                    <div className="col-span-3">
                      <div className="text-sm font-semibold">{pkg.name}</div>
                    </div>
                    <div className="col-span-2 text-right text-xs text-muted">{discountSummary}</div>
                    <div className="col-span-2 text-right text-sm text-muted">{pkg.minPlayers} min</div>
                    <div className="col-span-2 text-right text-sm text-muted">{pkg.equipmentCount} items</div>
                    <div className="col-span-1 text-right">
                      <StatusPill status={pkg.status} />
                      <div className="mt-2 flex justify-end gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setIsAdding(false)
                            setSelectedPackageId(pkg.id)
                            setForm({
                              name: pkg.name,
                              discountMode: pkgDiscount.mode,
                              discountValue: String(pkgDiscount.value),
                              discountTargets: pkgDiscount.targets,
                              description: pkg.description,
                              basePrice: String(pkg.basePrice),
                              minPlayers: String(pkg.minPlayers),
                              weaponIds: [...pkg.weaponIds],
                              equipmentIds: [...pkg.equipmentIds],
                            })
                          }}
                          className="rounded-xl border border-white/5 bg-white/5 px-2 py-1 text-[10px] text-muted transition hover:bg-white/6"
                        >
                          Manage
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {(isAdding || selectedPackageId) && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div ref={editorRef}>
            <Card className="p-4 bg-white/5/60">
              <div className="text-xs uppercase tracking-widest text-muted">{isAdding ? 'Adding' : 'Package details editor'}</div>
              <div className="mt-2 text-sm text-muted">{isAdding ? 'Adding' : 'Fine-tune the selected package name, price discount, and description.'}</div>

              <div className="mt-4 grid gap-3">
                <label className="block">
                  <div className="mb-2 text-sm font-semibold text-text">Package name</div>
                  <input
                    value={form.name}
                    onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text"
                  />
                  {errors.name ? <div className="mt-2 text-xs text-danger">{errors.name}</div> : null}
                </label>
                <label className="block">
                  <div className="mb-2 text-sm font-semibold text-text">Discount rule</div>
                  <p className="mb-3 text-xs text-muted">
                    Percent off reduces the selected target by a percentage. Fixed amount off subtracts a set peso value from the selected target.
                  </p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="block">
                      <div className="mb-2 text-[11px] uppercase tracking-widest text-muted">Mode</div>
                      <select
                        value={form.discountMode}
                        onChange={(event) => setForm((prev) => ({ ...prev, discountMode: event.target.value as PackageDiscountMode }))}
                        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text"
                      >
                        <option value="percent">Percent off</option>
                        <option value="amount">Fixed amount off</option>
                      </select>
                    </label>
                    <label className="block">
                      <div className="mb-2 text-[11px] uppercase tracking-widest text-muted">Value</div>
                      <input
                        type="number"
                        min="0"
                        value={form.discountValue}
                        onChange={(event) => setForm((prev) => ({ ...prev, discountValue: event.target.value }))}
                        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text"
                      />
                    </label>
                  </div>

                  <div className="mt-3">
                    <div className="mb-2 text-[11px] uppercase tracking-widest text-muted">Applies to</div>
                    <div className="grid gap-2 md:grid-cols-2">
                      {DISCOUNT_TARGET_OPTIONS.map((option) => {
                        const checked = form.discountTargets.includes(option.value)
                        const packageTotalSelected = form.discountTargets.includes('package_total')
                        const disabled = option.value !== 'package_total' && packageTotalSelected
                        return (
                          <label key={option.value} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${checked ? 'border-accent/40 bg-accent/10' : 'border-white/10 bg-white/5'} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={disabled}
                              onChange={() => setForm((prev) => {
                                const isCurrentlyChecked = prev.discountTargets.includes(option.value)
                                if (option.value === 'package_total') {
                                  return {
                                    ...prev,
                                    discountTargets: isCurrentlyChecked ? [] : ['package_total'],
                                  }
                                }

                                if (prev.discountTargets.includes('package_total')) {
                                  return prev
                                }

                                const nextTargets = isCurrentlyChecked
                                  ? prev.discountTargets.filter((target) => target !== option.value)
                                  : [...prev.discountTargets, option.value]

                                if (nextTargets.includes('weapons') && nextTargets.includes('equipment') && nextTargets.includes('entrance')) {
                                  return {
                                    ...prev,
                                    discountTargets: ['package_total'],
                                  }
                                }

                                return {
                                  ...prev,
                                  discountTargets: nextTargets,
                                }
                              })}
                              className="h-4 w-4 rounded border-white/20 bg-transparent accent-accent"
                            />
                            <span>{option.label}</span>
                          </label>
                        )
                      })}
                    </div>
                    <div className="mt-2 text-[11px] text-muted">
                      Package total applies to the full reservation total. When it is selected, the other targets stay visible but cannot be changed.
                    </div>
                  </div>

                  {errors.discountValue ? <div className="mt-2 text-xs text-danger">{errors.discountValue}</div> : null}
                </label>
                <label className="block">
                  <div className="mb-2 text-sm font-semibold text-text">Min players</div>
                  <input
                    type="number"
                    min="1"
                    value={form.minPlayers}
                    onChange={(event) => setForm((prev) => ({ ...prev, minPlayers: event.target.value }))}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text"
                  />
                </label>
                <label className="block">
                  <div className="mb-2 text-sm font-semibold text-text">Description</div>
                  <textarea
                    rows={3}
                    value={form.description}
                    onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text"
                  />
                </label>
              </div>

              {showWeaponInventory && (
                <div className="mt-4">
                  <div className="mb-2 text-sm font-semibold text-text">Weapons ({form.weaponIds.length} selected)</div>
                  {inventoryLoading ? (
                    <div className="text-xs text-muted">Loading weapons inventory...</div>
                  ) : weapons.length === 0 ? (
                    <div className="text-xs text-muted">No weapons available. Add weapons first in the Weapons module.</div>
                  ) : (
                    <div className="max-h-48 overflow-y-auto rounded-xl border border-white/10 bg-white/5 p-2 space-y-1">
                      {weapons.map((weapon) => {
                        const isSelected = form.weaponIds.includes(weapon.id)
                        return (
                          <label
                            key={weapon.id}
                            className={`flex items-center gap-3 rounded-xl px-3 py-2 cursor-pointer transition ${
                              isSelected ? 'bg-accent/15 ring-1 ring-accent/30' : 'hover:bg-white/5'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleWeapon(weapon.id)}
                              className="h-4 w-4 rounded border-white/20 bg-transparent accent-accent"
                            />
                            <div className="flex-1 flex items-center justify-between">
                              <div>
                                <div className="text-sm font-semibold text-text">{weapon.name}</div>
                                <div className="text-[11px] text-muted">{weapon.category.toUpperCase()} • {weapon.status}</div>
                              </div>
                              <div className="text-right">
                                <div className="text-[11px] text-muted">{weapon.id}</div>
                                <div className="text-[11px] font-semibold text-accent">₱{weapon.price}</div>
                              </div>
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {showEquipmentInventory && (
                <div className="mt-4">
                  <div className="mb-2 text-sm font-semibold text-text">Equipment ({form.equipmentIds.length} selected)</div>
                  {inventoryLoading ? (
                    <div className="text-xs text-muted">Loading equipment inventory...</div>
                  ) : equipment.length === 0 ? (
                    <div className="text-xs text-muted">No equipment available. Add equipment first in the Equipment module.</div>
                  ) : (
                    <div className="max-h-48 overflow-y-auto rounded-xl border border-white/10 bg-white/5 p-2 space-y-1">
                      {equipment.map((eq) => {
                        const isSelected = form.equipmentIds.includes(eq.id)
                        return (
                          <label
                            key={eq.id}
                            className={`flex items-center gap-3 rounded-xl px-3 py-2 cursor-pointer transition ${
                              isSelected ? 'bg-accent/15 ring-1 ring-accent/30' : 'hover:bg-white/5'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleEquipment(eq.id)}
                              className="h-4 w-4 rounded border-white/20 bg-transparent accent-accent"
                            />
                            <div className="flex-1 flex items-center justify-between">
                              <div>
                                <div className="text-sm font-semibold text-text">{eq.name}</div>
                                <div className="text-[11px] text-muted">{eq.category.toUpperCase()} • Qty: {eq.qty}</div>
                              </div>
                              <div className="text-right">
                                <div className="text-[11px] text-muted">{eq.id}</div>
                                <div className="text-[11px] font-semibold text-accent">₱{eq.price}</div>
                              </div>
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {!showWeaponInventory && !showEquipmentInventory && (
                <div className="mt-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-muted">
                  No inventory list is shown for this discount target. Package total and entrance fee discounts apply without selecting specific weapons or equipment.
                </div>
              )}

              <div className="mt-4">
                {isAdding ? (
                  <div className="flex items-center gap-2">
                    <Button onClick={handleCreatePackage} disabled={saving}>
                      {saving ? 'Creating...' : 'Create package'}
                    </Button>
                    <Button variant="ghost" onClick={handleCancelAdd}>Cancel</Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Button onClick={handleSave} disabled={saving}>
                      {saving ? 'Saving...' : 'Save package'}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        if (selectedPackage) {
                          handleArchive(selectedPackage)
                        }
                      }}
                      disabled={saving}
                    >
                      Archive
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setSelectedPackageId(null)
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          </div>

          <Card className="p-4 bg-white/5/60">
            <div className="text-xs uppercase tracking-widest text-muted">Included items</div>
            <div className="mt-2 text-sm text-muted">This bundle includes the following weapons and equipment from inventory.</div>
            <div className="mt-4 rounded-xl border border-white/5 bg-white/5 p-3">
              <div className="text-[11px] uppercase tracking-widest text-muted">Selected package</div>
              <div className="mt-1 text-sm font-semibold">{selectedPackage?.name || (isAdding ? '(New package)' : '—')}</div>

              {/* Weapons section */}
              <div className="mt-4">
                <div className="text-[11px] uppercase tracking-widest text-muted">Weapons</div>
                <div className="mt-2 space-y-2">
                  {(selectedPackage?.weaponIds ?? form.weaponIds).length === 0 ? (
                    <div className="rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-sm text-muted">
                      No weapons selected
                    </div>
                  ) : (
                    (selectedPackage?.weaponIds ?? form.weaponIds).map((wid) => {
                      const weapon = getWeaponById(wid)
                      return (
                        <div key={wid} className="rounded-lg border border-white/5 bg-white/5 px-3 py-2">
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-semibold text-text">{weapon?.name || wid}</div>
                            <div className="text-[10px] text-muted">{weapon?.category || '—'}</div>
                          </div>
                          <div className="mt-1 flex items-center justify-between">
                            <div className="text-[11px] text-muted">ID: {wid} • Status: {weapon?.status || '—'}</div>
                            {weapon?.price !== undefined && (
                              <div className="text-[11px] font-semibold text-accent">₱{weapon.price}</div>
                            )}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

              {/* Equipment section */}
              <div className="mt-4">
                <div className="text-[11px] uppercase tracking-widest text-muted">Equipment</div>
                <div className="mt-2 space-y-2">
                  {(selectedPackage?.equipmentIds ?? form.equipmentIds).length === 0 ? (
                    <div className="rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-sm text-muted">
                      No equipment selected
                    </div>
                  ) : (
                    (selectedPackage?.equipmentIds ?? form.equipmentIds).map((eid) => {
                      const eq = getEquipmentById(eid)
                      return (
                        <div key={eid} className="rounded-lg border border-white/5 bg-white/5 px-3 py-2">
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-semibold text-text">{eq?.name || eid}</div>
                            <div className="text-[10px] text-muted">{eq?.category || '—'}</div>
                          </div>
                          <div className="mt-1 flex items-center justify-between">
                            <div className="text-[11px] text-muted">ID: {eid} • Qty: {eq?.qty || '—'}</div>
                            {eq?.price !== undefined && (
                              <div className="text-[11px] font-semibold text-accent">₱{eq.price}</div>
                            )}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

              {/* Summary */}
              <div className="mt-4 pt-3 border-t border-white/5">
                <div className="flex items-center justify-between text-xs text-muted">
                  <span>Total items</span>
                  <span className="font-semibold text-text">
                    {(selectedPackage?.weaponIds ?? form.weaponIds).length + (selectedPackage?.equipmentIds ?? form.equipmentIds).length} items
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted mt-2">
                  <span>Total equipment value</span>
                  <span className="font-semibold text-accent">₱{totalItemPrice.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </Card>
        </div>
        )}
      </Card>
    </div>
  )
}

