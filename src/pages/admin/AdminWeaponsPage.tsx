import React from 'react'
import { confirmDialog, promptDialog } from '../../components/ui/ConfirmDialog'
import { FiAlertTriangle, FiCheck, FiCrosshair, FiEdit2, FiPlus, FiTool, FiTrash2 } from 'react-icons/fi'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import toast from 'react-hot-toast'
import { ActionGroup, Button } from '../../components/ui/Button'
import { FilterTabs } from '../../components/ui/FilterTabs'
import { BRANCHES, branchLabel } from '../../utils/branches'
import { Card } from '../../components/ui/Card'
import { Modal } from '../../components/ui/Modal'
import { apiGet, apiGetAll, apiPost, apiPut, apiDelete } from '../../utils/apiClient'
import { Pagination, usePagination } from '../../components/ui/Pagination'
import { BulkUpdateModal, InventoryToolbar, SelectBox, forEachPiece, type BulkChange } from '../../components/inventory/BulkActionBar'
import { modelOf } from '../../utils/inventoryModels'
import { SafetyLogPage } from '../marshal/SafetyLogPage'
import { RepairsPage } from '../operations/RepairsPage'
import { Input } from '../../components/ui/Input'

// "Today", "Yesterday" or "Nov 3" for a chronograph reading.
function fpsWhen(iso: string) {
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(d)
  const tested = day(new Date(iso))
  if (tested === day(new Date())) return 'today'
  if (tested === day(new Date(Date.now() - 86_400_000))) return 'yesterday'
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' })
}

type WeaponCategory = 'rifles' | 'gel_blasters' | 'pistols' | 'snipers' | 'mg' | 'shotguns' | 'grenades' | 'photoshoot'

type WeaponStatus = 'available' | 'rented' | 'needs-check'

type WeaponItem = {
  partnerId?: string
  // The branch that keeps and rents out this piece; blank = not assigned yet.
  locationId?: string
  fpsClass?: string
  fpsLimit?: number
  id: string
  _id?: any
  name: string
  category: WeaponCategory
  status: WeaponStatus
  note: string
  description?: string
  price: number
  replacementValue?: number
  model: string
  unitNumber: number
  createdAtISO?: string
  submittedBy?: string
  source?: 'business' | 'player'
  approvalStatus?: 'pending' | 'approved' | 'rejected'
  rejectionReason?: string
  // Why the piece is flagged (set by a damage report, a repair, or a hand flag).
  maintenanceReason?: string
}

// Mirrors the center's rental inventory: rifles, gel blasters, pistols, snipers, a machine
// gun, a shotgun, single-use grenades/bombs, and privately owned photoshoot rifles.
const categoryOptions: { key: WeaponCategory; label: string; subtitle: string }[] = [
  { key: 'rifles', label: 'Rifles', subtitle: 'Standard long-range platforms for regular bookings' },
  { key: 'gel_blasters', label: 'Gel blasters', subtitle: 'Gel-ball blasters for casual and younger players' },
  { key: 'pistols', label: 'Pistols', subtitle: 'Sidearms and compact builds for quick turns' },
  { key: 'snipers', label: 'Snipers', subtitle: 'Precision class weapons with heavier upkeep' },
  { key: 'mg', label: 'Machine guns', subtitle: 'Support weapons with limited stock and stricter control' },
  { key: 'shotguns', label: 'Shotguns', subtitle: 'Close-quarters spread style gear' },
  { key: 'grenades', label: 'Grenades / bombs', subtitle: 'Single-use pyrotechnics; stock is used up, not returned' },
  { key: 'photoshoot', label: 'Photoshoot rifles', subtitle: 'Privately owned display rifles for photoshoots' },
]

const categoryLabel = (key: string) => categoryOptions.find((option) => option.key === key)?.label || key

// What's wrong with a flagged piece: its open damage / loss report, or its open repair, or the
// reason it was flagged by hand.
type DamageInfo = {
  description: string
  reportId?: string
  repairId?: string
  repairStatus?: string
  gunsmith?: string
  playerName?: string
  reservationId?: string
  reportedAtISO?: string
  reportedBy?: string
  evidenceUrl?: string
  kind?: 'damage' | 'loss'
}

function formatWhen(iso?: string) {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })
}

