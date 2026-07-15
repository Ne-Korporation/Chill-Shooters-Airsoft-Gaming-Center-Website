import React from 'react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'

type WeaponCategory = 'rifles' | 'pistols' | 'snipers' | 'mg' | 'shotguns'

type WeaponStatus = 'available' | 'rented' | 'needs-check'

type WeaponItem = {
  id: string
  name: string
  category: WeaponCategory
  status: WeaponStatus
  note: string
}

const categoryOptions: { key: WeaponCategory; subtitle: string }[] = [
  { key: 'rifles', subtitle: 'Standard long-range platforms for regular bookings' },
  { key: 'pistols', subtitle: 'Sidearms and compact builds for quick turns' },
  { key: 'snipers', subtitle: 'Precision class weapons with heavier upkeep' },
  { key: 'mg', subtitle: 'Support weapons with limited stock and stricter control' },
  { key: 'shotguns', subtitle: 'Close-quarters spread style gear' },
]

const StatusBadge = ({ status }: { status: WeaponStatus }) => {
  const cls =
    status === 'available'
      ? 'bg-success/20 text-success border-success/30'
      : status === 'rented'
        ? 'bg-accent/20 text-accent border-accent/30'
        : 'bg-danger/20 text-danger border-danger/30'

  return <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${cls}`}>{status.toUpperCase()}</span>
}

export function AdminWeaponsPage() {
  const [category, setCategory] = React.useState<WeaponCategory>('rifles')
  const [status, setStatus] = React.useState<WeaponStatus | 'all'>('all')
  const [weapons, setWeapons] = React.useState<WeaponItem[]>([
    {
      id: 'W-RF-101',
      name: 'Rifle Alpha',
      category: 'rifles',
      status: 'available',
      note: 'Ready for the 2:30 PM group booking.',
    },
    {
      id: 'W-RF-108',
      name: 'Rifle Bravo',
      category: 'rifles',
      status: 'rented',
      note: 'Currently assigned to the premium package.',
    },
    {
      id: 'W-SN-014',
      name: 'Sniper Vanta',
      category: 'snipers',
      status: 'needs-check',
      note: 'Optics alignment review requested after last use.',
    },
    {
      id: 'W-MG-022',
      name: 'MG Atlas',
      category: 'mg',
      status: 'rented',
      note: 'Being used for the support rotation.',
    },
    {
      id: 'W-PS-003',
      name: 'Pistol Ember',
      category: 'pistols',
      status: 'available',
      note: 'Fresh inspection completed this morning.',
    },
  ])
  const [form, setForm] = React.useState({ name: '', category: 'rifles' as WeaponCategory, status: 'available' as WeaponStatus })
  const [selectedWeaponId, setSelectedWeaponId] = React.useState<string | null>(null)
  const nameRef = React.useRef<HTMLInputElement | null>(null)

  const filtered = weapons.filter((weapon) => {
    const matchCategory = weapon.category === category
    const matchStatus = status === 'all' ? true : weapon.status === status
    return matchCategory && matchStatus
  })

  const activeCategoryMeta = categoryOptions.find((item) => item.key === category)
  const maintenanceCount = weapons.filter((weapon) => weapon.status === 'needs-check').length

  const addWeapon = () => {
    if (!form.name.trim()) return

    const newWeapon: WeaponItem = {
      id: `W-${category.toUpperCase().slice(0, 2)}-${String(weapons.length + 1).padStart(3, '0')}`,
      name: form.name.trim(),
      category: form.category,
      status: form.status,
      note: 'Added through the admin inventory review.',
    }

    setWeapons((prev) => [newWeapon, ...prev])
    setForm({ name: '', category: 'rifles', status: 'available' })
  }

  const handleSelect = (weapon: WeaponItem) => {
    setSelectedWeaponId(weapon.id)
    setForm({ name: weapon.name, category: weapon.category, status: weapon.status })
  }

  React.useEffect(() => {
    if (selectedWeaponId) requestAnimationFrame(() => nameRef.current?.focus())
  }, [selectedWeaponId])

  const handleUpdate = () => {
    if (!selectedWeaponId) return addWeapon()
    setWeapons((prev) => prev.map((w) => (w.id === selectedWeaponId ? { ...w, name: form.name.trim() || w.name, category: form.category, status: form.status } : w)))
    setSelectedWeaponId(null)
    setForm({ name: '', category: 'rifles', status: 'available' })
  }

  const handleFlag = (id: string) => {
    // mark as needs-check
    setWeapons((prev) => prev.map((w) => (w.id === id ? { ...w, status: 'needs-check' } : w)))
  }

  const handleToggleFlag = (id: string) => {
    setWeapons((prev) => prev.map((w) => (w.id === id ? { ...w, status: w.status === 'needs-check' ? 'available' : 'needs-check' } : w)))
  }

  const handleRemove = (id: string) => {
    setWeapons((prev) => prev.filter((w) => w.id !== id))
    if (selectedWeaponId === id) {
      setSelectedWeaponId(null)
      setForm({ name: '', category: 'rifles', status: 'available' })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Weapons</h1>
          <p className="mt-1 text-sm text-muted">Manage the weapon catalog, inspect conditions, and keep the maintenance queue current.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {categoryOptions.map((item) => (
            <button
              key={item.key}
              onClick={() => setCategory(item.key)}
              className={
                'rounded-xl border px-3 py-2 text-sm transition ' +
                (category === item.key
                  ? 'bg-white/8 text-text border-accent/30'
                  : 'bg-white/5 text-muted hover:bg-white/6')
              }
            >
              {item.key.toUpperCase()}
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
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted">{category.toUpperCase()}</div>
            <div className="mt-2 text-sm text-muted">{activeCategoryMeta?.subtitle}</div>
          </div>

          <div className="flex flex-wrap gap-2">
            {(['all', 'available', 'rented', 'needs-check'] as const).map((item) => (
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

        <div className="mt-4 overflow-hidden rounded-2xl border border-white/5">
          <div className="grid grid-cols-12 bg-white/5 px-3 py-2 text-xs uppercase tracking-widest text-muted">
            <div className="col-span-3">ID</div>
            <div className="col-span-4">Weapon</div>
            <div className="col-span-2 text-right">Status</div>
            <div className="col-span-3 text-right">Actions</div>
          </div>

          <div className="divide-y divide-white/5">
            {filtered.length === 0 ? (
              <div className="p-6 text-sm text-muted">No weapons match this filter.</div>
            ) : (
              filtered.map((weapon) => (
                <div key={weapon.id} className={"grid grid-cols-12 items-center px-3 py-3 " + (selectedWeaponId === weapon.id ? 'bg-white/6 ring-2 ring-white/10' : '')}>
                  <div className="col-span-3 text-sm font-semibold">{weapon.id}</div>
                  <div className="col-span-4">
                    <div className="text-sm font-semibold">{weapon.name}</div>
                    <div className="mt-1 text-xs text-muted">{weapon.note}</div>
                  </div>
                  <div className="col-span-2 text-right">
                    <StatusBadge status={weapon.status} />
                  </div>
                  <div className="col-span-3 text-right">
                    <div className="flex items-center justify-end gap-2">
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
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text"
                  placeholder="e.g. Rifle Delta"
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
                    <option value="needs-check">Needs check</option>
                  </select>
                </label>
              </div>
            </div>
            <div className="mt-4">
              {selectedWeaponId ? (
                <div className="flex items-center gap-2">
                  <Button onClick={handleUpdate}>Update weapon</Button>
                  <Button variant="ghost" onClick={() => { setSelectedWeaponId(null); setForm({ name: '', category: 'rifles', status: 'available' }) }}>New</Button>
                </div>
              ) : (
                <Button onClick={addWeapon}>Register weapon</Button>
              )}
            </div>
          </Card>

          <Card className="p-4 bg-white/5/60">
            <div className="text-xs uppercase tracking-widest text-muted">Maintenance queue</div>
            <div className="mt-2 text-sm text-muted">Weapons that need servicing or re-inspection are surfaced here.</div>
            <div className="mt-4 space-y-2">
              <div className="rounded-xl border border-white/5 bg-white/5 px-3 py-3">
                <div className="text-sm font-semibold">Sniper Vanta</div>
                <div className="mt-1 text-xs text-muted">Optics alignment and barrel check pending.</div>
              </div>
              <div className="rounded-xl border border-white/5 bg-white/5 px-3 py-3">
                <div className="text-sm font-semibold">Rifle Delta</div>
                <div className="mt-1 text-xs text-muted">New weapon entry awaiting first inspection.</div>
              </div>
            </div>
          </Card>
        </div>
      </Card>
    </div>
  )
}

