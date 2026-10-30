import React, { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { FiAlertTriangle, FiCrosshair } from 'react-icons/fi'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { apiGet, apiPost, apiPut } from '../../utils/apiClient'
import { useAuth } from '../../context/AuthContext'

type Actor = { actorEmail?: string; actorRole?: string }

type FpsLog = {
  id: string
  weaponName: string
  weaponClass: 'aeg' | 'sniper'
  fps: number
  limit: number
  result: 'pass' | 'fail'
  playerName?: string
  notes?: string
  testedAtISO: string
  testedBy?: Actor
}

type DamageReport = {
  id: string
  itemType: 'weapon' | 'equipment'
  itemName: string
  reservationId?: string
  playerName?: string
  description: string
  status: 'reported' | 'billed' | 'waived'
  chargeAmount: number
  reviewNote?: string
  reportedAtISO: string
  reportedBy?: Actor
}

type InventoryItem = { id: string; name: string }

const selectClass = 'w-full rounded-xl border border-white/10 bg-background px-4 py-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/40 [&>option]:bg-background'

function formatDateTime(iso?: string) {
  if (!iso) return '-'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

function toItems(docs: any[]): InventoryItem[] {
  return docs
    // Player-owned gear is not center inventory; log it as "Player-owned / not listed".
    .filter((doc) => doc.source !== 'player')
    .map((doc) => ({ id: String(doc.id || doc._id || ''), name: String(doc.name || 'Unnamed') }))
    .filter((item) => item.id)
}

export function SafetyLogPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [tab, setTab] = useState<'fps' | 'damage'>('fps')
  const [fpsLogs, setFpsLogs] = useState<FpsLog[]>([])
  const [limits, setLimits] = useState({ aeg: 450, sniper: 550 })
  const [reports, setReports] = useState<DamageReport[]>([])
  const [weapons, setWeapons] = useState<InventoryItem[]>([])
  const [equipment, setEquipment] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [fpsForm, setFpsForm] = useState({ weaponId: '', weaponName: '', weaponClass: 'aeg', fps: '', playerName: '', notes: '' })
  const [damageForm, setDamageForm] = useState({ itemType: 'weapon', itemId: '', itemName: '', reservationId: '', playerName: '', description: '' })
  const [review, setReview] = useState<{ id: string; amount: string; note: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const [fpsRes, damageRes, weaponRes, equipmentRes] = await Promise.all([
        apiGet<{ ok: boolean; data: FpsLog[]; limits: { aeg: number; sniper: number } }>('/api/fps-logs'),
        apiGet<{ ok: boolean; data: DamageReport[] }>('/api/damage-reports'),
        apiGet<{ ok: boolean; data: any[] }>('/api/weapons?limit=200'),
        apiGet<{ ok: boolean; data: any[] }>('/api/equipments?limit=200'),
      ])
      setFpsLogs(fpsRes.data || [])
      if (fpsRes.limits) setLimits(fpsRes.limits)
      setReports(damageRes.data || [])
      setWeapons(toItems(weaponRes.data || []))
      setEquipment(toItems(equipmentRes.data || []))
    } catch (err: any) {
      toast.error(err?.message || 'Unable to load safety records')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const fpsStats = useMemo(() => ({
    total: fpsLogs.length,
    failed: fpsLogs.filter((log) => log.result === 'fail').length,
  }), [fpsLogs])

  const fpsValue = Number(fpsForm.fps)
  const fpsLimit = fpsForm.weaponClass === 'sniper' ? limits.sniper : limits.aeg
  const fpsPreview = Number.isFinite(fpsValue) && fpsValue > 0 ? (fpsValue <= fpsLimit ? 'pass' : 'fail') : null

  const submitFps = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      const res = await apiPost<{ ok: boolean; data: FpsLog; weaponPulled: boolean }>('/api/fps-logs', {
        ...fpsForm,
        fps: Number(fpsForm.fps),
      })
      if (res.data.result === 'pass') toast.success(`${res.data.weaponName}: ${res.data.fps} FPS — PASS`)
      else toast.error(`${res.data.weaponName}: ${res.data.fps} FPS — FAIL (limit ${res.data.limit})${res.weaponPulled ? '. Weapon moved to maintenance.' : ''}`)
      setFpsForm((current) => ({ ...current, weaponId: '', weaponName: '', fps: '', playerName: '', notes: '' }))
      await load()
    } catch (err: any) {
      toast.error(err?.message || 'Unable to save reading')
    } finally {
      setSaving(false)
    }
  }

  const submitDamage = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await apiPost('/api/damage-reports', damageForm)
      toast.success('Damage report filed. The item was moved to maintenance.')
      setDamageForm({ itemType: damageForm.itemType, itemId: '', itemName: '', reservationId: '', playerName: '', description: '' })
      await load()
    } catch (err: any) {
      toast.error(err?.message || 'Unable to file report')
    } finally {
      setSaving(false)
    }
  }

  const submitReview = async (decision: 'bill' | 'waive') => {
    if (!review) return
    setSaving(true)
    try {
      await apiPut(`/api/damage-reports/${encodeURIComponent(review.id)}/review`, {
        decision,
        chargeAmount: Number(review.amount),
        note: review.note,
      })
      toast.success(decision === 'bill' ? 'Charge added to the reservation balance.' : 'Charge waived.')
      setReview(null)
      await load()
    } catch (err: any) {
      toast.error(err?.message || 'Unable to review report')
    } finally {
      setSaving(false)
    }
  }

  const damageItems = damageForm.itemType === 'weapon' ? weapons : equipment

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">Safety Logs</h1>
        <p className="mt-1 text-sm text-muted">
          Chronograph checks (AEG limit {limits.aeg} FPS, sniper/VSR {limits.sniper} FPS) and damage reports with penalty billing.
        </p>
      </div>

      <div className="flex gap-2">
        {([['fps', 'FPS safety log'], ['damage', 'Damage reports']] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={[
              'rounded-full border px-4 py-2 text-sm font-semibold transition',
              tab === value ? 'border-accent/40 bg-accent/15 text-accent' : 'border-white/10 bg-white/5 text-muted hover:text-text',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'fps' ? (
        <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <Card className="p-4 md:p-5">
            <div className="flex items-center gap-2 text-sm font-bold"><FiCrosshair /> Record a chronograph reading</div>
            <form className="mt-4 space-y-3" onSubmit={submitFps}>
              <label className="block">
                <div className="mb-2 text-sm font-semibold text-text">Center weapon</div>
                <select
                  value={fpsForm.weaponId}
                  onChange={(e) => setFpsForm((c) => ({ ...c, weaponId: e.target.value }))}
                  className={selectClass}
                >
                  <option value="">Player-owned / not listed</option>
                  {weapons.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              {!fpsForm.weaponId ? (
                <Input
                  label="Weapon description"
                  placeholder="e.g. Player's M4 (blue tape)"
                  value={fpsForm.weaponName}
                  onChange={(e) => setFpsForm((c) => ({ ...c, weaponName: e.target.value }))}
                />
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <div className="mb-2 text-sm font-semibold text-text">Class</div>
                  <select
                    value={fpsForm.weaponClass}
                    onChange={(e) => setFpsForm((c) => ({ ...c, weaponClass: e.target.value }))}
                    className={selectClass}
                  >
                    <option value="aeg">AEG / rifle / pistol (≤ {limits.aeg})</option>
                    <option value="sniper">Sniper / VSR (≤ {limits.sniper})</option>
                  </select>
                  {fpsForm.weaponId ? (
                    <div className="mt-1 text-xs text-muted">Center weapons are checked against the class and limit saved on the weapon.</div>
                  ) : null}
                </label>
                <Input
                  label="Reading (FPS)"
                  type="number"
                  min={1}
                  value={fpsForm.fps}
                  onChange={(e) => setFpsForm((c) => ({ ...c, fps: e.target.value }))}
                  hint={fpsPreview ? (fpsPreview === 'pass' ? 'Within limit' : `Over the ${fpsLimit} FPS limit`) : undefined}
                />
              </div>
              <Input
                label="Player (optional)"
                value={fpsForm.playerName}
                onChange={(e) => setFpsForm((c) => ({ ...c, playerName: e.target.value }))}
              />
              <Input
                label="Notes (optional)"
                value={fpsForm.notes}
                onChange={(e) => setFpsForm((c) => ({ ...c, notes: e.target.value }))}
              />
              <Button type="submit" className="w-full" disabled={saving || !fpsForm.fps}>
                {saving ? 'Saving…' : 'Save reading'}
              </Button>
            </form>
          </Card>

          <Card className="p-4 md:p-5">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-widest text-muted">Recent readings</div>
              <div className="text-xs text-muted">{fpsStats.total} logged · <span className="text-danger">{fpsStats.failed} failed</span></div>
            </div>
            <div className="mt-3 divide-y divide-white/5">
              {loading ? <div className="py-3 text-sm text-muted">Loading…</div> : null}
              {!loading && fpsLogs.length === 0 ? <div className="py-3 text-sm text-muted">No readings yet.</div> : null}
              {fpsLogs.map((log) => (
                <div key={log.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{log.weaponName}</div>
                    <div className="mt-0.5 text-xs text-muted">
                      {log.weaponClass === 'sniper' ? 'Sniper/VSR' : 'AEG'} · {formatDateTime(log.testedAtISO)}
                      {log.playerName ? ` · ${log.playerName}` : ''} · by {log.testedBy?.actorEmail || 'staff'}
                    </div>
                    {log.notes ? <div className="mt-0.5 text-xs text-muted">{log.notes}</div> : null}
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold">{log.fps} FPS</div>
                    <span className={`text-[10px] font-semibold uppercase tracking-[0.15em] ${log.result === 'pass' ? 'text-success' : 'text-danger'}`}>
                      {log.result} (≤ {log.limit})
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <Card className="p-4 md:p-5">
            <div className="flex items-center gap-2 text-sm font-bold"><FiAlertTriangle /> File a damage report</div>
            <form className="mt-4 space-y-3" onSubmit={submitDamage}>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <div className="mb-2 text-sm font-semibold text-text">Item type</div>
                  <select
                    value={damageForm.itemType}
                    onChange={(e) => setDamageForm((c) => ({ ...c, itemType: e.target.value, itemId: '' }))}
                    className={selectClass}
                  >
                    <option value="weapon">Weapon</option>
                    <option value="equipment">Equipment</option>
                  </select>
                </label>
                <label className="block">
                  <div className="mb-2 text-sm font-semibold text-text">Item</div>
                  <select
                    value={damageForm.itemId}
                    onChange={(e) => setDamageForm((c) => ({ ...c, itemId: e.target.value }))}
                    className={selectClass}
                  >
                    <option value="">Not listed</option>
                    {damageItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
              </div>
              {!damageForm.itemId ? (
                <Input
                  label="Item description"
                  value={damageForm.itemName}
                  onChange={(e) => setDamageForm((c) => ({ ...c, itemName: e.target.value }))}
                />
              ) : null}
              <Input
                label="Reservation ID"
                hint="Needed to bill a damage charge to the responsible booking."
                placeholder="e.g. R-…"
                value={damageForm.reservationId}
                onChange={(e) => setDamageForm((c) => ({ ...c, reservationId: e.target.value.trim() }))}
              />
              <Input
                label="Responsible player (optional)"
                value={damageForm.playerName}
                onChange={(e) => setDamageForm((c) => ({ ...c, playerName: e.target.value }))}
              />
              <label className="block">
                <div className="mb-2 text-sm font-semibold text-text">What happened</div>
                <textarea
                  value={damageForm.description}
                  onChange={(e) => setDamageForm((c) => ({ ...c, description: e.target.value.slice(0, 1000) }))}
                  rows={3}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
              </label>
              <Button type="submit" className="w-full" disabled={saving || !damageForm.description.trim()}>
                {saving ? 'Saving…' : 'File report'}
              </Button>
            </form>
          </Card>

          <Card className="p-4 md:p-5">
            <div className="text-xs uppercase tracking-widest text-muted">Reports</div>
            <div className="mt-3 divide-y divide-white/5">
              {loading ? <div className="py-3 text-sm text-muted">Loading…</div> : null}
              {!loading && reports.length === 0 ? <div className="py-3 text-sm text-muted">No damage reports.</div> : null}
              {reports.map((report) => (
                <div key={report.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{report.itemName} <span className="text-xs text-muted">({report.itemType})</span></div>
                      <div className="mt-0.5 text-xs text-muted">
                        {report.id} · {formatDateTime(report.reportedAtISO)} · {report.reservationId || 'no reservation'}
                        {report.playerName ? ` · ${report.playerName}` : ''}
                      </div>
                      <div className="mt-1 text-sm text-muted">{report.description}</div>
                      {report.reviewNote ? <div className="mt-1 text-xs text-muted">Review: {report.reviewNote}</div> : null}
                    </div>
                    <div className="text-right">
                      <span className={`text-[10px] font-semibold uppercase tracking-[0.15em] ${report.status === 'billed' ? 'text-danger' : report.status === 'waived' ? 'text-success' : 'text-warning'}`}>
                        {report.status}
                      </span>
                      {report.status === 'billed' ? <div className="text-sm font-bold">₱{report.chargeAmount.toLocaleString()}</div> : null}
                    </div>
                  </div>

                  {isAdmin && report.status === 'reported' ? (
                    review?.id === report.id ? (
                      <div className="mt-3 grid gap-2 rounded-xl border border-white/10 bg-white/5 p-3 sm:grid-cols-2">
                        <Input
                          label="Approved charge (₱)"
                          type="number"
                          min={1}
                          value={review.amount}
                          onChange={(e) => setReview((c) => c && { ...c, amount: e.target.value })}
                        />
                        <Input
                          label="Note"
                          value={review.note}
                          onChange={(e) => setReview((c) => c && { ...c, note: e.target.value })}
                        />
                        <div className="flex flex-wrap gap-2 sm:col-span-2">
                          <Button variant="danger" disabled={saving || !report.reservationId} onClick={() => submitReview('bill')}>Bill to reservation</Button>
                          <Button variant="secondary" disabled={saving} onClick={() => submitReview('waive')}>Waive</Button>
                          <Button variant="ghost" disabled={saving} onClick={() => setReview(null)}>Cancel</Button>
                        </div>
                        {!report.reservationId ? <div className="text-xs text-warning sm:col-span-2">No reservation linked, so this can only be waived.</div> : null}
                      </div>
                    ) : (
                      <div className="mt-2">
                        <Button variant="ghost" onClick={() => setReview({ id: report.id, amount: '', note: '' })}>Review charge</Button>
                      </div>
                    )
                  ) : null}
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
