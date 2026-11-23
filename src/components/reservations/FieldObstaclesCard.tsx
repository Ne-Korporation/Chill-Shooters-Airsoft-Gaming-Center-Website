import React, { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { FiGrid } from 'react-icons/fi'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { apiPut } from '../../utils/apiClient'
import { DEFAULT_LAYOUT_FEES, OBSTACLE_TYPES, useFieldObstacles, type FieldObstacleCounts, type LayoutFeeTier, type PropType } from '../../utils/fieldObstacles'

const LABELS: Record<PropType, string> = {
  wall: 'Barricade walls',
  bunker: 'Bunkers',
  barrel: 'Barrels',
  tires: 'Tire stacks',
  tower: 'Watch towers',
  container: 'Containers',
}

const BRANCH: Record<string, string> = { salawag: 'Salawag', langkaan: 'Langkaan', binan: 'Biñan' }

// Admin editor: how many of each obstacle every field has. Players designing a layout for their
// game can only place what the field really has.
export function FieldObstaclesCard() {
  const { data, reload } = useFieldObstacles()
  const [open, setOpen] = useState(false)
  const [fieldId, setFieldId] = useState('')
  const [draft, setDraft] = useState<FieldObstacleCounts | null>(null)
  const [saving, setSaving] = useState(false)

  const field = useMemo(() => data?.fields.find((f) => f.id === fieldId) || null, [data, fieldId])
  useEffect(() => {
    if (!fieldId && data?.fields.length) setFieldId(data.fields[0].id)
  }, [data, fieldId])
  useEffect(() => {
    if (field) setDraft({ ...field.counts })
  }, [field])

  const save = async () => {
    if (!field || !draft) return
    setSaving(true)
    try {
      await apiPut(`/api/field-obstacles/${encodeURIComponent(field.id)}`, draft)
      await reload()
      toast.success(`${BRANCH[field.locationId] || field.locationId} · ${field.name} saved.`)
    } catch (err: any) {
      toast.error(err?.message || 'Unable to save the obstacles')
    } finally {
      setSaving(false)
    }
  }

  const changed = Boolean(field && draft && OBSTACLE_TYPES.some((type) => draft[type] !== field.counts[type]))

  // Custom layout fee tiers (Simple / Standard / Complex).
  const [tiers, setTiers] = useState<LayoutFeeTier[]>(DEFAULT_LAYOUT_FEES)
  useEffect(() => {
    if (data?.layoutFees) setTiers(data.layoutFees.map((tier) => ({ ...tier })))
  }, [data])
  const setTier = (index: number, changes: Partial<LayoutFeeTier>) =>
    setTiers((current) => current.map((tier, i) => (i === index ? { ...tier, ...changes } : tier)))
  const tiersChanged = JSON.stringify(tiers) !== JSON.stringify(data?.layoutFees || DEFAULT_LAYOUT_FEES)
  const [savingTiers, setSavingTiers] = useState(false)
  const saveTiers = async () => {
    setSavingTiers(true)
    try {
      await apiPut('/api/field-layout-fees', { tiers })
      await reload()
      toast.success('Layout fees saved.')
    } catch (err: any) {
      toast.error(err?.message || 'Unable to save the layout fees')
    } finally {
      setSavingTiers(false)
    }
  }

  return (
    <Card className="mb-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted"><FiGrid /> Field obstacles</div>
          <div className="mt-1 text-sm text-muted">How many of each obstacle every field has. Players designing a layout can only place these.</div>
        </div>
        {!open ? <Button size="sm" variant="ghost" onClick={() => setOpen(true)} disabled={!data}>Edit obstacles</Button> : null}
      </div>
      {open && data && field && draft ? (
        <div className="mt-3 space-y-3">
          <select
            value={fieldId}
            onChange={(event) => setFieldId(event.target.value)}
            aria-label="Field"
            className="w-full rounded-xl border border-white/10 bg-background px-3 py-2 text-sm sm:w-auto"
          >
            {data.fields.map((f) => (
              <option key={f.id} value={f.id}>{BRANCH[f.locationId] || f.locationId} · {f.name}</option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {OBSTACLE_TYPES.map((type) => (
              <label key={type} className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm">
                <span className="truncate">{LABELS[type]}</span>
                <input
                  type="number"
                  min={0}
                  max={99}
                  value={draft[type]}
                  onChange={(event) => setDraft({ ...draft, [type]: Math.max(0, Math.min(99, Math.round(Number(event.target.value) || 0))) })}
                  className="w-16 rounded-lg border border-white/10 bg-background px-2 py-1 text-right text-sm tabular-nums"
                  aria-label={`${LABELS[type]} at ${field.name}`}
                />
              </label>
            ))}
          </div>
          <p className="text-xs text-muted">
            Set a piece to 0 if the field doesn't have it; players won't see it. Game markers have fixed limits:
            {' '}{Object.entries(data.markers).map(([type, count]) => `${count} ${type === 'spawnA' ? 'Spawn A' : type === 'spawnB' ? 'Spawn B' : type === 'bomb' ? 'bomb sites' : 'flags'}`).join(', ')}.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={saving || !changed}>{saving ? 'Saving…' : 'Save field'}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setDraft({ ...field.counts }); setOpen(false) }}>Close</Button>
          </div>

          {/* What a custom layout costs, by how many pieces staff set up. Same at every field. */}
          <div className="mt-2 border-t border-white/10 pt-3">
            <div className="text-xs uppercase tracking-widest text-muted">Custom layout fee</div>
            <p className="mt-1 text-xs text-muted">Private games only. The standard field is free; spawns, flags and bomb sites don't count as pieces. An uploaded sketch is charged as {tiers[1]?.label}.</p>
            <div className="mt-2 space-y-2">
              {tiers.map((tier, index) => {
                const last = index === tiers.length - 1
                const from = index === 0 ? 1 : (Number(tiers[index - 1].maxPieces) || 0) + 1
                return (
                  <div key={tier.label} className="grid grid-cols-[6rem_1fr_auto] items-center gap-2 text-sm">
                    <span className="font-semibold">{tier.label}</span>
                    <span className="flex items-center gap-1.5 text-xs text-muted">
                      {from}{last ? '+ pieces' : <>–<input
                        type="number"
                        min={from}
                        max={300}
                        value={tier.maxPieces ?? ''}
                        onChange={(event) => setTier(index, { maxPieces: Math.max(1, Math.min(300, Math.round(Number(event.target.value) || 0))) })}
                        className="w-14 rounded-lg border border-white/10 bg-background px-2 py-1 text-right text-sm tabular-nums text-text"
                        aria-label={`${tier.label}: most pieces`}
                      /> pieces</>}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-muted">
                      ₱<input
                        type="number"
                        min={0}
                        max={100000}
                        value={tier.price}
                        onChange={(event) => setTier(index, { price: Math.max(0, Math.min(100000, Math.round(Number(event.target.value) || 0))) })}
                        className="w-20 rounded-lg border border-white/10 bg-background px-2 py-1 text-right text-sm tabular-nums text-text"
                        aria-label={`${tier.label}: price`}
                      />
                    </span>
                  </div>
                )
              })}
            </div>
            <div className="mt-2">
              <Button size="sm" onClick={saveTiers} disabled={savingTiers || !tiersChanged}>{savingTiers ? 'Saving…' : 'Save layout fees'}</Button>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  )
}
