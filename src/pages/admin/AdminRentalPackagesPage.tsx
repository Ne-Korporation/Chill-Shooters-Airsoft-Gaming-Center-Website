import React from 'react'
import toast from 'react-hot-toast'
import { ActionGroup, Button } from '../../components/ui/Button'
import { FilterTabs, titleCaseLabel } from '../../components/ui/FilterTabs'
import { Card } from '../../components/ui/Card'
import { apiGet, apiPost, apiPut, apiDelete } from '../../utils/apiClient'
import { formatDiscountTargetLabel, resolvePackageDiscountConfig, type PackageDiscountMode, type PackageDiscountTarget } from '../../utils/packagePricing'
import { modelOf, summarizeModels } from '../../utils/inventoryModels'

type PackageStatus = 'active' | 'draft' | 'archived'

type RentalPackage = {
  id: string
  _id?: any
  name: string
  discountPct: number
  discountMode?: PackageDiscountMode
  discountValue?: number
  discountTargets?: PackageDiscountTarget[]
  equipmentCount: number
  status: PackageStatus
  description: string
  weaponIds: string[]
  equipmentIds: string[]
  basePrice: number
  minPlayers: number
  // Number of players this package is priced for (0 = not fixed)
  players: number
  // Fixed total (before discount) for `players` players (0 = computed pricing)
  settledAmount: number
  // Number of weapons the package gives
  weaponCount: number
}

type WeaponItem = {
  id: string
  _id?: any
  name: string
  model?: string
  source?: string
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
  model?: string
  source?: string
  category: string
  status: string
  qty: number
  price: number
  note: string
  description?: string
}

