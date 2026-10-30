import React from 'react'
import { useParams } from 'react-router-dom'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { apiGet, apiPost } from '../../utils/apiClient'
import { useAuth } from '../../context/AuthContext'
import { sendRoleNotifications, useNotifications } from '../../context/NotificationContext'
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

export function MyWeaponsAndEquipmentPage() {
  const { playerId } = useParams()
  const { user } = useAuth()
  const { addNotification } = useNotifications()
  const [equipment, setEquipment] = React.useState<UserEquipmentItem[]>([])
  const [weapons, setWeapons] = React.useState<UserEquipmentItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [tableFilter, setTableFilter] = React.useState<'all' | 'equipment' | 'weapon'>('all')
  const [equipmentForm, setEquipmentForm] = React.useState({ name: '', category: 'gear', description: '' })
  const [weaponForm, setWeaponForm] = React.useState({ name: '', category: 'rifles', description: '' })

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
      setError('Equipment name is required.')
      return
    }

    try {
      setSubmitting(true)
      setError(null)
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
        approvalStatus: 'pending',
      })
      // The server notifies staff about player submissions itself.
      if (user?.role !== 'user') sendRoleNotifications(addNotification, {
        roles: ['admin', 'registrar', 'marshal'],
        type: 'equipment_submitted',
        title: 'New Equipment Request',
        message: `A player submitted equipment request "${equipmentForm.name.trim()}" for review.`,
        linkedResourceId: created?.data?.id,
      })

      setEquipment((current) => current.concat(created?.data ? [created.data] : []))
      toast.success('Equipment submitted for admin review.')
      setEquipmentForm({ name: '', category: 'gear', description: '' })
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmitWeapon = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!weaponForm.name.trim()) {
      setError('Weapon name is required.')
      return
    }

    try {
      setSubmitting(true)
      setError(null)
      const created = await apiPost<{ ok: boolean; data: UserEquipmentItem }>('/api/weapons', {
        id: `W-PLAYER-${Date.now()}`,
        kind: 'weapon',
        name: weaponForm.name.trim(),
        category: weaponForm.category,
        status: 'available',
        description: weaponForm.description.trim(),
        note: weaponForm.description.trim() || 'Submitted by player via account page.',
        createdAtISO: new Date().toISOString(),
        submittedBy: lookupId,
        source: 'player',
        approvalStatus: 'pending',
      })
      // The server notifies staff about player submissions itself.
      if (user?.role !== 'user') sendRoleNotifications(addNotification, {
        roles: ['admin', 'registrar', 'marshal'],
        type: 'weapon_submitted',
        title: 'New Weapon Request',
        message: `A player submitted weapon request "${weaponForm.name.trim()}" for review.`,
        linkedResourceId: created?.data?.id,
      })

      setWeapons((current) => current.concat(created?.data || []))
      toast.success('Weapon submitted for admin review.')
      setWeaponForm({ name: '', category: 'rifles', description: '' })
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="text-sm font-medium text-accent">Player Access</div>
        <h1 className="text-3xl font-bold">My Weapons and Equipment</h1>
        <p className="text-sm text-muted">See the gear and weapons available to your account.</p>
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
                <div className="text-xs uppercase tracking-widest text-muted">My submissions</div>
                <div className="mt-1 text-lg font-semibold">Weapons and equipment awaiting review</div>
              </div>
              <select
                value={tableFilter}
                onChange={(event) => setTableFilter(event.target.value as 'all' | 'equipment' | 'weapon')}
                className="min-w-[170px] rounded-full border border-white/10 bg-background px-3 py-2 text-sm text-text outline-none"
              >
                <option value="all">All items</option>
                <option value="equipment">Equipment</option>
                <option value="weapon">Weapons</option>
              </select>
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-white/5">
              <div className="grid grid-cols-12 bg-white/5 px-3 py-2 text-xs uppercase tracking-widest text-muted">
                <div className="col-span-2">Type</div>
                <div className="col-span-3">Name</div>
                <div className="col-span-2">Category</div>
                <div className="col-span-3">Notes</div>
                <div className="col-span-2 text-right">Status</div>
              </div>
              <div className="divide-y divide-white/5">
                {visibleItems.length === 0 ? (
                  <div className="p-4 text-sm text-muted">No submissions yet.</div>
                ) : (
                  visibleItems.map((item) => (
                    <div key={`${item.kind}-${item.id || item.name}`} className="grid grid-cols-12 items-center px-3 py-3">
                      <div className="col-span-2 text-xs uppercase tracking-wider text-muted">{item.kind}</div>
                      <div className="col-span-3 min-w-0 text-sm font-semibold">{item.name}</div>
                      <div className="col-span-2 text-xs uppercase tracking-wider text-muted">{item.category}</div>
                      <div className="col-span-3 min-w-0 text-sm text-muted">
                        <div className="truncate">{item.description || item.note || '-'}</div>
                        {item.approvalStatus === 'rejected' && item.rejectionReason ? (
                          <div className="mt-1 truncate text-xs text-danger">Reason: {item.rejectionReason}</div>
                        ) : null}
                      </div>
                      <div className="col-span-2 flex justify-end">
                        <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] ${item.approvalStatus === 'approved'
                          ? 'border-success/30 bg-success/10 text-success'
                          : item.approvalStatus === 'rejected'
                            ? 'border-danger/30 bg-danger/10 text-danger'
                            : 'border-warning/30 bg-warning/10 text-warning'
                          }`}>
                          {item.approvalStatus === 'approved' ? 'Approved' : item.approvalStatus === 'rejected' ? 'Rejected' : 'Pending'}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </Card>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-widest text-muted">Equipment</div>
                <div className="mt-1 text-lg font-semibold">Add your gear</div>
              </div>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-muted">
                {ownedEquipment.length} saved
              </span>
            </div>

            <form className="mt-4 space-y-3" onSubmit={handleSubmitEquipment}>
              <Input
                label="Equipment name"
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
                {submitting ? 'Submitting…' : 'Submit equipment'}
              </Button>
            </form>

          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-widest text-muted">Weapons</div>
                <div className="mt-1 text-lg font-semibold">Add your weapon</div>
              </div>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-muted">
                {ownedWeapons.length} saved
              </span>
            </div>

            <form className="mt-4 space-y-3" onSubmit={handleSubmitWeapon}>
              <Input
                label="Weapon name"
                value={weaponForm.name}
                onChange={(event) => setWeaponForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="e.g. AK Replica"
              />
              <label className="block">
                <div className="mb-2 text-sm font-semibold text-text">Category</div>
                <select
                  value={weaponForm.category}
                  onChange={(event) => setWeaponForm((current) => ({ ...current, category: event.target.value }))}
                  className="w-full rounded-xl bg-background border border-white/10 px-4 py-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/40 [&>option]:bg-background [&>option]:text-text"
                >
                  <option value="rifles">Rifles</option>
                  <option value="gel_blasters">Gel blasters</option>
                  <option value="pistols">Pistols</option>
                  <option value="snipers">Snipers</option>
                  <option value="mg">MG</option>
                  <option value="shotguns">Shotguns</option>
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

          </Card>
          </div>
        </>
      ) : null}
    </div>
  )
}
