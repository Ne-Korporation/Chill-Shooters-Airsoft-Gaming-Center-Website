import React from 'react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
// sequential package IDs are generated locally for readability

type PackageStatus = 'active' | 'draft' | 'archived'

type PackageTier = 'starter' | 'standard' | 'elite'

type RentalPackage = {
  id: string
  name: string
  tier: PackageTier
  discountPct: number
  equipmentCount: number
  status: PackageStatus
  description: string
  includedItems: string[]
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

export function AdminRentalPackagesPage() {
  const [status, setStatus] = React.useState<PackageStatus | 'all'>('all')
  const [tier, setTier] = React.useState<PackageTier | 'all'>('all')
  const [packages, setPackages] = React.useState<RentalPackage[]>([
    {
      id: '001',
      name: 'Starter Weekend',
      tier: 'starter',
      discountPct: 10,
      equipmentCount: 3,
      status: 'active',
      description: 'Best for first-time players who need a simple, guided experience.',
      includedItems: ['Mask', 'Gloves', 'Basic harness'],
    },
    {
      id: '002',
      name: 'Standard Ops',
      tier: 'standard',
      discountPct: 15,
      equipmentCount: 5,
      status: 'active',
      description: 'Balanced package for regular players with more equipment variety.',
      includedItems: ['Mask', 'Vest', 'Gloves', 'Pouch set', 'Target card'],
    },
    {
      id: '003',
      name: 'Elite Precision',
      tier: 'elite',
      discountPct: 25,
      equipmentCount: 7,
      status: 'draft',
      description: 'Premium bundle for serious players and longer sessions.',
      includedItems: ['Mask', 'Vest', 'Gloves', 'Optics', 'Heavy pouch', 'Extra ammo', 'Training guide'],
    },
    {
      id: '004',
      name: 'Old Season Bundle',
      tier: 'standard',
      discountPct: 5,
      equipmentCount: 4,
      status: 'archived',
      description: 'Legacy package kept for historical records and offline bookings.',
      includedItems: ['Mask', 'Gloves', 'Harness', 'Storage kit'],
    },
  ])
  const [selectedPackageId, setSelectedPackageId] = React.useState<string | null>('PKG-001')
  const [form, setForm] = React.useState({ name: 'Starter Weekend', discountPct: '10', description: 'Best for first-time players who need a simple, guided experience.' })
  const [isAdding, setIsAdding] = React.useState(false)
  const [errors, setErrors] = React.useState<{ name?: string; discountPct?: string }>({})

  const filtered = packages.filter((pkg) => {
    const matchStatus = status === 'all' ? true : pkg.status === status
    const matchTier = tier === 'all' ? true : pkg.tier === tier
    return matchStatus && matchTier
  })

  const selectedPackage = selectedPackageId ? packages.find((pkg) => pkg.id === selectedPackageId) : undefined

  React.useEffect(() => {
    // ensure editor shows current selected package details when not adding
    if (!isAdding && selectedPackage) {
      setForm({ name: selectedPackage.name, discountPct: String(selectedPackage.discountPct), description: selectedPackage.description })
      setErrors({})
    }
  }, [selectedPackageId, isAdding])

  const editorRef = React.useRef<HTMLDivElement | null>(null)

  const handleSave = () => {
    if (!selectedPackage) return

    const newErrors: typeof errors = {}
    if (!form.name || form.name.trim().length === 0) newErrors.name = 'Package name is required.'
    const pct = Number(form.discountPct)
    if (Number.isNaN(pct) || pct < 0 || pct > 100) newErrors.discountPct = 'Enter a valid discount (0-100).'

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    setErrors({})
    setPackages((prev) => prev.map((pkg) => (pkg.id === selectedPackage.id ? { ...pkg, name: form.name, discountPct: Math.round(pct) || 0, description: form.description } : pkg)))
  }

  const handleAddPackage = () => {
    // enter add mode — do not insert into list until user confirms
    setIsAdding(true)
    setSelectedPackageId(null)
    setForm({ name: '', discountPct: '0', description: '' })
    setErrors({})
    // scroll to editor after entering add mode
    setTimeout(() => {
      try {
        editorRef?.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } catch (e) {
        // ignore in non-DOM environments
      }
    }, 60)
  }

  const handleCreatePackage = () => {
    const newErrors: typeof errors = {}
    if (!form.name || form.name.trim().length === 0) newErrors.name = 'Package name is required.'
    const pct = Number(form.discountPct)
    if (Number.isNaN(pct) || pct < 0 || pct > 100) newErrors.discountPct = 'Enter a valid discount (0-100).'

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    // generate a short sequential ID like PKG-005 based on existing packages
    const maxNum = packages.reduce((max, p) => {
      const n = parseInt(p.id.replace(/[^0-9]/g, ''), 10)
      return Number.isFinite(n) && !Number.isNaN(n) ? Math.max(max, n) : max
    }, 0)
    const nextNum = maxNum + 1
    const newId = String(nextNum).padStart(3, '0')
    const newPkg: RentalPackage = {
      id: newId,
      name: form.name,
      tier: 'starter',
      discountPct: Math.round(pct) || 0,
      equipmentCount: 0,
      status: 'draft',
      description: form.description,
      includedItems: [],
    }

    setPackages((prev) => [newPkg, ...prev])
    setStatus('all')
    setTier('all')
    setSelectedPackageId(newId)
    setIsAdding(false)
    setErrors({})
  }

  const handleCancelAdd = () => {
    setIsAdding(false)
    setSelectedPackageId(packages[0]?.id ?? null)
    setErrors({})
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Rental Packages</h1>
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
                  {(['all', 'active', 'draft', 'archived'] as const).map((item) => (
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
            <div className="col-span-4">Package</div>
            <div className="col-span-2 text-right">Discount</div>
            <div className="col-span-2 text-right">Includes</div>
            <div className="col-span-2 text-right">Status</div>
          </div>

          <div className="divide-y divide-white/5">
            {filtered.length === 0 ? (
              <div className="p-6 text-sm text-muted">No packages found for selected filters.</div>
            ) : (
              filtered.map((pkg) => (
                <div
                  key={pkg.id}
                  onClick={() => {
                    setIsAdding(false)
                    setSelectedPackageId(pkg.id)
                    setForm({ name: pkg.name, discountPct: String(pkg.discountPct), description: pkg.description })
                  }}
                  className={`grid grid-cols-12 items-center px-3 py-3 cursor-pointer ${pkg.id === selectedPackageId ? 'bg-white/3' : ''}`}
                >
                  <div className="col-span-2 text-sm font-semibold">{pkg.id}</div>
                  <div className="col-span-4">
                    <div className="text-sm font-semibold">{pkg.name}</div>
                    <div className="mt-1 text-xs text-muted">Tier: {pkg.tier.toUpperCase()}</div>
                  </div>
                  <div className="col-span-2 text-right text-sm text-muted">{pkg.discountPct}%</div>
                  <div className="col-span-2 text-right text-sm text-muted">{pkg.equipmentCount} items</div>
                  <div className="col-span-2 text-right">
                    <StatusPill status={pkg.status} />
                    <div className="mt-2 flex justify-end">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setIsAdding(false)
                          setSelectedPackageId(pkg.id)
                          setForm({ name: pkg.name, discountPct: String(pkg.discountPct), description: pkg.description })
                        }}
                        className="rounded-xl border border-white/5 bg-white/5 px-3 py-2 text-xs text-muted transition hover:bg-white/6"
                      >
                        Manage
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

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
                <div className="mb-2 text-sm font-semibold text-text">Discount %</div>
                <input
                  type="number"
                  value={form.discountPct}
                  onChange={(event) => setForm((prev) => ({ ...prev, discountPct: event.target.value }))}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text"
                />
                {errors.discountPct ? <div className="mt-2 text-xs text-danger">{errors.discountPct}</div> : null}
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
            <div className="mt-4">
              {isAdding ? (
                <div className="flex items-center gap-2">
                  <Button onClick={handleCreatePackage}>Create package</Button>
                  <Button variant="ghost" onClick={handleCancelAdd}>Cancel</Button>
                </div>
              ) : (
                <Button onClick={handleSave}>Save package</Button>
              )}
            </div>
          </Card>
          </div>

          <Card className="p-4 bg-white/5/60">
            <div className="text-xs uppercase tracking-widest text-muted">Included equipment</div>
            <div className="mt-2 text-sm text-muted">This bundle currently includes the following support items and gear.</div>
            <div className="mt-4 rounded-xl border border-white/5 bg-white/5 p-3">
              <div className="text-[11px] uppercase tracking-widest text-muted">Selected package</div>
              <div className="mt-1 text-sm font-semibold">{selectedPackage?.name}</div>
              <div className="mt-3 space-y-2">
                {selectedPackage?.includedItems.map((item) => (
                  <div key={item} className="rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-sm text-muted">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
      </Card>
    </div>
  )
}

