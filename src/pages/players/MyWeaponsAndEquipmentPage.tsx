import React from 'react'
import { useParams } from 'react-router-dom'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { FiEdit2, FiPlus, FiShield, FiTrash2 } from 'react-icons/fi'
import { GiPistolGun } from 'react-icons/gi'
import { apiDelete, apiGet, apiPost, apiPut, apiGetAll } from '../../utils/apiClient'
import { confirmDialog } from '../../components/ui/ConfirmDialog'
import { useAuth } from '../../context/AuthContext'
import toast from 'react-hot-toast'

type UserEquipmentItem = {
  id?: string
  name?: string
  category?: string
  status?: string
  description?: string
  note?: string
  submittedBy?: string
  kind?: 'equipment' | 'weapon'
  approvalStatus?: string
  rejectionReason?: string
  source?: 'business' | 'player'
}

// Weapon categories a player can submit, and the name each submitted weapon gets.
const WEAPON_CATEGORY_LABELS: Record<string, string> = {
  rifles: 'Rifles',
  gel_blasters: 'Gel blasters',
  pistols: 'Pistols',
  snipers: 'Snipers',
  mg: 'MG',
  shotguns: 'Shotguns',
}
const GEAR_CATEGORY_LABELS: Record<string, string> = {
  gear: 'Gear',
  masks: 'Masks',
  vests: 'Vests',
  gloves: 'Gloves',
}
// Older items were saved with this note when the player left Notes empty: show it as blank.
const DEFAULT_NOTE = 'Submitted by player via account page.'
const notesOf = (item: UserEquipmentItem) => {
  const text = String(item.description || item.note || '').trim()
  return text === DEFAULT_NOTE ? '' : text
}
const categoryLabel = (item: UserEquipmentItem) =>
  (item.kind === 'weapon' ? WEAPON_CATEGORY_LABELS : GEAR_CATEGORY_LABELS)[String(item.category || '')] || String(item.category || '').replace(/_/g, ' ')
const isDamaged = (item: UserEquipmentItem) => ['damaged', 'needs-check', 'maintenance'].includes(String(item.status || '').toLowerCase())
const selectClass = 'w-full rounded-xl bg-background border border-white/10 px-4 py-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/40 [&>option]:bg-background [&>option]:text-text'

type EditForm = { type: 'weapon' | 'gear'; name: string; category: string; notes: string; status: 'available' | 'damaged' }

const WEAPON_CATEGORY_NAMES: Record<string, string> = {
  rifles: 'Rifle',
  gel_blasters: 'Gel blaster',
  pistols: 'Pistol',
  snipers: 'Sniper',
  mg: 'Machine gun',
  shotguns: 'Shotgun',
}

