import React from 'react'
import { useParams } from 'react-router-dom'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { FiPlus } from 'react-icons/fi'
import { apiGet, apiPost } from '../../utils/apiClient'
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
          apiGet<{ ok: boolean; data: UserEquipmentItem[] }>('/api/equipments?limit=200'),
          apiGet<{ ok: boolean; data: UserEquipmentItem[] }>('/api/weapons?limit=200'),
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
        note: equipmentForm.description.trim() || 'Submitted by player via account page.',
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
        note: weaponForm.description.trim() || 'Submitted by player via account page.',
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
          <Button onClick={() => setAdding('weapon')}><FiPlus /> Add weapon</Button>
          <Button variant="ghost" onClick={() => setAdding('gear')}><FiPlus /> Add gear</Button>
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
                <div className="col-span-2">Type</div>
                <div className="col-span-3">Name</div>
                <div className="col-span-2">Category</div>
                <div className="col-span-3">Notes</div>
                <div className="col-span-2 text-right">Status</div>
              </div>
              <div className="divide-y divide-white/5">
                {visibleItems.length === 0 ? (
                  <div className="p-4 text-sm text-muted">Nothing added yet.</div>
                ) : (
                  visibleItems.map((item) => (
                    <div key={`${item.kind}-${item.id || item.name}`} className="stack-row grid grid-cols-12 items-center px-3 py-3">
                      <div data-label="Type" className="col-span-2 text-xs uppercase tracking-wider text-muted">{item.kind}</div>
                      <div data-label="Name" className="stack-wide col-span-3 min-w-0 text-sm font-semibold">{item.name}</div>
                      <div data-label="Category" className="col-span-2 text-xs uppercase tracking-wider text-muted">{item.category}</div>
                      <div data-label="Notes" className="stack-wide col-span-3 min-w-0 text-sm text-muted">
                        <div className="md:truncate">{item.description || item.note || '-'}</div>
                        {item.approvalStatus === 'rejected' && item.rejectionReason ? (
                          <div className="mt-1 text-xs text-danger md:truncate">Reason: {item.rejectionReason}</div>
                        ) : null}
                      </div>
                      <div data-label="Status" className="stack-wide col-span-2 flex justify-end">
                        <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] ${item.approvalStatus === 'rejected'
                          ? 'border-danger/30 bg-danger/10 text-danger'
                          : 'border-success/30 bg-success/10 text-success'
                          }`}>
                          {item.approvalStatus === 'rejected' ? 'Rejected' : 'Active'}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </Card>

        </>
      ) : null}

      {adding === 'gear' ? (
        <Modal eyebrow={`Gear · ${ownedEquipment.length} saved`} title="Add your gear" onClose={() => setAdding(null)} size="md">
            {formError ? <div className="mb-3 text-sm text-danger">{formError}</div> : null}
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
                  className="w-full rounded-xl bg-background border border-white/10 px-4 py-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/40 [&>option]:bg-background [&>option]:text-text"
                >
                  <option value="gear">Gear</option>
                  <option value="masks">Masks</option>
                  <option value="vests">Vests</option>
                  <option value="gloves">Gloves</option>
                </select>
              </label>
              <Input
                label="Notes"
                value={equipmentForm.description}
                onChange={(event) => setEquipmentForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Describe condition or details"
              />
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Submitting…' : 'Submit gear'}
              </Button>
            </form>
        </Modal>
      ) : null}

      {adding === 'weapon' ? (
        <Modal eyebrow={`Weapons · ${ownedWeapons.length} saved`} title="Add your weapon" onClose={() => setAdding(null)} size="md">
            {formError ? <div className="mb-3 text-sm text-danger">{formError}</div> : null}
            <form className="space-y-3" onSubmit={handleSubmitWeapon}>
              <label className="block">
                <div className="mb-2 text-sm font-semibold text-text">Category</div>
                <select
                  value={weaponForm.category}
                  onChange={(event) => setWeaponForm((current) => ({ ...current, category: event.target.value }))}
                  className="w-full rounded-xl bg-background border border-white/10 px-4 py-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/40 [&>option]:bg-background [&>option]:text-text"
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
                placeholder="Mention condition or notes"
              />
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Submitting…' : 'Submit weapon'}
              </Button>
            </form>
        </Modal>
      ) : null}
    </div>
  )
}
