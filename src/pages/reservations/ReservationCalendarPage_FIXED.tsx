import React, { useMemo, useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useLocation } from 'react-router-dom'
import {
  FiAlertTriangle,
  FiCalendar,
  FiCheck,
  FiChevronRight,
  FiClock,
  FiMapPin,
  FiMinus,
  FiPlus,
  FiShield,
  FiSliders,
  FiTag,
  FiUsers,
} from 'react-icons/fi'

import { WaiverPage } from '../waiver/WaiverPage'
import { PaymentPage } from '../payments/PaymentPage'

import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'

type Field = {
  id: string
  name: string
  location: string
}

type TimeSlot = 'morning' | 'afternoon' | 'evening'

type SessionType = 'public' | 'private'

type ReservationRecord = {
  id: string
  dateISO: string
  fieldId: string
  slot: TimeSlot
  sessionType: SessionType
  players: number
}

type EquipmentItem = {
  id: string
  name: string
  qty: number
  pricePerPlayer: number
}

type GameMode = 'squad-deathmatch' | 'ctf' | 'search-and-destroy'

type Package = {
  id: string
  name: string
  mode: GameMode
  basePrice: number
  equipment: EquipmentItem[]
  minPlayers: number
}

const fields: Field[] = [
  { id: 'field-1', name: 'Upper Ground', location: 'Main Range / North Gate' },
  { id: 'field-2', name: 'Lower Ground', location: 'Ops Lane / East Drop' },
  { id: 'field-3', name: 'Forest', location: 'Training Block / West Bay' },
]

const GAME_MODES: { id: GameMode; label: string; detail: string }[] = [
  {
    id: 'squad-deathmatch',
    label: 'Squad Deathmatch',
    detail: 'Fast rounds with tactical respawns and squad roles.',
  },
  { id: 'ctf', label: 'Capture the Flag', detail: 'Objective-based control with organized pushes.' },
  {
    id: 'search-and-destroy',
    label: 'Search & Destroy',
    detail: 'Limited lives, high coordination, clean communication.',
  },
]

const slotLabels: Record<TimeSlot, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
}

function toISODate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