export function MyWeaponsAndEquipmentPage() {
  const { playerId } = useParams()
  const { user } = useAuth()
  const [equipment, setEquipment] = React.useState<UserEquipmentItem[]>([])
  const [weapons, setWeapons] = React.useState<UserEquipmentItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [tableFilter, setTableFilter] = React.useState<'all' | 'equipment' | 'weapon'>('all')
  const [equipmentForm, setEquipmentForm] = React.useState({ name: '', category: 'gear', description: '' })
  const [weaponForm, setWeaponForm] = React.useState({ name: '', category: 'rifles', description: '' })
  // Which add form is open in a pop-up, and its own error message.
  const [adding, setAddingState] = React.useState<'weapon' | 'gear' | null>(null)
  const [formError, setFormError] = React.useState<string | null>(null)
  const setAdding = (next: 'weapon' | 'gear' | null) => {
    setFormError(null)
    setAddingState(next)
  }
  // The item being edited in its pop-up, and the form for it.
  const [editing, setEditing] = React.useState<UserEquipmentItem | null>(null)
  const [editForm, setEditForm] = React.useState<EditForm>({ type: 'weapon', name: '', category: 'rifles', notes: '', status: 'available' })
  const [saving, setSaving] = React.useState(false)

  const startEdit = (item: UserEquipmentItem) => {
    setFormError(null)
    setEditing(item)
    setEditForm({
      type: item.kind === 'equipment' ? 'gear' : 'weapon',
      name: String(item.name || ''),
      category: String(item.category || (item.kind === 'equipment' ? 'gear' : 'rifles')),
      notes: notesOf(item),
      status: isDamaged(item) ? 'damaged' : 'available',
    })
  }

  const collectionOf = (item: UserEquipmentItem) => (item.kind === 'equipment' ? 'equipments' : 'weapons')

  const saveEdit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editing?.id) return
    if (editForm.type === 'gear' && !editForm.name.trim()) {
      setFormError('Gear name is required.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const res = await apiPut<{ ok: boolean; data: UserEquipmentItem }>(
        `/api/my-gear/${collectionOf(editing)}/${encodeURIComponent(editing.id)}`,
        { ...editForm, name: editForm.name.trim(), notes: editForm.notes.trim() },
      )
      const updated = res.data
      const oldId = editing.id
      // Take it out of its old list and put the saved version in the list for its type.
      setWeapons((current) => current.filter((item) => item.id !== oldId).concat(editForm.type === 'weapon' ? [updated] : []))
      setEquipment((current) => current.filter((item) => item.id !== oldId).concat(editForm.type === 'gear' ? [updated] : []))
      toast.success('Saved.')
      setEditing(null)
    } catch (e: any) {
      setFormError(String(e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  const removeItem = async (item: UserEquipmentItem) => {
    if (!item.id) return
    if (!(await confirmDialog({ title: `Delete ${item.name || 'this item'}?`, message: 'It is removed from your weapons and gear.', confirmLabel: 'Delete', danger: true }))) return
    try {
      await apiDelete(`/api/my-gear/${collectionOf(item)}/${encodeURIComponent(item.id)}`)
      setWeapons((current) => current.filter((row) => row.id !== item.id))
      setEquipment((current) => current.filter((row) => row.id !== item.id))
      toast.success('Deleted.')
    } catch (e: any) {
      toast.error(String(e?.message || e))
    }
  }

  React.useEffect(() => {
    const lookupId = playerId || user?.id
    if (!lookupId) {
      setLoading(false)
      return
    }

    let alive = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const [playerEquipmentRes, playerWeaponsRes] = await Promise.all([
          apiGetAll<any>('equipments').then((data) => ({ ok: true, data })),
          apiGetAll<any>('weapons').then((data) => ({ ok: true, data })),
        ])

        if (!alive) return

        const equipmentItems = Array.isArray(playerEquipmentRes?.data) ? playerEquipmentRes.data : []
        const weaponItems = Array.isArray(playerWeaponsRes?.data) ? playerWeaponsRes.data : []
        setEquipment(equipmentItems)
        setWeapons(weaponItems)
      } catch (e: any) {
        if (!alive) return
        setError(String(e?.message || e))
      } finally {
        if (alive) setLoading(false)
      }
    })()

    return () => {
      alive = false
    }
  }, [playerId, user?.id])

  const lookupId = playerId || user?.id

  const ownedEquipment = React.useMemo(() => {
    return equipment.filter((item) => String(item.submittedBy || '') === String(lookupId || ''))
  }, [equipment, lookupId])

  const ownedWeapons = React.useMemo(() => {
    return weapons.filter((item) => String(item.submittedBy || '') === String(lookupId || ''))
  }, [lookupId, weapons])

  const visibleItems = React.useMemo(() => {
    const rows = [
      ...ownedEquipment.map((item) => ({ ...item, kind: 'equipment' as const })),
      ...ownedWeapons.map((item) => ({ ...item, kind: 'weapon' as const })),
    ]
    return tableFilter === 'all' ? rows : rows.filter((item) => item.kind === tableFilter)
  }, [ownedEquipment, ownedWeapons, tableFilter])

  const handleSubmitEquipment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!equipmentForm.name.trim()) {
      setFormError('Gear name is required.')
      return
    }

    try {
      setSubmitting(true)
      setFormError(null)
      const created = await apiPost<{ ok: boolean; data: UserEquipmentItem }>('/api/equipments', {
        id: `EQ-PLAYER-${Date.now()}`,
        kind: 'equipment',
        name: equipmentForm.name.trim(),
        category: equipmentForm.category,
        status: 'available',
        qty: 1,
        description: equipmentForm.description.trim(),
        note: equipmentForm.description.trim(),
        createdAtISO: new Date().toISOString(),
        submittedBy: lookupId,
        source: 'player',
        approvalStatus: 'approved',
      })
      setEquipment((current) => current.concat(created?.data ? [created.data] : []))
      toast.success('Gear added to your inventory.')
      setAdding(null)
      setEquipmentForm({ name: '', category: 'gear', description: '' })
    } catch (e: any) {
      setFormError(String(e?.message || e))
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmitWeapon = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    // Players only pick the category; the weapon is named after it (staff see the notes too).
    const weaponName = WEAPON_CATEGORY_NAMES[weaponForm.category] || 'Weapon'

    try {
      setSubmitting(true)
      setFormError(null)
      const created = await apiPost<{ ok: boolean; data: UserEquipmentItem }>('/api/weapons', {
        id: `W-PLAYER-${Date.now()}`,
        kind: 'weapon',
        name: weaponName,
        category: weaponForm.category,
        status: 'available',
        description: weaponForm.description.trim(),
        note: weaponForm.description.trim(),
        createdAtISO: new Date().toISOString(),
        submittedBy: lookupId,
        source: 'player',
        approvalStatus: 'approved',
      })
      setWeapons((current) => current.concat(created?.data || []))
      toast.success('Weapon added. Marshals check its FPS at the field on game day.')
      setAdding(null)
      setWeaponForm({ name: '', category: 'rifles', description: '' })
    } catch (e: any) {
      setFormError(String(e?.message || e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">My Weapons and Gear</h1>
          <p className="text-sm text-muted">Add your own weapons and gear. They're ready to use as soon as you add them. Marshals check every weapon's FPS at the field on game day.</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button onClick={() => setAdding('weapon')}><FiPlus /> Add item</Button>
        </div>
      </div>

      {loading ? (
        <Card className="p-4 text-sm text-muted">Loading your gear…</Card>
      ) : error ? (
        <Card className="p-4 text-sm text-danger">{error}</Card>
      ) : null}

      {!loading && !error ? (
        <>
          <Card className="p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs uppercase tracking-widest text-muted">My inventory</div>
                <div className="mt-1 text-lg font-semibold">Your weapons and gear</div>
              </div>
              <select
                value={tableFilter}
                onChange={(event) => setTableFilter(event.target.value as 'all' | 'equipment' | 'weapon')}
                className="w-full sm:w-auto sm:min-w-[170px] rounded-full border border-white/10 bg-background px-3 py-2 text-sm text-text outline-none"
              >
                <option value="all">All items</option>
                <option value="equipment">Gear</option>
                <option value="weapon">Weapons</option>
              </select>
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-white/5">
              <div className="stack-head grid grid-cols-12 bg-white/5 px-3 py-2 text-xs uppercase tracking-widest text-muted">
                <div className="col-span-4">Item</div>
                <div className="col-span-4">Notes</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-2 text-right">Actions</div>
              </div>
              <div className="divide-y divide-white/5">
                {visibleItems.length === 0 ? (
                  <div className="p-4 text-sm text-muted">Nothing added yet.</div>
                ) : (
                  visibleItems.map((item) => (
                    <div key={`${item.kind}-${item.id || item.name}`} className="stack-row grid grid-cols-12 items-center px-3 py-3">
                      {/* The item: its name, then its type and category underneath. */}
                      <div data-label="Item" className="stack-wide col-span-4 flex min-w-0 items-center gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/5 text-muted">
                          {item.kind === 'weapon' ? <GiPistolGun className="h-4 w-4" /> : <FiShield className="h-4 w-4" />}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{item.name}</div>
                          <div className="text-xs text-muted">{item.kind === 'weapon' ? 'Weapon' : 'Gear'} · {categoryLabel(item)}</div>
                        </div>
                      </div>
                      <div data-label="Notes" className="stack-wide col-span-4 min-w-0 text-sm text-muted">
                        <div className="md:truncate">{notesOf(item)}</div>
                        {item.approvalStatus === 'rejected' && item.rejectionReason ? (
                          <div className="mt-1 text-xs text-danger md:truncate">Reason: {item.rejectionReason}</div>
                        ) : null}
                      </div>
                      <div data-label="Status" className="col-span-2">
                        <span className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] ${item.approvalStatus === 'rejected' || isDamaged(item)
                          ? 'border-danger/30 bg-danger/10 text-danger'
                          : 'border-success/30 bg-success/10 text-success'
                          }`}>
                          {item.approvalStatus === 'rejected' ? 'Rejected' : isDamaged(item) ? 'Damaged' : 'Available'}
                        </span>
                      </div>
                      <div data-label="Actions" className="stack-wide col-span-2 flex justify-end gap-1">
                        <Button size="xs" variant="ghost" onClick={() => startEdit(item)} aria-label={`Edit ${item.name}`}><FiEdit2 /> Edit</Button>
                        <Button size="xs" variant="danger-soft" onClick={() => removeItem(item)} aria-label={`Delete ${item.name}`}><FiTrash2 /></Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </Card>

        </>
      ) : null}

      {editing ? (
        <Modal eyebrow="Edit" title={editing.name || 'Item'} onClose={() => setEditing(null)} size="md">
          {formError ? <div className="mb-3 text-sm text-danger">{formError}</div> : null}
          <form className="space-y-3" onSubmit={saveEdit}>
            <label className="block">
              <div className="mb-2 text-sm font-semibold text-text">Type</div>
              <select
                value={editForm.type}
                onChange={(event) => {
                  const type = event.target.value as 'weapon' | 'gear'
                  setEditForm((current) => ({ ...current, type, category: type === 'weapon' ? 'rifles' : 'gear' }))
                }}
                className={selectClass}
              >
                <option value="weapon">Weapon</option>
                <option value="gear">Gear</option>
              </select>
            </label>
            {editForm.type === 'gear' ? (
              <Input label="Gear name" value={editForm.name} onChange={(event) => setEditForm((current) => ({ ...current, name: event.target.value }))} />
            ) : null}
            <label className="block">
              <div className="mb-2 text-sm font-semibold text-text">Category</div>
              <select value={editForm.category} onChange={(event) => setEditForm((current) => ({ ...current, category: event.target.value }))} className={selectClass}>
                {Object.entries(editForm.type === 'weapon' ? WEAPON_CATEGORY_LABELS : GEAR_CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <Input label="Notes" value={editForm.notes} onChange={(event) => setEditForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Optional" />
            <label className="block">
              <div className="mb-2 text-sm font-semibold text-text">Status</div>
              <select value={editForm.status} onChange={(event) => setEditForm((current) => ({ ...current, status: event.target.value as 'available' | 'damaged' }))} className={selectClass}>
                <option value="available">Available</option>
                <option value="damaged">Damaged</option>
              </select>
            </label>
            <Button type="submit" className="w-full" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
          </form>
        </Modal>
      ) : null}

      {/* One "Add item" pop-up: pick Weapon or Gear first, then fill in that type's fields. */}
      {adding ? (
        <Modal eyebrow={`My inventory · ${ownedWeapons.length + ownedEquipment.length} saved`} title="Add an item" onClose={() => setAdding(null)} size="md">
          {formError ? <div className="mb-3 text-sm text-danger">{formError}</div> : null}
          <div className="mb-4">
            <div className="mb-2 text-sm font-semibold text-text">Type</div>
            <div className="flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
              {(['weapon', 'gear'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  aria-pressed={adding === type}
                  onClick={() => setAdding(type)}
                  className={['flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition', adding === type ? 'bg-accent/15 text-accent' : 'text-muted hover:text-text'].join(' ')}
                >
                  {type === 'weapon' ? <GiPistolGun className="h-4 w-4" /> : <FiShield className="h-4 w-4" />}
                  {type === 'weapon' ? 'Weapon' : 'Gear'}
                </button>
              ))}
            </div>
          </div>

          {adding === 'weapon' ? (
            <form className="space-y-3" onSubmit={handleSubmitWeapon}>
              <label className="block">
                <div className="mb-2 text-sm font-semibold text-text">Category</div>
                <select
                  value={weaponForm.category}
                  onChange={(event) => setWeaponForm((current) => ({ ...current, category: event.target.value }))}
                  className={selectClass}
                >
                  {Object.entries(WEAPON_CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <Input
                label="Notes"
                value={weaponForm.description}
                onChange={(event) => setWeaponForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Optional: condition or details"
              />
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Adding…' : 'Add weapon'}
              </Button>
            </form>
          ) : (
            <form className="space-y-3" onSubmit={handleSubmitEquipment}>
              <Input
                label="Gear name"
                value={equipmentForm.name}
                onChange={(event) => setEquipmentForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="e.g. Tactical Vest"
              />
              <label className="block">
                <div className="mb-2 text-sm font-semibold text-text">Category</div>
                <select
                  value={equipmentForm.category}
                  onChange={(event) => setEquipmentForm((current) => ({ ...current, category: event.target.value }))}
                  className={selectClass}
                >
                  {Object.entries(GEAR_CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <Input
                label="Notes"
                value={equipmentForm.description}
                onChange={(event) => setEquipmentForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Optional: condition or details"
              />
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Adding…' : 'Add gear'}
              </Button>
            </form>
          )}
        </Modal>
      ) : null}
    </div>
  )
}
