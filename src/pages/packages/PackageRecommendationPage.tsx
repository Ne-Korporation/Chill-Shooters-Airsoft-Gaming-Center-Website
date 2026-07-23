import React, { useMemo, useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import {
  FiCheck,
  FiChevronRight,
  FiInfo,
  FiTag,
  FiUsers,
  FiDollarSign,
} from 'react-icons/fi'
import toast from 'react-hot-toast'

import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { apiGet } from '../../utils/apiClient'

const ENTRANCE_FEE_PER_PLAYER = 150

type RentalPackage = {
  id: string
  name: string
  discountPct: number
  description: string
  basePrice: number
  minPlayers: number
  weaponIds: string[]
  equipmentIds: string[]
  tier?: string
  status?: string
}

type WeaponItem = {
  id: string
  name: string
  category: string
  price: number
}

type EquipmentItem = {
  id: string
  name: string
  category: string
  price: number
  qty: number
}

function calculateEquipmentTotal(pkg: RentalPackage, weapons: WeaponItem[], equipment: EquipmentItem[]): number {
  const weaponTotal = (pkg.weaponIds || [])
    .map((wid) => weapons.find((w) => w.id === wid))
    .filter(Boolean)
    .reduce((sum, w: any) => sum + (w.price || 0), 0)

  const equipmentTotal = (pkg.equipmentIds || [])
    .map((eid) => equipment.find((e) => e.id === eid))
    .filter(Boolean)
    .reduce((sum, e: any) => sum + (e.price || 0), 0)

  return weaponTotal + equipmentTotal
}

function computeTotal({
  pkg,
  players,
  budgetModel,
  weapons,
  equipment,
}: {
  pkg: RentalPackage
  players: number
  budgetModel: 'public' | 'private'
  weapons: WeaponItem[]
  equipment: EquipmentItem[]
}) {
  const sessionMultiplier = budgetModel === 'private' ? 1.25 : 1.0

  // Per player: basePrice + weapons + equipment + entrance fee
  const equipmentCost = calculateEquipmentTotal(pkg, weapons, equipment)
  const perPlayerBeforeDiscount = pkg.basePrice + equipmentCost + ENTRANCE_FEE_PER_PLAYER

  // Apply package discountPct
  const discountedPerPlayer = perPlayerBeforeDiscount * (1 - pkg.discountPct / 100)

  const total = Math.round(discountedPerPlayer * players * sessionMultiplier)
  const perPlayer = Math.round(total / Math.max(1, players))
  const originalTotal = Math.round(perPlayerBeforeDiscount * players * sessionMultiplier)
  const savings = Math.max(0, originalTotal - total)

  return {
    total,
    perPlayer,
    equipmentCost,
    entranceFee: ENTRANCE_FEE_PER_PLAYER,
    discountPct: pkg.discountPct,
    discountLabel: pkg.discountPct > 0 ? `${pkg.discountPct}%` : '—',
    sessionMultiplier,
    savings,
    originalTotal,
    perPlayerBeforeDiscount,
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

export function PackageRecommendationPage() {
  const navigate = useNavigate()
  const [budget, setBudget] = useState<number>(25000)
  const [budgetInput, setBudgetInput] = useState('25000')
  const [budgetError, setBudgetError] = useState('')
  const [players, setPlayers] = useState<number>(8)
  const [playersInput, setPlayersInput] = useState('8')
  const [playersError, setPlayersError] = useState('')
  const [budgetModel, setBudgetModel] = useState<'public' | 'private'>('public')
  const [packages, setPackages] = useState<RentalPackage[]>([])
  const [weapons, setWeapons] = useState<WeaponItem[]>([])
  const [equipment, setEquipment] = useState<EquipmentItem[]>([])
  const [loading, setLoading] = useState(true)

  // Fetch real packages, weapons, and equipment from API
  useEffect(() => {
    let cancelled = false
    const fetchAll = async () => {
      try {
        const [pkgRes, wepRes, eqRes] = await Promise.all([
          apiGet<{ ok: boolean; data: any[] }>('/api/packages?limit=200'),
          apiGet<{ ok: boolean; data: any[] }>('/api/weapons?limit=200'),
          apiGet<{ ok: boolean; data: any[] }>('/api/equipments?limit=200'),
        ])

        if (cancelled) return

        // Parse packages
        const pkgDocs = Array.isArray(pkgRes?.data) ? pkgRes.data : []
        const active = pkgDocs
          .filter((d: any) => d.status === 'active' || !d.status)
          .map((d: any) => ({
            id: d.id ?? (d._id ? String(d._id) : undefined),
            name: d.name || 'Unnamed package',
            discountPct: typeof d.discountPct === 'number' ? d.discountPct : 0,
            description: d.description || '',
            basePrice: typeof d.basePrice === 'number' ? d.basePrice : 0,
            minPlayers: typeof d.minPlayers === 'number' ? d.minPlayers : 1,
            weaponIds: Array.isArray(d.weaponIds) ? d.weaponIds : [],
            equipmentIds: Array.isArray(d.equipmentIds) ? d.equipmentIds : [],
            tier: d.tier || 'starter',
            status: d.status || 'active',
          }))
        setPackages(active)

        // Parse weapons
        const wepDocs = Array.isArray(wepRes?.data) ? wepRes.data : []
        setWeapons(wepDocs.map((d: any) => ({
          id: d.id ?? (d._id ? String(d._id) : undefined),
          name: d.name || 'Unnamed weapon',
          category: d.category || 'rifles',
          price: typeof d.price === 'number' ? d.price : 0,
        })))

        // Parse equipment
        const eqDocs = Array.isArray(eqRes?.data) ? eqRes.data : []
        setEquipment(eqDocs.map((d: any) => ({
          id: d.id ?? (d._id ? String(d._id) : undefined),
          name: d.name || 'Unnamed equipment',
          category: d.category || 'gear',
          price: typeof d.price === 'number' ? d.price : 0,
          qty: typeof d.qty === 'number' ? d.qty : 1,
        })))
      } catch (e: any) {
        if (!cancelled) {
          toast.error(String(e?.message || e))
          setPackages([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchAll()
    return () => { cancelled = true }
  }, [])

  const budgetSafe = clamp(budget, 1000, 999999999)
  const minimumPlayersRequired = budgetModel === 'private' ? 10 : 1
  const playerSafe = clamp(players, minimumPlayersRequired, 40)

  const scored = useMemo(() => {
    return packages
      .map((pkg) => {
        const pricing = computeTotal({ pkg, players: playerSafe, budgetModel, weapons, equipment })
        const affordable = pricing.total <= budgetSafe
        const delta = Math.abs(pricing.total - budgetSafe)
        const minPenalty = Math.max(0, pkg.minPlayers - playerSafe) * 600
        return { pkg, pricing, affordable, delta, minPenalty }
      })
      .sort((a, b) => {
        if (a.affordable !== b.affordable) return a.affordable ? -1 : 1
        if (a.delta !== b.delta) return a.delta - b.delta
        return a.minPenalty - b.minPenalty
      })
  }, [packages, budgetSafe, budgetModel, playerSafe, weapons, equipment])

  const best = scored[0]
  const top3 = scored.slice(0, 3)
  const canSubmit = Boolean(
    best &&
      budgetInput.trim() !== '' &&
      playersInput.trim() !== '' &&
      Number(budgetInput) >= 1000 &&
      Number(playersInput) >= minimumPlayersRequired,
  )

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-muted">
          <span className="grid h-2.5 w-2.5 place-items-center rounded-full bg-accent" />
          <span className="uppercase tracking-[0.18em]">Packages</span>
        </div>
        <h1 className="text-3xl font-bold">Package Recommendation</h1>
        <p className="mt-1 text-sm text-muted">
          Enter your budget and group size — we will recommend the best package for your session.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <Card className="p-4 md:p-6">
            <div className="flex items-center gap-2 text-sm font-bold">
              <FiDollarSign /> <span>Your Budget & Group</span>
            </div>
            <p className="mt-1 text-xs text-muted">
              Used to match packages and calculate estimated total.
            </p>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Budget (₱)</div>
                <div className="mt-2">
                  <Input
                    type="text"
                    value={budgetInput}
                    onChange={(e) => {
                      const raw = e.target.value
                      if (raw === '') {
                        setBudgetInput('')
                        setBudgetError('Budget is required.')
                        return
                      }
                      if (!/^\d+$/.test(raw)) {
                        setBudgetError('Enter a valid number.')
                        return
                      }
                      const nextValue = Number(raw)
                      if (nextValue < 1000) {
                        setBudgetError('Budget must be at least ₱1,000.')
                      } else {
                        setBudgetError('')
                      }
                      setBudgetInput(raw)
                      setBudget(nextValue)
                    }}
                    onBlur={() => {
                      if (!budgetInput) {
                        setBudgetInput('1000')
                        setBudget(1000)
                        setBudgetError('')
                        return
                      }
                      const currentValue = Number(budgetInput)
                      if (Number.isNaN(currentValue) || currentValue < 1000) {
                        setBudgetInput('1000')
                        setBudget(1000)
                        setBudgetError('')
                      }
                    }}
                  />
                  {budgetError ? <p className="mt-1 text-xs text-danger">{budgetError}</p> : null}
                </div>
              </div>

              <div>
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Players</div>
                <div className="mt-2">
                  <Input
                    type="text"
                    value={playersInput}
                    onChange={(e) => {
                      const raw = e.target.value
                      if (raw === '') {
                        setPlayersInput('')
                        setPlayersError('Number of players is required.')
                        return
                      }
                      if (!/^\d+$/.test(raw)) {
                        setPlayersError('Enter a valid number.')
                        return
                      }
                      const nextValue = Number(raw)
                      if (nextValue < minimumPlayersRequired) {
                        setPlayersError(`Minimum ${minimumPlayersRequired} players required.`)
                      } else if (nextValue > 40) {
                        setPlayersError('Maximum 40 players allowed.')
                      } else {
                        setPlayersError('')
                      }
                      setPlayersInput(raw)
                      setPlayers(nextValue)
                    }}
                    onBlur={() => {
                      const currentValue = Number(playersInput)
                      if (!playersInput || Number.isNaN(currentValue) || currentValue < minimumPlayersRequired) {
                        setPlayersInput(String(minimumPlayersRequired))
                        setPlayers(minimumPlayersRequired)
                        setPlayersError('')
                        return
                      }
                      if (currentValue > 40) {
                        setPlayersInput('40')
                        setPlayers(40)
                        setPlayersError('')
                        return
                      }
                      setPlayersInput(String(clamp(currentValue, minimumPlayersRequired, 40)))
                      setPlayers(clamp(currentValue, minimumPlayersRequired, 40))
                      setPlayersError('')
                    }}
                  />
                  {playersError ? <p className="mt-1 text-xs text-danger">{playersError}</p> : null}
                </div>
              </div>

              <div className="md:col-span-2">
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Session Type</div>
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
            </div>
          </Card>

          <Card className="p-4 md:p-6">
            <div className="flex items-center gap-2 text-sm font-bold">
              <FiTag /> <span>Comparison Cards</span>
            </div>
            <p className="mt-1 text-xs text-muted">
              Ranked by affordability, then closest-to-budget, then meeting minimum player requirements.
            </p>

            {loading ? (
              <div className="mt-4 text-sm text-muted">Loading packages...</div>
            ) : top3.length === 0 ? (
              <div className="mt-4 text-sm text-muted">No packages available. Ask admin to create rental packages.</div>
            ) : (
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
                            {remaining >= 0 ? `Within (₱${remaining.toLocaleString()} left)` : `Over (+₱${Math.abs(remaining).toLocaleString()})`}
                          </div>
                        </div>

                        {item.pricing.discountPct > 0 && (
                          <div className="mt-2 space-y-1">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-muted">Discount</span>
                              <span className="font-semibold text-success">{item.pricing.discountLabel}</span>
                            </div>
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-muted">You save</span>
                              <span className="font-semibold text-success">₱{item.pricing.savings.toLocaleString()}</span>
                            </div>
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-muted">Original price</span>
                              <span className="text-muted line-through">₱{item.pricing.originalTotal.toLocaleString()}</span>
                            </div>
                          </div>
                        )}

                        <div className="mt-2 text-[11px] text-muted">Session {item.pricing.sessionMultiplier}×</div>
                      </div>

                      {item.pkg.description && (
                        <div className="mt-3 text-[11px] text-muted italic">
                          {item.pkg.description}
                        </div>
                      )}
                    </motion.div>
                  )
                })}
              </div>
            )}

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

            {loading ? (
              <div className="mt-4 text-sm text-muted">Loading...</div>
            ) : best ? (
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

                  {best.pricing.discountPct > 0 ? (
                    <div className="mt-3 space-y-1 pt-3 border-t border-accent/20">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs text-muted">Original price</div>
                        <div className="text-xs text-muted line-through">₱{best.pricing.originalTotal.toLocaleString()}</div>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs text-muted">Discount</div>
                        <div className="text-xs font-semibold text-success">{best.pricing.discountLabel}</div>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs text-muted">Savings signal</div>
                        <div className="text-xs font-bold text-success">
                          ₱{best.pricing.savings.toLocaleString()} value
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <div className="text-xs text-muted">Savings signal</div>
                      <div className="text-xs text-muted">—</div>
                    </div>
                  )}
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
              <div className="mt-4 text-sm text-muted">No packages available. Ask admin to create rental packages.</div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}