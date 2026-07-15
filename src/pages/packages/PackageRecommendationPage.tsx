import React, { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import {
  FiCheck,
  FiChevronRight,
  FiInfo,
  FiTag,
  FiUsers,
} from 'react-icons/fi'

import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'

type GameMode = 'squad-deathmatch' | 'ctf' | 'search-and-destroy'

type EquipmentItem = {
  id: string
  name: string
  qty: number
  pricePerPlayer: number
}

type Package = {
  id: string
  name: string
  mode: GameMode
  basePrice: number
  minPlayers: number
  equipment: EquipmentItem[]
}

const GAME_MODES: { id: GameMode; label: string }[] = [
  { id: 'squad-deathmatch', label: 'Squad Deathmatch' },
  { id: 'ctf', label: 'Capture the Flag' },
  { id: 'search-and-destroy', label: 'Search & Destroy' },
]

const packages: Package[] = [
  {
    id: 'pkg-squad-1',
    name: 'Sentry Core (Small Unit)',
    mode: 'squad-deathmatch',
    basePrice: 550,
    minPlayers: 4,
    equipment: [
      { id: 'eq-vest', name: 'Tactical Vest', qty: 1, pricePerPlayer: 90 },
      { id: 'eq-mask', name: 'Protective Mask', qty: 1, pricePerPlayer: 60 },
      { id: 'eq-goggles', name: 'Clear Goggles', qty: 1, pricePerPlayer: 45 },
    ],
  },
  {
    id: 'pkg-squad-2',
    name: 'Tactical Advance (Squad)',
    mode: 'squad-deathmatch',
    basePrice: 720,
    minPlayers: 6,
    equipment: [
      { id: 'eq-vest', name: 'Tactical Vest', qty: 1, pricePerPlayer: 110 },
      { id: 'eq-mask', name: 'Protective Mask', qty: 1, pricePerPlayer: 75 },
      { id: 'eq-mag', name: 'Extra Magazine', qty: 1, pricePerPlayer: 55 },
    ],
  },
  {
    id: 'pkg-ctf-1',
    name: 'Objective Handler (CTF)',
    mode: 'ctf',
    basePrice: 640,
    minPlayers: 5,
    equipment: [
      { id: 'eq-vest', name: 'Tactical Vest', qty: 1, pricePerPlayer: 95 },
      { id: 'eq-band', name: 'Flag Band', qty: 1, pricePerPlayer: 40 },
      { id: 'eq-mask', name: 'Protective Mask', qty: 1, pricePerPlayer: 65 },
    ],
  },
  {
    id: 'pkg-ctf-2',
    name: 'Urban Sprint (CTF Heavy)',
    mode: 'ctf',
    basePrice: 820,
    minPlayers: 7,
    equipment: [
      { id: 'eq-vest', name: 'Tactical Vest', qty: 1, pricePerPlayer: 120 },
      { id: 'eq-mask', name: 'Protective Mask', qty: 1, pricePerPlayer: 85 },
      { id: 'eq-radio', name: 'Ops Radio Band', qty: 1, pricePerPlayer: 60 },
    ],
  },
  {
    id: 'pkg-snd-1',
    name: 'Reconline (S&D Standard)',
    mode: 'search-and-destroy',
    basePrice: 690,
    minPlayers: 4,
    equipment: [
      { id: 'eq-mask', name: 'Protective Mask', qty: 1, pricePerPlayer: 70 },
      { id: 'eq-goggles', name: 'Clear Goggles', qty: 1, pricePerPlayer: 50 },
      { id: 'eq-vest', name: 'Tactical Vest', qty: 1, pricePerPlayer: 100 },
    ],
  },
  {
    id: 'pkg-snd-2',
    name: 'Night Ops (S&D Elite)',
    mode: 'search-and-destroy',
    basePrice: 860,
    minPlayers: 6,
    equipment: [
      { id: 'eq-vest', name: 'Tactical Vest', qty: 1, pricePerPlayer: 130 },
      { id: 'eq-mask', name: 'Protective Mask', qty: 1, pricePerPlayer: 95 },
      { id: 'eq-armor', name: 'Reinforced Plate', qty: 1, pricePerPlayer: 65 },
    ],
  },
]

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function equipmentTotalPerPlayer(pkg: Package) {
  return pkg.equipment.reduce((sum, e) => sum + e.pricePerPlayer, 0)
}

function computeTotal({
  pkg,
  players,
  budgetModel,
}: {
  pkg: Package
  players: number
  budgetModel: 'public' | 'private'
}) {
  const sessionMultiplier = budgetModel === 'private' ? 1.25 : 1.0
  const equipmentTotal = equipmentTotalPerPlayer(pkg)
  const base = pkg.basePrice + equipmentTotal

  const discountPct = players >= 12 ? 0.1 : players >= 8 ? 0.06 : 0.0
  const totalBeforeDiscount = base * players * sessionMultiplier
  const total = Math.round(totalBeforeDiscount * (1 - discountPct))
  const perPlayer = Math.round(total / Math.max(1, players))

  return {
    total,
    perPlayer,
    equipmentTotal,
    sessionMultiplier,
    discountPct,
    discountLabel: discountPct > 0 ? `${Math.round(discountPct * 100)}%` : '—',
  }
}

export function PackageRecommendationPage() {
  const navigate = useNavigate()
  const [budget, setBudget] = useState<number>(25000)
  const [budgetInput, setBudgetInput] = useState('25000')
  const [budgetError, setBudgetError] = useState('')
  const [players, setPlayers] = useState<number>(8)
  const [playersInput, setPlayersInput] = useState('8')
  const [playersError, setPlayersError] = useState('')
  const [mode, setMode] = useState<GameMode>('squad-deathmatch')
  const [budgetModel, setBudgetModel] = useState<'public' | 'private'>('public')

  const budgetSafe = clamp(budget, 1000, 999999999)
  const minimumPlayersRequired = budgetModel === 'private' ? 10 : 1
  const playerSafe = clamp(players, minimumPlayersRequired, 40)

  const scored = useMemo(() => {
    return packages
      .filter((p) => p.mode === mode)
      .map((pkg) => {
        const pricing = computeTotal({ pkg, players: playerSafe, budgetModel })
        const affordable = pricing.total <= budgetSafe
        const overBudget = pricing.total - budgetSafe
        const minPenalty = Math.max(0, pkg.minPlayers - playerSafe) * 600
        const delta = Math.abs(pricing.total - budgetSafe)
        return { pkg, pricing, affordable, overBudget, minPenalty, delta }
      })
      .sort((a, b) => {
        if (a.affordable !== b.affordable) return a.affordable ? -1 : 1
        if (a.delta !== b.delta) return a.delta - b.delta
        return a.minPenalty - b.minPenalty
      })
  }, [budgetSafe, budgetModel, mode, playerSafe])

  const best = scored[0]
  const top3 = scored.slice(0, 3)
  const canSubmit = Boolean(
    best &&
      budgetInput.trim() !== '' &&
      playersInput.trim() !== '' &&
      Number(budgetInput) >= 1000 &&
      Number(playersInput) >= minimumPlayersRequired,
  )

  const savings = useMemo(() => {
    if (!best) return 0
    const baseline = computeTotal({ pkg: best.pkg, players: playerSafe, budgetModel: 'public' }).total
    return Math.max(0, baseline - best.pricing.total)
  }, [best, playerSafe])

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-muted">
          <span className="grid h-2.5 w-2.5 place-items-center rounded-full bg-accent" />
          <span className="uppercase tracking-[0.18em]">Packages</span>
        </div>
        <h1 className="text-3xl font-bold">Package Recommendation</h1>
        <p className="text-muted text-sm">
          Budget + group size → auto recommendation with comparison cards.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <Card className="p-4 md:p-6">
            <div className="flex items-center gap-2 text-sm font-bold">
              <FiUsers /> <span>Inputs</span>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div>
                <Input
                  label="Budget (PHP)"
                  type="number"
                  min={1000}
                  inputMode="numeric"
                  value={budgetInput}
                  onChange={(e) => {
                    const raw = e.target.value
                    if (raw === '') {
                      setBudgetInput('')
                      setBudget(0)
                      setBudgetError('Budget is required before selecting a package.')
                      return
                    }

                    if (!/^\d+$/.test(raw)) return

                    const nextValue = Number(raw)
                    if (nextValue < 1000) {
                      setBudgetInput(raw)
                      setBudget(nextValue)
                      setBudgetError('Budget must be at least 1000.')
                      return
                    }

                    setBudgetInput(raw)
                    setBudget(nextValue)
                    setBudgetError('')
                  }}
                />
                {budgetError ? <p className="mt-1 text-xs text-danger">{budgetError}</p> : null}
              </div>
              <div>
                <Input
                  label="Players"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={playersInput}
                  onChange={(e) => {
                    const raw = e.target.value
                    if (raw === '') {
                      setPlayersInput('')
                      setPlayers(0)
                      setPlayersError(
                        budgetModel === 'private'
                          ? 'Private sessions require at least 10 players.'
                          : 'Group size must be at least 1.',
                      )
                      return
                    }

                    if (!/^\d+$/.test(raw)) return

                    const nextValue = Number(raw)
                    setPlayersInput(raw)
                    setPlayers(nextValue)
                    setPlayersError(
                      budgetModel === 'private' && nextValue < 10
                        ? 'Private sessions require at least 10 players.'
                        : nextValue < 1
                          ? 'Group size must be at least 1.'
                          : '',
                    )
                  }}
                  onBlur={() => {
                    const currentValue = Number(playersInput)
                    if (!playersInput || Number.isNaN(currentValue) || currentValue <= 0) {
                      const fallback = budgetModel === 'private' ? 10 : 1
                      setPlayersInput(String(fallback))
                      setPlayers(fallback)
                      setPlayersError(
                        budgetModel === 'private'
                          ? 'Private sessions require at least 10 players. Resetting to 10.'
                          : 'Group size must be at least 1. Resetting to 1.',
                      )
                      return
                    }

                    if (budgetModel === 'private' && currentValue < 10) {
                      setPlayersInput('10')
                      setPlayers(10)
                      setPlayersError('Private sessions require at least 10 players. Resetting to 10.')
                      return
                    }

                    if (budgetModel === 'public' && currentValue < 1) {
                      setPlayersInput('1')
                      setPlayers(1)
                      setPlayersError('Group size must be at least 1. Resetting to 1.')
                      return
                    }

                    setPlayersInput(String(clamp(currentValue, minimumPlayersRequired, 40)))
                    setPlayers(clamp(currentValue, minimumPlayersRequired, 40))
                    setPlayersError('')
                  }}
                />
                {playersError ? <p className="mt-1 text-xs text-danger">{playersError}</p> : null}
              </div>

              <div className="md:col-span-2">
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">
                  Session Type
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {(['public', 'private'] as const).map((t) => {
                    const active = t === budgetModel
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          const nextModel = t
                          setBudgetModel(nextModel)
                          if (nextModel === 'private' && Number(playersInput) < 10) {
                            setPlayersInput('10')
                            setPlayers(10)
                            setPlayersError('Private sessions require at least 10 players.')
                          } else if (nextModel === 'public' && Number(playersInput) < 1) {
                            setPlayersInput('1')
                            setPlayers(1)
                            setPlayersError('Group size must be at least 1.')
                          } else {
                            setPlayersError('')
                          }
                        }}
                        className={[
                          'rounded-2xl border p-4 text-left transition',
                          active
                            ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25'
                            : 'border-white/10 bg-white/5 hover:bg-white/8',
                        ].join(' ')}
                      >
                        <div className="text-sm font-bold">{t === 'private' ? 'Private' : 'Public'}</div>
                        <div className="mt-1 text-xs text-muted">
                          {t === 'private' ? 'Team exclusive' : 'Open roster'}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="md:col-span-2">
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Game Mode</div>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  {GAME_MODES.map((m) => {
                    const active = m.id === mode
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setMode(m.id)}
                        className={[
                          'rounded-2xl border p-3 text-left transition',
                          active
                            ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25'
                            : 'border-white/10 bg-white/5 hover:bg-white/8',
                        ].join(' ')}
                      >
                        <div className="text-sm font-bold">{m.label}</div>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-4 md:p-6">
            <div className="flex items-center gap-2 text-sm font-bold">
              <FiTag /> <span>Comparison Cards</span>
            </div>
            <p className="mt-1 text-xs text-muted">
              Ranked by affordability, then closest-to-budget, then meeting minimum player requirements.
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {top3.map((item) => {
                const active = best?.pkg.id === item.pkg.id
                const remaining = budgetSafe - item.pricing.total
                return (
                  <motion.div
                    key={item.pkg.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35 }}
                    className={[
                      'rounded-2xl border p-4 transition',
                      active ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25' : 'border-white/10 bg-white/5',
                    ].join(' ')}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold">{item.pkg.name}</div>
                        <div className="mt-1 text-xs text-muted">Min {item.pkg.minPlayers} players</div>
                      </div>
                      {active ? <FiCheck className="mt-1 text-gold" /> : <FiTag className="mt-1 text-muted" />}
                    </div>

                    <div className="mt-4">
                      <div className="text-xs text-muted">Total est.</div>
                      <div className="mt-1 text-2xl font-black text-gold">₱{item.pricing.total.toLocaleString()}</div>
                    </div>

                    <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs text-muted">Budget fit</div>
                        <div className={['text-xs font-bold', remaining >= 0 ? 'text-success' : 'text-danger'].join(' ')}>
                          {remaining >= 0 ? `Within (${remaining.toLocaleString()} left)` : `Over (+${Math.abs(remaining).toLocaleString()})`}
                        </div>
                      </div>
                      <div className="mt-2 text-[11px] text-muted">Discount: {item.pricing.discountLabel} • Session {item.pricing.sessionMultiplier}×</div>
                    </div>

                    <div className="mt-4">
                      <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Equipment included</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {item.pkg.equipment.slice(0, 3).map((e) => (
                          <div key={e.id} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-muted">
                            {e.name}
                          </div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )
              })}
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-black/15 p-4">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiInfo /> <span>Best Value Signal</span>
              </div>
              <div className="mt-2 text-xs text-muted">
                Best value chooses affordability first, then closest total to your budget, then minimum player requirement.
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-4 md:p-6">
            <div className="flex items-center gap-2 text-sm font-bold">
              <FiTag /> <span>Best Value</span>
            </div>

            {best ? (
              <div className="mt-4">
                <div className="rounded-2xl border border-accent/40 bg-accent/10 p-4">
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Recommended</div>
                  <div className="mt-2 text-lg font-black text-gold">{best.pkg.name}</div>
                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div>
                      <div className="text-xs text-muted">Total est.</div>
                      <div className="mt-1 text-3xl font-black text-gold">₱{best.pricing.total.toLocaleString()}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted">Per player</div>
                      <div className="mt-1 text-sm font-bold">₱{best.pricing.perPlayer.toLocaleString()}</div>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="text-xs text-muted">Savings signal</div>
                    <div className={['text-xs font-bold', savings > 0 ? 'text-success' : 'text-muted'].join(' ')}>
                      {savings > 0 ? `₱${savings.toLocaleString()} value` : '—'}
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center gap-2">
                    <div className="h-10 w-10 rounded-2xl bg-accent/10 ring-1 ring-accent/25 grid place-items-center">
                      <FiUsers className="text-gold" />
                    </div>
                    <div>
                      <div className="text-xs text-muted">Group fit</div>
                      <div className="mt-1 text-sm font-bold">
                        {playerSafe < best.pkg.minPlayers
                          ? `Increase players to minimum ${best.pkg.minPlayers}.`
                          : 'Your group meets the minimum requirements.'}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <Button
                    variant="primary"
                    className="w-full"
                    disabled={!canSubmit}
                    onClick={() => {
                      if (!best || !canSubmit) return
                      navigate('/app/reservations', {
                        state: {
                          fromPackageRecommendation: true,
                          players: playerSafe,
                          sessionType: budgetModel,
                          mode: best.pkg.mode,
                          selectedPackageId: best.pkg.id,
                        },
                      })
                    }}
                  >
                    Select package
                    <FiChevronRight />
                  </Button>
                  <div className="mt-2 text-[11px] text-muted">
                    In the full capstone flow, this selection feeds reservation calendar pricing.
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 text-sm text-muted">No packages found for this mode.</div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

