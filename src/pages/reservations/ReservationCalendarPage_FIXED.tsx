import React, { useMemo, useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
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

import { apiGet, apiPost } from '../../utils/apiClient'
import { useAuth } from '../../context/AuthContext'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'

type SessionType = 'public' | 'private'
type TimeSlot = 'morning' | 'afternoon' | 'evening'
type LocationOption = 'salawag' | 'langkaan' | 'binan'

type Field = {
  id: string
  name: string
  location: string
}

type RentalPackage = {
  id: string
  _id?: any
  name: string
  discountPct: number
  description: string
  basePrice: number
  minPlayers: number
  weaponIds: string[]
  equipmentIds: string[]
  equipmentCount: number
  status: string
}

type WeaponItem = {
  id: string
  _id?: any
  name: string
  category: string
  status: string
  price: number
}

type EquipmentItemDetails = {
  id: string
  _id?: any
  name: string
  category: string
  status: string
  qty: number
  price: number
}

type ReservationRecord = {
  id: string
  dateISO: string
  fieldId: string
  slot: TimeSlot
  sessionType: SessionType
  players: number
}

type PackageRecommendationPrefill = {
  fromPackageRecommendation?: boolean
  players?: number
  sessionType?: SessionType
  selectedPackageId?: string
}

const fields: Field[] = [
  { id: 'field-1', name: 'Upper Ground', location: 'Main Range / North Gate' },
  { id: 'field-2', name: 'Lower Ground', location: 'Ops Lane / East Drop' },
  { id: 'field-3', name: 'Forest', location: 'Training Block / West Bay' },
]

const locationOptions: { id: LocationOption; name: string; detail: string }[] = [
  { id: 'salawag', name: 'Delta Stronghold (Salawag)', detail: 'CQB-ready facilities and briefing rooms.' },
  { id: 'langkaan', name: 'Delta Stronghold (Langkaan)', detail: 'Open fields, staging area, and amenities.' },
  { id: 'binan', name: 'LOMA Binan Laguna', detail: 'Training lanes for teams and beginners.' },
]

const slotLabels: Record<TimeSlot, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
}

const timeSlots: TimeSlot[] = ['morning', 'afternoon', 'evening']

// Existing reservations consuming capacity
const existingReservations: ReservationRecord[] = [
  { id: 'r-1001', dateISO: '2026-07-23', fieldId: 'field-1', slot: 'morning', sessionType: 'public', players: 12 },
  { id: 'r-1002', dateISO: '2026-07-23', fieldId: 'field-1', slot: 'morning', sessionType: 'private', players: 10 },
  { id: 'r-1003', dateISO: '2026-07-24', fieldId: 'field-2', slot: 'evening', sessionType: 'public', players: 14 },
  { id: 'r-1004', dateISO: '2026-07-25', fieldId: 'field-3', slot: 'afternoon', sessionType: 'public', players: 18 },
]

function toISODate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

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

