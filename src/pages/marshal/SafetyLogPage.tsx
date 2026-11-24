import React, { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { FiAlertTriangle, FiCrosshair, FiPlus } from 'react-icons/fi'
import { Card } from '../../components/ui/Card'
import { FilterTabs } from '../../components/ui/FilterTabs'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { ItemCombobox, type ComboItem } from '../../components/ui/ItemCombobox'
import { apiGet, apiPost, apiPut, apiGetAll } from '../../utils/apiClient'
import { useAuth } from '../../context/AuthContext'
import { Paged } from '../../components/ui/Pagination'
import { DamageReportForm, type FiledReport, type InventoryItem } from './DamageReportForm'

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

type PenaltyLine = { label: string; amount: number }

type PenaltyQuote = {
  amount: number | null
  basis: 'damage' | 'loss'
  lines?: PenaltyLine[]
  missing?: string
  handlingFeePercent: number
}

type DamageReport = {
  id: string
  itemType: 'weapon' | 'equipment'
  kind?: 'damage' | 'loss'
  penalty?: { computedAmount: number | null; overridden: boolean; overrideReason?: string; lines?: PenaltyLine[] }
  itemName: string
  reservationId?: string
  playerName?: string
  description: string
  status: 'reported' | 'billed' | 'waived'
  chargeAmount: number
  reviewNote?: string
  reportedAtISO: string
  reportedBy?: Actor
  // Repair opened automatically when the report was filed
  repairId?: string
}


const selectClass = 'w-full rounded-xl border border-white/10 bg-background px-4 py-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/40 [&>option]:bg-background'

function formatDateTime(iso?: string) {
  if (!iso) return '-'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

const toOption = (item: InventoryItem): ComboItem => ({ key: item.id, label: item.name, detail: item.id })

function toItems(docs: any[]): InventoryItem[] {
  return docs
    // Player-owned gear is not center inventory; log it as "Player-owned / not listed".
    .filter((doc) => doc.source !== 'player')
    .map((doc) => ({ id: String(doc.id || doc._id || ''), name: String(doc.name || 'Unnamed') }))
    .filter((item) => item.id)
}

// Chronograph checks and damage reports. Shown on the Weapons page (`embedded`), which supplies
// the title and picks the tab.
// `onRepairOpened`: filing a damage report opens its repair automatically; the page refreshes its repair list.
export function SafetyLogPage({ embedded = false, tab: tabFromPage, onRepairOpened }: { embedded?: boolean; tab?: 'fps' | 'damage'; onRepairOpened?: () => void } = {}) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  // Marshals inspect the damage, so they set the fee too; it goes on the booking's bill for the registrar.
  const canSetFee = isAdmin || user?.role === 'marshal'
  const [ownTab, setTab] = useState<'fps' | 'damage'>('fps')
  const tab = tabFromPage || ownTab
  const [fpsLogs, setFpsLogs] = useState<FpsLog[]>([])
  const [limits, setLimits] = useState({ aeg: 450, sniper: 550 })
  const [reports, setReports] = useState<DamageReport[]>([])
  const [weapons, setWeapons] = useState<InventoryItem[]>([])
  const [equipment, setEquipment] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // The manual reading form, closed unless a gun outside the inventory needs testing.
  const [fpsFormOpen, setFpsFormOpen] = useState(false)
  const [fpsForm, setFpsForm] = useState({ weaponId: '', weaponName: '', weaponClass: 'aeg', fps: '', playerName: '', notes: '' })
  const [review, setReview] = useState<{ id: string; amount: string; note: string; overrideReason: string; quote: PenaltyQuote | null } | null>(null)
  const [handlingFee, setHandlingFee] = useState('')
  const [editingFee, setEditingFee] = useState(false)
  // The report form (in a pop-up) loads today's games itself each time it opens.
  const [damageFormOpen, setDamageFormOpen] = useState(false)
  const [reportFilter, setReportFilter] = useState<'reported' | 'billed' | 'waived' | 'all'>('all')

  useEffect(() => {
    apiGet<{ ok: boolean; data: { handlingFeePercent: number } }>('/api/penalty-rules')
      .then((res) => setHandlingFee(String(res.data.handlingFeePercent)))
      .catch(() => null)
  }, [])

  const saveHandlingFee = async () => {
    try {
      const res = await apiPut<{ ok: boolean; data: { handlingFeePercent: number } }>('/api/penalty-rules', { handlingFeePercent: Number(handlingFee) })
      setHandlingFee(String(res.data.handlingFeePercent))
      toast.success('Handling fee saved.')
    } catch (err: any) {
      toast.error(err?.message || 'Unable to save the handling fee')
    }
  }

  const openReview = async (report: DamageReport) => {
    setReview({ id: report.id, amount: '', note: '', overrideReason: '', quote: null })
    try {
      const res = await apiGet<{ ok: boolean; data: PenaltyQuote }>(`/api/damage-reports/${encodeURIComponent(report.id)}/penalty-quote`)
      setReview((current) => current && current.id === report.id
        ? { ...current, quote: res.data, amount: res.data.amount !== null ? String(res.data.amount) : '' }
        : current)
    } catch (err: any) {
      toast.error(err?.message || 'Unable to compute the penalty')
    }
  }

  const load = useCallback(async () => {
    try {
      const [fpsRes, damageRes, weaponRes, equipmentRes] = await Promise.all([
        apiGet<{ ok: boolean; data: FpsLog[]; limits: { aeg: number; sniper: number } }>('/api/fps-logs'),
        apiGet<{ ok: boolean; data: DamageReport[] }>('/api/damage-reports'),
        apiGetAll<any>('weapons').then((data) => ({ ok: true, data })),
        apiGetAll<any>('equipments').then((data) => ({ ok: true, data })),
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
      setFpsFormOpen(false)
      await load()
    } catch (err: any) {
      toast.error(err?.message || 'Unable to save reading')
    } finally {
      setSaving(false)
    }
  }

  const handleReportFiled = async (res: FiledReport) => {
    toast.success(
      res.kind === 'loss'
        ? 'Loss report filed. The item was taken out of rental.'
        : res.repair
          ? `Damage report filed and repair ${res.repair.id} opened. Mark it repaired once the gunsmith is done.`
          : 'Damage report filed. The item was moved to maintenance.',
    )
    setDamageFormOpen(false)
    await load()
    if (res.repair) onRepairOpened?.()
  }

  const submitReview = async (decision: 'bill' | 'waive') => {
    if (!review) return
    setSaving(true)
    try {
      await apiPut(`/api/damage-reports/${encodeURIComponent(review.id)}/review`, {
        decision,
        chargeAmount: review.amount === '' ? undefined : Number(review.amount),
        overrideReason: review.overrideReason,
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

  const reportCounts = useMemo(() => ({
    reported: reports.filter((r) => r.status === 'reported').length,
    billed: reports.filter((r) => r.status === 'billed').length,
    waived: reports.filter((r) => r.status === 'waived').length,
  }), [reports])
  const visibleReports = reportFilter === 'all' ? reports : reports.filter((r) => r.status === reportFilter)

  const weaponOptions = weapons.map(toOption)

  return (
    <div className="space-y-4">
      {embedded ? (
        // The damage view writes its own section header (with counts and the File report button).
        tab === 'fps' ? (
          <p className="text-sm text-muted">{`Chronograph checks: AEG limit ${limits.aeg} FPS, sniper/VSR ${limits.sniper} FPS.`}</p>
        ) : null
      ) : (
      <div>
        <h1 className="text-3xl font-bold">Safety Logs</h1>
        <p className="mt-1 text-sm text-muted">
          Chronograph checks (AEG limit {limits.aeg} FPS, sniper/VSR {limits.sniper} FPS) and damage reports with penalty billing.
        </p>
      </div>
      )}

      <div className={embedded ? 'hidden' : 'flex gap-2'}>
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
        <div className="space-y-4">
          {/* Readings are normally taken from a weapon's FPS button (Inventory) or the FPS check in
              a game. This form is only for a gun that isn't in the system, like a walk-in's own gun. */}
          {!fpsFormOpen ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
              <span>Test guns from their FPS button in Inventory, or from a game's FPS check before it starts.</span>
              <button type="button" onClick={() => setFpsFormOpen(true)} className="-my-2 flex items-center gap-1.5 py-2 text-left font-semibold text-accent hover:underline">
                <FiCrosshair /> Test a gun that isn't in the inventory
              </button>
            </div>
          ) : (
          <Card className="p-4 md:p-5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold"><FiCrosshair /> Test a gun that isn't in the inventory</div>
              <button type="button" onClick={() => setFpsFormOpen(false)} className="text-xs text-muted hover:text-text">Close</button>
            </div>
            <form className="mt-4 space-y-3" onSubmit={submitFps}>
              <ItemCombobox
                label="Weapon"
                placeholder="Type a weapon name or pick one, e.g. M4 Rifle or Player's M4 (blue tape)"
                items={weaponOptions}
                selectedKey={fpsForm.weaponId}
                onSelect={(item) => setFpsForm((c) => ({ ...c, weaponId: item?.key || '' }))}
                allowCustom
                customText={fpsForm.weaponName}
                onCustomText={(text) => setFpsForm((c) => ({ ...c, weaponName: text }))}
              />
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
          )}

          <Card className="p-4 md:p-5">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-widest text-muted">FPS history</div>
              <div className="text-xs text-muted">{fpsStats.total} logged · <span className="text-danger">{fpsStats.failed} failed</span></div>
            </div>
            <div className="mt-3 divide-y divide-white/5">
              {loading ? <div className="py-3 text-sm text-muted">Loading…</div> : null}
              {!loading && fpsLogs.length === 0 ? <div className="py-3 text-sm text-muted">No readings yet.</div> : null}
              <Paged items={fpsLogs}>{(pageItems) => pageItems.map((log) => (
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
              ))}</Paged>
            </div>
          </Card>
        </div>
      ) : (
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-bold"><FiAlertTriangle /> Damage &amp; loss reports</h2>
              <p className="mt-0.5 text-xs text-muted">
                {reportCounts.reported > 0
                  ? <><span className="font-semibold text-warning">{reportCounts.reported} waiting for a charge decision</span> · {reports.length} total</>
                  : `${reports.length} report${reports.length === 1 ? '' : 's'}, none waiting for a decision`}
              </p>
            </div>
            <Button size="sm" onClick={() => setDamageFormOpen(true)}><FiPlus /> File report</Button>
          </div>

          {/* Penalty rules in one line; admins can change the handling fee in place. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-muted">
            <span><span className="font-semibold text-text">Lost:</span> replacement value</span>
            <span><span className="font-semibold text-text">Damaged:</span> repair cost + {handlingFee || 0}% handling fee</span>
            <span>The marshal can bill a different amount.</span>
            {isAdmin ? (
              editingFee ? (
                <span className="ml-auto flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={handlingFee}
                    onChange={(e) => setHandlingFee(e.target.value)}
                    aria-label="Handling fee (%)"
                    className="w-20 rounded-lg border border-white/10 bg-background px-2 py-1 text-xs text-text"
                  />
                  <span>%</span>
                  <Button size="xs" variant="secondary" disabled={handlingFee === ''} onClick={async () => { await saveHandlingFee(); setEditingFee(false) }}>Save</Button>
                  <Button size="xs" variant="ghost" onClick={() => setEditingFee(false)}>Cancel</Button>
                </span>
              ) : (
                <button type="button" onClick={() => setEditingFee(true)} className="ml-auto font-semibold text-accent hover:underline">Edit handling fee</button>
              )
            ) : null}
          </div>

          <FilterTabs
            size="sm"
            ariaLabel="Filter reports by status"
            value={reportFilter}
            onChange={setReportFilter}
            options={[
              { value: 'reported', label: 'Needs decision', count: reportCounts.reported },
              { value: 'billed', label: 'Billed', count: reportCounts.billed },
              { value: 'waived', label: 'Waived', count: reportCounts.waived },
              { value: 'all', label: 'All', count: reports.length },
            ]}
          />

          {damageFormOpen ? (
          <Modal title="File a damage or loss report" eyebrow="Weapons & gear" size="md" onClose={() => setDamageFormOpen(false)}>
            <DamageReportForm weapons={weapons} equipment={equipment} onFiled={handleReportFiled} />
          </Modal>
          ) : null}

          <Card className="p-2 md:p-3">
            <div className="divide-y divide-white/5">
              {loading ? <div className="px-2 py-3 text-sm text-muted">Loading…</div> : null}
              {!loading && visibleReports.length === 0 ? (
                <div className="px-2 py-8 text-center text-sm text-muted">
                  {reportFilter === 'reported' ? 'Nothing waiting for a decision.' : reportFilter === 'all' ? 'No damage or loss reports yet.' : `No ${reportFilter} reports.`}
                </div>
              ) : null}
              <Paged items={visibleReports} resetKey={reportFilter}>{(pageItems) => pageItems.map((report) => (
                <div key={report.id} className="px-2 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">{report.itemName}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${report.kind === 'loss' ? 'border-danger/30 bg-danger/10 text-danger' : 'border-white/10 bg-white/5 text-muted'}`}>
                          {report.kind === 'loss' ? 'Lost' : 'Damaged'} · {report.itemType === 'weapon' ? 'Weapon' : 'Gear'}
                        </span>
                      </div>
                      <div className="mt-1 text-sm text-muted">{report.description}</div>
                      <div className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-muted">
                        <span>{report.id}</span>
                        <span>· {formatDateTime(report.reportedAtISO)}</span>
                        <span>· {report.reservationId ? `Booking ${report.reservationId}` : 'No booking linked'}</span>
                        {report.playerName ? <span>· {report.playerName}</span> : null}
                        {report.repairId ? <span>· <span className="font-semibold text-accent">Repair {report.repairId}</span></span> : null}
                      </div>
                      {report.reviewNote ? <div className="mt-1 text-xs text-muted">Review: {report.reviewNote}</div> : null}
                      {report.penalty?.overridden ? (
                        <div className="mt-1 text-xs text-warning">
                          Override{report.penalty.computedAmount != null ? ` (rule gave ₱${report.penalty.computedAmount.toLocaleString()})` : ''}: {report.penalty.overrideReason}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${report.status === 'billed' ? 'border-danger/30 bg-danger/10 text-danger' : report.status === 'waived' ? 'border-success/30 bg-success/10 text-success' : 'border-amber-400/30 bg-amber-400/10 text-warning'}`}>
                        {report.status === 'reported' ? 'Needs decision' : report.status === 'billed' ? `Billed ₱${report.chargeAmount.toLocaleString()}` : 'Waived'}
                      </span>
                      {canSetFee && report.status === 'reported' && review?.id !== report.id ? (
                        <Button size="xs" variant="secondary" onClick={() => void openReview(report)}>Set damage fee</Button>
                      ) : null}
                    </div>
                  </div>

                  {canSetFee && report.status === 'reported' && review?.id === report.id ? (
                    (
                      // The fee form: the rule's suggestion (when it has one), the fee and an optional
                      // note side by side, then the decision. Waive sits apart from billing.
                      <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
                        <div className="text-xs">
                          {!review.quote ? (
                            <span className="text-muted">Working out the suggested fee…</span>
                          ) : review.quote.amount === null ? (
                            <span className="text-muted">No repair cost recorded yet, so enter the fee yourself.</span>
                          ) : (
                            <div className="space-y-0.5">
                              {(review.quote.lines || []).map((line) => (
                                <div key={line.label} className="flex justify-between text-muted"><span>{line.label}</span><span>₱{line.amount.toLocaleString()}</span></div>
                              ))}
                              <div className="flex justify-between font-semibold">
                                <span>Suggested fee</span>
                                <button type="button" className="text-accent hover:underline" onClick={() => setReview((c) => c && { ...c, amount: String(review.quote?.amount ?? '') })}>
                                  ₱{review.quote.amount.toLocaleString()} · use this
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
                          <Input
                            label="Damage fee (₱)"
                            type="number"
                            min={1}
                            value={review.amount}
                            placeholder={review.quote?.amount ? String(review.quote.amount) : 'e.g. 300'}
                            onChange={(e) => setReview((c) => c && { ...c, amount: e.target.value })}
                          />
                          <Input
                            label="Note (optional)"
                            value={review.note}
                            placeholder="What was damaged, or why this amount"
                            onChange={(e) => setReview((c) => c && { ...c, note: e.target.value })}
                          />
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <Button variant="primary" disabled={saving || !report.reservationId || !(Number(review.amount) > 0 || (review.amount === '' && review.quote?.amount))} onClick={() => submitReview('bill')}>
                            {saving ? 'Saving…' : `Add ${Number(review.amount) > 0 ? `₱${Number(review.amount).toLocaleString()} ` : review.quote?.amount ? `₱${review.quote.amount.toLocaleString()} ` : ''}to player's bill`}
                          </Button>
                          <Button variant="ghost" disabled={saving} onClick={() => setReview(null)}>Cancel</Button>
                          <Button variant="danger-soft" className="sm:ml-auto" disabled={saving} onClick={() => submitReview('waive')}>Waive fee</Button>
                        </div>
                        <div className={`mt-2 text-xs ${report.reservationId ? 'text-muted' : 'text-warning'}`}>
                          {report.reservationId
                            ? `Goes on booking ${report.reservationId}'s remaining balance; the registrar collects it at the counter, even if the game is already done.`
                            : 'No booking is linked to this report, so the fee can only be waived.'}
                        </div>
                      </div>
                    )
                  ) : null}
                </div>
              ))}</Paged>
            </div>
          </Card>
        </section>
      )}
    </div>
  )
}