// Fake data: existing reservations already consume capacity
const existingReservations: ReservationRecord[] = [
  {
    id: 'r-1001',
    dateISO: toISODate(addDays(new Date(), 1)),
    fieldId: 'field-1',
    slot: 'morning',
    sessionType: 'public',
    players: 12,
  },
  {
    id: 'r-1002',
    dateISO: toISODate(addDays(new Date(), 1)),
    fieldId: 'field-1',
    slot: 'morning',
    sessionType: 'private',
    players: 10,
  },
  {
    id: 'r-1003',
    dateISO: toISODate(addDays(new Date(), 2)),
    fieldId: 'field-2',
    slot: 'evening',
    sessionType: 'public',
    players: 14,
  },
  {
    id: 'r-1004',
    dateISO: toISODate(addDays(new Date(), 3)),
    fieldId: 'field-3',
    slot: 'afternoon',
    sessionType: 'public',
    players: 18,
  },
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

function capacityFor(fieldId: string, slot: TimeSlot) {
  const base = fieldId === 'field-1' ? 28 : fieldId === 'field-2' ? 24 : 22
  const mult = slot === 'morning' ? 1.0 : slot === 'afternoon' ? 0.95 : 0.9
  return Math.floor(base * mult)
}

function slotSort(a: TimeSlot, b: TimeSlot) {
  const order: TimeSlot[] = ['morning', 'afternoon', 'evening']
  return order.indexOf(a) - order.indexOf(b)
}

type PackageRecommendationPrefill = {
  fromPackageRecommendation?: boolean
  players?: number
  sessionType?: SessionType
  mode?: GameMode
  selectedPackageId?: string
}

export function ReservationCalendarPage_FIXED() {
  const location = useLocation()
  const today = useMemo(() => new Date(), [])

  const packagePrefill = (location.state as PackageRecommendationPrefill | null)?.fromPackageRecommendation
    ? (location.state as PackageRecommendationPrefill)
    : undefined

  const dates = useMemo(() => Array.from({ length: 7 }).map((_, i) => addDays(today, i)), [today])

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [waiverSubmitted, setWaiverSubmitted] = useState<boolean>(() => {
    try {
      return localStorage.getItem('waiver_submitted') === '1'
    } catch (e) {
      return false
    }
  })
  const [fieldId, setFieldId] = useState(fields[0].id)
  const [dateISO, setDateISO] = useState(toISODate(addDays(today, 1)))
  const [slot, setSlot] = useState<TimeSlot>('evening')
  const [sessionType, setSessionType] = useState<SessionType>(packagePrefill?.sessionType ?? 'public')
  const [players, setPlayers] = useState(packagePrefill?.players ?? 8)
  const [playersInput, setPlayersInput] = useState(String(packagePrefill?.players ?? 8))

  const [mode, setMode] = useState<GameMode>(packagePrefill?.mode ?? 'squad-deathmatch')
  const [selectedPackageId, setSelectedPackageId] = useState<string>(
    packagePrefill?.selectedPackageId ?? packages.find((p) => p.mode === 'squad-deathmatch')?.id ?? packages[0].id,
  )

  const [notes, setNotes] = useState('')

  const selectedPackage = useMemo(
    () => packages.find((p) => p.id === selectedPackageId) ?? packages[0],
    [selectedPackageId],
  )

  const effectiveMinPlayers = useMemo(
    () => Math.max(selectedPackage.minPlayers, sessionType === 'private' ? 10 : 1),
    [selectedPackage.minPlayers, sessionType],
  )

  useEffect(() => {
    if (players < effectiveMinPlayers) {
      setPlayers(effectiveMinPlayers)
      setPlayersInput(String(effectiveMinPlayers))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveMinPlayers])

  const existingForSelection = useMemo(
    () => existingReservations.filter((r) => r.dateISO === dateISO && r.fieldId === fieldId && r.slot === slot),
    [dateISO, fieldId, slot],
  )

  const usedPlayers = useMemo(() => existingForSelection.reduce((sum, r) => sum + r.players, 0), [existingForSelection])

  const maxCapacity = useMemo(() => capacityFor(fieldId, slot), [fieldId, slot])

  const remainingSlots = useMemo(() => maxCapacity - usedPlayers, [maxCapacity, usedPlayers])

  const canProceed = remainingSlots >= players

  const slotOverview = useMemo(() => {
    const cap = maxCapacity
    const pct = cap === 0 ? 0 : Math.round((usedPlayers / cap) * 100)
    return { cap, pct: clamp(pct, 0, 100) }
  }, [maxCapacity, usedPlayers])

  const recommendedPackages = useMemo(() => {
    return packages
      .filter((p) => p.mode === mode)
      .map((p) => ({
        ...p,
        score: Math.abs(players - p.minPlayers),
      }))
      .sort((a, b) => a.score - b.score)
  }, [mode, players])

  const dynamicPricing = useMemo(() => {
    const equipmentTotalPerPlayer = selectedPackage.equipment.reduce((sum, e) => sum + e.pricePerPlayer, 0)
    const sessionMultiplier = sessionType === 'private' ? 1.25 : 1.0
    const discountPct = players >= 12 ? 0.1 : players >= 8 ? 0.06 : 0.0

    const base = selectedPackage.basePrice + equipmentTotalPerPlayer
    const totalBeforeDiscount = base * players * sessionMultiplier
    const total = Math.round(totalBeforeDiscount * (1 - discountPct))

    return {
      total,
      perPlayer: Math.round(total / players),
      discountPct,
      discountLabel: discountPct > 0 ? `${Math.round(discountPct * 100)}%` : '—',
      equipmentTotalPerPlayer,
      sessionMultiplier,
    }
  }, [players, selectedPackage, sessionType])

  const reservationSummary = useMemo(() => {
    return {
      field: fields.find((f) => f.id === fieldId)!,
      dateISO,
      slotLabel: slotLabels[slot],
      sessionTypeLabel: sessionType === 'private' ? 'Private Session' : 'Public Session',
      players,
      gameModeLabel: GAME_MODES.find((m) => m.id === mode)?.label ?? 'Game Mode',
      packageName: selectedPackage.name,
      notes,
    }
  }, [dateISO, fieldId, mode, notes, players, selectedPackage.name, sessionType, slot])

  const handleChangeMode = (nextMode: GameMode) => {
    setMode(nextMode)
    const nextPkg = packages.find((p) => p.mode === nextMode)
    if (nextPkg) setSelectedPackageId(nextPkg.id)
  }

  const StepHeader = ({ title, subtitle }: { title: string; subtitle: string }) => (
    <div>
      <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-muted">
        <span className="grid h-2.5 w-2.5 place-items-center rounded-full bg-accent" />
        <span className="uppercase tracking-[0.18em]">Reservation</span>
      </div>
      <h1 className="mt-3 text-3xl font-bold">{title}</h1>
      <p className="mt-1 text-muted text-sm">{subtitle}</p>
    </div>
  )

  const timeSlots: TimeSlot[] = ['morning', 'afternoon', 'evening']

  return (
    <div className="space-y-4">
      <StepHeader
        title={
          step === 1
            ? 'Choose Field & Slot'
            : step === 2
              ? 'Select Equipment & Mode'
              : step === 3
                ? 'Reservation Summary'
                : 'Confirm Reservation'
        }
        subtitle="Mobile-first reservation flow with live slot prevention (prototype)."
      />

      {/* Steps */}
      <div className="grid grid-cols-4 gap-3">
        {([1, 2, 3, 4] as const).map((s) => {
          const active = s === step
          const done = s < step
          return (
            <button
              key={s}
              type="button"
              onClick={() => (s <= step ? setStep(s) : undefined)}
              className={[
                'rounded-2xl border border-white/10 bg-white/5 p-3 text-left transition',
                active ? 'ring-2 ring-accent/40' : '',
                done ? 'opacity-90' : '',
              ].join(' ')}
              aria-current={active}
            >
              <div className="flex items-center gap-2">
                <div
                  className={[
                    'grid h-8 w-8 place-items-center rounded-2xl ring-1 ring-white/10',
                    active ? 'bg-accent/15 text-gold' : done ? 'bg-success/15 text-success' : 'bg-black/30 text-muted',
                  ].join(' ')}
                >
                  {done ? <FiCheck /> : s}
                </div>
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Step</div>
                  <div className="text-sm font-bold">{s}</div>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* Step 1 */}
      {step === 1 ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            <Card className="p-4 md:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-sm font-bold">
                    <FiMapPin /> <span>Field</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">Pick where your team will operate.</p>
                </div>
                <div className="hidden md:flex items-center gap-2 text-xs text-muted">
                  <FiCalendar />
                  <span>{dateISO}</span>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {fields.map((f) => {
                  const active = f.id === fieldId
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFieldId(f.id)}
                      className={[
                        'rounded-2xl border p-3 text-left transition',
                        active
                          ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25'
                          : 'border-white/10 bg-white/5 hover:bg-white/8',
                      ].join(' ')}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-bold">{f.name}</div>
                        {active ? <FiCheck className="text-gold" /> : null}
                      </div>
                      <div className="mt-1 text-xs text-muted">{f.location}</div>
                    </button>
                  )
                })}
              </div>
            </Card>

            <Card className="p-4 md:p-6">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiCalendar /> <span>Date & Time</span>
              </div>
              <p className="mt-1 text-xs text-muted">Select a date and time window. Slot prevention locks full schedules.</p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Date</div>
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    {dates.map((d) => {
                      const iso = toISODate(d)
                      const active = iso === dateISO
                      return (
                        <button
                          key={iso}
                          type="button"
                          onClick={() => setDateISO(iso)}
                          className={[
                            'rounded-2xl border px-2 py-2 text-xs transition',
                            active
                              ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25'
                              : 'border-white/10 bg-white/5 hover:bg-white/8',
                          ].join(' ')}
                        >
                          <div className="font-bold">{d.getDate()}</div>
                          <div className="text-[10px] text-muted">
                            {d.toLocaleDateString(undefined, { weekday: 'short' })}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Time Window</div>
                  <div className="mt-2 grid grid-cols-1 gap-2">
                    {timeSlots.sort(slotSort).map((s) => {
                      const active = s === slot
                      const cap = capacityFor(fieldId, s)
                      const used = existingReservations
                        .filter((r) => r.dateISO === dateISO && r.fieldId === fieldId && r.slot === s)
                        .reduce((sum, r) => sum + r.players, 0)
                      const remaining = cap - used

                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setSlot(s)}
                          className={[
                            'rounded-2xl border p-3 text-left transition',
                            active
                              ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25'
                              : 'border-white/10 bg-white/5 hover:bg-white/8',
                          ].join(' ')}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-bold">{slotLabels[s]}</div>
                              <div className="mt-1 text-xs text-muted flex items-center gap-2">
                                <FiClock />
                                <span>{remaining <= 0 ? 'No slots' : `${remaining} slots left`}</span>
                              </div>
                            </div>
                            <div
                              className={[
                                'rounded-2xl px-3 py-1 text-xs font-bold',
                                remaining <= 0
                                  ? 'bg-danger/15 text-danger'
                                  : remaining <= 5
                                    ? 'bg-accent/15 text-gold'
                                    : 'bg-success/15 text-success',
                              ].join(' ')}
                            >
                              {remaining <= 0 ? 'FULL' : `${remaining}`}
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="p-4 md:p-6">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiUsers /> <span>Players & Session</span>
              </div>
              <p className="mt-1 text-xs text-muted">Reservation capacity is enforced for the selected date/field/slot.</p>

              <div className="mt-4 grid gap-4">
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Session Type</div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {(['public', 'private'] as SessionType[]).map((t) => {
                      const active = t === sessionType
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => {
                            const requiredMin = Math.max(selectedPackage.minPlayers, t === 'private' ? 10 : 1)
                            setSessionType(t)
                            if (players < requiredMin) {
                              setPlayers(requiredMin)
                              setPlayersInput(String(requiredMin))
                            }
                          }}
                          className={[
                            'rounded-2xl border p-3 text-left transition',
                            active
                              ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25'
                              : 'border-white/10 bg-white/5 hover:bg-white/8',
                          ].join(' ')}
                        >
                          <div className="text-sm font-bold">{t === 'private' ? 'Private' : 'Public'}</div>
                          <div className="mt-1 text-xs text-muted">{t === 'private' ? 'Team exclusive' : 'Open roster'}</div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted"># of Players</div>
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        const nextValue = Math.max(effectiveMinPlayers, players - 1)
                        setPlayers(nextValue)
                        setPlayersInput(String(nextValue))
                      }}
                      className="grid h-10 w-10 place-items-center rounded-2xl border border-white/10 bg-white/5 hover:bg-white/8"
                      aria-label="Decrease players"
                    >
                      <FiMinus />
                    </button>
                    <div className="flex-1">
                      <Input
                        type="number"
                        min={effectiveMinPlayers}
                        max={maxCapacity}
                        value={playersInput}
                        onChange={(e) => {
                          const raw = e.target.value
                          if (raw === '') {
                            setPlayersInput('')
                            setPlayers(0)
                            return
                          }

                          if (!/^\d+$/.test(raw)) return

                          const nextValue = Number(raw)
                          setPlayersInput(raw)
                          setPlayers(nextValue)
                        }}
                        onBlur={() => {
                          const currentValue = Number(playersInput)
                          if (!playersInput || Number.isNaN(currentValue) || currentValue <= 0) {
                            setPlayersInput(String(effectiveMinPlayers))
                            setPlayers(effectiveMinPlayers)
                            return
                          }

                          const safeValue = clamp(currentValue, effectiveMinPlayers, maxCapacity)
                          setPlayersInput(String(safeValue))
                          setPlayers(safeValue)
                        }}
                        className="[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const nextValue = Math.min(maxCapacity, players + 1)
                        setPlayers(nextValue)
                        setPlayersInput(String(nextValue))
                      }}
                      className="grid h-10 w-10 place-items-center rounded-2xl border border-white/10 bg-white/5 hover:bg-white/8"
                      aria-label="Increase players"
                    >
                      <FiPlus />
                    </button>
                  </div>

                  <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs text-muted">Capacity</div>
                        <div className="mt-1 text-sm font-bold">{slotOverview.cap} max</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-muted">Used</div>
                        <div className="mt-1 text-sm font-bold">{usedPlayers} ops</div>
                      </div>
                    </div>

                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/5">
                      <motion.div
                        className="h-full bg-[linear-gradient(90deg,rgba(197,163,90,0.9),rgba(85,107,47,0.8))]"
                        initial={{ width: 0 }}
                        animate={{ width: `${slotOverview.pct}%` }}
                        transition={{ duration: 0.6, ease: 'easeOut' }}
                      />
                    </div>

                    <div className="mt-3 flex items-center justify-between">
                      <div className="text-xs text-muted">Remaining</div>
                      <div
                        className={[
                          'text-xs font-bold rounded-xl px-3 py-1',
                          remainingSlots <= 0
                            ? 'bg-danger/15 text-danger'
                            : remainingSlots < 6
                              ? 'bg-accent/15 text-gold'
                              : 'bg-success/15 text-success',
                        ].join(' ')}
                      >
                        {remainingSlots <= 0 ? 'FULL' : `${remainingSlots} slots left`}
                      </div>
                    </div>

                    {!canProceed ? (
                      <div className="mt-3 flex items-start gap-3 rounded-2xl bg-danger/10 p-3 ring-1 ring-danger/20">
                        <FiAlertTriangle className="mt-0.5 h-5 w-5 text-danger" />
                        <div>
                          <div className="text-sm font-bold text-danger">Schedule overloaded</div>
                          <div className="mt-1 text-xs text-muted">
                            Reduce players to {Math.max(0, remainingSlots)} to proceed.
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Button variant="primary" disabled={!canProceed} onClick={() => setStep(2)}>
                  Continue
                  <FiChevronRight />
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setFieldId(fields[0].id)
                    setDateISO(toISODate(addDays(today, 1)))
                    setSlot('evening')
                    setSessionType('public')
                    setPlayers(8)
                    setPlayersInput('8')
                  }}
                >
                  Reset
                </Button>
              </div>
            </Card>
          </div>
        </div>
      ) : null}

      {/* Step 2 */}
      {step === 2 ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            <Card className="p-4 md:p-6">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiSliders /> <span>Game Mode</span>
              </div>
              <p className="mt-1 text-xs text-muted">Select a mode. Recommended packages will update automatically.</p>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {GAME_MODES.map((m) => {
                  const active = m.id === mode
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleChangeMode(m.id)}
                      className={[
                        'rounded-2xl border p-3 text-left transition',
                        active
                          ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25'
                          : 'border-white/10 bg-white/5 hover:bg-white/8',
                      ].join(' ')}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-bold">{m.label}</div>
                          <div className="mt-1 text-xs text-muted">{m.detail}</div>
                        </div>
                        {active ? <FiCheck className="mt-0.5 text-gold" /> : null}
                      </div>
                    </button>
                  )
                })}
              </div>
            </Card>

            <Card className="p-4 md:p-6">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiTag /> <span>Package Recommendation</span>
              </div>
              <p className="mt-1 text-xs text-muted">Compare packages and select the one your group will use.</p>

              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {recommendedPackages.slice(0, 2).map((p) => {
                  const active = p.id === selectedPackageId
                  const equipmentCount = p.equipment.reduce((sum, e) => sum + e.qty, 0)
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedPackageId(p.id)}
                      className={[
                        'rounded-2xl border p-4 text-left transition',
                        active
                          ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25'
                          : 'border-white/10 bg-white/5 hover:bg-white/8',
                      ].join(' ')}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-bold">{p.name}</div>
                            <div className="rounded-xl border border-white/10 bg-black/20 px-2 py-1 text-[11px] font-bold text-muted">
                              Min {p.minPlayers} players
                            </div>
                          </div>
                          <div className="mt-2 text-xs text-muted">Includes {equipmentCount} equipment items</div>
                        </div>
                        {active ? <FiCheck className="text-gold" /> : null}
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {p.equipment.slice(0, 3).map((e) => (
                          <div
                            key={e.id}
                            className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-muted"
                          >
                            {e.name}
                          </div>
                        ))}
                      </div>

                      <div className="mt-4 flex items-center justify-between">
                        <div className="text-xs text-muted">Base package</div>
                        <div className="text-sm font-bold text-accent">₱{p.basePrice.toLocaleString()}</div>
                      </div>
                    </button>
                  )
                })}
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center gap-2 text-sm font-bold">
                  <FiShield /> <span>Equipment Availability (Prototype)</span>
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  {selectedPackage.equipment.map((e) => (
                    <div
                      key={e.id}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                    >
                      <div>
                        <div className="text-sm font-bold">{e.name}</div>
                        <div className="mt-1 text-xs text-muted">Qty {e.qty} / per player</div>
                      </div>
                      <div className="text-xs text-muted font-semibold">+₱{e.pricePerPlayer}/player</div>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="p-4 md:p-6">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiAlertTriangle /> <span>Quick Validation</span>
              </div>
              <p className="mt-1 text-xs text-muted">Prevent invalid selections before going to summary.</p>

              <div className="mt-4 space-y-3">
                <div
                  className={[
                    'rounded-2xl border p-4',
                    players < effectiveMinPlayers
                      ? 'border-danger/30 bg-danger/10'
                      : 'border-white/10 bg-white/5',
                  ].join(' ')}
                >
                  <div className="text-sm font-bold">Minimum players</div>
                  <div className="mt-1 text-xs text-muted">Package requires {selectedPackage.minPlayers} players</div>
                  {players < effectiveMinPlayers ? (
                    <div className="mt-2 text-xs font-semibold text-danger">Increase players to continue.</div>
                  ) : (
                    <div className="mt-2 text-xs font-semibold text-success">Meets requirement.</div>
                  )}
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-sm font-bold">Dynamic price</div>
                  <div className="mt-1 text-xs text-muted">Calculated for your group and session type.</div>
                  <div className="mt-3 flex items-end justify-between">
                    <div>
                      <div className="text-xs text-muted">Total</div>
                      <div className="text-2xl font-bold text-gold">₱{dynamicPricing.total.toLocaleString()}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted">Per player</div>
                      <div className="text-sm font-bold">₱{dynamicPricing.perPlayer.toLocaleString()}</div>
                    </div>
                  </div>

                  {dynamicPricing.discountPct > 0 ? (
                    <div className="mt-2 text-xs text-muted">Discount applied: {dynamicPricing.discountLabel}</div>
                  ) : null}
                </div>

                <div>
                  <Input
                    label="Operation Notes (Optional)"
                    hint="Used by marshals for briefing and gear readiness."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Button variant="ghost" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button
                  variant="primary"
                  disabled={players < effectiveMinPlayers || !canProceed}
                  onClick={() => setStep(3)}
                >
                  Continue
                  <FiChevronRight />
                </Button>
              </div>
            </Card>
          </div>
        </div>
      ) : null}

      {/* Step 3 */}
      {step === 3 ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            <Card className="p-4 md:p-6">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiShield /> <span>Reservation Summary</span>
              </div>
              <p className="mt-1 text-xs text-muted">Review the full breakdown before confirmation.</p>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Field</div>
                  <div className="mt-2 text-sm font-bold">{reservationSummary.field.name}</div>
                  <div className="mt-1 text-xs text-muted">{reservationSummary.field.location}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Date / Slot</div>
                  <div className="mt-2 text-sm font-bold">{reservationSummary.dateISO}</div>
                  <div className="mt-1 text-xs text-muted">{reservationSummary.slotLabel}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Session</div>
                  <div className="mt-2 text-sm font-bold">{reservationSummary.sessionTypeLabel}</div>
                  <div className="mt-1 text-xs text-muted">{reservationSummary.players} players</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Game / Package</div>
                  <div className="mt-2 text-sm font-bold">{reservationSummary.gameModeLabel}</div>
                  <div className="mt-1 text-xs text-muted">{reservationSummary.packageName}</div>
                </div>
              </div>

              {reservationSummary.notes ? (
                <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Notes</div>
                  <div className="mt-2 text-sm text-text">{reservationSummary.notes}</div>
                </div>
              ) : null}
            </Card>

            <Card className="p-4 md:p-6">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiTag /> <span>Pricing Breakdown</span>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs text-muted">Base package</div>
                  <div className="mt-2 text-sm font-bold">₱{selectedPackage.basePrice.toLocaleString()}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs text-muted">Equipment add-ons (per player)</div>
                  <div className="mt-2 text-sm font-bold">₱{dynamicPricing.equipmentTotalPerPlayer.toLocaleString()}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs text-muted">Session multiplier</div>
                  <div className="mt-2 text-sm font-bold">{dynamicPricing.sessionMultiplier}×</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs text-muted">Discount</div>
                  <div className="mt-2 text-sm font-bold">{dynamicPricing.discountLabel}</div>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-accent/30 bg-accent/10 p-4">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <div className="text-xs text-muted">Total reservation</div>
                    <div className="mt-1 text-3xl font-black text-gold">₱{dynamicPricing.total.toLocaleString()}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted">Per player</div>
                    <div className="mt-1 text-sm font-bold">₱{dynamicPricing.perPlayer.toLocaleString()}</div>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="p-4 md:p-6">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiCheck /> <span>Confirm Slot Lock</span>
              </div>
              <p className="mt-1 text-xs text-muted">This action represents creating a reservation lock for the selected schedule.</p>

              <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-muted">Remaining capacity</div>
                  <div className="text-xs font-bold">{remainingSlots} slots</div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-muted">Requested players</div>
                  <div className="text-xs font-bold">{players}</div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-muted">Status</div>
                  <div
                    className={[
                      'text-xs font-bold rounded-xl px-3 py-1',
                      canProceed ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger',
                    ].join(' ')}
                  >
                    {canProceed ? 'LOCK READY' : 'NOT ENOUGH SLOTS'}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Button variant="ghost" onClick={() => setStep(2)}>
                  Back
                </Button>
                <Button
                  variant="primary"
                  disabled={!canProceed || players < effectiveMinPlayers}
                  onClick={() => setStep(4)}
                >
                  Confirm
                  <FiChevronRight />
                </Button>
              </div>
            </Card>

            <Card className="p-4 md:p-6">
              <div className="text-sm font-bold">Next: Waiver + Payment</div>
              <p className="mt-1 text-xs text-muted">After confirmation, the waiver signature step would be requested.</p>
              <div className="mt-4 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="grid h-10 w-10 place-items-center rounded-2xl bg-accent/10 ring-1 ring-accent/25">
                  <FiShield className="text-gold" />
                </div>
                <div>
                  <div className="text-xs text-muted">Workflow</div>
                  <div className="mt-1 text-sm font-bold">Waiver → Payment → Confirmation</div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      ) : null}

      {/* Step 4 */}
      {step === 4 ? (
        <div className="grid gap-4">


          <Card className="p-4 md:p-6">

            <div className="text-sm font-bold">Next: Waiver + Payment</div>
            <p className="mt-1 text-xs text-muted">Embedded prototype so step 4 includes the full flow.</p>

            <div className="mt-4 space-y-4">
              <div>
                <div className="text-xs uppercase tracking-widest text-muted">Waiver</div>
                <div className="mt-2">
                  {!waiverSubmitted ? (
                    <WaiverPage variant="embedded" onSubmitted={() => setWaiverSubmitted(true)} />
                  ) : (
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm font-bold">Waiver already submitted — you may proceed to payment.</div>
                  )}
                </div>
              </div>

              <div>
                <div className="text-xs uppercase tracking-widest text-muted">Payment</div>
                <div className="mt-2">
                  <PaymentPage />
                </div>
              </div>
            </div>

            <div className="mt-6">
              <div className="text-sm font-bold">What this calendar does (working prototype)</div>
              <ul className="mt-3 space-y-2 text-xs text-muted">
                <li className="flex items-start gap-2">
                  <FiCheck className="mt-0.5 text-success" /> Date/field/slot selection
                </li>
                <li className="flex items-start gap-2">
                  <FiCheck className="mt-0.5 text-success" /> Remaining slot prevention (no full schedules)
                </li>
                <li className="flex items-start gap-2">
                  <FiCheck className="mt-0.5 text-success" /> Equipment + game mode packages
                </li>
                <li className="flex items-start gap-2">
                  <FiCheck className="mt-0.5 text-success" /> Dynamic price calculation
                </li>
                <li className="flex items-start gap-2">
                  <FiCheck className="mt-0.5 text-success" /> Reservation summary + confirmation UI
                </li>
              </ul>
            </div>
          </Card>
        </div>
      ) : null}

      <div className="rounded-2xl border border-white/5 bg-black/10 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-white/5 ring-1 ring-white/10">
              <FiShield className="text-gold" />
            </div>
            <div>
              <div className="text-sm font-bold">Slot Prevention Engine</div>
              <div className="text-xs text-muted">Ensures you can’t reserve beyond capacity for the selected slot.</div>
            </div>
          </div>
          <div className="hidden md:block text-right">
            <div className="text-xs text-muted">Selected</div>
            <div className="mt-1 text-sm font-bold">
              {slotLabels[slot]} • {fields.find((f) => f.id === fieldId)?.name}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