type FormErrors = {
  name?: string
  discountValue?: string
  players?: string
  settledAmount?: string
  weaponCount?: string
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

// Preview a legacy settled package that still stores a percent or fixed discount.
function settledAfterDiscount(settled: number, mode: PackageDiscountMode, value: number) {
  const raw = mode === 'percent' ? (settled * value) / 100 : value
  const discount = Math.round(Math.max(0, Math.min(settled, raw)))
  return { discount, total: Math.max(0, settled - discount) }
}

type FormState = {
  name: string
  discountMode: PackageDiscountMode
  discountValue: string
  discountTargets: PackageDiscountTarget[]
  description: string
  basePrice: string
  minPlayers: string
  players: string
  settledAmount: string
  weaponCount: string
  weaponIds: string[]
  equipmentIds: string[]
}

const EMPTY_FORM: FormState = {
  name: '',
  discountMode: 'percent',
  discountValue: '0',
  discountTargets: ['package_total'],
  description: '',
  basePrice: '0',
  minPlayers: '1',
  players: '0',
  settledAmount: '0',
  weaponCount: '0',
  weaponIds: [],
  equipmentIds: [],
}

function formFromPackage(pkg: RentalPackage): FormState {
  const discount = resolvePackageDiscountConfig(pkg)
  const isSettled = pkg.settledAmount > 0
  return {
    name: pkg.name,
    discountMode: isSettled ? 'settled' : discount.mode,
    discountValue: isSettled ? String(pkg.settledAmount) : String(discount.value),
    discountTargets: isSettled ? ['package_total'] : discount.targets,
    description: pkg.description,
    basePrice: String(pkg.basePrice),
    minPlayers: String(pkg.minPlayers),
    players: String(pkg.players),
    settledAmount: String(pkg.settledAmount),
    weaponCount: String(pkg.weaponCount),
    weaponIds: [...pkg.weaponIds],
    equipmentIds: [...pkg.equipmentIds],
  }
}

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
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM)
  const [isAdding, setIsAdding] = React.useState(false)
  const [errors, setErrors] = React.useState<FormErrors>({})

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
      const normalized: RentalPackage[] = pkgDocs.map((d: any) => {
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
        const weaponIds = Array.isArray(d.weaponIds) ? d.weaponIds : []
        return {
          id: displayId,
          _id: d._id,
          name: d.name || 'Unnamed package',
          discountPct: typeof d.discountPct === 'number' ? d.discountPct : 0,
          discountMode: d.discountMode === 'amount' ? 'amount' : d.discountMode === 'settled' ? 'settled' : d.discountMode === 'percent' ? 'percent' : undefined,
          discountValue: typeof d.discountValue === 'number' ? d.discountValue : undefined,
          discountTargets: Array.isArray(d.discountTargets) ? d.discountTargets : undefined,
          equipmentCount: (d.weaponIds?.length || 0) + (d.equipmentIds?.length || 0),
          status: (d.status || 'draft') as PackageStatus,
          description: d.description || '',
          weaponIds,
          equipmentIds: Array.isArray(d.equipmentIds) ? d.equipmentIds : [],
          basePrice: typeof d.basePrice === 'number' ? d.basePrice : 0,
          minPlayers: typeof d.minPlayers === 'number' ? d.minPlayers : 1,
          players: typeof d.players === 'number' ? d.players : 0,
          settledAmount: typeof d.settledAmount === 'number' ? d.settledAmount : 0,
          weaponCount: typeof d.weaponCount === 'number' && d.weaponCount > 0 ? d.weaponCount : weaponIds.length,
        }
      })
      setPackages(normalized)

      // Normalize weapons (include price from inventory)
      const wepDocs = Array.isArray(wepRes?.data) ? wepRes.data : []
      setWeapons(wepDocs.map((d: any) => ({
        id: d.id ?? (d._id ? String(d._id) : undefined),
        _id: d._id,
        name: d.name || 'Unnamed weapon',
        model: modelOf(d),
        source: d.source,
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
        model: modelOf(d),
        source: d.source,
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

  React.useEffect(() => {
    if (!isAdding && selectedPackage) {
      setForm(formFromPackage(selectedPackage))
      setErrors({})
    }
  }, [selectedPackageId, isAdding])

  const editorRef = React.useRef<HTMLDivElement | null>(null)

  // Use _id for API calls to avoid "not found" due to ID formatting
  function getApiId(pkg: RentalPackage): string {
    return pkg._id ? String(pkg._id) : encodeURIComponent(pkg.id)
  }

  const validateForm = (): FormErrors => {
    const newErrors: FormErrors = {}
    if (!form.name || form.name.trim().length === 0) newErrors.name = 'Package name is required.'

    const discountValue = Number(form.discountValue)
    if (Number.isNaN(discountValue) || discountValue < 0) newErrors.discountValue = 'Enter a valid discount value.'
    else if (form.discountMode === 'percent' && discountValue > 100) newErrors.discountValue = 'Percent discount cannot exceed 100.'
    if (form.discountTargets.length === 0) newErrors.discountValue = 'Pick at least one discount target.'

    const players = Number(form.players)
    if (!Number.isInteger(players) || players < 0) newErrors.players = 'Enter a whole number (0 = not fixed).'

    const settled = Number(form.settledAmount)
    if (Number.isNaN(settled) || settled < 0) newErrors.settledAmount = 'Enter a valid amount.'
    else if (settled > 0 && (!Number.isInteger(players) || players < 1)) {
      newErrors.players = 'Set the number of players this settled amount is for.'
    }
    if (form.discountMode === 'settled' && (!Number.isInteger(discountValue) || discountValue <= 0)) {
      newErrors.discountValue = 'Enter the entire package price.'
    }
    if (!newErrors.settledAmount && form.discountMode !== 'settled' && settled > 0 && form.discountMode === 'amount' && discountValue > settled) {
      newErrors.discountValue = 'Fixed discount cannot be more than the settled amount.'
    }

    const weaponCount = Number(form.weaponCount)
    if (!Number.isInteger(weaponCount) || weaponCount < 0) newErrors.weaponCount = 'Enter a whole number.'

    return newErrors
  }

  // Shared payload for create + save
  const buildPayload = () => {
    const discountValue = Number(form.discountValue)
    const totalItems = form.weaponIds.length + form.equipmentIds.length
    const typedWeaponCount = Math.round(Number(form.weaponCount)) || 0
    return {
      name: form.name.trim(),
      discountPct: form.discountMode === 'percent' && form.discountTargets.includes('package_total') ? Math.round(discountValue) || 0 : 0,
      discountMode: form.discountMode,
      discountValue: form.discountMode === 'settled'
        ? Math.round(discountValue) || 0
        : form.discountMode === 'amount'
          ? Math.round(discountValue) || 0
          : Math.round(discountValue * 100) / 100,
      discountTargets: form.discountMode === 'settled' ? ['package_total'] : form.discountTargets,
      description: form.description.trim(),
      basePrice: Number(form.basePrice) || 0,
      minPlayers: Number(form.minPlayers) || 1,
      players: Math.round(Number(form.players)) || 0,
      settledAmount: form.discountMode === 'settled' ? Math.round(discountValue) || 0 : 0,
      // If left at 0, fall back to the number of weapons picked from inventory
      weaponCount: typedWeaponCount > 0 ? typedWeaponCount : form.weaponIds.length,
      weaponIds: form.weaponIds,
      equipmentIds: form.equipmentIds,
      equipmentCount: totalItems,
    }
  }

  const handleSave = async () => {
    if (!selectedPackage) return

    const newErrors = validateForm()
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    setSaving(true)
    try {
      const payload = { ...buildPayload(), updatedAtISO: new Date().toISOString() }

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
    setForm({ ...EMPTY_FORM, discountTargets: ['package_total'], weaponIds: [], equipmentIds: [] })
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
    const newErrors = validateForm()
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

      const payload = {
        id: newId,
        ...buildPayload(),
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

  // Packages include kinds of items (models), not specific pieces: the booking assigns each
  // player a free piece of every included model. The package stores one piece ID per model.
  const weaponModels = React.useMemo(() => summarizeModels(weapons), [weapons])
  const equipmentModels = React.useMemo(() => summarizeModels(equipment), [equipment])
  const modelOfPiece = (list: Array<{ id: string; model?: string; name?: string }>, id: string) => {
    const piece = list.find((item) => item.id === id)
    return piece ? modelOf(piece) : id
  }
  const firstPieceOf = (list: Array<{ id: string; model?: string; name?: string; source?: string }>, model: string) =>
    list.find((item) => item.source !== 'player' && modelOf(item) === model)?.id

  const toggleWeapon = (model: string) => {
    setForm((prev) => {
      const selected = prev.weaponIds.some((id) => modelOfPiece(weapons, id) === model)
      const pieceId = firstPieceOf(weapons, model)
      return {
        ...prev,
        weaponIds: selected
          ? prev.weaponIds.filter((id) => modelOfPiece(weapons, id) !== model)
          : pieceId ? [...prev.weaponIds, pieceId] : prev.weaponIds,
      }
    })
  }

  const toggleEquipment = (model: string) => {
    setForm((prev) => {
      const selected = prev.equipmentIds.some((id) => modelOfPiece(equipment, id) === model)
      const pieceId = firstPieceOf(equipment, model)
      return {
        ...prev,
        equipmentIds: selected
          ? prev.equipmentIds.filter((id) => modelOfPiece(equipment, id) !== model)
          : pieceId ? [...prev.equipmentIds, pieceId] : prev.equipmentIds,
      }
    })
  }

  // Get weapon details from the weapons array
  const getWeaponById = (id: string) => weapons.find((w) => w.id === id)

  // Get equipment details from the equipment array
  const getEquipmentById = (id: string) => equipment.find((e) => e.id === id)

  const pickedWeaponCount = form.weaponIds.length
  const typedWeaponCount = Math.round(Number(form.weaponCount)) || 0
  const effectiveWeaponCount = typedWeaponCount > 0 ? typedWeaponCount : pickedWeaponCount

  // Calculate total price from selected inventory items (prices come from weapons/equipment modules)
  const totalItemPrice = React.useMemo(() => {
    const selectedWeaponTotal = form.weaponIds.reduce((sum, wid) => {
      const weapon = getWeaponById(wid)
      return sum + (weapon?.price || 0)
    }, 0)
    const averageWeaponPrice = pickedWeaponCount > 0 ? selectedWeaponTotal / pickedWeaponCount : 0
    const weaponTotal = averageWeaponPrice * effectiveWeaponCount
    const equipmentTotal = form.equipmentIds.reduce((sum, eid) => {
      const eq = getEquipmentById(eid)
      return sum + (eq?.price || 0)
    }, 0)
    return weaponTotal + equipmentTotal
  }, [form.weaponIds, form.equipmentIds, weapons, equipment, pickedWeaponCount, effectiveWeaponCount])

  // Live preview of what a player would spend with the settled amount
  const settledPreview = React.useMemo(() => {
    const settled = Math.max(0, Math.round(Number(form.settledAmount) || 0))
    const players = Math.max(0, Math.round(Number(form.players) || 0))
    const discountValue = Math.max(0, Number(form.discountValue) || 0)
    if (form.discountMode !== 'settled' || settled <= 0 || players <= 0) return null
    const { discount, total } = settledAfterDiscount(settled, form.discountMode, discountValue)
    return { settled, players, discount: 0, total: settled, perPlayer: Math.round(settled / players) }
  }, [form.settledAmount, form.players, form.discountMode, form.discountValue])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Package Recommendation</h1>
          <p className="mt-1 text-sm text-muted">Review package offerings, manage pricing, and align included equipment with booking tiers.</p>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={handleAddPackage} variant="primary" size="sm">+ Add package</Button>
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
                <FilterTabs
                  className="mt-2"
                  ariaLabel="Filter packages by status"
                  value={status}
                  onChange={setStatus}
                  options={(['all', 'active', 'archived'] as const).map((item) => ({ value: item, label: item === 'all' ? 'All' : titleCaseLabel(item) }))}
                />
              </div>
            </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-white/5">
          <div className="min-w-[860px]">
            <div className="grid grid-cols-12 bg-white/5 px-3 py-2 text-xs uppercase tracking-widest text-muted">
              <div className="col-span-1">ID</div>
              <div className="col-span-2">Package</div>
              <div className="col-span-2 text-right">Discount rule</div>
              <div className="col-span-1 text-right">Players</div>
              <div className="col-span-2 text-right">Settled amount</div>
              <div className="col-span-2 text-right">Includes</div>
              <div className="col-span-2 text-right">Status</div>
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
                  const rowSettled = pkg.settledAmount > 0
                    ? settledAfterDiscount(pkg.settledAmount, pkgDiscount.mode, pkgDiscount.value)
                    : null

                  return (
                    <div
                      key={pkg.id}
                      onClick={() => {
                        setIsAdding(false)
                        setSelectedPackageId(pkg.id)
                        setForm(formFromPackage(pkg))
                      }}
                      className={`grid grid-cols-12 items-center px-3 py-3 cursor-pointer ${pkg.id === selectedPackageId ? 'bg-white/3' : ''}`}
                    >
                      <div className="col-span-1 text-sm font-semibold">{pkg.id}</div>
                      <div className="col-span-2">
                        <div className="text-sm font-semibold">{pkg.name}</div>
                      </div>
                      <div className="col-span-2 text-right text-xs text-muted">{discountSummary}</div>
                      <div className="col-span-1 text-right text-sm text-muted">
                        {pkg.players > 0 ? `${pkg.players}` : `${pkg.minPlayers} min`}
                      </div>
                      <div className="col-span-2 text-right">
                        {rowSettled ? (
                          <>
                            <div className="text-sm font-semibold text-accent">₱{rowSettled.total.toLocaleString()}</div>
                            {rowSettled.discount > 0 ? (
                              <div className="text-[10px] text-muted line-through">₱{pkg.settledAmount.toLocaleString()}</div>
                            ) : null}
                          </>
                        ) : (
                          <div className="text-xs text-muted">Computed</div>
                        )}
                      </div>
                      <div className="col-span-2 text-right text-sm text-muted">
                        <div>{pkg.weaponCount} weapon{pkg.weaponCount === 1 ? '' : 's'}</div>
                        <div className="text-[11px]">{pkg.equipmentCount} items</div>
                      </div>
                      <div className="col-span-2 text-right">
                        <StatusPill status={pkg.status} />
                        <div className="mt-2 flex justify-end">
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation()
                              setIsAdding(false)
                              setSelectedPackageId(pkg.id)
                              setForm(formFromPackage(pkg))
                            }}
                          >
                            Manage
                          </Button>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>

        {(isAdding || selectedPackageId) && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div ref={editorRef}>
            <Card className="p-4 bg-white/5/60">
              <div className="text-xs uppercase tracking-widest text-muted">{isAdding ? 'Adding' : 'Package details editor'}</div>
              <div className="mt-2 text-sm text-muted">{isAdding ? 'Set up the new package, its players, settled amount and weapons.' : 'Fine-tune the selected package name, players, settled amount, discount, and weapons.'}</div>

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
                    Percent off reduces the selected target by a percentage. Fixed amount off subtracts the peso value entered below from the selected target.
                    Settled amount sets the entire package price.
                  </p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="block">
                      <div className="mb-2 text-[11px] uppercase tracking-widest text-muted">Mode</div>
                      <select
                        value={form.discountMode}
                        onChange={(event) => {
                          const nextMode = event.target.value as PackageDiscountMode
                          setForm((prev) => ({
                            ...prev,
                            discountMode: nextMode,
                            discountValue: nextMode === 'settled'
                              ? (prev.settledAmount !== '0' ? prev.settledAmount : '0')
                              : prev.discountMode === 'settled' ? '0' : prev.discountValue,
                            settledAmount: nextMode === 'settled' ? prev.settledAmount : '0',
                            discountTargets: nextMode === 'settled' ? ['package_total'] : prev.discountTargets,
                          }))
                        }}
                        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text"
                      >
                        <option value="percent">Percent off</option>
                        <option value="amount">Fixed amount off</option>
                        <option value="settled">Settled amount</option>
                      </select>
                    </label>
                    <label className="block">
                      <div className="mb-2 text-[11px] uppercase tracking-widest text-muted">
                        {form.discountMode === 'percent' ? 'Percentage to take off (%)' : form.discountMode === 'amount' ? 'Fixed amount to take off (₱)' : 'Entire package price (₱)'}
                      </div>
                      <input
                        type="number"
                        min="0"
                        value={form.discountValue}
                        onChange={(event) => setForm((prev) => ({
                          ...prev,
                          discountValue: event.target.value,
                          settledAmount: prev.discountMode === 'settled' ? event.target.value : prev.settledAmount,
                        }))}
                        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text"
                      />
                    </label>
                  </div>
                  <div className="mt-4">
                    <div className="mb-2 text-[11px] uppercase tracking-widest text-muted">Number of players</div>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={form.players}
                      onChange={(event) => setForm((prev) => ({ ...prev, players: event.target.value }))}
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text"
                    />
                  </div>

                  <div className="mt-3">
                    <div className="mb-2 text-[11px] uppercase tracking-widest text-muted">Applies to</div>
                    <div className="grid gap-2 md:grid-cols-2">
                      {DISCOUNT_TARGET_OPTIONS.map((option) => {
                        const checked = form.discountTargets.includes(option.value)
                        const packageTotalSelected = form.discountTargets.includes('package_total')
                        const disabled = form.discountMode === 'settled' || (option.value !== 'package_total' && packageTotalSelected)
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
                      {form.discountMode === 'settled'
                        ? 'Settled amount is the entire package price. Discount targets are disabled, while selected weapons and equipment remain included in the package.'
                        : 'Package total applies to the full reservation total. When it is selected, the other targets stay visible but cannot be changed.'}
                    </div>
                  </div>

                  {errors.discountValue ? <div className="mt-2 text-xs text-danger">{errors.discountValue}</div> : null}
                </label>

                <div className="grid gap-3 md:grid-cols-2">
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
                    <div className="mb-2 text-sm font-semibold text-text">Weapons per player</div>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={form.weaponCount}
                      onChange={(event) => setForm((prev) => ({ ...prev, weaponCount: event.target.value }))}
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text"
                    />
                    <div className="mt-1 text-[11px] text-muted">
                      How many rental weapons each player gets (usually 1). A booking for 10 players at 1 per player
                      needs 10 units in stock across the weapons picked below. Leave at 0 to use {pickedWeaponCount}.
                    </div>
                    {errors.weaponCount ? <div className="mt-1 text-xs text-danger">{errors.weaponCount}</div> : null}
                  </label>
                </div>

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

              <div className="mt-4">
                <div className="mb-2 text-sm font-semibold text-text">Weapons ({form.weaponIds.length} selected)</div>
                {inventoryLoading ? (
                  <div className="text-xs text-muted">Loading weapons inventory...</div>
                ) : weapons.length === 0 ? (
                  <div className="text-xs text-muted">No weapons available. Add weapons first in the Weapons module.</div>
                ) : (
                  <div className="max-h-48 overflow-y-auto rounded-xl border border-white/10 bg-white/5 p-2 space-y-1">
                    {weaponModels.map((weapon) => {
                      const isSelected = form.weaponIds.some((id) => modelOfPiece(weapons, id) === weapon.model)
                      return (
                        <label
                          key={weapon.model}
                          className={`flex items-center gap-3 rounded-xl px-3 py-2 cursor-pointer transition ${
                            isSelected ? 'bg-accent/15 ring-1 ring-accent/30' : 'hover:bg-white/5'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleWeapon(weapon.model)}
                            className="h-4 w-4 rounded border-white/20 bg-transparent accent-accent"
                          />
                          <div className="flex-1 flex items-center justify-between">
                            <div>
                              <div className="text-sm font-semibold text-text">{weapon.model}</div>
                              <div className="text-[11px] text-muted">{weapon.category.toUpperCase()} • {weapon.available} of {weapon.total} pieces available</div>
                            </div>
                            <div className="text-right">
                              <div className="text-[11px] font-semibold text-accent">₱{weapon.price}</div>
                            </div>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="mt-4">
                <div className="mb-2 text-sm font-semibold text-text">Equipment ({form.equipmentIds.length} selected)</div>
                {inventoryLoading ? (
                  <div className="text-xs text-muted">Loading equipment inventory...</div>
                ) : equipment.length === 0 ? (
                  <div className="text-xs text-muted">No equipment available. Add equipment first in the Equipment module.</div>
                ) : (
                  <div className="max-h-48 overflow-y-auto rounded-xl border border-white/10 bg-white/5 p-2 space-y-1">
                    {equipmentModels.map((eq) => {
                      const isSelected = form.equipmentIds.some((id) => modelOfPiece(equipment, id) === eq.model)
                      return (
                        <label
                          key={eq.model}
                          className={`flex items-center gap-3 rounded-xl px-3 py-2 cursor-pointer transition ${
                            isSelected ? 'bg-accent/15 ring-1 ring-accent/30' : 'hover:bg-white/5'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleEquipment(eq.model)}
                            className="h-4 w-4 rounded border-white/20 bg-transparent accent-accent"
                          />
                          <div className="flex-1 flex items-center justify-between">
                            <div>
                              <div className="text-sm font-semibold text-text">{eq.model}</div>
                              <div className="text-[11px] text-muted">{eq.category.toUpperCase()} • {eq.available} of {eq.total} pieces available</div>
                            </div>
                            <div className="text-right">
                              <div className="text-[11px] font-semibold text-accent">₱{eq.price}</div>
                            </div>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="mt-4">
                {isAdding ? (
                  <ActionGroup>
                    <Button size="sm" variant="ghost" onClick={handleCancelAdd}>Cancel</Button>
                    <Button size="sm" onClick={handleCreatePackage} disabled={saving}>
                      {saving ? 'Creating…' : 'Create package'}
                    </Button>
                  </ActionGroup>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Button
                      size="sm"
                      variant="danger-soft"
                      onClick={() => {
                        if (selectedPackage) {
                          handleArchive(selectedPackage)
                        }
                      }}
                      disabled={saving}
                    >
                      Archive
                    </Button>
                    <ActionGroup>
                      <Button size="sm" variant="ghost" onClick={() => setSelectedPackageId(null)}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={handleSave} disabled={saving}>
                        {saving ? 'Saving…' : 'Save package'}
                      </Button>
                    </ActionGroup>
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
              <div className="mt-1 text-sm font-semibold">{form.name.trim() || selectedPackage?.name || (isAdding ? '(New package)' : '—')}</div>

              {/* Player-facing price preview */}
              <div className="mt-3 rounded-lg border border-accent/20 bg-accent/5 px-3 py-3">
                <div className="text-[11px] uppercase tracking-widest text-muted">What players will spend</div>
                {settledPreview ? (
                  <div className="mt-2 space-y-1 text-xs">
                    <div className="flex items-center justify-between text-muted">
                      <span>Settled amount ({settledPreview.players} players)</span>
                      <span>₱{settledPreview.settled.toLocaleString()}</span>
                    </div>
                    {settledPreview.discount > 0 ? (
                      <div className="flex items-center justify-between text-success">
                        <span>
                          Discount ({form.discountMode === 'percent' ? `${Number(form.discountValue) || 0}%` : `₱${Math.round(Number(form.discountValue) || 0).toLocaleString()}`})
                        </span>
                        <span>− ₱{settledPreview.discount.toLocaleString()}</span>
                      </div>
                    ) : null}
                    <div className="flex items-center justify-between text-muted">
                      <span>Per player</span>
                      <span>₱{settledPreview.perPlayer.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-white/10 pt-2 text-sm font-bold text-accent">
                      <span>Total</span>
                      <span>₱{settledPreview.total.toLocaleString()}</span>
                    </div>
                    <div className="pt-1 text-[11px] text-muted">Holds as long as the player count stays at {settledPreview.players}.</div>
                  </div>
                ) : (
                  <div className="mt-2 space-y-1 text-xs">
                    {/* Computed pricing: what one player pays before discounts. The standard full
                        package is ₱150 entrance + ₱500 rifle (2 mags, 600 BBs) + ₱50 mask + ₱50 vest = ₱750. */}
                    <div className="flex items-center justify-between text-muted">
                      <span>Package base fee</span>
                      <span>₱{(Number(form.basePrice) || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between text-muted">
                      <span>Included weapons &amp; equipment</span>
                      <span>₱{Math.round(totalItemPrice).toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between text-muted">
                      <span>Entrance fee</span>
                      <span>₱150</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-white/10 pt-2 text-sm font-bold text-accent">
                      <span>Per player (before discount)</span>
                      <span>₱{Math.round((Number(form.basePrice) || 0) + totalItemPrice + 150).toLocaleString()}</span>
                    </div>
                    <div className="pt-1 text-[11px] text-muted">
                      Full package standard: ₱150 entrance + ₱500 rifle (2 magazines, 600 BBs) + ₱50 mask + ₱50 vest = ₱750 per player. Or set a settled amount for a fixed group price.
                    </div>
                  </div>
                )}
              </div>

              {/* Weapons section */}
              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] uppercase tracking-widest text-muted">Weapons</div>
                  <div className="text-[11px] font-semibold text-text">{effectiveWeaponCount} weapon{effectiveWeaponCount === 1 ? '' : 's'} offered</div>
                </div>
                <div className="mt-2 space-y-2">
                  {form.weaponIds.length === 0 ? (
                    <div className="rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-sm text-muted">
                      No weapons selected
                    </div>
                  ) : (
                    form.weaponIds.map((wid) => {
                      const weapon = getWeaponById(wid)
                      return (
                        <div key={wid} className="rounded-lg border border-white/5 bg-white/5 px-3 py-2">
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-semibold text-text">{weapon ? modelOf(weapon) : wid}</div>
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
                  {form.equipmentIds.length === 0 ? (
                    <div className="rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-sm text-muted">
                      No equipment selected
                    </div>
                  ) : (
                    form.equipmentIds.map((eid) => {
                      const eq = getEquipmentById(eid)
                      return (
                        <div key={eid} className="rounded-lg border border-white/5 bg-white/5 px-3 py-2">
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-semibold text-text">{eq ? modelOf(eq) : eid}</div>
                            <div className="text-[10px] text-muted">{eq?.category || '—'}</div>
                          </div>
                          <div className="mt-1 flex items-center justify-between">
                            <div className="text-[11px] text-muted">{eq ? `${equipmentModels.find((g) => g.model === modelOf(eq))?.total ?? 0} pieces in inventory` : `ID: ${eid}`}</div>
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
                    {form.weaponIds.length + form.equipmentIds.length} items
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted mt-2">
                  <span>Total included item value</span>
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