export function ReservationCalendarPage_FIXED() {
  const location = useLocation()
  const today = useMemo(() => new Date(), [])
  const { user } = useAuth()

  const packagePrefill = (location.state as PackageRecommendationPrefill | null)?.fromPackageRecommendation
    ? (location.state as PackageRecommendationPrefill)
    : undefined

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [isConfirming, setIsConfirming] = useState(false)
  const [packages, setPackages] = useState<RentalPackage[]>([])
  const [weapons, setWeapons] = useState<WeaponItem[]>([])
  const [equipment, setEquipment] = useState<EquipmentItemDetails[]>([])
  const [loadingPackages, setLoadingPackages] = useState(true)

  const [selectedLocation, setSelectedLocation] = useState<LocationOption>('salawag')
  const [selectedFieldIds, setSelectedFieldIds] = useState<string[]>([fields[0].id])
  const [dateISO, setDateISO] = useState(toISODate(addDays(today, 1)))
  const [slot, setSlot] = useState<TimeSlot>('evening')
  const [sessionType, setSessionType] = useState<SessionType>(packagePrefill?.sessionType ?? 'public')
  const [players, setPlayers] = useState(packagePrefill?.players ?? 8)
  const [playersInput, setPlayersInput] = useState(String(packagePrefill?.players ?? 8))
  const [notes, setNotes] = useState('')
  const [selectedPackageId, setSelectedPackageId] = useState<string>('')

  // Fetch real packages, weapons, and equipment from API
  useEffect(() => {
    let cancelled = false
    const fetchData = async () => {
      try {
        const [pkgRes, wepRes, eqRes] = await Promise.all([
          apiGet<{ ok: boolean; data: any[] }>('/api/packages?limit=200'),
          apiGet<{ ok: boolean; data: any[] }>('/api/weapons?limit=200'),
          apiGet<{ ok: boolean; data: any[] }>('/api/equipments?limit=200'),
        ])

        if (cancelled) return

        // Parse packages
        const pkgDocs = Array.isArray(pkgRes?.data) ? pkgRes.data : []
        const parsedPackages: RentalPackage[] = pkgDocs
          .filter((d: any) => d.status === 'active' || !d.status)
          .map((d: any) => ({
            id: d.id ?? (d._id ? String(d._id) : undefined),
            _id: d._id,
            name: d.name || 'Unnamed package',
            discountPct: typeof d.discountPct === 'number' ? d.discountPct : 0,
            description: d.description || '',
            basePrice: typeof d.basePrice === 'number' ? d.basePrice : 0,
            minPlayers: typeof d.minPlayers === 'number' ? d.minPlayers : 1,
            weaponIds: Array.isArray(d.weaponIds) ? d.weaponIds : [],
            equipmentIds: Array.isArray(d.equipmentIds) ? d.equipmentIds : [],
            equipmentCount: (d.weaponIds?.length || 0) + (d.equipmentIds?.length || 0),
            status: d.status || 'active',
          }))
        setPackages(parsedPackages)

        // Parse weapons
        const wepDocs = Array.isArray(wepRes?.data) ? wepRes.data : []
        setWeapons(wepDocs.map((d: any) => ({
          id: d.id ?? (d._id ? String(d._id) : undefined),
          _id: d._id,
          name: d.name || 'Unnamed weapon',
          category: d.category || 'rifles',
          status: d.status || 'available',
          price: typeof d.price === 'number' ? d.price : 0,
        })))

        // Parse equipment
        const eqDocs = Array.isArray(eqRes?.data) ? eqRes.data : []
        setEquipment(eqDocs.map((d: any) => ({
          id: d.id ?? (d._id ? String(d._id) : undefined),
          _id: d._id,
          name: d.name || 'Unnamed equipment',
          category: d.category || 'gear',
          status: d.status || 'available',
          qty: typeof d.qty === 'number' ? d.qty : 1,
          price: typeof d.price === 'number' ? d.price : 0,
        })))
      } catch (e: any) {
        if (!cancelled) toast.error(String(e?.message || e))
      } finally {
        if (!cancelled) setLoadingPackages(false)
      }
    }
    fetchData()
    return () => { cancelled = true }
  }, [])

  // Set selected package from prefill or first available
  useEffect(() => {
    if (packages.length > 0 && !selectedPackageId) {
      const prefillId = packagePrefill?.selectedPackageId
      setSelectedPackageId(prefillId && packages.find((p) => p.id === prefillId) ? prefillId : packages[0].id)
    }
  }, [packages, packagePrefill?.selectedPackageId, selectedPackageId])

  const selectedPackage = useMemo(
    () => packages.find((p) => p.id === selectedPackageId) ?? packages[0],
    [packages, selectedPackageId],
  )

  const effectiveMinPlayers = useMemo(
    () => selectedPackage ? Math.max(selectedPackage.minPlayers, sessionType === 'private' ? 10 : 1) : 1,
    [selectedPackage, sessionType],
  )

  const allowedFieldIds = useMemo(() => {
    if (players <= 10) return ['field-1']
    if (players <= 20) return ['field-1', 'field-2']
    return ['field-1', 'field-2', 'field-3']
  }, [players])

  // Ensure selected fields are valid
  useEffect(() => {
    setSelectedFieldIds((prev) => {
      const filtered = prev.filter((id) => allowedFieldIds.includes(id))
      if (filtered.length === 0) return [allowedFieldIds[0] || 'field-1']
      return filtered
    })
  }, [allowedFieldIds])

  const usedPlayers = useMemo(() => {
    return existingReservations
      .filter((r) => r.dateISO === dateISO && selectedFieldIds.includes(r.fieldId) && r.slot === slot)
      .reduce((sum, r) => sum + r.players, 0)
  }, [dateISO, selectedFieldIds, slot])

  const maxCapacity = useMemo(() => {
    return selectedFieldIds.reduce((sum, fieldId) => sum + capacityFor(fieldId, slot), 0)
  }, [selectedFieldIds, slot])

  const remainingSlots = maxCapacity - usedPlayers
  const canProceed = remainingSlots >= players

  const slotOverview = useMemo(() => {
    const cap = maxCapacity
    const pct = cap > 0 ? Math.round((usedPlayers / cap) * 100) : 0
    return { cap, pct: clamp(pct, 0, 100) }
  }, [maxCapacity, usedPlayers])

  // Get weapon details for the package
  const packageWeapons = useMemo(() => {
    if (!selectedPackage) return []
    return selectedPackage.weaponIds
      .map((wid) => weapons.find((w) => w.id === wid))
      .filter(Boolean) as WeaponItem[]
  }, [selectedPackage, weapons])

  // Get equipment details for the package
  const packageEquipment = useMemo(() => {
    if (!selectedPackage) return []
    return selectedPackage.equipmentIds
      .map((eid) => equipment.find((e) => e.id === eid))
      .filter(Boolean) as EquipmentItemDetails[]
  }, [selectedPackage, equipment])

  // Calculate equipment total per player
  const equipmentTotalPerPlayer = useMemo(() => {
    const weaponPrices = packageWeapons.reduce((sum, w) => sum + (w.price || 0), 0)
    const equipmentPrices = packageEquipment.reduce((sum, e) => sum + (e.price || 0), 0)
    return weaponPrices + equipmentPrices
  }, [packageWeapons, packageEquipment])

  const dynamicPricing = useMemo(() => {
    if (!selectedPackage) {
      return { total: 0, perPlayer: 0, discountPct: 0, discountLabel: '—', equipmentTotalPerPlayer: 0, sessionMultiplier: 1, savings: 0, originalTotal: 0 }
    }
    const sessionMultiplier = sessionType === 'private' ? 1.25 : 1.0
    const basePerPlayer = selectedPackage.basePrice + equipmentTotalPerPlayer
    const discountPct = selectedPackage.discountPct || 0
    const totalBeforeMultiplier = basePerPlayer * players
    const total = Math.round(totalBeforeMultiplier * sessionMultiplier)
    const originalTotal = Math.round(totalBeforeMultiplier * sessionMultiplier)
    const savings = Math.max(0, originalTotal - total)

    return {
      total,
      perPlayer: Math.round(total / Math.max(players, 1)),
      discountPct,
      discountLabel: discountPct > 0 ? `${discountPct}%` : '—',
      equipmentTotalPerPlayer,
      sessionMultiplier,
      savings,
      originalTotal,
    }
  }, [players, selectedPackage, sessionType, equipmentTotalPerPlayer])

  const reservationSummary = useMemo(() => {
    const selectedFields = fields.filter((f) => selectedFieldIds.includes(f.id))
    return {
      locationLabel: locationOptions.find((loc) => loc.id === selectedLocation)?.name ?? 'Location',
      fields: selectedFields,
      dateISO,
      slotLabel: slotLabels[slot],
      sessionTypeLabel: sessionType === 'private' ? 'Private Session' : 'Public Session',
      players,
      packageName: selectedPackage?.name || 'No package selected',
      notes,
    }
  }, [dateISO, selectedFieldIds, selectedLocation, selectedPackage?.name, sessionType, slot, players, notes])

  const StepHeader = ({ title, subtitle }: { title: string; subtitle: string }) => (
    <div>
      <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-muted">
        <span className="grid h-2.5 w-2.5 place-items-center rounded-full bg-accent" />
        <span className="uppercase tracking-[0.18em]">Reservation</span>
      </div>
      <h1 className="mt-3 text-3xl font-bold">{title}</h1>
      <p className="mt-1 text-sm text-muted">{subtitle}</p>
    </div>
  )

  const handleConfirm = async () => {
    if (!user?.id) {
      toast.error('Please login to continue.')
      return
    }

    if (!canProceed || players < effectiveMinPlayers || !selectedPackage) {
      toast.error('Invalid reservation details. Please check your selections.')
      return
    }

    setIsConfirming(true)

    try {
      const selectedLocationName = locationOptions.find((loc) => loc.id === selectedLocation)?.name ?? selectedLocation
      const selectedFieldNames = fields.filter((f) => selectedFieldIds.includes(f.id)).map((f) => f.name).join(', ')

      const payload = {
        userId: user.id,
        selectedPackageId: selectedPackage.id,
        fieldIds: selectedFieldIds,
        locationId: selectedLocation,
        locationName: selectedLocationName,
        reservationDate: dateISO,
        reservationTime: slot,
        sessionType,
        numberOfPlayers: players,
        totalAmount: dynamicPricing.total,
        notes,
        reservationStatus: 'pending',
        selectedGameplayName: selectedPackage.name,
        packageName: selectedPackage.name,
      }

      const result = await apiPost<{ ok: boolean; insertedId?: string; data?: any }>('/api/reservations', payload)

      const reservationId = result?.data?.id ?? result?.insertedId ?? result?.data?._id
      if (!reservationId) throw new Error('Reservation ID missing from API response')

      localStorage.setItem('active_reservation_id', String(reservationId))
      setStep(4)
      toast.success('Reservation submitted successfully!')
    } catch (e: any) {
      toast.error(e instanceof Error ? e.message : 'Failed to confirm reservation')
    } finally {
      setIsConfirming(false)
    }
  }

  const getStepTitle = () => {
    switch (step) {
      case 1: return 'Choose Field & Slot'
      case 2: return 'Select Package & Equipment'
      case 3: return 'Reservation Summary'
      default: return 'Confirm Reservation'
    }
  }

  return (
    <div className="space-y-4">
      <StepHeader
        title={getStepTitle()}
        subtitle="Mobile-first reservation flow with live slot prevention."
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
              onClick={() => s <= step && setStep(s)}
              className={[
                'rounded-2xl border p-3 text-left transition',
                active ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25' : '',
                done ? 'border-success/30 bg-success/10' : 'border-white/10 bg-white/5',
                'hover:bg-white/8'
              ].join(' ')}
            >
              <div className="flex items-center gap-2">
                <div className={[
                  'grid h-8 w-8 place-items-center rounded-2xl ring-1 ring-white/10',
                  active ? 'bg-accent/15 text-gold' : done ? 'bg-success/15 text-success' : 'bg-black/30 text-muted',
                ].join(' ')}>
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
      {step === 1 && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            <Card className="p-4 md:p-6">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiMapPin /> <span>Location</span>
              </div>
              <p className="mt-1 text-xs text-muted">Choose the venue before selecting your field.</p>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {locationOptions.map((loc) => {
                  const active = loc.id === selectedLocation
                  return (
                    <button
                      key={loc.id}
                      type="button"
                      onClick={() => setSelectedLocation(loc.id)}
                      className={[
                        'rounded-2xl border p-3 text-left transition',
                        active ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25' : 'border-white/10 bg-white/5 hover:bg-white/8',
                      ].join(' ')}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-bold">{loc.name}</div>
                        {active ? <FiCheck className="text-gold" /> : null}
                      </div>
                      <div className="mt-1 text-xs text-muted">{loc.detail}</div>
                    </button>
                  )
                })}
              </div>
            </Card>

            <Card className="p-4 md:p-6">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiMapPin /> <span>Field</span>
              </div>
              <p className="mt-1 text-xs text-muted">Pick the specific field at the selected location.</p>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {fields.map((f) => {
                  const active = selectedFieldIds.includes(f.id)
                  const allowed = allowedFieldIds.includes(f.id)
                  return (
                    <label
                      key={f.id}
                      className={[
                        'flex items-start gap-3 rounded-2xl border p-3 text-left transition',
                        active ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25' : 'border-white/10 bg-white/5 hover:bg-white/8',
                        !allowed ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                      ].join(' ')}
                    >
                      <input
                        type="checkbox"
                        checked={active}
                        disabled={!allowed}
                        onChange={() => {
                          setSelectedFieldIds((prev) => {
                            if (prev.includes(f.id)) return prev.filter((id) => id !== f.id)
                            if (!allowedFieldIds.includes(f.id)) return prev
                            return [...prev, f.id]
                          })
                        }}
                        className="mt-1 h-4 w-4 rounded border-white/20 bg-transparent accent-accent"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-bold">{f.name}</div>
                        <div className="mt-1 text-xs text-muted">{f.location}</div>
                      </div>
                    </label>
                  )
                })}
              </div>
            </Card>

            <Card className="p-4 md:p-6">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiCalendar /> <span>Date & Time</span>
              </div>
              <p className="mt-1 text-xs text-muted">Select a date and time window.</p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Date</div>
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    {Array.from({ length: 7 }).map((_, i) => {
                      const d = addDays(today, i)
                      const iso = toISODate(d)
                      const active = iso === dateISO
                      return (
                        <button
                          key={iso}
                          type="button"
                          onClick={() => setDateISO(iso)}
                          className={[
                            'rounded-2xl border px-2 py-2 text-xs transition',
                            active ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25' : 'border-white/10 bg-white/5 hover:bg-white/8',
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
                      const cap = selectedFieldIds.reduce((sum, fieldId) => sum + capacityFor(fieldId, s), 0)
                      const used = existingReservations
                        .filter((r) => r.dateISO === dateISO && selectedFieldIds.includes(r.fieldId) && r.slot === s)
                        .reduce((sum, r) => sum + r.players, 0)
                      const remaining = cap - used

                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setSlot(s)}
                          className={[
                            'rounded-2xl border p-3 text-left transition',
                            active ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25' : 'border-white/10 bg-white/5 hover:bg-white/8',
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
                            <div className={[
                              'rounded-2xl px-3 py-1 text-xs font-bold',
                              remaining <= 0 ? 'bg-danger/15 text-danger' : remaining <= 5 ? 'bg-accent/15 text-gold' : 'bg-success/15 text-success',
                            ].join(' ')}>
                              {remaining <= 0 ? 'FULL' : remaining}
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
                            const requiredMin = Math.max(selectedPackage?.minPlayers || 1, t === 'private' ? 10 : 1)
                            setSessionType(t)
                            if (players < requiredMin) {
                              setPlayers(requiredMin)
                              setPlayersInput(String(requiredMin))
                            }
                          }}
                          className={[
                            'rounded-2xl border p-3 text-left transition',
                            active ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25' : 'border-white/10 bg-white/5 hover:bg-white/8',
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
                      <div className={[
                        'text-xs font-bold rounded-xl px-3 py-1',
                        remainingSlots <= 0 ? 'bg-danger/15 text-danger' : remainingSlots < 6 ? 'bg-accent/15 text-gold' : 'bg-success/15 text-success',
                      ].join(' ')}>
                        {remainingSlots <= 0 ? 'FULL' : `${remainingSlots} slots left`}
                      </div>
                    </div>

                    {!canProceed && (
                      <div className="mt-3 flex items-start gap-3 rounded-2xl bg-danger/10 p-3 ring-1 ring-danger/20">
                        <FiAlertTriangle className="mt-0.5 h-5 w-5 text-danger" />
                        <div>
                          <div className="text-sm font-bold text-danger">Schedule overloaded</div>
                          <div className="mt-1 text-xs text-muted">
                            Reduce players to {Math.max(0, remainingSlots)} to proceed.
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Button variant="primary" disabled={!canProceed} onClick={() => setStep(2)}>
                  Continue <FiChevronRight />
                </Button>
                <Button variant="ghost" onClick={() => {
                  setSelectedFieldIds([fields[0].id])
                  setDateISO(toISODate(addDays(today, 1)))
                  setSlot('evening')
                  setSessionType('public')
                  setPlayers(8)
                  setPlayersInput('8')
                }}>
                  Reset
                </Button>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Step 2 */}
      {step === 2 && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            <Card className="p-4 md:p-6">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiTag /> <span>Available Packages</span>
              </div>
              <p className="mt-1 text-xs text-muted">Select a rental package. These are managed by the admin.</p>

              {loadingPackages ? (
                <div className="mt-4 text-sm text-muted">Loading packages...</div>
              ) : packages.length === 0 ? (
                <div className="mt-4 text-sm text-muted">No packages available yet. Ask admin to create rental packages.</div>
              ) : (
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {packages.map((pkg) => {
                    const active = pkg.id === selectedPackageId
                    return (
                      <button
                        key={pkg.id}
                        type="button"
                        onClick={() => setSelectedPackageId(pkg.id)}
                        className={[
                          'rounded-2xl border p-4 text-left transition',
                          active ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25' : 'border-white/10 bg-white/5 hover:bg-white/8',
                        ].join(' ')}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <div className="text-sm font-bold">{pkg.name}</div>
                              <div className="rounded-xl border border-white/10 bg-black/20 px-2 py-1 text-[11px] font-bold text-muted">
                                Min {pkg.minPlayers} players
                              </div>
                            </div>
                            {pkg.description && (
                              <div className="mt-1 text-xs text-muted">{pkg.description}</div>
                            )}
                          </div>
                          {active && <FiCheck className="text-gold" />}
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          {pkg.weaponIds.length > 0 && (
                            <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-muted">
                              {pkg.weaponIds.length} weapon{pkg.weaponIds.length > 1 ? 's' : ''}
                            </div>
                          )}
                          {pkg.equipmentIds.length > 0 && (
                            <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-muted">
                              {pkg.equipmentIds.length} equipment items
                            </div>
                          )}
                          {pkg.discountPct > 0 && (
                            <div className="rounded-xl border border-success/20 bg-success/10 px-3 py-2 text-xs font-semibold text-success">
                              {pkg.discountPct}% OFF
                            </div>
                          )}
                        </div>

                        <div className="mt-3 flex items-center justify-between">
                          <div className="text-xs text-muted">Base price (per player)</div>
                          <div className="text-sm font-bold text-accent">₱{pkg.basePrice.toLocaleString()}</div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </Card>

            {/* Equipment Details */}
            {selectedPackage && (packageWeapons.length > 0 || packageEquipment.length > 0) && (
              <Card className="p-4 md:p-6">
                <div className="flex items-center gap-2 text-sm font-bold">
                  <FiShield /> <span>Included Weapons & Equipment</span>
                </div>
                <p className="mt-1 text-xs text-muted">From the admin inventory — prices are per item rental.</p>

                {packageWeapons.length > 0 && (
                  <div className="mt-4">
                    <div className="text-[11px] uppercase tracking-widest text-muted mb-2">Weapons</div>
                    <div className="grid gap-2 md:grid-cols-2">
                      {packageWeapons.map((w) => (
                        <div key={w.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                          <div>
                            <div className="text-sm font-bold">{w.name}</div>
                            <div className="mt-1 text-xs text-muted">{w.category.toUpperCase()} • {w.status}</div>
                          </div>
                          <div className="text-xs font-semibold text-accent">₱{w.price}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {packageEquipment.length > 0 && (
                  <div className="mt-4">
                    <div className="text-[11px] uppercase tracking-widest text-muted mb-2">Equipment</div>
                    <div className="grid gap-2 md:grid-cols-2">
                      {packageEquipment.map((e) => (
                        <div key={e.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                          <div>
                            <div className="text-sm font-bold">{e.name}</div>
                            <div className="mt-1 text-xs text-muted">{e.category.toUpperCase()} • Qty: {e.qty}</div>
                          </div>
                          <div className="text-xs font-semibold text-accent">₱{e.price}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            )}
          </div>

          <div className="space-y-4">
            <Card className="p-4 md:p-6">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiAlertTriangle /> <span>Quick Validation</span>
              </div>
              <p className="mt-1 text-xs text-muted">Prevent invalid selections before going to summary.</p>

              <div className="mt-4 space-y-3">
                <div className={[
                  'rounded-2xl border p-4',
                  players < effectiveMinPlayers ? 'border-danger/30 bg-danger/10' : 'border-white/10 bg-white/5',
                ].join(' ')}>
                  <div className="text-sm font-bold">Minimum players</div>
                  <div className="mt-1 text-xs text-muted">Package requires {selectedPackage?.minPlayers || '—'} players</div>
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

                  {dynamicPricing.discountPct > 0 && (
                    <div className="mt-2 text-xs text-muted">
                      Discount applied: {dynamicPricing.discountLabel}
                      {dynamicPricing.savings > 0 && ` (save ₱${dynamicPricing.savings.toLocaleString()})`}
                    </div>
                  )}
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
                <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
                <Button
                  variant="primary"
                  disabled={players < effectiveMinPlayers || !canProceed || !selectedPackage}
                  onClick={() => setStep(3)}
                >
                  Continue <FiChevronRight />
                </Button>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Step 3 */}
      {step === 3 && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            <Card className="p-4 md:p-6">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiShield /> <span>Reservation Summary</span>
              </div>
              <p className="mt-1 text-xs text-muted">Review the full breakdown before confirmation.</p>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Location</div>
                  <div className="mt-2 text-sm font-bold">{reservationSummary.locationLabel}</div>
                  <div className="mt-1 text-xs text-muted">{reservationSummary.fields.map((field) => field.name).join(', ')}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Field</div>
                  <div className="mt-2 text-sm font-bold">{reservationSummary.fields.map((field) => field.name).join(', ')}</div>
                  <div className="mt-1 text-xs text-muted">{reservationSummary.fields.map((field) => field.location).join(' • ')}</div>
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
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 md:col-span-2">
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Package</div>
                  <div className="mt-2 text-sm font-bold">{reservationSummary.packageName}</div>
                </div>
              </div>

              {reservationSummary.notes && (
                <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Notes</div>
                  <div className="mt-2 text-sm text-text">{reservationSummary.notes}</div>
                </div>
              )}
            </Card>

            <Card className="p-4 md:p-6">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiTag /> <span>Pricing Breakdown</span>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs text-muted">Base package (per player)</div>
                  <div className="mt-2 text-sm font-bold">₱{selectedPackage?.basePrice.toLocaleString() || '0'}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs text-muted">Equipment add-ons (per player)</div>
                  <div className="mt-2 text-sm font-bold">₱{equipmentTotalPerPlayer.toLocaleString()}</div>
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

              {dynamicPricing.savings > 0 && (
                <div className="mt-3 text-xs text-muted">
                  You save ₱{dynamicPricing.savings.toLocaleString()} compared to the original price
                </div>
              )}

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
                <FiCheck /> <span>Confirm Reservation</span>
              </div>
              <p className="mt-1 text-xs text-muted">Review all details before confirming.</p>

              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs text-muted">Total</div>
                  <div className="text-2xl font-bold text-gold">₱{dynamicPricing.total.toLocaleString()}</div>
                  <div className="mt-1 text-xs text-muted">Including all fees and discounts</div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs text-muted">Status</div>
                  <div className="mt-1 text-sm font-bold text-accent">Pending Review</div>
                  <div className="mt-1 text-xs text-muted">Your reservation will be reviewed by staff</div>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-2">
                <Button variant="ghost" onClick={() => setStep(2)}>Back</Button>
                <Button
                  variant="primary"
                  disabled={isConfirming || !canProceed}
                  onClick={handleConfirm}
                >
                  {isConfirming ? 'Confirming...' : 'Confirm Reservation'}
                </Button>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Step 4 - Success */}
      {step === 4 && (
        <Card className="p-6">
          <div className="text-lg font-bold text-success">Reservation submitted</div>
          <p className="mt-2 text-sm text-muted">Your reservation is pending review.</p>
        </Card>
      )}
    </div>
  )
}