function DamageDetails({ info, compact = false }: { info: DamageInfo; compact?: boolean }) {
  const repairState = info.repairStatus === 'in_progress' ? ' (in progress)' : info.repairStatus ? ` (${info.repairStatus.replace(/_/g, ' ')})` : ''
  const facts = [
    info.reportId ? `Report ${info.reportId}` : '',
    info.repairId ? `Repair ${info.repairId}${repairState}` : '',
    info.gunsmith ? `Gunsmith: ${info.gunsmith}` : '',
    info.playerName ? `Player: ${info.playerName}` : '',
    info.reservationId ? `Booking ${info.reservationId}` : '',
    info.reportedBy ? `Reported by ${info.reportedBy}` : '',
    formatWhen(info.reportedAtISO),
  ].filter(Boolean)
  const label = info.kind === 'loss' ? 'Reported lost' : 'Damage'
  return (
    <div className={compact ? 'mt-1' : 'rounded-xl border border-danger/30 bg-danger/10 p-3'}>
      {!compact ? <div className="text-[11px] font-semibold uppercase tracking-widest text-danger">{label}</div> : null}
      <div className={compact ? 'text-xs text-text' : 'mt-1 text-sm text-text'}>
        {compact ? <span className="font-semibold text-danger">{label}: </span> : null}
        {info.description}
      </div>
      {facts.length ? <div className="mt-1 text-[11px] text-muted">{facts.join(' · ')}</div> : null}
      {info.evidenceUrl ? (
        <a href={info.evidenceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[11px] font-semibold text-accent underline">View photo</a>
      ) : null}
    </div>
  )
}

// The center's weapons in one table: a row per model, a column per field (plus pieces not assigned
// to a field, when there are any) with "available / total", the total across fields, and the price.
// Follows the Category and Branch filters. Player-owned guns aren't the center's inventory.
function WeaponInventoryTable({ weapons, category, branch }: { weapons: WeaponItem[]; category: WeaponCategory | 'all'; branch: string }) {
  const known = new Set<string>(BRANCHES.map((entry) => entry.id))
  const fieldOf = (weapon: WeaponItem) => (known.has(String(weapon.locationId || '')) ? String(weapon.locationId) : 'none')
  const own = weapons.filter((weapon) => weapon.source !== 'player' && (category === 'all' || weapon.category === category))
  if (own.length === 0) return null
  const hasUnassigned = own.some((weapon) => fieldOf(weapon) === 'none')
  const allColumns = [
    ...BRANCHES.map((entry) => ({ id: entry.id as string, label: entry.label as string })),
    ...(hasUnassigned ? [{ id: 'none', label: 'Unassigned' }] : []),
  ]
  // One field picked: just its column. All branches: every field plus the total.
  const columns = branch === 'all' ? allColumns : allColumns.filter((column) => column.id === branch)
  const showTotal = branch === 'all'
  const groups = new Map<string, WeaponItem[]>()
  for (const weapon of own) {
    const model = modelOf(weapon)
    groups.set(model, [...(groups.get(model) || []), weapon])
  }
  const rows = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
  const cell = (items: WeaponItem[]) => {
    const total = items.length
    if (total === 0) return <span className="text-muted">—</span>
    const available = items.filter((weapon) => weapon.status === 'available').length
    const tone = available === 0 ? 'text-danger' : available < total ? 'text-warning' : 'text-success'
    return <span><span className={`font-semibold ${tone}`}>{available}</span><span className="text-muted"> / {total}</span></span>
  }
  return (
    <div className="mt-4 overflow-x-auto rounded-2xl border border-white/5">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="bg-white/5 text-left text-[11px] uppercase tracking-widest text-muted">
          <tr>
            <th className="px-3 py-2 font-semibold">Model</th>
            {columns.map((column) => <th key={column.id} className="px-3 py-2 text-right font-semibold">{column.label}</th>)}
            {showTotal ? <th className="px-3 py-2 text-right font-semibold">All fields</th> : null}
            <th className="px-3 py-2 text-right font-semibold">Price</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map(([model, items]) => (
            <tr key={model}>
              <td className="px-3 py-2">
                <div className="font-semibold">{model}</div>
                <div className="text-[11px] text-muted">{categoryLabel(items[0].category)}</div>
              </td>
              {columns.map((column) => <td key={column.id} className="px-3 py-2 text-right">{cell(items.filter((weapon) => fieldOf(weapon) === column.id))}</td>)}
              {showTotal ? <td className="px-3 py-2 text-right">{cell(items)}</td> : null}
              <td className="whitespace-nowrap px-3 py-2 text-right text-muted">₱{Number(items[0].price || 0).toLocaleString()} each</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-white/5 px-3 py-2 text-[11px] text-muted">Available / total pieces at each field.</div>
    </div>
  )
}

// A label only: a piece becomes "rented" when it is checked out at Rentals, and "needs check"
// through Flag. Clicking it used to flip available/rented, which bypassed the rental records.
const STATUS_LABELS: Record<WeaponStatus, string> = { available: 'Available', rented: 'Rented', 'needs-check': 'Needs check' }
const StatusBadge = ({ status }: { status: WeaponStatus }) => {
  const cls =
    status === 'available'
      ? 'bg-success/20 text-success border-success/30'
      : status === 'rented'
        ? 'bg-accent/20 text-accent border-accent/30'
        : 'bg-danger/20 text-danger border-danger/30'

  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-semibold ${cls}`}>
      {STATUS_LABELS[status] || status}
    </span>
  )
}

// Standard rental prices: a rifle is ₱500 (it comes with 2 magazines / 600 BBs). Picking the
// category fills in the price; the admin can still change it.
const DEFAULT_CATEGORY_PRICES: Partial<Record<WeaponCategory, number>> = { rifles: 500 }

const emptyForm = () => ({ name: '', description: '', category: 'rifles' as WeaponCategory, status: 'available' as WeaponStatus, price: String(DEFAULT_CATEGORY_PRICES.rifles), replacementValue: '', pieces: '1', applyToModel: true, partnerId: '', locationId: '', fpsClass: '', fpsLimit: '' })

// Blank class follows the category (snipers are sniper class); blank limit uses the class default.
function fpsFields(form: { fpsClass: string; fpsLimit: string }) {
  return { fpsClass: form.fpsClass, fpsLimit: Number(form.fpsLimit) > 0 ? Number(form.fpsLimit) : 0 }
}

function WeaponInventory() {
  const [category, setCategory] = React.useState<WeaponCategory | 'all'>('all')
  const [status, setStatus] = React.useState<WeaponStatus | 'all'>('all')
  const [branchFilter, setBranchFilter] = React.useState<string>('all')
  const [weapons, setWeapons] = React.useState<WeaponItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [form, setForm] = React.useState(emptyForm())
  const [selectedWeaponId, setSelectedWeaponId] = React.useState<string | null>(null)
  // The add/edit form opens in a pop-up.
  const [formOpen, setFormOpen] = React.useState(false)
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

  const [damageReports, setDamageReports] = React.useState<any[]>([])
  const [repairs, setRepairs] = React.useState<any[]>([])
  const refresh = React.useCallback(async () => {
    setLoading(true)
    try {
      // Players' own weapons aren't center inventory: they're only noted on the player's profile
      // and picked when booking, so they're left out here.
      const docs = (await apiGetAll<any>('weapons')).filter((d: any) => !(d.source === 'player' || (!d.source && d.submittedBy)))
      const normalized = docs.map((d: any) => ({
        id: d.id ?? (d._id ? String(d._id) : undefined),
        _id: d._id,
        name: d.name || 'Unnamed weapon',
        category: (d.category || 'rifles') as WeaponCategory,
        status: (d.status || 'available') as WeaponStatus,
        note: d.note || d.description || '',
        description: d.description || d.note || '',
        price: typeof d.price === 'number' ? d.price : 0,
        replacementValue: Number(d.replacementValue) || 0,
        model: modelOf(d),
        unitNumber: Number(d.unitNumber) || 0,
        createdAtISO: d.createdAtISO || null,
        submittedBy: d.submittedBy,
        source: 'business' as const,
        partnerId: d.partnerId || '',
        locationId: d.locationId || '',
        fpsClass: d.fpsClass || '',
        fpsLimit: Number(d.fpsLimit) || 0,
        maintenanceReason: d.maintenanceReason || '',
      }))
      setWeapons(normalized)
      // Damage reports and repairs, so a flagged piece shows what's wrong with it.
      const [reportsRes, repairsRes] = await Promise.all([
        apiGet<{ data: any[] }>('/api/damage-reports?limit=500').catch(() => ({ data: [] as any[] })),
        apiGet<{ data: any[] }>('/api/repairs').catch(() => ({ data: [] as any[] })),
      ])
      setDamageReports(Array.isArray(reportsRes?.data) ? reportsRes.data : [])
      setRepairs(Array.isArray(repairsRes?.data) ? repairsRes.data : [])
    } catch (e: any) {
      toast.error(String(e?.message || e))
      setWeapons([])
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { refresh() }, [refresh])

  // The latest chronograph reading per weapon, shown on its row, and the FPS check pop-up.
  const [lastFps, setLastFps] = React.useState<Map<string, { fps: number; limit: number; result: string; testedAtISO: string }>>(new Map())
  const loadFps = React.useCallback(() => {
    apiGet<{ data: Array<{ weaponId: string; fps: number; limit: number; result: string; testedAtISO: string }> }>('/api/fps-logs?limit=500')
      .then((res) => {
        const latest = new Map<string, { fps: number; limit: number; result: string; testedAtISO: string }>()
        for (const log of res.data || []) if (log.weaponId && !latest.has(log.weaponId)) latest.set(log.weaponId, log)
        setLastFps(latest)
      })
      .catch(() => null)
  }, [])
  React.useEffect(() => { loadFps() }, [loadFps])
  const [fpsFor, setFpsFor] = React.useState<WeaponItem | null>(null)
  const [fpsReading, setFpsReading] = React.useState('')
  const [fpsNotes, setFpsNotes] = React.useState('')
  const [fpsSaving, setFpsSaving] = React.useState(false)
  const saveFps = async () => {
    if (!fpsFor) return
    const fps = Number(fpsReading)
    if (!Number.isFinite(fps) || fps <= 0) return toast.error('Enter the chronograph reading in FPS.')
    setFpsSaving(true)
    try {
      const res = await apiPost<{ data: { result: string; limit: number }; weaponPulled?: boolean }>('/api/fps-logs', { weaponId: fpsFor.id, fps, notes: fpsNotes })
      if (res.data.result === 'pass') toast.success(`${fpsFor.name}: ${fps} FPS, passed (limit ${res.data.limit}).`)
      else toast.error(`${fpsFor.name}: ${fps} FPS is over the ${res.data.limit} limit.${res.weaponPulled ? ' Pulled from rentals for repair.' : ''}`)
      setFpsFor(null)
      setFpsNotes('')
      loadFps()
      await refresh()
    } catch (e: any) {
      toast.error(String(e?.message || e))
    } finally {
      setFpsSaving(false)
    }
  }

  const [search, setSearch] = React.useState('')
  // Filters run over every weapon first, then the result is paged 10 at a time.
  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase()
    return weapons.filter((weapon) => {
      const matchCategory = category === 'all' ? true : weapon.category === category
      const matchStatus = status === 'all' ? true : weapon.status === status
      const matchBranch = branchFilter === 'all' || (weapon.locationId || 'none') === branchFilter
      const matchSearch = !term || [weapon.id, weapon.name, weapon.model, weapon.description]
        .some((value) => String(value || '').toLowerCase().includes(term))
      return matchCategory && matchStatus && matchBranch && matchSearch
    })
      // Ascending by ID; numbers inside IDs compare by value (W-2 before W-10).
      .sort((a, b) => String(a.id || '').localeCompare(String(b.id || ''), undefined, { numeric: true, sensitivity: 'base' }))
  }, [weapons, category, status, branchFilter, search])
  const { page, setPage, pageCount, pageItems, total } = usePagination(filtered, undefined, `${category}|${status}|${branchFilter}|${search}`)

  const activeCategoryMeta = category === 'all' ? null : categoryOptions.find((item) => item.key === category)
  const maintenanceQueue = weapons.filter((weapon) => weapon.status === 'needs-check')
  // The newest report and repair for a piece (both lists come newest first).
  const damageOf = (weapon: WeaponItem): DamageInfo | null => {
    const id = String(weapon.id)
    const actor = (by: any) => (by ? [by.role ? String(by.role).charAt(0).toUpperCase() + String(by.role).slice(1) : '', by.name || by.email || ''].filter(Boolean).join(' ') : '')
    const report = damageReports.find((item) => String(item.itemId || '') === id)
    const repair = (report?.repairId ? repairs.find((item) => item.id === report.repairId) : undefined)
      || repairs.find((item) => String(item.itemId || '') === id)
    if (report) {
      return {
        description: String(report.description || 'No details given.'),
        kind: report.kind === 'loss' ? 'loss' : 'damage',
        reportId: report.id,
        repairId: report.repairId || repair?.id,
        repairStatus: repair?.status,
        gunsmith: repair?.gunsmith,
        playerName: report.playerName,
        reservationId: report.reservationId,
        reportedAtISO: report.reportedAtISO,
        reportedBy: actor(report.reportedBy),
        evidenceUrl: report.evidenceUrl,
      }
    }
    if (repair) {
      return {
        description: String(repair.damage || 'No details given.'),
        repairId: repair.id,
        repairStatus: repair.status,
        gunsmith: repair.gunsmith,
        reservationId: repair.reservationId,
        reportedAtISO: repair.openedAtISO,
        reportedBy: actor(repair.openedBy),
      }
    }
    if (weapon.maintenanceReason) return { description: weapon.maintenanceReason }
    return null
  }
  const maintenanceCount = maintenanceQueue.length


  // Each physical weapon is its own record: adding 20 creates 20 pieces with their own IDs.
  const addWeapon = async () => {
    if (!form.name.trim()) {
      toast.error('Weapon name is required')
      return
    }
    const count = Number(form.pieces)
    if (!Number.isInteger(count) || count < 1 || count > 200) {
      toast.error('Add between 1 and 200 pieces at a time.')
      return
    }

    setSaving(true)
    try {
      const res = await apiPost<{ ok: boolean; data: Array<{ id: string }> }>('/api/inventory/weapons/pieces', {
        model: form.name.trim(),
        count,
        category: form.category,
        status: form.status,
        price: Number(form.price) || 0,
        replacementValue: Number(form.replacementValue) || 0, 
        description: form.description.trim(),
        note: form.description.trim() || 'Added through the admin inventory review.',
        partnerId: form.partnerId,
        locationId: form.locationId,
        ...fpsFields(form),
      })
      const ids = res.data.map((piece) => piece.id)
      toast.success(count === 1 ? `Added ${ids[0]}` : `Added ${count} pieces (${ids[0]} – ${ids[ids.length - 1]})`)
      setForm(emptyForm())
      setFormOpen(false)
      await refresh()
    } catch (e: any) {
      toast.error(String(e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  const handleSelect = (weapon: WeaponItem) => {
    setSelectedWeaponId(weapon.id)
    setFormOpen(true)
    setForm({
      name: weapon.name,
      description: weapon.description || weapon.note || '',
      category: weapon.category,
      status: weapon.status,
      price: String(weapon.price),
      replacementValue: weapon.replacementValue ? String(weapon.replacementValue) : '',
      pieces: '1',
      applyToModel: true,
      partnerId: weapon.partnerId || '',
      locationId: weapon.locationId || '',
      fpsClass: weapon.fpsClass || '',
      fpsLimit: weapon.fpsLimit ? String(weapon.fpsLimit) : '',
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

    const piece = weapons.find((w) => w.id === selectedWeaponId)
    setSaving(true)
    try {
      // Status and notes belong to this one piece.
      await apiPut<any>(`/api/weapons/${encodeURIComponent(selectedWeaponId)}`, {
        status: form.status,
        // The branch belongs to this one piece.
        locationId: form.locationId,
        description: form.description.trim(),
        note: form.description.trim() || 'Updated from admin inventory.',
        ...(form.applyToModel ? {} : { price: Number(form.price) || 0, replacementValue: Number(form.replacementValue) || 0, category: form.category, partnerId: form.partnerId, ...fpsFields(form) }),
        updatedAtISO: new Date().toISOString(),
      })
      // Price, category, owner, and FPS rules are shared by every piece of the model.
      if (form.applyToModel && piece) {
        await apiPut<any>('/api/inventory/weapons/models', {
          model: piece.model,
          price: Number(form.price) || 0,
          replacementValue: Number(form.replacementValue) || 0, 
          category: form.category,
          partnerId: form.partnerId,
          ...fpsFields(form),
        })
      }
      toast.success(form.applyToModel && piece ? `Updated ${piece.name} and all ${piece.model} pieces` : 'Weapon updated')
      setSelectedWeaponId(null)
      setForm(emptyForm())
      setFormOpen(false)
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
    // Flagging asks what's wrong, so whoever checks the piece knows what to look at.
    let reason = ''
    if (newStatus === 'needs-check') {
      reason = (await promptDialog({ title: `What's wrong with ${weapon.name}?`, label: 'Damage or problem', placeholder: 'e.g. Hop-up not working, cracked stock', confirmLabel: 'Flag', required: true, multiline: true })) || ''
      if (!reason) return
    }
    try {
      await apiPut<any>(`/api/weapons/${encodeURIComponent(id)}`, {
        status: newStatus,
        maintenanceReason: newStatus === 'needs-check' ? reason : '',
        updatedAtISO: new Date().toISOString(),
      })
      await refresh()
    } catch (e: any) {
      toast.error(String(e?.message || e))
    }
  }

  const handleRemove = async (id: string) => {
    const name = weapons.find((weapon) => weapon.id === id)?.name || id
    if (!(await confirmDialog({ title: `Remove "${name}"?`, message: 'It will be removed from the weapon list. This cannot be undone.', confirmLabel: 'Remove', danger: true }))) return
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


  // Bulk selection: tick rows (or every row matching the filters) and change them together.
  const [selectedIds, setSelectedIds] = React.useState<string[]>([])
  const [bulkBusy, setBulkBusy] = React.useState(false)
  // Tick boxes appear only after "Select items"; "Update" opens the bulk changes pop-up.
  const [selecting, setSelecting] = React.useState(false)
  const [bulkOpen, setBulkOpen] = React.useState(false)
  React.useEffect(() => setSelectedIds([]), [category, status, branchFilter, search])
  const stopSelecting = () => {
    setSelecting(false)
    setSelectedIds([])
    setBulkOpen(false)
  }
  const allFilteredSelected = filtered.length > 0 && filtered.every((weapon) => selectedIds.includes(weapon.id))
  const toggleSelected = (id: string) =>
    setSelectedIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]))
  const toggleAll = () => setSelectedIds(allFilteredSelected ? [] : filtered.map((weapon) => weapon.id))

  const applyBulk = async (change: BulkChange) => {
    setBulkBusy(true)
    const failed = await forEachPiece(selectedIds, (id) =>
      apiPut(`/api/weapons/${encodeURIComponent(id)}`, { ...change, updatedAtISO: new Date().toISOString() }))
    setBulkBusy(false)
    if (failed) toast.error(`${failed} of ${selectedIds.length} weapons could not be updated.`)
    else toast.success(`Updated ${selectedIds.length} weapon${selectedIds.length === 1 ? '' : 's'}.`)
    stopSelecting()
    await refresh()
  }

  const removeBulk = async () => {
    if (!(await confirmDialog({ title: `Remove ${selectedIds.length} weapon${selectedIds.length === 1 ? '' : 's'}?`, message: 'They will be removed from the weapon list. This cannot be undone.', confirmLabel: 'Remove', danger: true }))) return
    setBulkBusy(true)
    const failed = await forEachPiece(selectedIds, (id) => apiDelete(`/api/weapons/${encodeURIComponent(id)}`))
    setBulkBusy(false)
    if (failed) toast.error(`${failed} of ${selectedIds.length} weapons could not be removed.`)
    else toast.success(`Removed ${selectedIds.length} weapon${selectedIds.length === 1 ? '' : 's'}.`)
    stopSelecting()
    await refresh()
  }

  const resetForm = () => {
    setSelectedWeaponId(null)
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

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <Card className="rounded-xl px-3 py-2 md:px-3 md:py-2">
          <div className="truncate text-[10px] uppercase tracking-wider text-muted">Weapons in catalog</div>
          <div className="mt-0.5 text-base font-bold text-success">{weapons.length}</div>
        </Card>
        <Card className="rounded-xl px-3 py-2 md:px-3 md:py-2">
          <div className="truncate text-[10px] uppercase tracking-wider text-muted">Currently rented</div>
          <div className="mt-0.5 text-base font-bold text-warning">{weapons.filter((weapon) => weapon.status === 'rented').length}</div>
        </Card>
        {/* Clicking it filters the list below to just these weapons. */}
        <button
          type="button"
          onClick={() => {
            setCategory('all')
            setSearch('')
            setStatus(status === 'needs-check' ? 'all' : 'needs-check')
          }}
          aria-pressed={status === 'needs-check'}
          className={[
            'rounded-xl border px-3 py-2 text-left transition',
            status === 'needs-check' ? 'border-danger/50 bg-danger/10' : 'border-white/10 bg-white/5 hover:bg-white/10',
          ].join(' ')}
        >
          <div className="truncate text-[10px] uppercase tracking-wider text-muted">Needs check{status === 'needs-check' ? ' · showing' : ''}</div>
          <div className="mt-0.5 text-base font-bold text-danger">{maintenanceCount}</div>
        </button>
      </div>

      {/* Weapons waiting for a marshal, at the top so they're found first. Clear one after
          inspecting it, or open it to note what's wrong. */}
      {maintenanceQueue.length > 0 ? (
        <Card className="border-danger/30 p-4">
          <div className="flex items-center gap-2 text-sm font-bold">
            <FiAlertTriangle className="text-danger" /> Needs check before play ({maintenanceQueue.length})
          </div>
          <p className="mt-1 text-xs text-muted">Inspect each one, then mark it OK to put it back in the rental pool.</p>
          <ul className="mt-3 divide-y divide-white/5">
            {maintenanceQueue.map((weapon) => (
              <li key={weapon.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{weapon.name}</div>
                  <div className="text-xs text-muted">{weapon.id}{weapon.locationId ? ` · ${branchLabel(weapon.locationId)}` : ''}</div>
                  {(() => {
                    const info = damageOf(weapon)
                    return info ? <DamageDetails info={info} compact /> : <div className="mt-1 text-xs text-muted">No reason was given when it was flagged.</div>
                  })()}
                </div>
                <div className="flex flex-none gap-2">
                  <Button size="sm" variant="ghost" onClick={() => handleSelect(weapon)}><FiEdit2 /> Details</Button>
                  <Button size="sm" onClick={() => void handleToggleFlag(weapon.id)}><FiCheck /> Checked, OK</Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button size="sm" onClick={openAddForm}>
          <FiPlus /> Add weapon
        </Button>
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted">{category === 'all' ? 'All categories' : categoryLabel(category).toUpperCase()}</div>
            <div className="mt-2 text-sm text-muted">{activeCategoryMeta?.subtitle || 'All weapon categories'}</div>
          </div>
        </div>

        {/* Each model's pieces per field, with the price. */}
        <WeaponInventoryTable weapons={weapons} category={category} branch={branchFilter} />

        {/* Filters and the select/update/add toolbar sit right above the list they act on, after the model summary. */}
        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">Search</div>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="ID, name, model"
                className="w-full sm:min-w-[200px] rounded-full border border-white/10 bg-background px-4 py-2 text-sm text-text outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">Category</div>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value as WeaponCategory | 'all')}
                className="w-full sm:w-auto sm:min-w-[170px] rounded-full border border-white/10 bg-background px-3 py-2 text-sm text-text outline-none"
              >
                <option value="all">All categories</option>
                {categoryOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">Status</div>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as WeaponStatus | 'all')}
                className="w-full sm:w-auto sm:min-w-[170px] rounded-full border border-white/10 bg-background px-3 py-2 text-sm text-text outline-none"
              >
                <option value="all">All statuses</option>
                <option value="available">Available</option>
                <option value="rented">Rented</option>
                <option value="needs-check">Needs check</option>
              </select>
            </div>

            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">Branch</div>
              <select
                value={branchFilter}
                onChange={(event) => setBranchFilter(event.target.value)}
                className="w-full sm:w-auto sm:min-w-[170px] rounded-full border border-white/10 bg-background px-3 py-2 text-sm text-text outline-none"
              >
                <option value="all">All branches</option>
                {BRANCHES.map((branch) => <option key={branch.id} value={branch.id}>{branch.label}</option>)}
                <option value="none">Unassigned</option>
              </select>
            </div>
          </div>
          <InventoryToolbar
            selecting={selecting}
            selectedCount={selectedIds.length}
            allSelected={allFilteredSelected}
            onStartSelecting={() => setSelecting(true)}
            onToggleAll={toggleAll}
            onCancel={stopSelecting}
            onUpdate={() => setBulkOpen(true)}
          />
        </div>

        {bulkOpen ? (
          <BulkUpdateModal
            count={selectedIds.length}
            noun={selectedIds.length === 1 ? 'weapon' : 'weapons'}
            statuses={(Object.keys(STATUS_LABELS) as WeaponStatus[]).map((value) => ({ value, label: STATUS_LABELS[value] }))}
            categories={categoryOptions.map((option) => ({ value: option.key, label: option.label }))}
            busy={bulkBusy}
            onApply={applyBulk}
            onRemove={removeBulk}
            onClose={() => setBulkOpen(false)}
          />
        ) : null}

        <div className="mt-4 overflow-x-auto rounded-2xl border border-white/5">
          <div className="md:min-w-[920px]">
            <div className="stack-head grid grid-cols-12 gap-3 bg-white/5 px-3 py-2 text-xs uppercase tracking-widest text-muted">
              <div className="col-span-2">ID</div>
              <div className="col-span-3">Weapon</div>
              <div className="col-span-1 text-right">Piece</div>
              <div className="col-span-1 text-right">Price</div>
              <div className="col-span-2 pl-4">Status</div>
              <div className="col-span-3 text-right">Actions</div>
            </div>

            <div className="divide-y divide-white/5">
            {loading ? (
              <div className="p-6 text-sm text-muted">Loading weapons...</div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-sm text-muted">No weapons match this filter.</div>
            ) : (
              pageItems.map((weapon) => (
                <div key={weapon.id} className={"stack-row grid grid-cols-12 items-center gap-3 px-3 py-3 " + (selectedWeaponId === weapon.id ? 'bg-white/6 ring-2 ring-white/10' : '')}>
                  <div data-label="ID" className="col-span-2 flex items-center gap-2 text-sm font-semibold">
                    {selecting ? <SelectBox checked={selectedIds.includes(weapon.id)} onChange={() => toggleSelected(weapon.id)} label={`Select ${weapon.id}`} /> : null}
                    {weapon.id}
                  </div>
                  <div data-label="Weapon" className="stack-wide col-span-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold">{weapon.name}</div>
                      <span className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.15em] ${weapon.locationId ? 'border-white/10 bg-white/5 text-muted' : 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'}`}>
                        {branchLabel(weapon.locationId)}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted">{weapon.description || weapon.note}</div>
                  </div>
                  <div data-label="Piece" className="col-span-1 text-right text-sm font-semibold">{!weapon.unitNumber ? '—' : `#${weapon.unitNumber}`}</div>
                  <div data-label="Price" className="col-span-1 text-right text-sm font-semibold text-muted">₱{weapon.price.toLocaleString()}</div>
                  <div data-label="Status" className="col-span-2 pl-4">
                    <StatusBadge status={weapon.status} />
                    {/* The last chronograph reading for this gun. */}
                    {lastFps.get(weapon.id) ? (() => {
                      const log = lastFps.get(weapon.id)!
                      return (
                        <div className={`mt-1 text-[11px] ${log.result === 'pass' ? 'text-success' : 'text-danger'}`} title={`Tested ${new Date(log.testedAtISO).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}`}>
                          {log.result === 'pass' ? '✓' : '✗'} {log.fps} FPS · {fpsWhen(log.testedAtISO)}
                        </div>
                      )
                    })() : <div className="mt-1 text-[11px] text-muted">No FPS reading</div>}
                  </div>
                  <div className="stack-wide col-span-3">
                    <ActionGroup>
                      <Button size="xs" variant="ghost" onClick={(e) => { e.stopPropagation(); setFpsFor(weapon); setFpsReading('') }}>
                        <FiCrosshair /> FPS
                      </Button>
                      <Button size="xs" variant="ghost" onClick={(e) => { e.stopPropagation(); handleSelect(weapon) }}>
                        <FiEdit2 /> Edit
                      </Button>
                      <Button size="xs" variant={weapon.status === 'needs-check' ? 'ghost' : 'accent-soft'} onClick={(e) => { e.stopPropagation(); handleToggleFlag(weapon.id) }}>
                        {weapon.status === 'needs-check' ? 'Unflag' : 'Flag'}
                      </Button>
                      <Button size="xs" variant="danger-soft" onClick={(e) => { e.stopPropagation(); handleRemove(weapon.id) }}>
                        <FiTrash2 /> Remove
                      </Button>
                    </ActionGroup>
                  </div>
                </div>
              ))
            )}
            </div>
          </div>
        </div>
        <Pagination page={page} pageCount={pageCount} total={total} onPageChange={setPage} />

      </Card>
      {fpsFor ? (
        <Modal eyebrow="FPS check" title={`${fpsFor.name}${fpsFor.unitNumber && !fpsFor.name.includes('#') ? ` #${fpsFor.unitNumber}` : ''}`} onClose={() => setFpsFor(null)}>
          <div className="text-sm text-muted">
            {fpsFor.id} · limit {fpsFor.fpsLimit || (String(fpsFor.fpsClass || fpsFor.category).startsWith('sniper') ? 550 : 450)} FPS.
            {lastFps.get(fpsFor.id) ? ` Last reading ${lastFps.get(fpsFor.id)!.fps} FPS (${fpsWhen(lastFps.get(fpsFor.id)!.testedAtISO)}).` : ' No readings yet.'}
          </div>
          <div className="mt-4 grid gap-3">
            <Input label="Reading (FPS)" type="number" min="1" value={fpsReading} onChange={(e) => setFpsReading(e.target.value)} autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void saveFps() } }} />
            <Input label="Notes (optional)" value={fpsNotes} onChange={(e) => setFpsNotes(e.target.value)} />
            <p className="text-xs text-muted">A center gun that reads over its limit is pulled from rentals for repair automatically.</p>
            <Button disabled={fpsSaving || !fpsReading} onClick={() => void saveFps()}>{fpsSaving ? 'Saving…' : 'Save reading'}</Button>
          </div>
        </Modal>
      ) : null}
      {formOpen ? (
        <Modal eyebrow="Weapons" title={selectedWeaponId ? `Edit ${selectedWeaponId}` : 'Add weapons'} onClose={closeForm}>
          <div className="text-sm text-muted">
            {selectedWeaponId ? 'Update this piece, or every piece of the same model.' : 'Every physical weapon is its own piece with its own ID.'}
          </div>
          {(() => {
            const piece = selectedWeaponId ? weapons.find((w) => w.id === selectedWeaponId) : null
            const info = piece && piece.status === 'needs-check' ? damageOf(piece) : null
            return info ? <div className="mt-3"><DamageDetails info={info} /></div> : null
          })()}
          <div className="mt-4 grid gap-3">
            <label className="block">
              <div className="mb-2 text-sm font-semibold text-text">Weapon name</div>
              <input
                ref={nameRef}
                value={form.name}
                readOnly={Boolean(selectedWeaponId)}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                className="w-full rounded-xl border border-white/10 bg-transparent px-4 py-3 text-sm text-text placeholder:text-muted read-only:opacity-70"
                placeholder="e.g. M4 Rifle"
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
              <div className="mb-2 text-sm font-semibold text-text">Replacement value (₱)</div>
              <input
                type="number"
                min="0"
                value={form.replacementValue}
                onChange={(event) => setForm((prev) => ({ ...prev, replacementValue: event.target.value }))}
                placeholder="What it costs to replace if lost"
                className="w-full rounded-xl border border-white/10 bg-transparent px-4 py-3 text-sm text-text placeholder:text-muted"
              />
            </label>

            {selectedWeaponId ? (
              <label className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm">
                <input
                  type="checkbox"
                  checked={form.applyToModel}
                  onChange={(event) => setForm((prev) => ({ ...prev, applyToModel: event.target.checked }))}
                  className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
                />
                <span>
                  Apply price, category, owner, and FPS settings to every {weapons.find((w) => w.id === selectedWeaponId)?.model || 'matching'} piece
                  <span className="block text-xs text-muted">Status and notes always change only this piece.</span>
                </span>
              </label>
            ) : (
              <label className="block">
                <div className="mb-2 text-sm font-semibold text-text">Pieces to add</div>
                <input
                  type="number"
                  min="1"
                  max="200"
                  step="1"
                  value={form.pieces}
                  onChange={(event) => setForm((prev) => ({ ...prev, pieces: event.target.value }))}
                  className="w-full rounded-xl border border-white/10 bg-transparent px-4 py-3 text-sm text-text placeholder:text-muted"
                />
                <div className="mt-1 text-xs text-muted">Each piece gets its own ID and number (e.g. M4 Rifle #1, #2, …) so players can pick a specific one.</div>
              </label>
            )}

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
                  onChange={(event) => {
                    const nextCategory = event.target.value as WeaponCategory
                    const defaultPrice = DEFAULT_CATEGORY_PRICES[nextCategory]
                    setForm((prev) => ({
                      ...prev,
                      category: nextCategory,
                      ...(defaultPrice !== undefined ? { price: String(defaultPrice) } : {}),
                    }))
                  }}
                  className="w-full rounded-xl border border-white/10 glass px-4 py-3 text-sm text-text"
                >
                  {categoryOptions.map((option) => (
                    <option key={option.key} value={option.key}>{option.label}</option>
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

            <label className="block">
              <div className="mb-2 text-sm font-semibold text-text">Branch</div>
              <select
                value={form.locationId}
                onChange={(event) => setForm((prev) => ({ ...prev, locationId: event.target.value }))}
                className="w-full rounded-xl border border-white/10 glass px-4 py-3 text-sm text-text"
              >
                <option value="">Unassigned (any branch can rent it)</option>
                {BRANCHES.map((branch) => <option key={branch.id} value={branch.id}>{branch.label}</option>)}
              </select>
              <div className="mt-1 text-xs text-muted">Each branch rents out only its own pieces.{selectedWeaponId ? ' Applies to this piece only.' : ''}</div>
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <div className="mb-2 text-sm font-semibold text-text">FPS classification</div>
                <select
                  value={form.fpsClass}
                  onChange={(event) => setForm((prev) => ({ ...prev, fpsClass: event.target.value }))}
                  className="w-full rounded-xl border border-white/10 glass px-4 py-3 text-sm text-text"
                >
                  <option value="">From category ({form.category === 'snipers' ? 'sniper / VSR' : 'AEG'})</option>
                  <option value="aeg">AEG / rifle / pistol (450 FPS)</option>
                  <option value="sniper">Sniper / VSR (550 FPS, 0.20g BBs)</option>
                </select>
              </label>
              <label className="block">
                <div className="mb-2 text-sm font-semibold text-text">FPS limit override</div>
                <input
                  type="number"
                  min="0"
                  value={form.fpsLimit}
                  onChange={(event) => setForm((prev) => ({ ...prev, fpsLimit: event.target.value }))}
                  placeholder="Blank = class limit"
                  className="w-full rounded-xl border border-white/10 bg-transparent px-4 py-3 text-sm text-text placeholder:text-muted"
                />
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
              </div>
            ) : (
              <Button onClick={addWeapon} disabled={saving}>
                {saving ? 'Saving...' : Number(form.pieces) > 1 ? `Add ${form.pieces} pieces` : 'Add weapon'}
              </Button>
            )}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}


type WeaponsView = 'inventory' | 'fps' | 'repairs'
const WEAPON_VIEWS: WeaponsView[] = ['inventory', 'fps', 'repairs']

// Weapons: the catalog and maintenance queue, the FPS safety log (chronograph checks), and
// "Damage & repairs": damage/loss reports and the gunsmith repair log together, since a report
// sends the item to maintenance and its repair cost is what gets billed.
// ?view=fps|repairs opens a tab directly (the old ?view=damage opens Damage & repairs).
export function AdminWeaponsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const linked = searchParams.get('view')
  const fromLink = (linked === 'damage' ? 'repairs' : linked) as WeaponsView | null
  const [view, setView] = React.useState<WeaponsView>(fromLink && WEAPON_VIEWS.includes(fromLink) ? fromLink : 'inventory')
  const [repairsVersion, setRepairsVersion] = React.useState(0)

  const changeView = (next: WeaponsView) => {
    setView(next)
    setSearchParams(next === 'inventory' ? {} : { view: next }, { replace: true })
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">Weapons</h1>
        {/* The other tabs write their own subtitle (the FPS limits are read from the server). */}
        {view === 'inventory' ? (
          <p className="mt-1 text-sm text-muted">Manage the weapon catalog, inspect conditions, and keep the maintenance queue current.</p>
        ) : null}
      </div>
      <FilterTabs
        ariaLabel="Weapons section"
        value={view}
        onChange={changeView}
        options={[
          { value: 'inventory', label: 'Inventory' },
          { value: 'repairs', label: <><FiTool /> Damage &amp; repairs</> },
          { value: 'fps', label: <><FiCrosshair /> FPS history</> },
        ]}
      />
      {view === 'inventory' ? (
        <WeaponInventory />
      ) : view === 'repairs' ? (
        <div className="space-y-8">
          {/* How a broken or lost item moves through this tab. */}
          <ol className="grid gap-2 sm:grid-cols-3">
            {[
              { icon: FiAlertTriangle, title: 'File a report', text: 'Damaged items open a repair automatically. Lost items get a loss report only.' },
              { icon: FiTool, title: 'Gunsmith repairs it', text: 'Mark the repair done with the parts and labor cost.' },
              { icon: FiCheck, title: 'Bill or waive', text: "The charge goes on the player's booking, or is waived." },
            ].map((step, index) => (
              <li key={step.title} className="flex gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent/15 text-xs font-bold text-accent">{index + 1}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-semibold"><step.icon className="h-3.5 w-3.5 text-muted" /> {step.title}</div>
                  <div className="mt-0.5 text-xs text-muted">{step.text}</div>
                </div>
              </li>
            ))}
          </ol>
          <SafetyLogPage embedded tab="damage" onRepairOpened={() => setRepairsVersion((v) => v + 1)} />
          <div className="border-t border-white/10 pt-6">
            {/* Remounted when a damage report opens a repair, so the new one shows up. */}
            <RepairsPage key={repairsVersion} embedded />
          </div>
        </div>
      ) : (
        <SafetyLogPage embedded tab="fps" />
      )}
    </div>
  )
}
