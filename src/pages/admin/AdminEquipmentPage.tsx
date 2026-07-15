import React from 'react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'

type EquipmentCategory = 'masks' | 'vests' | 'gloves' | 'gear'

type EquipmentStatus = 'available' | 'rented' | 'maintenance'

type InventoryItem = {
  id: string
  name: string
  category: EquipmentCategory
  status: EquipmentStatus
  qty: number
  note: string
}

const categoryMeta: Record<EquipmentCategory, { subtitle: string }> = {
  masks: { subtitle: 'Face protection, optics, and field-ready headgear' },
  vests: { subtitle: 'Body armor and protective carriers' },
  gloves: { subtitle: 'Grip, impact, and handling gear' },
  gear: { subtitle: 'Holsters, pouches, and accessories' },
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

export function AdminEquipmentPage() {
  const [activeCategory, setActiveCategory] = React.useState<EquipmentCategory>('masks')
  const [status, setStatus] = React.useState<EquipmentStatus | 'all'>('all')
  const [inventory, setInventory] = React.useState<InventoryItem[]>([
    {
      id: 'EQ-M-001',
      name: 'Viper Mask',
      category: 'masks',
      status: 'available',
      qty: 1,
      note: 'Recently inspected; lens coating intact.',
    },
    {
      id: 'EQ-M-014',
      name: 'Ghost Mask',
      category: 'masks',
      status: 'rented',
      qty: 1,
      note: 'Booked for the 4:00 PM session.',
    },
    {
      id: 'EQ-V-007',
      name: 'Tactical Vest',
      category: 'vests',
      status: 'maintenance',
      qty: 2,
      note: 'Strap reinforcement due before next weekend.',
    },
    {
      id: 'EQ-G-002',
      name: 'Impact Gloves',
      category: 'gloves',
      status: 'available',
      qty: 3,
      note: 'High turnover item for beginner packages.',
    },
    {
      id: 'EQ-GR-003',
      name: 'Molle Pouch Set',
      category: 'gear',
      status: 'rented',
      qty: 2,
      note: 'Reserved by the elite package group.',
    },
  ])
  const [form, setForm] = React.useState({ name: '', qty: '1', status: 'available' as EquipmentStatus })
  const [selectedItemId, setSelectedItemId] = React.useState<string | null>(null)

  const filtered = inventory.filter((item) => {
    const matchesCategory = item.category === activeCategory
    const matchesStatus = status === 'all' ? true : item.status === status
    return matchesCategory && matchesStatus
  })

  const totalInStock = inventory.reduce((sum, item) => sum + item.qty, 0)
  const maintenanceCount = inventory.filter((item) => item.status === 'maintenance').length
  const rentedCount = inventory.filter((item) => item.status === 'rented').length

  const handleCreate = () => {
    if (!form.name.trim()) return

    const newItem: InventoryItem = {
      id: `EQ-${activeCategory.toUpperCase().slice(0, 2)}-${String(inventory.length + 1).padStart(3, '0')}`,
      name: form.name.trim(),
      category: activeCategory,
      status: form.status,
      qty: Number(form.qty) || 1,
      note: 'Newly entered from admin inventory review.',
    }

    setInventory((prev) => [newItem, ...prev])
    setForm({ name: '', qty: '1', status: 'available' })
  }

  const handleSelect = (item: InventoryItem) => {
    setSelectedItemId(item.id)
    setForm({ name: item.name, qty: String(item.qty), status: item.status })
    // scroll into view could be added if needed
  }

  const nameRef = React.useRef<HTMLInputElement | null>(null)

  // focus the name input when selecting an item
  React.useEffect(() => {
    if (selectedItemId) {
      requestAnimationFrame(() => nameRef.current?.focus())
    }
  }, [selectedItemId])

  const handleRemove = (id: string) => {
    setInventory((prev) => prev.filter((it) => it.id !== id))
    if (selectedItemId === id) {
      setSelectedItemId(null)
      setForm({ name: '', qty: '1', status: 'available' })
    }
  }

  const handleUpdate = () => {
    if (!selectedItemId) return handleCreate()
    setInventory((prev) => prev.map((it) => (it.id === selectedItemId ? { ...it, name: form.name.trim() || it.name, qty: Number(form.qty) || it.qty, status: form.status, } : it)))
    setSelectedItemId(null)
    setForm({ name: '', qty: '1', status: 'available' })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Equipment</h1>
          <p className="mt-1 text-sm text-muted">Track inventory by category, condition, and upcoming usage.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {(Object.keys(categoryMeta) as EquipmentCategory[]).map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={
                'rounded-xl border px-3 py-2 text-sm transition ' +
                (activeCategory === cat
                  ? 'bg-white/8 text-text border-accent/30'
                  : 'bg-white/5 text-muted hover:bg-white/6')
              }
            >
              {cat.charAt(0).toUpperCase() + cat.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Units in stock</div>
          <div className="mt-2 text-2xl font-bold text-accent">{totalInStock}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Rented right now</div>
          <div className="mt-2 text-2xl font-bold text-danger">{rentedCount}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Needs maintenance</div>
          <div className="mt-2 text-2xl font-bold text-success">{maintenanceCount}</div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted">Inventory & availability</div>
            <div className="mt-2 text-sm text-muted">{categoryMeta[activeCategory].subtitle}</div>
          </div>

          <div className="flex flex-wrap gap-2">
            {(['all', 'available', 'rented', 'maintenance'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={
                  'rounded-xl border px-3 py-2 text-sm transition ' +
                  (status === s
                    ? 'bg-white/8 text-text border-accent/30'
                    : 'bg-white/5 text-muted hover:bg-white/6')
                }
              >
                {s === 'all' ? 'ALL' : s.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-white/5">
          <div className="grid grid-cols-12 bg-white/5 px-3 py-2 text-xs uppercase tracking-widest text-muted">
            <div className="col-span-3">ID</div>
            <div className="col-span-4">Item</div>
            <div className="col-span-2">Qty</div>
            <div className="col-span-3 text-right">Status</div>
          </div>

          <div className="divide-y divide-white/5">
            {filtered.length === 0 ? (
              <div className="p-6 text-sm text-muted">No equipment matches this filter.</div>
            ) : (
              filtered.map((item) => (
                <div
                  key={item.id}
                  className={"grid grid-cols-12 items-center px-3 py-3 " + (selectedItemId === item.id ? 'bg-white/6 ring-2 ring-white/10' : '')}
                >
                  <div className="col-span-3 text-sm font-semibold">{item.id}</div>
                  <div className="col-span-4">
                    <div className="text-sm font-semibold">{item.name}</div>
                    <div className="mt-1 text-xs text-muted">{item.note}</div>
                  </div>
                  <div className="col-span-2 text-sm text-muted">{item.qty}</div>
                  <div className="col-span-3 text-right">
                    <StatusBadge status={item.status} />
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleSelect(item) }}
                        className="rounded-xl border border-white/5 bg-white/5 px-3 py-2 text-xs text-muted transition hover:bg-white/8 active:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/10 cursor-pointer"
                      >
                        Edit
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); handleRemove(item.id) }} className="rounded-xl border border-white/5 bg-white/5 px-3 py-2 text-xs text-muted transition hover:bg-white/6">
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

            <div className="mt-4 grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
          <Card className="p-4 bg-white/5/60">
            <div className="text-xs uppercase tracking-widest text-muted">Add or update stock</div>
            <div className="mt-2 text-sm text-muted">Create new inventory entries with clear status and quantity notes.</div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Input
                ref={nameRef}
                label="Item name"
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="e.g. Tactical Helmet"
              />
              <Input
                label="Quantity"
                type="number"
                min="1"
                value={form.qty}
                onChange={(event) => setForm((prev) => ({ ...prev, qty: event.target.value }))}
              />
            </div>
            <div className="mt-3">
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
            <div className="mt-4 flex items-center gap-2">
              {selectedItemId ? (
                <>
                  <Button onClick={handleUpdate}>Update inventory item</Button>
                  <Button variant="ghost" onClick={() => { setSelectedItemId(null); setForm({ name: '', qty: '1', status: 'available' }) }}>New</Button>
                </>
              ) : (
                <Button onClick={handleCreate}>Save inventory item</Button>
              )}
            </div>
          </Card>

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
    </div>
  )
}

