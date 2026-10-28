import React, { useMemo, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import {
  FiCheck,
  FiChevronRight,
  FiInfo,
  FiPackage,
  FiTag,
  FiUsers,
  FiDollarSign,
  FiCrosshair,
  FiX,
} from 'react-icons/fi'
import toast from 'react-hot-toast'

import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { apiGet } from '../../utils/apiClient'
import { calculatePackagePricing, resolvePackageDiscountConfig } from '../../utils/packagePricing'
import { savePackagePrefill, type PackageRecommendationPrefill } from '../../utils/packagePrefill'
import { modelOf } from '../../utils/inventoryModels'

const ENTRANCE_FEE_PER_PLAYER = 150
const MAX_PLAYERS = 40
const MAX_WEAPONS = 200

type RentalPackage = {
  id: string
  name: string
  discountPct: number
  discountMode?: 'percent' | 'amount' | 'settled'
  discountValue?: number
  discountTargets?: Array<'package_total' | 'weapons' | 'equipment' | 'entrance'>
  description: string
  basePrice: number
  minPlayers: number
  // Number of players this package is priced for (0 = not fixed to a headcount)
  players: number
  // Fixed total (before discount) for `players` players (0 = use computed pricing)
  settledAmount: number
  // Number of weapons the package gives
  weaponCount: number
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

type PricingResult = {
  total: number
  perPlayer: number
  equipmentCost: number
  entranceFee: number
  discountPct: number
  discountLabel: string
  sessionMultiplier: number
  savings: number
  originalTotal: number
  perPlayerBeforeDiscount: number
  subtotal: number
  discountAmount: number
  discountSummary: string
  isSettled: boolean
  settledAmount: number
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

// Package with a fixed (settled) amount: the price is set for `pkg.players` players.
// The percent / fixed-amount discount is applied on top of the settled amount.
function computeSettledTotal(pkg: RentalPackage, players: number): PricingResult {
  const settled = Math.max(0, Math.round(pkg.settledAmount || 0))
  const cfg = resolvePackageDiscountConfig(pkg)
  const rawDiscount = cfg.mode === 'percent' ? (settled * cfg.value) / 100 : cfg.value
  const discountAmount = cfg.mode === 'settled' ? 0 : Math.round(clamp(rawDiscount, 0, settled))
  const total = settled - discountAmount
  const safePlayers = Math.max(1, players)

  const discountSummary =
    discountAmount > 0
      ? cfg.mode === 'percent'
        ? `${cfg.value}% off`
        : `₱${Math.round(cfg.value).toLocaleString()} off`
      : 'No discount'

  return {
    total,
    perPlayer: Math.round(total / safePlayers),
    equipmentCost: 0,
    entranceFee: ENTRANCE_FEE_PER_PLAYER,
    discountPct: cfg.mode === 'percent' ? cfg.value : 0,
    discountLabel: cfg.mode === 'settled' ? 'Settled amount' : discountSummary,
    sessionMultiplier: 1,
    savings: discountAmount,
    originalTotal: settled,
    perPlayerBeforeDiscount: Math.round(settled / safePlayers),
    subtotal: settled,
    discountAmount,
    discountSummary,
    isSettled: true,
    settledAmount: settled,
  }
}

function computeTotal({
  pkg,
  players,
  ownWeapons,
  budgetModel,
  weapons,
  equipment,
}: {
  pkg: RentalPackage
  players: number
  ownWeapons: number
  budgetModel: 'public' | 'private'
  weapons: WeaponItem[]
  equipment: EquipmentItem[]
}): PricingResult {
  // Settled amount wins: the package has a fixed price for its set number of players
  if (pkg.settledAmount > 0) {
    return computeSettledTotal(pkg, players)
  }

  // Matches the server's PRIVATE_SESSION_PRICE_MULTIPLIER (1) so quotes equal the booked price.
  const sessionMultiplier = 1
  const pricing = calculatePackagePricing({
    pkg,
    players,
    ownWeapons,
    sessionMultiplier,
    weapons,
    equipment,
    entranceFeePerPlayer: ENTRANCE_FEE_PER_PLAYER,
  })

  return {
    total: pricing.total,
    perPlayer: pricing.perPlayer,
    equipmentCost: pricing.weaponsTotal + pricing.equipmentTotal,
    entranceFee: ENTRANCE_FEE_PER_PLAYER,
    discountPct: pricing.isLegacyPct ? pkg.discountPct : (pricing.discountMode === 'percent' && pricing.discountTargets.includes('package_total') ? pricing.discountValue : 0),
    discountLabel: pricing.discountLabel,
    sessionMultiplier,
    savings: Math.max(0, pricing.discountAmount),
    originalTotal: pricing.preDiscountTotal,
    perPlayerBeforeDiscount: Math.round((pricing.basePriceTotal + pricing.weaponsTotal + pricing.equipmentTotal + pricing.entranceFeeTotal) / Math.max(1, players)),
    subtotal: pricing.preDiscountTotal,
    discountAmount: pricing.discountAmount,
    discountSummary: pricing.discountSummary,
    isSettled: false,
    settledAmount: 0,
  }
}

type IncludedRow = {
  item: { id: string; name: string; category: string; price: number }
  qty: number
}

// Turns a list of ids into rows, merging duplicates into a quantity
function buildRows<T extends { id: string; name: string; category: string; price: number }>(ids: string[], list: T[]): IncludedRow[] {
  const map = new Map<string, IncludedRow>()
  for (const id of ids || []) {
    const found = list.find((entry) => entry.id === id)
    if (!found) continue
    const existing = map.get(id)
    if (existing) existing.qty += 1
    // Packages name a kind of item; show the model ("M4 Rifle"), not the sample piece ("M4 Rifle #1").
    else map.set(id, { item: { ...found, name: modelOf(found) }, qty: 1 })
  }
  return Array.from(map.values())
}

function getIncludedItems(pkg: RentalPackage, weapons: WeaponItem[], equipment: EquipmentItem[]) {
  const weaponRows = buildRows(pkg.weaponIds, weapons)
  const equipmentRows = buildRows(pkg.equipmentIds, equipment)
  return {
    weaponRows,
    equipmentRows,
    count: weaponRows.reduce((n, r) => n + r.qty, 0) + equipmentRows.reduce((n, r) => n + r.qty, 0),
  }
}

function IncludedRows({ rows }: { rows: IncludedRow[] }) {
  return (
    <div className="space-y-2">
      {rows.map(({ item, qty }) => (
        <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{qty > 1 ? `${qty} × ` : ''}{item.name}</div>
            <div className="text-[11px] uppercase tracking-widest text-muted">{item.category}</div>
          </div>
          <div className="flex-none text-xs font-semibold text-muted">
            {item.price > 0 ? `₱${(item.price * qty).toLocaleString()}` : 'Included'}
          </div>
        </div>
      ))}
    </div>
  )
}

export function PackageRecommendationPage() {
  const navigate = useNavigate()
  const [budget, setBudget] = useState<number>(25000)
  const [budgetInput, setBudgetInput] = useState('25000')
  const [budgetError, setBudgetError] = useState('')
  const [players, setPlayers] = useState<number>(8)
  const [playersInput, setPlayersInput] = useState('8')
  const [playersError, setPlayersError] = useState('')
  // Weapons the player wants to avail (empty = no preference)
  const [weaponsWanted, setWeaponsWanted] = useState<number>(0)
  const [weaponsInput, setWeaponsInput] = useState('')
  const [weaponsError, setWeaponsError] = useState('')
  const [ownWeapons, setOwnWeapons] = useState<number>(0)
  const [ownWeaponsInput, setOwnWeaponsInput] = useState('')
  const [ownWeaponsError, setOwnWeaponsError] = useState('')
  const [budgetModel, setBudgetModel] = useState<'public' | 'private'>('public')
  const [packages, setPackages] = useState<RentalPackage[]>([])
  const [weapons, setWeapons] = useState<WeaponItem[]>([])
  const [equipment, setEquipment] = useState<EquipmentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [detailsPackageId, setDetailsPackageId] = useState<string | null>(null)

  // Esc closes the details window, and the page behind it stops scrolling
  useEffect(() => {
    if (!detailsPackageId) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetailsPackageId(null)
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [detailsPackageId])

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
        const active: RentalPackage[] = pkgDocs
          .filter((d: any) => d.status === 'active' || !d.status)
          .map((d: any) => {
            const weaponIds = Array.isArray(d.weaponIds) ? d.weaponIds : []
            return {
              id: d.id ?? (d._id ? String(d._id) : undefined),
              name: d.name || 'Unnamed package',
              discountPct: typeof d.discountPct === 'number' ? d.discountPct : 0,
              discountMode: d.discountMode === 'amount' ? 'amount' : d.discountMode === 'settled' ? 'settled' : d.discountMode === 'percent' ? 'percent' : undefined,
              discountValue: typeof d.discountValue === 'number' ? d.discountValue : undefined,
              discountTargets: Array.isArray(d.discountTargets) ? d.discountTargets : undefined,
              description: d.description || '',
              basePrice: typeof d.basePrice === 'number' ? d.basePrice : 0,
              minPlayers: typeof d.minPlayers === 'number' ? d.minPlayers : 1,
              players: typeof d.players === 'number' ? d.players : 0,
              settledAmount: typeof d.settledAmount === 'number' ? d.settledAmount : 0,
              weaponCount: typeof d.weaponCount === 'number' && d.weaponCount > 0 ? d.weaponCount : weaponIds.length,
              weaponIds,
              equipmentIds: Array.isArray(d.equipmentIds) ? d.equipmentIds : [],
              tier: d.tier || 'starter',
              status: d.status || 'active',
            }
          })
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
  const playerSafe = clamp(players, minimumPlayersRequired, MAX_PLAYERS)
  const weaponsWantedSafe = clamp(weaponsWanted, 0, MAX_WEAPONS)
  const ownWeaponsSafe = clamp(ownWeapons, 0, MAX_WEAPONS)
  const rentalWeaponsNeeded = Math.max(0, playerSafe - ownWeaponsSafe)

  // Every package that fits the group size and weapon request, priced for this group
  const priced = useMemo(() => {
    return packages
      .filter((pkg) => {
        // Packages with a set headcount only match that exact number of players
        const playersOk = pkg.players > 0 ? pkg.players === playerSafe : playerSafe >= pkg.minPlayers
        // Settled packages give a fixed number of weapons for the whole group; computed
        // packages are per player (the server rents weaponCount × players).
        const totalWeapons = pkg.settledAmount > 0 ? pkg.weaponCount : pkg.weaponCount * playerSafe
        const weaponsOk = totalWeapons >= rentalWeaponsNeeded && (weaponsWantedSafe <= 0 || totalWeapons >= weaponsWantedSafe)
        return playersOk && weaponsOk
      })
      .map((pkg) => {
        const pricing = computeTotal({ pkg, players: playerSafe, budgetModel, weapons, equipment, ownWeapons: ownWeaponsSafe })
        return { pkg, pricing, affordable: pricing.total <= budgetSafe }
      })
      .sort((a, b) => a.pricing.total - b.pricing.total)
  }, [packages, budgetSafe, budgetModel, playerSafe, weaponsWantedSafe, ownWeaponsSafe, weapons, equipment])

  // Only packages that match the group AND fit the budget are recommended
  const scored = useMemo(() => priced.filter((item) => item.affordable), [priced])
  const closestOver = useMemo(() => priced.find((item) => !item.affordable), [priced])

  // Packages hidden only because the group size doesn't fit, so the empty state can say why
  const blockedByPlayers = useMemo(() => {
    return packages
      .filter((pkg) => {
        const playersOk = pkg.players > 0 ? pkg.players === playerSafe : playerSafe >= pkg.minPlayers
        // Judge weapons at the player count the hint will suggest (same per-player rule as above)
        const suggestedPlayers = pkg.players > 0 ? pkg.players : Math.max(playerSafe, pkg.minPlayers)
        const totalWeapons = pkg.settledAmount > 0 ? pkg.weaponCount : pkg.weaponCount * suggestedPlayers
        const weaponsOk = totalWeapons >= rentalWeaponsNeeded && (weaponsWantedSafe <= 0 || totalWeapons >= weaponsWantedSafe)
        return !playersOk && weaponsOk
      })
      .sort((a, b) => Math.abs((a.players || a.minPlayers) - playerSafe) - Math.abs((b.players || b.minPlayers) - playerSafe))
  }, [packages, playerSafe, rentalWeaponsNeeded, weaponsWantedSafe])
  const nearestByPlayers = blockedByPlayers[0]

  const best = scored[0]
  const [selectedPackageId, setSelectedPackageId] = useState<string | undefined>(best?.pkg.id)

  useEffect(() => {
    if (scored.length === 0) {
      if (selectedPackageId) setSelectedPackageId(undefined)
      return
    }
    if (!selectedPackageId || !scored.some((item) => item.pkg.id === selectedPackageId)) {
      setSelectedPackageId(best?.pkg.id)
    }
  }, [best, scored, selectedPackageId])

  const selectedItem = scored.find((item) => item.pkg.id === selectedPackageId) || best
  const selectedPackage = selectedItem?.pkg

  const selectedIncluded = selectedPackage ? getIncludedItems(selectedPackage, weapons, equipment) : null
  const detailsItem = detailsPackageId ? priced.find((item) => item.pkg.id === detailsPackageId) : undefined
  const detailsIncluded = detailsItem ? getIncludedItems(detailsItem.pkg, weapons, equipment) : null

  const canSubmit = Boolean(
    selectedPackage &&
      budgetInput.trim() !== '' &&
      playersInput.trim() !== '' &&
      Number(budgetInput) >= 1000 &&
      Number(playersInput) >= minimumPlayersRequired &&
      !weaponsError &&
      !ownWeaponsError,
  )

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="text-sm font-medium text-accent">Packages</div>
        <h1 className="text-3xl font-bold">Package Recommendation</h1>
        <p className="mt-1 text-sm text-muted">
          Enter your budget and group size — we will show the packages that match your group and fit your budget.
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

            <div className="mt-4 grid gap-4 md:grid-cols-4">
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
                      } else if (nextValue > MAX_PLAYERS) {
                        setPlayersError(`Maximum ${MAX_PLAYERS} players allowed.`)
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
                      if (currentValue > MAX_PLAYERS) {
                        setPlayersInput(String(MAX_PLAYERS))
                        setPlayers(MAX_PLAYERS)
                        setPlayersError('')
                        return
                      }
                      setPlayersInput(String(clamp(currentValue, minimumPlayersRequired, MAX_PLAYERS)))
                      setPlayers(clamp(currentValue, minimumPlayersRequired, MAX_PLAYERS))
                      setPlayersError('')
                    }}
                  />
                  {playersError ? <p className="mt-1 text-xs text-danger">{playersError}</p> : null}
                </div>
              </div>

              <div>
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Weapons</div>
                <div className="mt-2">
                  <Input
                    type="text"
                    placeholder="Any"
                    value={weaponsInput}
                    onChange={(e) => {
                      const raw = e.target.value
                      if (raw === '') {
                        setWeaponsInput('')
                        setWeaponsWanted(0)
                        setWeaponsError('')
                        return
                      }
                      if (!/^\d+$/.test(raw)) {
                        setWeaponsError('Enter a valid number.')
                        return
                      }
                      const nextValue = Number(raw)
                      if (nextValue > MAX_WEAPONS) {
                        setWeaponsError(`Maximum ${MAX_WEAPONS} weapons.`)
                      } else {
                        setWeaponsError('')
                      }
                      setWeaponsInput(raw)
                      setWeaponsWanted(nextValue)
                    }}
                    onBlur={() => {
                      if (weaponsInput === '') {
                        setWeaponsWanted(0)
                        setWeaponsError('')
                        return
                      }
                      const safe = clamp(Number(weaponsInput) || 0, 0, MAX_WEAPONS)
                      setWeaponsInput(safe > 0 ? String(safe) : '')
                      setWeaponsWanted(safe)
                      setWeaponsError('')
                    }}
                  />
                  {weaponsError ? <p className="mt-1 text-xs text-danger">{weaponsError}</p> : (
                    <p className="mt-1 text-[11px] text-muted">Packages with at least this many weapons.</p>
                  )}
                </div>
              </div>

              <div>
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Own weapons</div>
                <div className="mt-2">
                  <Input
                    type="text"
                    placeholder="0"
                    value={ownWeaponsInput}
                    onChange={(e) => {
                      const raw = e.target.value
                      if (raw === '') {
                        setOwnWeaponsInput('')
                        setOwnWeapons(0)
                        setOwnWeaponsError('')
                        return
                      }
                      if (!/^\d+$/.test(raw)) {
                        setOwnWeaponsError('Enter a valid number.')
                        return
                      }
                      const nextValue = Number(raw)
                      setOwnWeaponsInput(raw)
                      setOwnWeapons(nextValue)
                      setOwnWeaponsError(nextValue > MAX_WEAPONS ? `Maximum ${MAX_WEAPONS} weapons.` : '')
                    }}
                    onBlur={() => {
                      const safe = clamp(Number(ownWeaponsInput) || 0, 0, MAX_WEAPONS)
                      setOwnWeaponsInput(safe > 0 ? String(safe) : '')
                      setOwnWeapons(safe)
                      setOwnWeaponsError('')
                    }}
                  />
                  {ownWeaponsError ? <p className="mt-1 text-xs text-danger">{ownWeaponsError}</p> : (
                    <p className="mt-1 text-[11px] text-muted">Your own weapons reduce rentals and their cost.</p>
                  )}
                </div>
              </div>

              <div className="md:col-span-3">
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
                <div className="mt-3 rounded-2xl border border-accent/20 bg-accent/5 p-3 text-xs text-muted">
                  <span className="font-semibold text-accent">Note:</span> Public sessions are only available on weekends.
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-4 md:p-6">
            <div className="flex items-center gap-2 text-sm font-bold">
              <FiTag /> <span>Matching Packages</span>
            </div>
            <p className="mt-1 text-xs text-muted">
              Showing packages for {playerSafe} player{playerSafe === 1 ? '' : 's'}
              {` with ${rentalWeaponsNeeded} rental weapon${rentalWeaponsNeeded === 1 ? '' : 's'}`} within ₱{budgetSafe.toLocaleString()}, cheapest first.
            </p>

            {loading ? (
              <div className="mt-4 text-sm text-muted">Loading packages...</div>
            ) : packages.length === 0 ? (
              <div className="mt-4 text-sm text-muted">No packages available. Ask admin to create rental packages.</div>
            ) : scored.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-muted">
                <div className="font-semibold text-text">No package matches your budget and group.</div>
                <div className="mt-1 text-xs">
                  {closestOver
                    ? `The closest match is "${closestOver.pkg.name}" at ₱${closestOver.pricing.total.toLocaleString()} for ${playerSafe} player${playerSafe === 1 ? '' : 's'} — increase your budget by ₱${(closestOver.pricing.total - budgetSafe).toLocaleString()} to see it.`
                    : nearestByPlayers
                      ? nearestByPlayers.players > 0
                        ? `"${nearestByPlayers.name}" is set for exactly ${nearestByPlayers.players} players — change players to ${nearestByPlayers.players} to see it.`
                        : `"${nearestByPlayers.name}" needs at least ${nearestByPlayers.minPlayers} players — increase players to ${nearestByPlayers.minPlayers} to see it.`
                      : 'Try a different number of players or fewer weapons.'}
                </div>
              </div>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {scored.map((item, index) => {
                  const active = selectedPackageId === item.pkg.id
                  const remaining = budgetSafe - item.pricing.total
                  return (
                    <motion.div
                      key={item.pkg.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.35 }}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedPackageId(item.pkg.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setSelectedPackageId(item.pkg.id)
                        }
                      }}
                      className={[
                        'rounded-2xl border p-4 transition focus:outline-none focus:ring-2 focus:ring-accent/40',
                        active ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25' : 'border-white/10 bg-white/5 hover:bg-white/8',
                      ].join(' ')}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-bold">{item.pkg.name}</div>
                          <div className="mt-1 text-xs text-muted">
                            {item.pkg.players > 0 ? `Set for ${item.pkg.players} players` : `Min ${item.pkg.minPlayers} players`}
                          </div>
                        </div>
                        {active ? <FiCheck className="mt-1 text-gold" /> : <FiTag className="mt-1 text-muted" />}
                      </div>

                      {index === 0 ? (
                        <div className="mt-2 inline-flex rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-success">
                          Best value
                        </div>
                      ) : null}

                      <div className="mt-4">
                        <div className="text-xs text-muted">
                          {item.pricing.isSettled ? `You will spend (${playerSafe} players)` : 'Total est.'}
                        </div>
                        <div className="mt-1 text-2xl font-black text-gold">₱{item.pricing.total.toLocaleString()}</div>
                        <div className="mt-1 text-[11px] text-muted">₱{item.pricing.perPlayer.toLocaleString()} per player</div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <div className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-muted">
                          <FiCrosshair /> {item.pkg.weaponCount} weapon{item.pkg.weaponCount === 1 ? '' : 's'}
                        </div>
                        {item.pkg.equipmentIds.length > 0 ? (
                          <div className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-muted">
                            <FiPackage /> {item.pkg.equipmentIds.length} equipment
                          </div>
                        ) : null}
                      </div>

                      <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs text-muted">Budget fit</div>
                          <div className={['text-xs font-bold', remaining >= 0 ? 'text-success' : 'text-danger'].join(' ')}>
                            {remaining >= 0 ? `Within (₱${remaining.toLocaleString()} left)` : `Over (+₱${Math.abs(remaining).toLocaleString()})`}
                          </div>
                        </div>

                        {item.pricing.discountAmount > 0 && (
                          <div className="mt-2 space-y-1">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-muted">Discount</span>
                              <span className="font-semibold text-success">{item.pricing.discountSummary}</span>
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

                        {!item.pricing.isSettled ? (
                          <div className="mt-2 text-[11px] text-muted">Session {item.pricing.sessionMultiplier}×</div>
                        ) : (
                          <div className="mt-2 text-[11px] text-muted">Fixed price while the player count stays at {item.pkg.players}.</div>
                        )}
                      </div>

                      {item.pkg.description && (
                        <div className="mt-3 text-[11px] text-muted italic">
                          {item.pkg.description}
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          setDetailsPackageId(item.pkg.id)
                        }}
                        onKeyDown={(event) => event.stopPropagation()}
                        className="mt-3 inline-flex items-center gap-2 text-[11px] font-semibold text-accent hover:underline"
                      >
                        <FiPackage /> See included items
                      </button>
                    </motion.div>
                  )
                })}
              </div>
            )}

            <div className="mt-4 rounded-2xl border border-white/10 bg-black/15 p-4">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiInfo /> <span>How matching works</span>
              </div>
              <div className="mt-2 text-xs text-muted">
                A package appears when it fits your number of players (packages set for a specific headcount only appear for that exact number),
                has at least the weapons you asked for, and its total after discount is within your budget. Packages with a settled amount keep
                that price as long as your number of players does not change.
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
            ) : selectedPackage && selectedItem ? (
              <div className="mt-4">
                <div className="rounded-2xl border border-accent/40 bg-accent/10 p-4">
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Selected package</div>
                  <div className="mt-2 text-lg font-black text-gold">{selectedPackage.name}</div>
                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div>
                      <div className="text-xs text-muted">{selectedItem.pricing.isSettled ? 'You will spend' : 'Total est.'}</div>
                      <div className="mt-1 text-3xl font-black text-gold">₱{selectedItem.pricing.total.toLocaleString()}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted">Per player</div>
                      <div className="mt-1 text-sm font-bold">₱{selectedItem.pricing.perPlayer.toLocaleString()}</div>
                    </div>
                  </div>

                  {selectedItem.pricing.discountAmount > 0 ? (
                    <div className="mt-3 space-y-1 pt-3 border-t border-accent/20">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs text-muted">Original price</div>
                        <div className="text-xs text-muted line-through">₱{selectedItem.pricing.originalTotal.toLocaleString()}</div>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs text-muted">Discount</div>
                        <div className="text-xs font-semibold text-success">{selectedItem.pricing.discountSummary}</div>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs text-muted">You save</div>
                        <div className="text-xs font-bold text-success">
                          ₱{selectedItem.pricing.savings.toLocaleString()}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <div className="text-xs text-muted">Savings</div>
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
                        {selectedPackage.players > 0
                          ? `Fixed price for ${selectedPackage.players} players. Changing the headcount changes the price.`
                          : playerSafe < selectedPackage.minPlayers
                            ? `Increase players to minimum ${selectedPackage.minPlayers}.`
                            : 'Your group meets the minimum requirements.'}
                      </div>
                    </div>
                  </div>
                </div>

                {selectedIncluded ? (
                  <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm font-bold">
                        <FiPackage /> <span>What's included</span>
                      </div>
                      <div className="text-xs text-muted">{selectedIncluded.count} item{selectedIncluded.count === 1 ? '' : 's'}</div>
                    </div>

                    <div className="mt-3 flex items-center gap-2 text-xs text-muted">
                      <FiCrosshair className="flex-none text-gold" />
                      <span>{selectedPackage.weaponCount} weapon{selectedPackage.weaponCount === 1 ? '' : 's'} included</span>
                    </div>

                    {selectedIncluded.count === 0 ? (
                      <div className="mt-3 text-xs text-muted">No rental items are attached to this package.</div>
                    ) : (
                      <ul className="mt-3 space-y-1 text-xs text-muted">
                        {[...selectedIncluded.weaponRows, ...selectedIncluded.equipmentRows].slice(0, 5).map(({ item, qty }) => (
                          <li key={item.id} className="flex items-center gap-2">
                            <FiCheck className="flex-none text-success" />
                            <span className="truncate">{qty > 1 ? `${qty} × ` : ''}{item.name}</span>
                          </li>
                        ))}
                        {selectedIncluded.weaponRows.length + selectedIncluded.equipmentRows.length > 5 ? (
                          <li className="pl-6">+ {selectedIncluded.weaponRows.length + selectedIncluded.equipmentRows.length - 5} more</li>
                        ) : null}
                      </ul>
                    )}

                    <button
                      type="button"
                      onClick={() => setDetailsPackageId(selectedPackage.id)}
                      className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-accent hover:underline"
                    >
                      See all included items <FiChevronRight />
                    </button>
                  </div>
                ) : null}

                <div className="mt-4">
                  <Button
                    variant="primary"
                    className="w-full"
                    disabled={!canSubmit}
                    onClick={() => {
                      if (!selectedPackage || !canSubmit) return
                      const prefill: PackageRecommendationPrefill = {
                        fromPackageRecommendation: true,
                        players: playerSafe,
                        sessionType: budgetModel,
                        selectedPackageId: selectedPackage.id,
                        selectedPackageName: selectedPackage.name,
                        weaponsWanted: weaponsWantedSafe,
                        ownWeapons: ownWeaponsSafe,
                      }
                      savePackagePrefill(prefill)
                      navigate('/app/reservations', { state: prefill })
                    }}
                  >
                    Select package
                    <FiChevronRight />
                  </Button>
                  <div className="mt-2 text-[11px] text-muted">
                    Your package, group size, and own-weapon count carry over to the reservation.
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 text-sm text-muted">
                {packages.length === 0
                  ? 'No packages available. Ask admin to create rental packages.'
                  : 'No package matches your current budget and group yet.'}
              </div>
            )}
          </Card>
        </div>
      </div>

      {detailsItem && detailsIncluded
        ? createPortal(
            <div
              className="fixed inset-0 z-[9999] grid place-items-center bg-black/70 p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="package-details-title"
              onClick={() => setDetailsPackageId(null)}
            >
              <div
                className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[1.75rem] border border-white/10 bg-background p-4 shadow-2xl md:p-6"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-widest text-muted">Package details</div>
                    <h2 id="package-details-title" className="mt-1 text-2xl font-bold">{detailsItem.pkg.name}</h2>
                    {detailsItem.pkg.description ? (
                      <p className="mt-2 text-sm text-muted">{detailsItem.pkg.description}</p>
                    ) : null}
                    <div className="mt-2 text-xs text-muted">
                      {detailsItem.pkg.players > 0 ? `Set for ${detailsItem.pkg.players} players` : `Min ${detailsItem.pkg.minPlayers} players`}
                      {' • '}
                      {detailsItem.pkg.weaponCount} weapon{detailsItem.pkg.weaponCount === 1 ? '' : 's'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDetailsPackageId(null)}
                    aria-label="Close package details"
                    className="rounded-lg p-2 text-muted transition hover:bg-white/10"
                  >
                    <FiX />
                  </button>
                </div>

                <div className="mt-5 space-y-5">
                  <div>
                    <div className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-muted">
                      Weapons ({detailsIncluded.weaponRows.reduce((n, r) => n + r.qty, 0)})
                    </div>
                    {detailsIncluded.weaponRows.length ? (
                      <IncludedRows rows={detailsIncluded.weaponRows} />
                    ) : (
                      <div className="text-xs text-muted">No weapons listed in this package.</div>
                    )}
                  </div>

                  <div>
                    <div className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-muted">
                      Equipment ({detailsIncluded.equipmentRows.reduce((n, r) => n + r.qty, 0)})
                    </div>
                    {detailsIncluded.equipmentRows.length ? (
                      <IncludedRows rows={detailsIncluded.equipmentRows} />
                    ) : (
                      <div className="text-xs text-muted">No equipment in this package.</div>
                    )}
                  </div>

                  {detailsItem.pricing.isSettled ? (
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">
                        Settled price for {playerSafe} player{playerSafe === 1 ? '' : 's'}
                      </div>
                      <div className="mt-3 space-y-2 text-sm">
                        <div className="flex items-center justify-between"><span className="text-muted">Settled amount</span><span>₱{detailsItem.pricing.settledAmount.toLocaleString()}</span></div>
                        {detailsItem.pricing.discountAmount > 0 ? (
                          <div className="flex items-center justify-between text-success"><span>Discount ({detailsItem.pricing.discountSummary})</span><span>− ₱{detailsItem.pricing.discountAmount.toLocaleString()}</span></div>
                        ) : null}
                        <div className="flex items-center justify-between"><span className="text-muted">Per player</span><span>₱{detailsItem.pricing.perPlayer.toLocaleString()}</span></div>
                        <div className="flex items-center justify-between border-t border-white/10 pt-2 text-base font-black text-gold">
                          <span>You will spend</span>
                          <span>₱{detailsItem.pricing.total.toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="mt-3 text-[11px] text-muted">
                        This price stays the same as long as the number of players does not change.
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Price per player</div>
                      <div className="mt-3 space-y-2 text-sm">
                        <div className="flex items-center justify-between"><span className="text-muted">Package base</span><span>₱{detailsItem.pkg.basePrice.toLocaleString()}</span></div>
                        <div className="flex items-center justify-between"><span className="text-muted">Weapons &amp; equipment</span><span>₱{detailsItem.pricing.equipmentCost.toLocaleString()}</span></div>
                        <div className="flex items-center justify-between"><span className="text-muted">Entrance fee</span><span>₱{detailsItem.pricing.entranceFee.toLocaleString()}</span></div>
                        <div className="flex items-center justify-between border-t border-white/10 pt-2 font-semibold"><span>Subtotal</span><span>₱{detailsItem.pricing.perPlayerBeforeDiscount.toLocaleString()}</span></div>
                        {detailsItem.pricing.discountAmount > 0 ? (
                          <div className="flex items-center justify-between text-success"><span>Discount ({detailsItem.pricing.discountSummary})</span><span>− ₱{detailsItem.pricing.discountAmount.toLocaleString()}</span></div>
                        ) : null}
                        {detailsItem.pricing.sessionMultiplier !== 1 ? (
                          <div className="flex items-center justify-between"><span className="text-muted">Private session</span><span>× {detailsItem.pricing.sessionMultiplier}</span></div>
                        ) : null}
                        <div className="flex items-center justify-between border-t border-white/10 pt-2 text-base font-black text-gold">
                          <span>Total for {playerSafe} player{playerSafe === 1 ? '' : 's'}</span>
                          <span>₱{detailsItem.pricing.total.toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
                  <Button variant="ghost" onClick={() => setDetailsPackageId(null)}>Close</Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      setSelectedPackageId(detailsItem.pkg.id)
                      setDetailsPackageId(null)
                    }}
                  >
                    Choose this package
                    <FiChevronRight />
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}