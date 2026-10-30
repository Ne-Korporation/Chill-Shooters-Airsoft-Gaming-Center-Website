import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  FiAlertTriangle,
  FiCalendar,
  FiCheck,
  FiChevronRight,
  FiClock,
  FiCrosshair,
  FiMapPin,
  FiMinus,
  FiPackage,
  FiPlus,
  FiSearch,
  FiShield,
  FiSliders,
  FiTag,
  FiTool,
  FiUsers,
  FiX,
} from 'react-icons/fi'

import { apiBase, apiDelete, apiGet, apiPost, getApiAuthHeaders } from '../../utils/apiClient'
import { useAuth } from '../../context/AuthContext'
import { LANDING_PREFILL_KEY, type LandingReservationPrefill } from '../auth/LandingPage'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { calculatePackagePricing, packageEquipmentQty } from '../../utils/packagePricing'
import { formatDiscountTargetLabel, resolvePackageDiscountConfig } from '../../utils/packagePricing'
import { loadPackagePrefill } from '../../utils/packagePrefill'
import { modelOf } from '../../utils/inventoryModels'
import { PiecePicker, type PickerGroup } from '../../components/inventory/PiecePicker'

// Slot holds last 15 minutes on the server; refresh well before that while the player is booking.
const SLOT_HOLD_REFRESH_MS = 4 * 60 * 1000

type SessionType = 'public' | 'private'
type TimeSlot = 'morning' | 'afternoon' | 'evening'
type LocationOption = 'salawag' | 'langkaan' | 'binan'

type Field = {
  id: string
  name: string
  location: string
  minPlayersPrivate: number
  locationId: LocationOption
}

type RentalPackage = {
  id: string
  _id?: any
  name: string
  discountPct: number
  discountMode?: 'percent' | 'amount' | 'settled'
  discountValue?: number
  discountTargets?: Array<'package_total' | 'weapons' | 'equipment' | 'entrance'>
  description: string
  basePrice: number
  minPlayers: number
  players: number
  settledAmount: number
  weaponCount: number
  weaponIds: string[]
  equipmentIds: string[]
  equipmentQuantities: Record<string, number>
  equipmentCount: number
  status: string
}

// Rental gear is one record per physical piece (e.g. "M4 Rifle #3"), grouped by model.
type WeaponItem = {
  id: string
  _id?: any
  name: string
  model: string
  unitNumber: number
  source?: string
  category: string
  status: string
  price: number
}

type EquipmentItemDetails = {
  id: string
  _id?: any
  name: string
  model: string
  unitNumber: number
  source?: string
  category: string
  status: string
  price: number
}

type ReservationRecord = {
  id: string
  dateISO: string
  fieldIds: string[]
  slot: TimeSlot
  sessionType: SessionType
  players: number
  reservationStatus?: string
  locationId?: string
}

type SelectionMode = 'package' | 'custom'

// Must match GAME_MODES in server/routes/crud.js
const GAME_MODES = [
  "Marshal's choice",
  'Team Deathmatch',
  'Capture the Flag',
  'Search & Destroy (bomb defusal)',
  'Domination / King of the Hill',
  'VIP Escort',
  'Attack & Defend',
]

type TeamMember = {
  id: string
  name: string
  email: string
  status: string
  waiverSubmitted: boolean
  hasApprovedWeapon: boolean
}

type PaymentMode = 'self' | 'split'
// full: pay everything online now. cash_balance: the 50% downpayment online now, the rest in cash at the field.
type PaymentPlan = 'full' | 'cash_balance'

type StockEntry = { stock: number; held: number; available: number }

type SlotStock = {
  weapons: Record<string, StockEntry>
  equipments: Record<string, StockEntry>
}

type WaiverRecord = {
  userId?: string
  playerId?: string
  accountId?: string
  status?: string
}

const locationFields: Record<LocationOption, Field[]> = {
  salawag: [
    { id: 'salawag-field-1', name: 'Upper Ground', location: 'Delta Stronghold Salawag', minPlayersPrivate: 10, locationId: 'salawag' },
    { id: 'salawag-field-2', name: 'Lower Ground', location: 'Delta Stronghold Salawag', minPlayersPrivate: 10, locationId: 'salawag' },
    { id: 'salawag-field-3', name: 'Forest', location: 'Delta Stronghold Salawag', minPlayersPrivate: 10, locationId: 'salawag' },
  ],
  langkaan: [
    { id: 'langkaan-field-1', name: 'Upper Ground', location: 'Delta Stronghold Langkaan', minPlayersPrivate: 10, locationId: 'langkaan' },
    { id: 'langkaan-field-2', name: 'Lower Ground', location: 'Delta Stronghold Langkaan', minPlayersPrivate: 10, locationId: 'langkaan' },
    { id: 'langkaan-field-3', name: 'Forest', location: 'Delta Stronghold Langkaan', minPlayersPrivate: 10, locationId: 'langkaan' },
  ],
  binan: [
    { id: 'binan-field-1', name: 'Upper Ground', location: 'LOMA Binan Laguna', minPlayersPrivate: 10, locationId: 'binan' },
    { id: 'binan-field-2', name: 'Lower Ground', location: 'LOMA Binan Laguna', minPlayersPrivate: 10, locationId: 'binan' },
    { id: 'binan-field-3', name: 'Forest', location: 'LOMA Binan Laguna', minPlayersPrivate: 10, locationId: 'binan' },
  ],
}

const locationHectares: Record<LocationOption, number> = {
  salawag: 2,
  langkaan: 2,
  binan: 4,
}

function locationCapacityPerSlot(location: LocationOption, slot: TimeSlot): number {
  const basePerHectare = 100
  const hectares = locationHectares[location]
  const mult = slot === 'morning' ? 1.0 : slot === 'afternoon' ? 0.95 : 0.9
  return Math.floor(hectares * basePerHectare * mult)
}

type SlotCapacities = Record<LocationOption, Record<TimeSlot, number>>

function getFieldsForLocation(location: LocationOption): Field[] {
  return locationFields[location] || []
}

function getMinPlayersForSelectedFields(selectedFieldIds: string[], location: LocationOption): number {
  if (selectedFieldIds.length === 0) return 0
  const fields = getFieldsForLocation(location)
  return selectedFieldIds
    .map((fieldId) => fields.find((f) => f.id === fieldId)?.minPlayersPrivate ?? 0)
    .reduce((max, value) => Math.max(max, value), 0)
}

function getFieldById(fieldId: string): Field | undefined {
  for (const location of ['salawag', 'langkaan', 'binan'] as LocationOption[]) {
    const field = locationFields[location].find(f => f.id === fieldId)
    if (field) return field
  }
  return undefined
}

const locationOptions: { id: LocationOption; name: string; detail: string; capacity: string }[] = [
  { id: 'salawag', name: 'Delta Stronghold (Salawag)', detail: 'Approximately 2 hectares.', capacity: '~200 players per slot' },
  { id: 'langkaan', name: 'Delta Stronghold (Langkaan)', detail: 'Approximately 2 hectares.', capacity: '~200 players per slot' },
  { id: 'binan', name: 'LOMA Binan Laguna', detail: 'Approximately 4 hectares.', capacity: '~400 players per slot' },
]

const slotLabels: Record<TimeSlot, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
}

const timeSlots: TimeSlot[] = ['morning', 'afternoon', 'evening']

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

function isWeekday(isoDate: string): boolean {
  const d = new Date(isoDate + 'T12:00:00')
  const day = d.getDay()
  return day >= 1 && day <= 5
}

function isWeekend(isoDate: string): boolean {
  return !isWeekday(isoDate)
}

function getDatesUntilEndOfNextMonth(from: Date): string[] {
  const dates: string[] = []
  const end = new Date(from.getFullYear(), from.getMonth() + 2, 0)
  const current = new Date(from)
  while (current <= end) {
    dates.push(toISODate(current))
    current.setDate(current.getDate() + 1)
  }
  return dates
}

function capacityFor(location: LocationOption, slot: TimeSlot) {
  return locationCapacityPerSlot(location, slot)
}

function slotSort(a: TimeSlot, b: TimeSlot) {
  const order: TimeSlot[] = ['morning', 'afternoon', 'evening']
  return order.indexOf(a) - order.indexOf(b)
}

const ENTRANCE_FEE_PER_PLAYER = 150
const MIN_PLAYERS = 2

export function ReservationCalendarPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const today = useMemo(() => new Date(), [])
  const { user } = useAuth()

  // Package picked in the Recommendation Engine (router state, or sessionStorage after a refresh).
  const [packagePrefill] = useState(() => loadPackagePrefill(location.state))

  // Booking bar selections from the landing page, if the user came from there.
  const [landingPrefill] = useState<LandingReservationPrefill | null>(() => {
    try {
      const raw = sessionStorage.getItem(LANDING_PREFILL_KEY)
      const parsed = raw ? (JSON.parse(raw) as LandingReservationPrefill) : null
      if (!parsed || !locationOptions.some((l) => l.id === parsed.location)) return null
      if (!timeSlots.includes(parsed.slot)) return null
      return parsed
    } catch {
      return null
    }
  })

  useEffect(() => {
    try {
      sessionStorage.removeItem(LANDING_PREFILL_KEY)
    } catch {
      // ignore
    }
  }, [])

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [isConfirming, setIsConfirming] = useState(false)
  const [packages, setPackages] = useState<RentalPackage[]>([])
  const [weapons, setWeapons] = useState<WeaponItem[]>([])
  const [equipment, setEquipment] = useState<EquipmentItemDetails[]>([])
  const [loadingPackages, setLoadingPackages] = useState(true)

  const [reservations, setReservations] = useState<ReservationRecord[]>([])
  const [loadingReservations, setLoadingReservations] = useState(true)
  const [serverCapacities, setServerCapacities] = useState<SlotCapacities | null>(null)
  const [loadingWaiverEligibility, setLoadingWaiverEligibility] = useState(true)
  // Teammates are found one at a time by email rather than from a list of every player.
  const [selectedTeammates, setSelectedTeammates] = useState<TeamMember[]>([])
  const selectedTeammateIds = useMemo(() => selectedTeammates.map((member) => member.id), [selectedTeammates])
  const [teamEmail, setTeamEmail] = useState('')
  const [teamLookup, setTeamLookup] = useState<{ status: 'idle' | 'searching' | 'found' | 'error'; member?: TeamMember; error?: string }>({ status: 'idle' })
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('self')
  const [paymentPlan, setPaymentPlan] = useState<PaymentPlan>('cash_balance')
  const [waiverEligibleUserIds, setWaiverEligibleUserIds] = useState<string[]>([])
  // Status of the logged-in user's own waiver: none = never submitted
  const [currentWaiverStatus, setCurrentWaiverStatus] = useState<'none' | 'pending' | 'approved' | 'denied'>('none')

  const monthCalendars = useMemo(() => {
    const monthStarts = [
      new Date(today.getFullYear(), today.getMonth(), 1),
      new Date(today.getFullYear(), today.getMonth() + 1, 1),
    ]

    return monthStarts.map((start) => {
      const year = start.getFullYear()
      const month = start.getMonth()
      const firstWeekday = new Date(year, month, 1).getDay()
      const daysInMonth = new Date(year, month + 1, 0).getDate()
      const cells: Array<string | null> = []

      for (let i = 0; i < firstWeekday; i += 1) cells.push(null)
      for (let day = 1; day <= daysInMonth; day += 1) {
        cells.push(toISODate(new Date(year, month, day)))
      }
      while (cells.length < 42) cells.push(null)

      const weeks: Array<Array<string | null>> = []
      for (let i = 0; i < cells.length; i += 7) {
        weeks.push(cells.slice(i, i + 7))
      }

      return {
        key: `${year}-${String(month + 1).padStart(2, '0')}`,
        label: new Date(year, month, 1).toLocaleString('default', { month: 'long', year: 'numeric' }),
        weeks,
      }
    })
  }, [today])

  const [selectedLocation, setSelectedLocation] = useState<LocationOption>(landingPrefill?.location ?? 'salawag')

  const availableFields = useMemo(() => {
    return getFieldsForLocation(selectedLocation)
  }, [selectedLocation])

  const [selectedFieldIds, setSelectedFieldIds] = useState<string[]>(() => {
    const fields = getFieldsForLocation(landingPrefill?.location ?? 'salawag')
    const prefilled = fields.find((f) => f.name === landingPrefill?.fieldArea)
    if (prefilled) return [prefilled.id]
    return fields.length > 0 ? [fields[0].id] : []
  })

  const initialDateISO = toISODate(addDays(today, 1))
  const todayDateISO = toISODate(today)
  // ISO dates compare correctly as strings; ignore a prefilled date that has already passed.
  const startDateISO =
    landingPrefill?.dateISO && landingPrefill.dateISO >= initialDateISO ? landingPrefill.dateISO : initialDateISO
  const [dateISO, setDateISO] = useState(startDateISO)
  const initialIsWeekend = isWeekend(startDateISO)
  const [slot, setSlot] = useState<TimeSlot>(landingPrefill?.slot ?? 'morning')
  const [selectedSlots, setSelectedSlots] = useState<TimeSlot[]>([])
  const [slotTouched, setSlotTouched] = useState(false)
  const [sessionType, setSessionType] = useState<SessionType>(
    initialIsWeekend ? 'public' : 'private'
  )

  // Update selected fields when location changes
  useEffect(() => {
    const fields = getFieldsForLocation(selectedLocation)
    if (fields.length > 0) {
      setSelectedFieldIds(prev => {
        const validIds = prev.filter(id => fields.some(f => f.id === id))
        return validIds.length > 0 ? validIds : [fields[0].id]
      })
    }
  }, [selectedLocation])

  // Fetch only the minimal future slot data used for availability indicators.
  const fetchReservations = useCallback(async (silent = false) => {
    let cancelled = false
    try {
      if (!silent) setLoadingReservations(true)
      const res = await apiGet<{ ok: boolean; data: any[]; capacities?: SlotCapacities }>('/api/reservation-availability')
      if (cancelled) return

      if (res.capacities) setServerCapacities(res.capacities)
      const data = Array.isArray(res?.data) ? res.data : []
      // Include PENDING, CONFIRMED, and APPROVED reservations
      // so slots are blocked as soon as someone books
      const mappedReservations: ReservationRecord[] = data
        .map((item: any) => ({
          id: `${item.locationId || ''}:${item.reservationDate || item.dateISO || ''}:${item.reservationTime || item.slot || ''}`,
          dateISO: item.reservationDate || item.dateISO || '',
          fieldIds: Array.isArray(item.fieldIds)
            ? item.fieldIds.map((id: any) => String(id)).filter(Boolean)
            : (item.fieldId ? [String(item.fieldId)] : []),
          slot: (item.reservationTime || item.slot || 'morning') as TimeSlot,
          sessionType: (item.sessionType || 'public') as SessionType,
          players: Number(item.numberOfPlayers || item.players || 0),
          reservationStatus: item.reservationStatus,
          locationId: item.locationId || item.location || '',
        }))
      setReservations(mappedReservations)
    } catch (e: any) {
      if (!cancelled) {
        console.error('Failed to fetch reservations:', e)
      }
    } finally {
      if (!cancelled) setLoadingReservations(false)
    }
    return () => { cancelled = true }
  }, [])

  // Initial fetch, then keep availability fresh while the page is open
  useEffect(() => {
    fetchReservations()
    const interval = window.setInterval(() => fetchReservations(true), 60_000)
    const onFocus = () => fetchReservations(true)
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [fetchReservations])

  // Refresh reservations if flagged (e.g., after returning from payment)
  useEffect(() => {
    const shouldRefresh = localStorage.getItem('refresh_reservations')
    if (shouldRefresh === 'true') {
      localStorage.removeItem('refresh_reservations')
      fetchReservations()
    }
  }, [fetchReservations])

  // Enforce session type when date changes
  useEffect(() => {
    const isWd = isWeekday(dateISO)
    if (isWd) {
      setSessionType('private')
      setSelectedSlots([])
      if (!slot) setSlot('morning')
    } else {
      setSessionType('public')
      setSlot('morning')
    }
    setSlotTouched(false)
  }, [dateISO])

  const defaultPlayers = useMemo(() => {
    if (packagePrefill?.players) return packagePrefill.players
    if (landingPrefill?.players) return landingPrefill.players
    const isWd = isWeekday(dateISO)
    return isWd ? 10 : MIN_PLAYERS
  }, [dateISO, packagePrefill?.players])

  const [players, setPlayers] = useState(defaultPlayers)
  const [playersInput, setPlayersInput] = useState(String(defaultPlayers))
  const [notes, setNotes] = useState('')
  const [gameModePreference, setGameModePreference] = useState<string>(GAME_MODES[0])
  const [layoutRequest, setLayoutRequest] = useState('')
  // Optional sketch of the custom field layout the marshals should set up.
  const [layoutBlueprintUrl, setLayoutBlueprintUrl] = useState('')
  const [uploadingBlueprint, setUploadingBlueprint] = useState(false)
  const uploadBlueprint = async (file: File) => {
    if (!file.type.startsWith('image/')) return toast.error('Upload an image file (PNG or JPG).')
    if (file.size > 5 * 1024 * 1024) return toast.error('The image must be 5 MB or smaller.')
    setUploadingBlueprint(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`${apiBase}/api/upload-image`, { method: 'POST', headers: getApiAuthHeaders(), body: formData })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.url) throw new Error(json?.error || 'Upload failed')
      setLayoutBlueprintUrl(json.url)
    } catch (e: any) {
      toast.error(e?.message || 'Could not upload the blueprint')
    } finally {
      setUploadingBlueprint(false)
    }
  }
  const [selectedPackageId, setSelectedPackageId] = useState<string>('')

  const [selectionMode, setSelectionMode] = useState<SelectionMode>('package')
  const [customWeaponIds, setCustomWeaponIds] = useState<string[]>([])
  const [customEquipmentIds, setCustomEquipmentIds] = useState<string[]>([])
  const [ownWeapons, setOwnWeapons] = useState('')
  const [ownEquipment, setOwnEquipment] = useState('')

  const [playerApprovedWeapons, setPlayerApprovedWeapons] = useState<any[]>([])
  const [playerApprovedEquipment, setPlayerApprovedEquipment] = useState<any[]>([])
  const [selectedOwnWeaponIds, setSelectedOwnWeaponIds] = useState<string[]>([])
  const [selectedOwnEquipmentIds, setSelectedOwnEquipmentIds] = useState<string[]>([])
  // How many players the group said will bring their own weapon, and which teammates were assigned.
  const [ownWeaponTarget, setOwnWeaponTarget] = useState(() => Math.max(0, Math.round(packagePrefill?.ownWeapons ?? 0)))
  const [teammateOwnWeaponIds, setTeammateOwnWeaponIds] = useState<string[]>([])
  const [noWeaponWarning, setNoWeaponWarning] = useState<TeamMember | null>(null)
  const [slotHoldExpiresAt, setSlotHoldExpiresAt] = useState<string | null>(null)
  const [placingHold, setPlacingHold] = useState(false)

  const findTeammate = async () => {
    const email = teamEmail.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setTeamLookup({ status: 'error', error: 'Enter a valid email address.' })
      return
    }
    if (user?.email && email === user.email.toLowerCase()) {
      setTeamLookup({ status: 'error', error: 'You are already counted as the team captain.' })
      return
    }
    setTeamLookup({ status: 'searching' })
    try {
      const res = await apiGet<{
        ok: boolean
        data: { id: string; name: string; email: string; waiverApproved: boolean; hasApprovedWeapon: boolean }
      }>(`/api/team-directory/lookup?email=${encodeURIComponent(email)}`)
      const found = res.data
      setTeamLookup({
        status: 'found',
        member: {
          id: String(found.id),
          name: found.name || found.email,
          email: found.email,
          status: 'active',
          waiverSubmitted: found.waiverApproved === true,
          hasApprovedWeapon: found.hasApprovedWeapon === true,
        },
      })
    } catch (err: any) {
      setTeamLookup({ status: 'error', error: err?.message || 'Could not look up that player.' })
    }
  }

  const addTeammate = (member: TeamMember) => {
    if (!member.waiverSubmitted) {
      toast.error(`${member.name}'s waiver isn't approved yet.`)
      return
    }
    if (selectedTeammateIds.includes(member.id)) {
      toast.error(`${member.name} is already on your team.`)
      return
    }
    if (selectedTeammates.length >= Math.max(0, players - 1)) {
      toast.error('Your team is full for this many players. Increase the player count to add more.')
      return
    }
    setSelectedTeammates((current) => [...current, member])
    setTeamEmail('')
    setTeamLookup({ status: 'idle' })
    toast.success(`${member.name} added to your team.`)
  }

  // Fetch waiver submissions so only players who completed the waiver can be added
  useEffect(() => {
    if (!user?.id) {
      setWaiverEligibleUserIds([])
      setLoadingWaiverEligibility(false)
      return
    }

    let cancelled = false

    const fetchWaiverEligibility = async () => {
      try {
        setLoadingWaiverEligibility(true)
        const res = await apiGet<{ ok: boolean; data: WaiverRecord[] }>('/api/waivers?limit=500')
        if (cancelled) return

        const docs = Array.isArray(res?.data) ? res.data : []
        const normStatus = (doc: WaiverRecord) => String(doc.status || '').trim().toLowerCase()
        const idsOf = (doc: WaiverRecord) =>
          [doc.userId, doc.playerId, doc.accountId].map((value) => String(value || '').trim()).filter(Boolean)

        // Only APPROVED waivers make a player eligible
        const eligibleIds = Array.from(new Set(
          docs
            .filter((doc) => normStatus(doc) === 'approved')
            .flatMap(idsOf),
        ))
        setWaiverEligibleUserIds(eligibleIds)

        // The logged-in user's own waiver status (approved > pending > denied > none)
        const mine = docs.filter((doc) => idsOf(doc).includes(String(user.id))).map(normStatus)
        if (mine.includes('approved')) setCurrentWaiverStatus('approved')
        else if (mine.some((st) => st !== 'denied' && st !== 'flagged')) setCurrentWaiverStatus('pending')
        else if (mine.length > 0) setCurrentWaiverStatus('denied')
        else setCurrentWaiverStatus('none')
      } catch {
        if (!cancelled) {
          setWaiverEligibleUserIds([])
          setCurrentWaiverStatus('none')
        }
      } finally {
        if (!cancelled) setLoadingWaiverEligibility(false)
      }
    }

    fetchWaiverEligibility()
    return () => { cancelled = true }
  }, [user?.id])

  const waiverEligibleSet = useMemo(() => new Set(waiverEligibleUserIds), [waiverEligibleUserIds])

  // Keep selected teammates within the headcount (players - 1, since the booker is one of them)
  useEffect(() => {
    const limit = Math.max(0, players - 1)
    setSelectedTeammates((current) => (current.length > limit ? current.slice(0, limit) : current))
  }, [players])

  useEffect(() => {
    setTeammateOwnWeaponIds((current) => {
      const next = current.filter((id) => selectedTeammateIds.includes(id))
      return next.length === current.length ? current : next
    })
  }, [selectedTeammateIds])

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

        const pkgDocs = Array.isArray(pkgRes?.data) ? pkgRes.data : []
        const parsedPackages: RentalPackage[] = pkgDocs
          .filter((d: any) => (d.status === 'active' || !d.status) && d.status !== 'archived')
          .map((d: any) => ({
            id: d.id ?? (d._id ? String(d._id) : undefined),
            _id: d._id,
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
            weaponCount: typeof d.weaponCount === 'number' && d.weaponCount > 0 ? d.weaponCount : (Array.isArray(d.weaponIds) ? d.weaponIds.length : 0),
            weaponIds: Array.isArray(d.weaponIds) ? d.weaponIds : [],
            equipmentIds: Array.isArray(d.equipmentIds) ? d.equipmentIds : [],
            equipmentQuantities: d.equipmentQuantities && typeof d.equipmentQuantities === 'object' ? d.equipmentQuantities : {},
            equipmentCount: (d.weaponIds?.length || 0) + (d.equipmentIds?.length || 0),
            status: d.status || 'active',
          }))
        setPackages(parsedPackages)

        const wepDocs = Array.isArray(wepRes?.data) ? wepRes.data : []
        setWeapons(wepDocs.map((d: any) => ({
          id: d.id ?? (d._id ? String(d._id) : undefined),
          _id: d._id,
          name: d.name || 'Unnamed weapon',
          model: modelOf(d),
          unitNumber: Number(d.unitNumber) || 0,
          source: d.source,
          category: d.category || 'rifles',
          status: d.status || 'available',
          price: typeof d.price === 'number' ? d.price : 0,
        })))

        const eqDocs = Array.isArray(eqRes?.data) ? eqRes.data : []
        setEquipment(eqDocs.map((d: any) => ({
          id: d.id ?? (d._id ? String(d._id) : undefined),
          _id: d._id,
          name: d.name || 'Unnamed equipment',
          model: modelOf(d),
          unitNumber: Number(d.unitNumber) || 0,
          source: d.source,
          category: d.category || 'gear',
          status: d.status || 'available',
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

  // Fetch user's approved own weapons and equipment
  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    ;(async () => {
      try {
        const [wepRes, eqRes] = await Promise.all([
          apiGet<{ ok: boolean; data: any[] }>('/api/weapons?limit=200'),
          apiGet<{ ok: boolean; data: any[] }>('/api/equipments?limit=200'),
        ])
        if (cancelled) return
        const wepDocs = Array.isArray(wepRes?.data) ? wepRes.data : []
        const eqDocs = Array.isArray(eqRes?.data) ? eqRes.data : []
        const approvedWeapons = wepDocs.filter(
          (d: any) => String(d.submittedBy) === String(user.id) && d.approvalStatus === 'approved'
        )
        const approvedEquipment = eqDocs.filter(
          (d: any) => String(d.submittedBy) === String(user.id) && d.approvalStatus === 'approved'
        )
        setPlayerApprovedWeapons(approvedWeapons)
        setPlayerApprovedEquipment(approvedEquipment)
      } catch {
        // silently fail
      }
    })()
    return () => { cancelled = true }
  }, [user?.id])

  // Only players with an approved weapon on file count; the rest are charged a rental weapon.
  const captainBringsOwnWeapon = selectedOwnWeaponIds.length > 0
  const verifiedTeammateBringers = useMemo(
    () => selectedTeammates.filter((member) => teammateOwnWeaponIds.includes(member.id) && member.hasApprovedWeapon),
    [selectedTeammates, teammateOwnWeaponIds],
  )
  const verifiedOwnWeaponCount = Math.min(players, (captainBringsOwnWeapon ? 1 : 0) + verifiedTeammateBringers.length)
  const ownWeaponShortfall = Math.max(0, ownWeaponTarget - verifiedOwnWeaponCount)

  // Rental stock left for the chosen date/slot, so players see shortages here
  // instead of hitting them when the reservation is submitted at payment.
  const [slotStock, setSlotStock] = useState<SlotStock | null>(null)
  const [loadingSlotStock, setLoadingSlotStock] = useState(false)
  useEffect(() => {
    if (!dateISO || !slot) return
    let cancelled = false
    setLoadingSlotStock(true)
    apiGet<{ ok: boolean; data: SlotStock }>(`/api/inventory-availability?date=${encodeURIComponent(dateISO)}&slot=${encodeURIComponent(slot)}`)
      .then((res) => { if (!cancelled) setSlotStock(res?.data ?? null) })
      .catch(() => { if (!cancelled) setSlotStock(null) })
      .finally(() => { if (!cancelled) setLoadingSlotStock(false) })
    return () => { cancelled = true }
  }, [dateISO, slot, step])

  // A piece is free when it's in service and not reserved by another booking for this slot.
  const pieceFree = useCallback((collection: 'weapons' | 'equipments', piece: { id: string; status: string }) => {
    if (String(piece.status || 'available') !== 'available') return false
    const entry = slotStock?.[collection]?.[piece.id]
    return entry ? entry.available > 0 : true
  }, [slotStock])

  const rentalWeapons = useMemo(() => weapons.filter((w) => w.source !== 'player'), [weapons])
  const rentalEquipment = useMemo(() => equipment.filter((e) => e.source !== 'player'), [equipment])

  const groupPieces = useCallback((collection: 'weapons' | 'equipments', items: Array<WeaponItem | EquipmentItemDetails>): PickerGroup[] => {
    const groups = new Map<string, PickerGroup>()
    for (const item of [...items].sort((a, b) => a.unitNumber - b.unitNumber || a.id.localeCompare(b.id))) {
      const group = groups.get(item.model) || { model: item.model, category: item.category, price: item.price, pieces: [] }
      group.pieces.push({ id: item.id, label: item.unitNumber ? `#${item.unitNumber}` : item.id, free: pieceFree(collection, item) })
      groups.set(item.model, group)
    }
    return [...groups.values()].sort((a, b) => a.model.localeCompare(b.model))
  }, [pieceFree])

  const weaponGroups = useMemo(() => groupPieces('weapons', rentalWeapons), [groupPieces, rentalWeapons])
  const equipmentGroups = useMemo(() => groupPieces('equipments', rentalEquipment), [groupPieces, rentalEquipment])

  const freeOfModel = useCallback((groups: PickerGroup[], model: string) =>
    groups.find((group) => group.model === model)?.pieces.filter((piece) => piece.free).length ?? 0,
  [])

  const modelsOfIds = useCallback((items: Array<{ id: string; model: string }>, ids: string[]) =>
    [...new Set(ids.map((id) => items.find((item) => item.id === id)?.model).filter(Boolean) as string[])],
  [])

  // Mirrors the server: a package rents weaponCount × players weapons (minus verified own
  // weapons) from the free pieces of its weapon models.
  const packageWeaponStock = useCallback((pkg: RentalPackage) => {
    const models = modelsOfIds(rentalWeapons, pkg.weaponIds)
    const needed = models.length ? Math.max(0, Math.round(pkg.weaponCount || models.length) * players - verifiedOwnWeaponCount) : 0
    if (!slotStock) return { needed, available: null as number | null, ok: true }
    const available = models.reduce((sum, model) => sum + freeOfModel(weaponGroups, model), 0)
    return { needed, available, ok: available >= needed }
  }, [modelsOfIds, rentalWeapons, players, verifiedOwnWeaponCount, slotStock, freeOfModel, weaponGroups])

  const cheapestPackage = useMemo(() => {
    if (packages.length === 0) return undefined
    return packages.reduce((cheapest, pkg) =>
      pkg.basePrice < cheapest.basePrice ? pkg : cheapest
    )
  }, [packages])

  // Pre-pick a package only in package mode; choosing Custom Selection clears the package and
  // must not be undone by this effect.
  useEffect(() => {
    if (selectionMode === 'package' && packages.length > 0 && !selectedPackageId) {
      const prefillId = packagePrefill?.selectedPackageId
      if (prefillId && packages.find((p) => p.id === prefillId)) {
        setSelectedPackageId(prefillId)
      } else if (cheapestPackage) {
        setSelectedPackageId(cheapestPackage.id)
      }
    }
  }, [packages, packagePrefill?.selectedPackageId, selectedPackageId, cheapestPackage, selectionMode])

  const selectedPackage = useMemo(
    () => packages.find((p) => p.id === selectedPackageId) ?? cheapestPackage,
    [packages, selectedPackageId, cheapestPackage],
  )

  const isWd = useMemo(() => isWeekday(dateISO), [dateISO])

  // ---------------------------------------------------------------------
  // Field availability + minimum player rules
  // ---------------------------------------------------------------------

  const isFieldSlotAvailable = useCallback((fieldId: string, slotToCheck: TimeSlot): boolean => {
    // Weekdays (private): one game per field per slot
    if (isWd) {
      const field = getFieldById(fieldId)
      if (!field) return false
      return !reservations.some(
        (r) =>
          r.dateISO === dateISO &&
          r.fieldIds.includes(fieldId) &&
          r.slot === slotToCheck &&
          r.locationId === selectedLocation,
      )
    }
    // Weekends (public): multiple games allowed
    return true
  }, [isWd, reservations, dateISO, selectedLocation])

  const isUpperGroundTaken = useCallback((slotToCheck: TimeSlot): boolean => {
    const upper = getFieldsForLocation(selectedLocation).find((f) =>
      f.name.toLowerCase().includes('upper'),
    )
    return upper ? !isFieldSlotAvailable(upper.id, slotToCheck) : false
  }, [selectedLocation, isFieldSlotAvailable])

  const isLowerGroundTaken = useCallback((slotToCheck: TimeSlot): boolean => {
    const lower = getFieldsForLocation(selectedLocation).find((f) =>
      f.name.toLowerCase().includes('lower'),
    )
    return lower ? !isFieldSlotAvailable(lower.id, slotToCheck) : false
  }, [selectedLocation, isFieldSlotAvailable])

  // Single source of truth for the minimum players of a field selection
  const getMinPlayersForSelection = useCallback((ids: string[], slotToCheck: TimeSlot): number => {
    if (ids.length === 0) return 0

    if (ids.length === 1) {
      const field = getFieldById(ids[0])
      if (!field) return 0
      const name = field.name.toLowerCase()

      // Exception 1: Lower Ground drops to 10 when Upper Ground is taken
      if (name.includes('lower') && isUpperGroundTaken(slotToCheck)) {
        return 10
      }
      // Exception 2: Forest drops to 10 when BOTH Upper and Lower Ground are taken
      if (
        !name.includes('upper') &&
        !name.includes('lower') &&
        isUpperGroundTaken(slotToCheck) &&
        isLowerGroundTaken(slotToCheck)
      ) {
        return 10
      }
      return field.minPlayersPrivate
    }

    return getMinPlayersForSelectedFields(ids, selectedLocation)
  }, [selectedLocation, isUpperGroundTaken, isLowerGroundTaken])

  const getFieldSelectionValidity = useCallback(
    (candidateIds: string[], playersCount: number, slotToCheck: TimeSlot) => {
      if (sessionType !== 'private') return true
      if (candidateIds.length === 0) return false

      const allAvailable = candidateIds.every((id) => isFieldSlotAvailable(id, slotToCheck))
      if (!allAvailable) return false

      return playersCount >= getMinPlayersForSelection(candidateIds, slotToCheck)
    },
    [sessionType, isFieldSlotAvailable, getMinPlayersForSelection],
  )

  const minPlayersForFields = useMemo(() => {
    if (sessionType === 'public') return MIN_PLAYERS
    return getMinPlayersForSelection(selectedFieldIds, slot)
  }, [sessionType, selectedFieldIds, slot, getMinPlayersForSelection])

  const effectiveMinPlayers = useMemo(
    () => selectionMode === 'custom'
      ? minPlayersForFields
      : (selectedPackage ? Math.max(selectedPackage.minPlayers, minPlayersForFields) : minPlayersForFields),
    [selectionMode, selectedPackage, minPlayersForFields],
  )

  const meetsFieldRequirements = useMemo(() => {
    if (sessionType === 'public') return true
    return getFieldSelectionValidity(selectedFieldIds, players, slot)
  }, [getFieldSelectionValidity, players, selectedFieldIds, sessionType, slot])

  // On weekdays, drop selected fields that are no longer available for the slot
  useEffect(() => {
    if (!isWd) return

    setSelectedFieldIds((prev) => {
      const stillAvailable = prev.filter((fieldId) => isFieldSlotAvailable(fieldId, slot))
      if (stillAvailable.length > 0) {
        const unchanged = stillAvailable.length === prev.length && stillAvailable.every((id, idx) => id === prev[idx])
        return unchanged ? prev : stillAvailable
      }

      const firstAvailable = availableFields.find((field) => isFieldSlotAvailable(field.id, slot))
      const fallback = firstAvailable ? [firstAvailable.id] : []
      const unchanged = fallback.length === prev.length && fallback.every((id, idx) => id === prev[idx])
      return unchanged ? prev : fallback
    })
  }, [availableFields, dateISO, isWd, isFieldSlotAvailable, reservations, selectedLocation, slot])

  // Check if a specific slot is fully booked for ALL fields at this location
  const isSlotFullyBooked = (slotToCheck: TimeSlot): boolean => {
    const fields = getFieldsForLocation(selectedLocation)

    if (isWd) {
      const freeFields = fields.filter(f => isFieldSlotAvailable(f.id, slotToCheck))
      return freeFields.length === 0
    }
    // For weekends: slots have capacity limits
    const cap = serverCapacities?.[selectedLocation]?.[slotToCheck] ?? capacityFor(selectedLocation, slotToCheck)
    const used = reservations
      .filter((r) => r.dateISO === dateISO &&
                     r.slot === slotToCheck &&
                     r.locationId === selectedLocation)
      .reduce((sum, r) => sum + r.players, 0)
    return used >= cap
  }

  // Get available fields for a specific slot at this location
  const getAvailableFieldsForSlot = (slotToCheck: TimeSlot): Field[] => {
    const fields = getFieldsForLocation(selectedLocation)
    if (isWd) {
      return fields.filter(f => isFieldSlotAvailable(f.id, slotToCheck))
    }
    return fields
  }

  // Used players from reservations. Capacity is per location and slot (all fields),
  // matching the server's check, so the counter never shows room the server will refuse.
  const usedPlayers = useMemo(() => {
    return reservations
      .filter((r) => r.dateISO === dateISO &&
                     r.slot === slot &&
                     r.locationId === selectedLocation)
      .reduce((sum, r) => sum + r.players, 0)
  }, [dateISO, slot, reservations, selectedLocation])

  const maxCapacity = useMemo(() => {
    return serverCapacities?.[selectedLocation]?.[slot] ?? capacityFor(selectedLocation, slot)
  }, [selectedLocation, serverCapacities, slot])

  const remainingSlots = maxCapacity - usedPlayers
  const hasRequiredSlotSelection = isWd ? slotTouched : selectedSlots.length > 0
  const canProceed = hasRequiredSlotSelection && remainingSlots >= players && meetsFieldRequirements

  const slotOverview = useMemo(() => {
    const cap = maxCapacity
    const pct = cap > 0 ? Math.round((usedPlayers / cap) * 100) : 0
    return { cap, pct: clamp(pct, 0, 100) }
  }, [maxCapacity, usedPlayers])

  const packageWeapons = useMemo(() => {
    if (!selectedPackage) return []
    return selectedPackage.weaponIds
      .map((wid) => weapons.find((w) => w.id === wid))
      .filter(Boolean) as WeaponItem[]
  }, [selectedPackage, weapons])

  const packageEquipment = useMemo(() => {
    if (!selectedPackage) return []
    return selectedPackage.equipmentIds
      .map((eid) => equipment.find((e) => e.id === eid))
      .filter(Boolean) as EquipmentItemDetails[]
  }, [selectedPackage, equipment])

  const equipmentTotalPerPlayer = useMemo(() => {
    const weaponPrices = packageWeapons.reduce((sum, w) => sum + (w.price || 0), 0)
    const equipmentPrices = packageEquipment.reduce((sum, e) => sum + (e.price || 0), 0)
    return weaponPrices + equipmentPrices
  }, [packageWeapons, packageEquipment])

  // Pieces the player picked for a package (optional; the rest are assigned automatically).
  const [pickedUnitIds, setPickedUnitIds] = useState<string[]>([])
  const packageWeaponModels = useMemo(() => (selectedPackage ? modelsOfIds(rentalWeapons, selectedPackage.weaponIds) : []), [selectedPackage, modelsOfIds, rentalWeapons])
  const packageEquipmentModels = useMemo(() => (selectedPackage ? modelsOfIds(rentalEquipment, selectedPackage.equipmentIds) : []), [selectedPackage, modelsOfIds, rentalEquipment])
  const packageWeaponGroups = useMemo(() => weaponGroups.filter((group) => packageWeaponModels.includes(group.model)), [weaponGroups, packageWeaponModels])
  const packageEquipmentGroups = useMemo(() => equipmentGroups.filter((group) => packageEquipmentModels.includes(group.model)), [equipmentGroups, packageEquipmentModels])

  // Drop picks that no longer apply (package, slot, or headcount changed).
  useEffect(() => {
    const allowed = new Set([...packageWeaponGroups, ...packageEquipmentGroups].flatMap((group) => group.pieces.filter((piece) => piece.free).map((piece) => piece.id)))
    setPickedUnitIds((current) => {
      const next = current.filter((id) => allowed.has(id))
      return next.length === current.length ? current : next
    })
  }, [packageWeaponGroups, packageEquipmentGroups])

  useEffect(() => {
    const free = new Set([...weaponGroups, ...equipmentGroups].flatMap((group) => group.pieces.filter((piece) => piece.free).map((piece) => piece.id)))
    setCustomWeaponIds((current) => (current.every((id) => free.has(id)) ? current : current.filter((id) => free.has(id))))
    setCustomEquipmentIds((current) => (current.every((id) => free.has(id)) ? current : current.filter((id) => free.has(id))))
  }, [weaponGroups, equipmentGroups])

  const togglePickedUnit = (id: string) => {
    setPickedUnitIds((current) => (current.includes(id) ? current.filter((unit) => unit !== id) : [...current, id]))
  }

  const packageWeaponsNeeded = selectedPackage ? packageWeaponStock(selectedPackage).needed : 0
  const pickedPackageWeapons = pickedUnitIds.filter((id) => rentalWeapons.some((w) => w.id === id)).length

  const customSelectedWeapons = useMemo(() => {
    return weapons.filter((w) => customWeaponIds.includes(w.id))
  }, [weapons, customWeaponIds])

  const customSelectedEquipment = useMemo(() => {
    return equipment.filter((e) => customEquipmentIds.includes(e.id))
  }, [equipment, customEquipmentIds])

  // Pieces of an equipment model each player gets in the selected package (set by the admin).
  const equipmentPerPlayer = useCallback((model: string) => {
    if (!selectedPackage) return 1
    const ids = selectedPackage.equipmentIds.filter((id) => rentalEquipment.find((item) => item.id === id)?.model === model)
    return Math.max(1, ...ids.map((id) => packageEquipmentQty(selectedPackage, id)))
  }, [selectedPackage, rentalEquipment])

  // Package shortages for the selected date/slot. Custom picks are individual free pieces.
  const equipmentStockCheck = useMemo(() => {
    if (selectionMode !== 'package' || !selectedPackage || !slotStock) return []
    const checks = packageEquipmentModels.map((model) => {
      const available = freeOfModel(equipmentGroups, model)
      const required = players * equipmentPerPlayer(model)
      return { name: model, available, required, ok: available >= required }
    })
    if (packageWeaponModels.length > 0) {
      const weaponStock = packageWeaponStock(selectedPackage)
      if (weaponStock.available !== null) {
        checks.push({ name: 'Rental weapons', available: weaponStock.available, required: weaponStock.needed, ok: weaponStock.ok })
      }
    }
    return checks
  }, [selectionMode, selectedPackage, slotStock, packageEquipmentModels, packageWeaponModels, freeOfModel, equipmentGroups, players, packageWeaponStock, equipmentPerPlayer])

  const hasInsufficientEquipmentStock = equipmentStockCheck.some((item) => !item.ok)

  // Custom rentals are individual pieces: each chosen piece is rented once at its own price.
  const customItemsTotal = useMemo(
    () => [...customSelectedWeapons, ...customSelectedEquipment].reduce((sum, item) => sum + (item.price || 0), 0),
    [customSelectedWeapons, customSelectedEquipment],
  )
  const customTotal = customItemsTotal + ENTRANCE_FEE_PER_PLAYER * players
  const customPerPlayerTotal = Math.round(customTotal / Math.max(1, players))

  const basePricing = useMemo(() => {
    if (selectionMode === 'custom') {
      return {
        total: customTotal,
        perPlayer: customPerPlayerTotal,
        discountPct: 0,
        discountLabel: '—',
        discountSummary: 'No package discount',
        discountAmount: 0,
        equipmentTotalPerPlayer: customPerPlayerTotal,
        sessionMultiplier: 1,
        savings: 0,
        originalTotal: customTotal,
        mode: 'custom' as const,
        totalBeforeOverall: customTotal,
        details: null,
      }
    }

    if (!selectedPackage) {
      return { total: 0, perPlayer: 0, discountPct: 0, discountLabel: '—', discountSummary: '—', discountAmount: 0, equipmentTotalPerPlayer: 0, sessionMultiplier: 1, savings: 0, originalTotal: 0, mode: 'package' as const, entranceFeeTotal: 0, totalBeforeOverall: 0, details: null }
    }
    const sessionMultiplier = 1.0
    const packagePricing = calculatePackagePricing({
      pkg: selectedPackage,
      players,
      sessionMultiplier,
      weapons: packageWeapons,
      equipment: packageEquipment,
      entranceFeePerPlayer: ENTRANCE_FEE_PER_PLAYER,
      ownWeapons: verifiedOwnWeaponCount,
    })

    return {
      total: packagePricing.total,
      perPlayer: packagePricing.perPlayer,
      discountPct: packagePricing.isLegacyPct ? selectedPackage.discountPct : (packagePricing.discountMode === 'percent' && packagePricing.discountTargets.includes('package_total') ? packagePricing.discountValue : 0),
      discountLabel: packagePricing.discountLabel,
      discountSummary: packagePricing.discountSummary,
      discountAmount: packagePricing.discountAmount,
      equipmentTotalPerPlayer,
      sessionMultiplier,
      savings: Math.max(0, packagePricing.discountAmount),
      originalTotal: packagePricing.preDiscountTotal,
      mode: 'package' as const,
      entranceFeeTotal: packagePricing.entranceFeeTotal,
      totalBeforeOverall: packagePricing.total,
      details: packagePricing,
    }
  }, [players, selectedPackage, packageWeapons, packageEquipment, equipmentTotalPerPlayer, selectionMode, customTotal, customPerPlayerTotal, verifiedOwnWeaponCount])

  const dynamicPricing = basePricing

  const paymentBreakdown = useMemo(() => {
    const entranceFee = ENTRANCE_FEE_PER_PLAYER * players
    const itemizedBreakdown: Array<{ label: string; amount: number }> = []
    let fieldPrice = 0
    let equipmentPrice = 0

    if (selectionMode === 'package' && selectedPackage && dynamicPricing.details) {
      const details = dynamicPricing.details
      if (details.isSettled) {
        itemizedBreakdown.push({ label: `${selectedPackage.name} (set price for ${players} players)`, amount: details.basePriceTotal })
        fieldPrice = details.basePriceTotal
      } else {
        fieldPrice = details.basePriceTotal
        equipmentPrice = details.weaponsTotal + details.equipmentTotal
        if (details.basePriceTotal > 0) itemizedBreakdown.push({ label: `${selectedPackage.name} fee`, amount: details.basePriceTotal })
        if (details.weaponsTotal > 0) itemizedBreakdown.push({ label: `Rental weapons (${details.rentedWeaponCount})`, amount: details.weaponsTotal })
        if (details.ownWeaponsUsed > 0) itemizedBreakdown.push({ label: `Own weapons (${details.ownWeaponsUsed}) — no rental charge`, amount: 0 })
        packageEquipment.forEach((item) => {
          itemizedBreakdown.push({ label: `${item.name} (1 per player)`, amount: Number(item.price || 0) * players })
        })
        itemizedBreakdown.push({ label: `Player entrance fee (${players} × ₱${ENTRANCE_FEE_PER_PLAYER})`, amount: entranceFee })
      }
      if (details.discountAmount > 0) itemizedBreakdown.push({ label: `Package discount (${details.discountSummary})`, amount: -details.discountAmount })
    } else if (selectionMode === 'custom') {
      equipmentPrice = customItemsTotal
      const groups = new Map<string, { count: number; amount: number }>()
      for (const item of [...customSelectedWeapons, ...customSelectedEquipment]) {
        const group = groups.get(item.model) || { count: 0, amount: 0 }
        groups.set(item.model, { count: group.count + 1, amount: group.amount + Number(item.price || 0) })
      }
      for (const [model, group] of groups) {
        itemizedBreakdown.push({ label: `${model}${group.count > 1 ? ` × ${group.count}` : ''}`, amount: group.amount })
      }
      itemizedBreakdown.push({ label: `Player entrance fee (${players} × ₱${ENTRANCE_FEE_PER_PLAYER})`, amount: entranceFee })
    }

    return {
      fieldPrice,
      equipmentPrice,
      entranceFee,
      serviceFee: 0,
      total: dynamicPricing.total,
      itemizedBreakdown,
    }
  }, [customItemsTotal, customSelectedEquipment, customSelectedWeapons, dynamicPricing, packageEquipment, players, selectedPackage, selectionMode])

  const reservationSummary = useMemo(() => {
    const selectedFields = availableFields.filter((f) => selectedFieldIds.includes(f.id))
    const pkgName = selectionMode === 'custom'
      ? 'Custom Selection (No Package)'
      : (selectedPackage?.name || 'No package selected')
    return {
      locationLabel: locationOptions.find((loc) => loc.id === selectedLocation)?.name ?? 'Location',
      fields: selectedFields,
      dateISO,
      slotLabel: slotLabels[slot],
      sessionTypeLabel: sessionType === 'private' ? 'Private Session' : 'Public Session',
      players,
      packageName: pkgName,
      notes,
      selectionMode,
      customWeapons: customSelectedWeapons,
      customEquipment: customSelectedEquipment,
      ownWeapons,
      ownEquipment,
    }
  }, [dateISO, selectedFieldIds, selectedLocation, selectionMode, selectedPackage?.name, sessionType, slot, players, notes, customSelectedWeapons, customSelectedEquipment, ownWeapons, ownEquipment, availableFields])

  const maxTeammates = Math.max(0, players - 1)
  const hasCurrentUserWaiver = !user?.id ? false : waiverEligibleSet.has(String(user.id))
  // Teammates are optional: any spots not filled with registered players are walk-ins.
  const teamSelectionComplete = maxTeammates === 0 || selectedTeammateIds.length === maxTeammates
  const walkInSpots = Math.max(0, maxTeammates - selectedTeammateIds.length)
  const toggleTeammateOwnWeapon = (member: TeamMember) => {
    if (teammateOwnWeaponIds.includes(member.id)) {
      setTeammateOwnWeaponIds((current) => current.filter((id) => id !== member.id))
      return
    }
    if (!member.hasApprovedWeapon) {
      setNoWeaponWarning(member)
      return
    }
    setTeammateOwnWeaponIds((current) => [...current, member.id])
  }
  const canSplitPayment = players > 1 && selectedTeammateIds.length > 0
  const splitPartySize = Math.max(1, selectedTeammateIds.length + 1)
  const payerShareAmount = paymentMode === 'split'
    ? Number((dynamicPricing.total / splitPartySize).toFixed(2))
    : dynamicPricing.total
  const teamPaymentLabel = paymentMode === 'split'
    ? `Split among ${splitPartySize} player${splitPartySize === 1 ? '' : 's'}`
    : 'This player pays for all'
  const canSubmitReservation = canProceed && hasCurrentUserWaiver
  // true only once we KNOW the user has no waiver (avoids flashing the warning while loading)
  const waiverBlocked = !!user?.id && !loadingWaiverEligibility && !hasCurrentUserWaiver

  // If the user has no waiver, they can't be past step 1
  useEffect(() => {
    if (waiverBlocked && step > 1) setStep(1)
  }, [waiverBlocked, step])

  // If the team becomes incomplete, fall back to single payer
  useEffect(() => {
    if (paymentMode === 'split' && !canSplitPayment) {
      setPaymentMode('self')
    }
  }, [paymentMode, canSplitPayment])

  const slotHoldPayload = useMemo(() => ({
    locationId: selectedLocation,
    reservationDate: dateISO,
    reservationTime: slot,
    sessionType,
    fieldIds: selectedFieldIds,
    players,
  }), [selectedLocation, dateISO, slot, sessionType, selectedFieldIds, players])

  // Locks the chosen slot on the server so nobody else can book it while this player finishes.
  const placeSlotHold = useCallback(async (silent = false) => {
    try {
      const res = await apiPost<{ ok: boolean; data: { expiresAtISO: string } }>('/api/slot-holds', slotHoldPayload)
      setSlotHoldExpiresAt(res.data.expiresAtISO)
      return true
    } catch (e: any) {
      setSlotHoldExpiresAt(null)
      toast.error(e?.message || 'That slot was just taken. Please choose another one.')
      fetchReservations(true)
      if (silent) setStep(1)
      return false
    }
  }, [slotHoldPayload, fetchReservations])

  // While past step 1, keep the hold alive; changing the slot details re-places it.
  useEffect(() => {
    if (step === 1 || !slotHoldExpiresAt) return
    const timer = window.setInterval(() => { void placeSlotHold(true) }, SLOT_HOLD_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [step, slotHoldExpiresAt, placeSlotHold])

  useEffect(() => {
    if (step > 1 && slotHoldExpiresAt) void placeSlotHold(true)
    // Re-hold only when the booked slot or headcount changes, not on every hold refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotHoldPayload])

  const goToStep2 = async () => {
    setPlacingHold(true)
    const held = await placeSlotHold()
    setPlacingHold(false)
    if (held) setStep(2)
  }

  // Leaving the page without booking frees the slot right away instead of waiting for it to expire.
  const proceedingToPaymentRef = useRef(false)
  const hasSlotHoldRef = useRef(false)
  hasSlotHoldRef.current = !!slotHoldExpiresAt
  useEffect(() => () => {
    if (hasSlotHoldRef.current && !proceedingToPaymentRef.current) {
      apiDelete('/api/slot-holds/mine').catch(() => null)
    }
  }, [])

  const formatCurrency = (value: number | string | null | undefined) => {
    const numeric = Number(value ?? 0)
    if (!Number.isFinite(numeric)) return '₱0'
    const amount = Math.abs(numeric).toLocaleString()
    return numeric < 0 ? `−₱${amount}` : `₱${amount}`
  }

  const StepHeader = ({ title, subtitle }: { title: string; subtitle: string }) => (
    <div>
      <div className="text-sm font-medium text-accent">Reservation</div>
      <h1 className="mt-3 text-3xl font-bold">{title}</h1>
      <p className="mt-1 text-sm text-muted">{subtitle}</p>
    </div>
  )

  const handleConfirm = async () => {
    if (!user?.id) {
      toast.error('Please login to continue.')
      return
    }

    if (!hasCurrentUserWaiver) {
      toast.error('Your waiver must be approved before you can make a reservation.')
      return
    }

    if (!hasRequiredSlotSelection) {
      toast.error('Please select a time slot before proceeding.')
      return
    }

    if (sessionType === 'private' && !meetsFieldRequirements) {
      toast.error('The selected field combination is not valid for the current group size.')
      return
    }

    if (isWd) {
      const isAvailable = selectedFieldIds.every(fieldId =>
        isFieldSlotAvailable(fieldId, slot)
      )
      if (!isAvailable) {
        toast.error('One or more selected fields are no longer available for this time slot.')
        return
      }
    }

    const currentRemaining = maxCapacity - usedPlayers

    if (players > currentRemaining) {
      toast.error(`Only ${currentRemaining} slots remaining. Please reduce players.`)
      return
    }

    if (!canProceed || players < effectiveMinPlayers) {
      toast.error('Invalid reservation details. Please check your selections.')
      return
    }

    if (selectionMode === 'package' && !selectedPackage) {
      toast.error('Please select a package.')
      return
    }

    if (selectedTeammateIds.length > maxTeammates) {
      toast.error(`You can add at most ${maxTeammates} teammate${maxTeammates === 1 ? '' : 's'} for ${players} players.`)
      return
    }

    // Every selected teammate must have a waiver too
    const teammateWithoutWaiver = selectedTeammates.find((member) => !member.waiverSubmitted)
    if (teammateWithoutWaiver) {
      toast.error(`${teammateWithoutWaiver.name}'s waiver isn't approved yet.`)
      return
    }

    const { fieldPrice, equipmentPrice, serviceFee, entranceFee, itemizedBreakdown } = paymentBreakdown

    setIsConfirming(true)

    try {
      const selectedLocationName = locationOptions.find((loc) => loc.id === selectedLocation)?.name ?? selectedLocation

      const pkgName = selectionMode === 'custom' ? 'Custom Selection' : (selectedPackage?.name || 'Custom Selection')

      const pendingReservation: any = {
        userId: user.id,
        fieldIds: selectedFieldIds,
        locationId: selectedLocation,
        locationName: selectedLocationName,
        reservationDate: dateISO,
        reservationTime: slot,
        sessionType,
        numberOfPlayers: players,
        totalAmount: dynamicPricing.total,
        fieldPrice,
        equipmentPrice,
        entranceFee,
        serviceFee,
        itemizedBreakdown,
        notes,
        gameModePreference,
        layoutRequest: layoutRequest.trim(),
        ...(layoutBlueprintUrl ? { layoutBlueprintUrl } : {}),
        reservationStatus: 'pending',
        packageName: pkgName,
        selectionMode,
        teamMembers: selectedTeammates.map((member) => ({
          id: member.id,
          name: member.name,
          email: member.email,
        })),
        selectedTeammateIds,
        paymentMode,
        paymentPlan,
        teamSize: paymentMode === 'split' ? splitPartySize : 1,
        payerShareAmount,
        ownWeaponTarget,
        ownWeaponBringerIds: [
          ...(captainBringsOwnWeapon ? [user.id] : []),
          ...teammateOwnWeaponIds,
        ],
      }

      if (selectionMode === 'package') {
        pendingReservation.selectedPackageId = selectedPackage?.id
        pendingReservation.selectedGameplayName = selectedPackage?.name
        pendingReservation.selectedOwnWeaponIds = selectedOwnWeaponIds
        pendingReservation.selectedOwnEquipmentIds = selectedOwnEquipmentIds
        pendingReservation.selectedUnitIds = pickedUnitIds
      } else {
        pendingReservation.customWeaponIds = customWeaponIds
        pendingReservation.customEquipmentIds = customEquipmentIds
        pendingReservation.ownWeapons = ownWeapons.trim()
        pendingReservation.ownEquipment = ownEquipment.trim()
        pendingReservation.selectedOwnWeaponIds = selectedOwnWeaponIds
        pendingReservation.selectedOwnEquipmentIds = selectedOwnEquipmentIds
        pendingReservation.selectedGameplayName = 'Custom Selection'
      }

      localStorage.setItem('pending_reservation', JSON.stringify(pendingReservation))
      // A reservation id left over from an earlier, unfinished payment belongs to
      // different booking details; drop it so the payment page creates this one.
      localStorage.removeItem('pending_reservation_id')

      // Flag to refresh reservations when user returns
      localStorage.setItem('refresh_reservations', 'true')

      proceedingToPaymentRef.current = true
      toast.success('Proceed to payment to complete your reservation.')
      navigate('/app/payment')
    } catch (e: any) {
      toast.error(e instanceof Error ? e.message : 'Failed to process reservation')
    } finally {
      setIsConfirming(false)
    }
  }

  const getStepTitle = () => {
    switch (step) {
      case 1: return 'Choose Field & Slot'
      case 2: return 'Select Package & Equipment'
      case 3: return 'Reservation Summary'
      default: return 'Teammates & Payment'
    }
  }

  // Gate: hide the step indicator and every step until the user has answered the waiver
  if (!hasCurrentUserWaiver) {
    return (
      <div className="space-y-4">
        <StepHeader
          title="Reservation"
          subtitle="Your waiver must be approved before you can book."
        />

        {!user?.id ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-muted">
            Please log in to make a reservation.
          </div>
        ) : loadingWaiverEligibility ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-muted">
            Checking waiver status...
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-2xl border border-warning/20 bg-warning/10 px-4 py-3 text-sm text-warning">
            <FiAlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div className="flex-1">
              <div className="font-bold">You can&apos;t create reservations yet.</div>
              <div className="mt-0.5 text-xs">
                {currentWaiverStatus === 'pending'
                  ? 'Your waiver is pending approval. You can reserve once staff approves it.'
                  : currentWaiverStatus === 'denied'
                    ? 'Your waiver was denied. Please contact staff or submit a new waiver.'
                    : 'Answer the waiver first, then wait for approval before booking.'}
              </div>
            </div>
            {/* Replace with your real waiver route */}
            <Button variant="ghost" onClick={() => navigate('/app/waiver')}>
              {currentWaiverStatus === 'none' ? 'Answer waiver' : 'View waiver'}
            </Button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <StepHeader
        title={getStepTitle()}
        subtitle="Mobile-first reservation flow with live slot prevention."
      />

      {packagePrefill?.selectedPackageId && selectionMode === 'package' && selectedPackageId === packagePrefill.selectedPackageId ? (
        <div className="flex items-start gap-3 rounded-2xl border border-accent/25 bg-accent/10 px-4 py-3 text-sm">
          <FiPackage className="mt-0.5 h-4 w-4 flex-shrink-0 text-gold" />
          <div>
            <div className="font-bold">Package from your recommendation: {selectedPackage?.name || packagePrefill.selectedPackageName}</div>
            <div className="mt-0.5 text-xs text-muted">
              {packagePrefill.players ? `${packagePrefill.players} players` : ''}
              {ownWeaponTarget > 0 ? ` · ${ownWeaponTarget} bringing their own weapon` : ''}
              {' '}· You can still change it in step 2.
            </div>
          </div>
        </div>
      ) : null}

      {slotHoldExpiresAt && step > 1 ? (
        <div className="flex items-center gap-2 rounded-2xl border border-success/25 bg-success/10 px-4 py-2 text-xs text-success">
          <FiClock className="h-4 w-4 flex-shrink-0" />
          <span>
            {slotLabels[slot]} on {dateISO} is locked for you while you finish booking. It's released if you leave without paying.
          </span>
        </div>
      ) : null}

      <div className="grid grid-cols-4 gap-3">
        {([1, 2, 3, 4] as const).map((s) => {
          const active = s === step
          const done = s < step
          const labels = {
            1: 'Select field location',
            2: 'Choose package',
            3: 'Review details',
            4: 'Teammates & payment',
          }

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
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">Step {s}</div>
                  <div className="text-sm font-bold leading-tight">{labels[s]}</div>
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
              <p className="mt-1 text-xs text-muted">Choose the venue. Each location has different capacity and field configurations.</p>

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
                      <div className="mt-1 text-xs text-accent/70">{loc.capacity}</div>
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

              {loadingReservations ? (
                <div className="mt-4 text-sm text-muted">Loading availability...</div>
              ) : (
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {availableFields.map((f) => {
                    const active = selectedFieldIds.includes(f.id)
                    const isFieldBooked = isWd && !isFieldSlotAvailable(f.id, slot)
                    const isDisabled = isFieldBooked && !active

                    return (
                      <label
                        key={f.id}
                        className={[
                          'flex items-start gap-3 rounded-2xl border p-3 text-left transition',
                          active ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25' : 'border-white/10 bg-white/5 hover:bg-white/8',
                          isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                          isFieldBooked && !active ? 'bg-danger/5 border-danger/20' : '',
                        ].join(' ')}
                      >
                        <input
                          type="checkbox"
                          checked={active}
                          disabled={isDisabled}
                          onChange={() => {
                            if (isDisabled) {
                              if (isFieldBooked) {
                                toast.error(`${f.name} is already booked for ${slotLabels[slot]}`)
                              }
                              return
                            }
                            setSelectedFieldIds((prev) => {
                              if (prev.includes(f.id)) return prev.filter((id) => id !== f.id)
                              return [...prev, f.id]
                            })
                          }}
                          className="mt-1 h-4 w-4 rounded border-white/20 bg-transparent accent-accent"
                        />
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-bold">{f.name}</div>
                            {sessionType === 'private' && (
                              <div className="text-[10px] text-muted bg-black/30 px-2 py-0.5 rounded-full">
                                Min {getMinPlayersForSelection([f.id], slot)} players
                              </div>
                            )}
                            {isFieldBooked && !active && (
                              <div className="text-[10px] text-danger bg-danger/10 px-2 py-0.5 rounded-full">
                                BOOKED
                              </div>
                            )}
                          </div>
                          <div className="mt-1 text-xs text-muted">{f.location}</div>
                          {isFieldBooked && !active && (
                            <div className="mt-1 text-xs text-danger">Already reserved for this time slot</div>
                          )}
                        </div>
                      </label>
                    )
                  })}
                </div>
              )}

              {sessionType === 'private' && (
                <div className="mt-4 rounded-2xl border border-accent/20 bg-accent/5 p-4">
                  <div className="text-xs font-bold text-accent">Field Requirements</div>
                  <div className="mt-2 space-y-1 text-xs text-muted">
                    <div>• Upper Ground: Minimum 10 players</div>
                    <div>
                      • Lower Ground: Minimum 20 players
                      {isUpperGroundTaken(slot) && (
                        <span className="text-accent"> (Upper Ground is taken, so minimum is 10 for this slot)</span>
                      )}
                    </div>
                    <div>
                      • Forest: Minimum 50 players
                      {isUpperGroundTaken(slot) && isLowerGroundTaken(slot) && (
                        <span className="text-accent"> (Upper and Lower Ground are taken, so minimum is 10 for this slot)</span>
                      )}
                    </div>
                    <div className="mt-2 text-accent/80">
                      Current selection requires at least {minPlayersForFields} players
                      {players < minPlayersForFields && (
                        <span className="text-danger ml-2">(Current: {players})</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </Card>

            <Card className="p-4 md:p-6">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiCalendar /> <span>Date & Time</span>
              </div>
              <p className="mt-1 text-xs text-muted">
                {isWd
                  ? 'Weekdays: Private sessions only. One game per field per time slot. Minimum 10 players.'
                  : 'Weekends: Public sessions only. Multiple time slots available.'}
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Date</div>
                  <div className="mt-2 space-y-4 max-h-96 overflow-y-auto pr-1">
                    {monthCalendars.map((month) => (
                      <div key={month.key} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                        <div className="text-sm font-bold text-white">{month.label}</div>
                        <div className="mt-2 grid grid-cols-7 gap-1 text-[10px] uppercase tracking-[0.12em] text-muted">
                          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((weekday) => (
                            <div key={weekday} className="py-1 text-center">{weekday}</div>
                          ))}
                        </div>
                        <div className="mt-1 space-y-1">
                          {month.weeks.map((week, weekIndex) => (
                            <div key={`${month.key}-week-${weekIndex}`} className="grid grid-cols-7 gap-1">
                              {week.map((iso, dayIndex) => {
                                if (!iso) {
                                  return <div key={`${month.key}-empty-${weekIndex}-${dayIndex}`} className="h-12 rounded-xl border border-transparent" />
                                }

                                const d = new Date(iso + 'T12:00:00')
                                const active = iso === dateISO
                                const isPastOrToday = iso <= todayDateISO
                                const isWd = isWeekday(iso)

                                return (
                                  <button
                                    key={iso}
                                    type="button"
                                    disabled={isPastOrToday}
                                    onClick={() => {
                                      if (isPastOrToday) return
                                      setDateISO(iso)
                                    }}
                                    className={[
                                      'h-12 rounded-xl border px-1 text-center text-[11px] transition',
                                      active ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25' : 'border-white/10 bg-white/5 hover:bg-white/8',
                                      isPastOrToday ? 'cursor-not-allowed opacity-40 hover:bg-white/5' : 'cursor-pointer',
                                    ].join(' ')}
                                  >
                                    <div className="font-bold leading-tight">{d.getDate()}</div>
                                    <div className="text-[9px] leading-tight text-muted/70">{isWd ? 'PRIV' : 'PUB'}</div>
                                  </button>
                                )
                              })}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Time Window</div>
                  <div className="mt-2 grid grid-cols-1 gap-2">
                    {loadingReservations ? (
                      <div className="py-4 text-center text-sm text-muted">Loading slots...</div>
                    ) : (
                      [...timeSlots].sort(slotSort).map((s) => {
                        const isSlotFull = isSlotFullyBooked(s)
                        const slotFields = getAvailableFieldsForSlot(s)
                        const active = isWd ? slotTouched && s === slot : selectedSlots.includes(s)

                        const handleSlotClick = () => {
                          if (isSlotFull) {
                            toast.error(`All fields are booked for ${slotLabels[s]}`)
                            return
                          }
                          if (isWd) {
                            setSlot(s)
                            setSlotTouched(true)
                          } else {
                            setSelectedSlots((prev) =>
                              prev.includes(s) ? prev.filter((sl) => sl !== s) : [...prev, s]
                            )
                            setSlot(s)
                            setSlotTouched(true)
                          }
                        }

                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={handleSlotClick}
                            disabled={isSlotFull}
                            className={[
                              'rounded-2xl border p-3 text-left transition',
                              active ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25' : 'border-white/10 bg-white/5 hover:bg-white/8',
                              isSlotFull ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                            ].join(' ')}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="text-sm font-bold">{slotLabels[s]}</div>
                                <div className="mt-1 text-xs text-muted flex items-center gap-2">
                                  <FiClock />
                                  {isSlotFull ? (
                                    <span className="text-danger">Fully booked</span>
                                  ) : isWd ? (
                                    <span className="text-accent">
                                      Available: {slotFields.map(f => f.name).join(', ')}
                                    </span>
                                  ) : (
                                    <span>Available fields</span>
                                  )}
                                </div>
                              </div>
                              {isSlotFull ? (
                                <div className="rounded-2xl px-3 py-1 text-xs font-bold bg-danger/15 text-danger">FULL</div>
                              ) : isWd ? (
                                <div className="rounded-2xl px-3 py-1 text-xs font-bold bg-success/15 text-success">
                                  {slotFields.length} field{slotFields.length > 1 ? 's' : ''} available
                                </div>
                              ) : (
                                <div className="rounded-2xl px-3 py-1 text-xs font-bold bg-success/15 text-success">AVAILABLE</div>
                              )}
                            </div>
                          </button>
                        )
                      })
                    )}
                  </div>
                  {isWeekend(dateISO) && selectedSlots.length > 0 && (
                    <div className="mt-3 text-xs text-muted">
                      Selected slots: {[...selectedSlots].sort(slotSort).map((s) => slotLabels[s]).join(', ')}
                    </div>
                  )}
                  {!hasRequiredSlotSelection && (
                    <div className="mt-3 text-xs text-danger">
                      Please select a time slot to continue.
                    </div>
                  )}
                  {isWd && (
                    <div className="mt-3 text-xs text-muted/60">
                      One game per field per time slot on weekdays
                    </div>
                  )}
                </div>
              </div>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="p-4 md:p-6">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiUsers /> <span>Players & Session</span>
              </div>
              <p className="mt-1 text-xs text-muted">Reservation capacity is enforced for the selected location.</p>

              <div className="mt-4 grid gap-4">
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Session Type</div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {(['public', 'private'] as SessionType[]).map((t) => {
                      const active = t === sessionType
                      const isDisabled = (isWd && t === 'public') || (!isWd && t === 'private')
                      return (
                        <button
                          key={t}
                          type="button"
                          disabled={isDisabled}
                          onClick={() => {
                            const requiredMin = t === 'private'
                              ? getMinPlayersForSelection(selectedFieldIds, slot)
                              : MIN_PLAYERS
                            setSessionType(t)
                            if (players < requiredMin) {
                              setPlayers(requiredMin)
                              setPlayersInput(String(requiredMin))
                            }
                          }}
                          className={[
                            'rounded-2xl border p-3 text-left transition',
                            active ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25' : 'border-white/10 bg-white/5 hover:bg-white/8',
                            isDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
                          ].join(' ')}
                        >
                          <div className="text-sm font-bold">{t === 'private' ? 'Private' : 'Public'}</div>
                          <div className="mt-1 text-xs text-muted">{t === 'private' ? 'Team exclusive' : 'Open roster'}</div>
                          {isDisabled && (
                            <div className="mt-1 text-[10px] text-muted/60">Not available for this date</div>
                          )}
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

                  {sessionType === 'private' && !meetsFieldRequirements && (
                    <div className="mt-2 flex items-start gap-2 rounded-xl bg-danger/10 p-3 ring-1 ring-danger/20">
                      <FiAlertTriangle className="mt-0.5 h-4 w-4 text-danger flex-shrink-0" />
                      <div className="text-xs text-danger">
                        Need {minPlayersForFields} players for selected fields. Current: {players}
                      </div>
                    </div>
                  )}

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
                          <div className="text-sm font-bold text-danger">Cannot proceed</div>
                          <div className="mt-1 text-xs text-muted">
                            {!meetsFieldRequirements
                              ? `Need ${minPlayersForFields} players for selected fields.`
                              : 'Cannot proceed.'
                            }
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Button variant="primary" disabled={!canProceed || !hasCurrentUserWaiver || placingHold} onClick={goToStep2}>
                  {placingHold ? 'Locking slot…' : 'Continue'} <FiChevronRight />
                </Button>
                <Button variant="ghost" onClick={() => {
                  const newDateISO = toISODate(addDays(today, 1))
                  const newIsWeekend = isWeekend(newDateISO)
                  const newDefault = newIsWeekend ? 1 : 10
                  const fields = getFieldsForLocation(selectedLocation)
                  setSelectedFieldIds(fields.length > 0 ? [fields[0].id] : [])
                  setDateISO(newDateISO)
                  setSlot('morning')
                  setSlotTouched(false)
                  setSessionType(newIsWeekend ? 'public' : 'private')
                  setPlayers(newDefault)
                  setPlayersInput(String(newDefault))
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
                <FiSliders /> <span>Selection Mode</span>
              </div>
              <p className="mt-1 text-xs text-muted">Choose a pre-set package or pick individual items.</p>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setSelectionMode('package')}
                  className={[
                    'rounded-2xl border p-4 text-left transition',
                    selectionMode === 'package'
                      ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25'
                      : 'border-white/10 bg-white/5 hover:bg-white/8',
                  ].join(' ')}
                >
                  <div className="flex items-center gap-2">
                    <FiPackage className="text-gold" />
                    <div className="text-sm font-bold">Select Package</div>
                  </div>
                  <div className="mt-1 text-xs text-muted">Choose a curated rental package with discount.</div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSelectionMode('custom')
                    setSelectedPackageId('')
                  }}
                  className={[
                    'rounded-2xl border p-4 text-left transition',
                    selectionMode === 'custom'
                      ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25'
                      : 'border-white/10 bg-white/5 hover:bg-white/8',
                  ].join(' ')}
                >
                  <div className="flex items-center gap-2">
                    <FiTool className="text-gold" />
                    <div className="text-sm font-bold">Custom Selection</div>
                  </div>
                  <div className="mt-1 text-xs text-muted">Pick individual weapons/equipment + bring your own.</div>
                </button>
              </div>
            </Card>

            {selectionMode === 'package' ? (
              <>
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
                                {[...modelsOfIds(rentalWeapons, pkg.weaponIds), ...modelsOfIds(rentalEquipment, pkg.equipmentIds)].map((model) => (
                                <div key={model} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-muted">
                                  {model}
                                </div>
                              ))}
                              {(() => {
                                const pkgDiscount = resolvePackageDiscountConfig(pkg)
                                if (pkgDiscount.value <= 0) return null
                                return (
                                  <div className="rounded-xl border border-success/20 bg-success/10 px-3 py-2 text-xs font-semibold text-success">
                                    {pkgDiscount.mode === 'percent'
                                      ? `${pkgDiscount.value}% off ${formatDiscountTargetLabel(pkgDiscount.targets)}`
                                      : `₱${Math.round(pkgDiscount.value).toLocaleString()} off ${formatDiscountTargetLabel(pkgDiscount.targets)}`}
                                  </div>
                                )
                              })()}
                            </div>

                            {pkg.weaponIds.length > 0 && (() => {
                              const stock = packageWeaponStock(pkg)
                              if (stock.available === null) {
                                return <div className="mt-3 text-xs text-muted">{loadingSlotStock ? 'Checking weapon stock…' : 'Weapon stock unavailable'}</div>
                              }
                              return (
                                <div className={['mt-3 rounded-xl border px-3 py-2 text-xs', stock.ok ? 'border-success/20 bg-success/10 text-success' : 'border-danger/30 bg-danger/10 text-danger'].join(' ')}>
                                  {stock.ok
                                    ? `${stock.available} rental weapon${stock.available === 1 ? '' : 's'} free this slot · needs ${stock.needed}`
                                    : `Not enough weapons: needs ${stock.needed}, only ${stock.available} free this slot`}
                                </div>
                              )
                            })()}

                            <div className="mt-3 flex items-center justify-between">
                              <div className="text-xs text-muted">Base price (per player)</div>
                              <div className="text-sm font-bold text-accent">{formatCurrency(pkg.basePrice)}</div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </Card>

                {/* Included items: each player gets a piece of every model; the player may pick which pieces */}
                {selectedPackage && (packageWeaponGroups.length > 0 || packageEquipmentGroups.length > 0) && (
                  <Card className="p-4 md:p-6">
                    <div className="flex items-center gap-2 text-sm font-bold">
                      <FiShield /> <span>Included Weapons &amp; Equipment</span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      Each player gets the items below. Optionally pick the exact pieces you want; any you don't pick are assigned automatically from what's free.
                    </p>
                    <PiecePicker
                      groups={[...packageWeaponGroups, ...packageEquipmentGroups]}
                      selected={pickedUnitIds}
                      onToggle={togglePickedUnit}
                      limitFor={(model) => {
                        if (packageEquipmentModels.includes(model)) return players * equipmentPerPlayer(model)
                        // Weapons share one allowance across the package's weapon models.
                        const pickedHere = pickedUnitIds.filter((id) => rentalWeapons.find((w) => w.id === id)?.model === model).length
                        return pickedHere + Math.max(0, packageWeaponsNeeded - pickedPackageWeapons)
                      }}
                      note={(group) => (packageEquipmentModels.includes(group.model)
                        ? `${players * equipmentPerPlayer(group.model)} needed (${equipmentPerPlayer(group.model)} per player)`
                        : `${packageWeaponsNeeded} rental weapon${packageWeaponsNeeded === 1 ? '' : 's'} needed for the group`)}
                    />
                  </Card>
                )}
              </>
            ) : (
              <>
                {/* Custom mode: pick individual pieces */}
                <Card className="p-4 md:p-6">
                  <div className="flex items-center gap-2 text-sm font-bold">
                    <FiCrosshair /> <span>Pick Weapons to Rent</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    Every weapon is a separate piece. Pick one for each player who needs a rental; each piece is charged once. Crossed-out pieces are taken for this slot.
                  </p>
                  <PiecePicker
                    groups={weaponGroups}
                    selected={customWeaponIds}
                    onToggle={(id) => setCustomWeaponIds((prev) => (prev.includes(id) ? prev.filter((unit) => unit !== id) : [...prev, id]))}
                    emptyText="No rental weapons in inventory."
                  />
                </Card>

                <Card className="p-4 md:p-6">
                  <div className="flex items-center gap-2 text-sm font-bold">
                    <FiShield /> <span>Pick Equipment to Rent</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">Masks, vests, and other gear — each piece is charged once.</p>
                  <PiecePicker
                    groups={equipmentGroups}
                    selected={customEquipmentIds}
                    onToggle={(id) => setCustomEquipmentIds((prev) => (prev.includes(id) ? prev.filter((unit) => unit !== id) : [...prev, id]))}
                    emptyText="No rental equipment in inventory."
                  />
                </Card>
              </>
            )}

            {/* Bring Your Own */}
            <Card className="p-4 md:p-6">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiTool /> <span>Bring Your Own (Free)</span>
              </div>
              <p className="mt-1 text-xs text-muted">Select from your admin-approved weapons and equipment. Each player who brings an approved weapon skips one rental weapon charge.</p>

              <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-white/10 bg-black/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-bold">Players bringing their own weapon</div>
                  <div className="mt-1 text-xs text-muted">
                    You'll choose which teammates in step 4. Only weapons registered and approved on a player's profile are deducted.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setOwnWeaponTarget((n) => Math.max(0, n - 1))} aria-label="Fewer own weapons"><FiMinus /></Button>
                  <span className="w-8 text-center text-lg font-bold">{ownWeaponTarget}</span>
                  <Button variant="ghost" size="sm" onClick={() => setOwnWeaponTarget((n) => Math.min(players, n + 1))} aria-label="More own weapons"><FiPlus /></Button>
                </div>
              </div>

              {playerApprovedWeapons.length === 0 && playerApprovedEquipment.length === 0 ? (
                <div className="mt-4 text-sm text-muted">
                  No approved items yet. Go to{" "}
                  <button
                    type="button"
                    className="text-gold underline"
                    onClick={() => navigate('/app/players/' + user?.id + '/weapons-and-equipment')}
                  >
                    My Weapons & Equipment
                  </button>{" "}
                  to submit gear for admin approval.
                </div>
              ) : (
                <div className="mt-4 grid gap-4">
                  {playerApprovedWeapons.length > 0 && (
                    <div>
                      <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted mb-2">
                        Approved Weapons ({playerApprovedWeapons.length})
                      </div>
                      <div className="grid gap-2 md:grid-cols-2">
                        {playerApprovedWeapons.map((w: any) => {
                          const active = selectedOwnWeaponIds.includes(w.id || w._id)
                          return (
                            <label
                              key={w.id || w._id}
                              className={[
                                'flex items-start gap-3 rounded-2xl border p-3 cursor-pointer transition',
                                active ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25' : 'border-white/10 bg-white/5 hover:bg-white/8',
                              ].join(' ')}
                            >
                              <input
                                type="checkbox"
                                checked={active}
                                onChange={() => {
                                  const id = w.id || w._id
                                  setSelectedOwnWeaponIds((prev) =>
                                    prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
                                  )
                                }}
                                className="mt-1 h-4 w-4 accent-accent"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-bold truncate">{w.name}</div>
                                <div className="text-xs text-muted">{w.category?.toUpperCase?.() || 'Weapon'}</div>
                              </div>
                              <div className="text-xs font-semibold text-success">FREE</div>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {playerApprovedEquipment.length > 0 && (
                    <div>
                      <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted mb-2">
                        Approved Equipment ({playerApprovedEquipment.length})
                      </div>
                      <div className="grid gap-2 md:grid-cols-2">
                        {playerApprovedEquipment.map((e: any) => {
                          const active = selectedOwnEquipmentIds.includes(e.id || e._id)
                          return (
                            <label
                              key={e.id || e._id}
                              className={[
                                'flex items-start gap-3 rounded-2xl border p-3 cursor-pointer transition',
                                active ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25' : 'border-white/10 bg-white/5 hover:bg-white/8',
                              ].join(' ')}
                            >
                              <input
                                type="checkbox"
                                checked={active}
                                onChange={() => {
                                  const id = e.id || e._id
                                  setSelectedOwnEquipmentIds((prev) =>
                                    prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
                                  )
                                }}
                                className="mt-1 h-4 w-4 accent-accent"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-bold truncate">{e.name}</div>
                                <div className="text-xs text-muted">{e.category?.toUpperCase?.() || 'Equipment'}</div>
                              </div>
                              <div className="text-xs font-semibold text-success">FREE</div>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>
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
                  <div className="mt-1 text-xs text-muted">
                    {selectionMode === 'custom' ? `Minimum ${MIN_PLAYERS} players (custom mode)` : `Package requires ${selectedPackage?.minPlayers || '—'} players`}
                  </div>
                  {players < effectiveMinPlayers ? (
                    <div className="mt-2 text-xs font-semibold text-danger">Increase players to continue.</div>
                  ) : (
                    <div className="mt-2 text-xs font-semibold text-success">Meets requirement.</div>
                  )}
                </div>

                {hasInsufficientEquipmentStock && (
                  <div className="rounded-2xl border border-danger/30 bg-danger/10 p-4">
                    <div className="text-sm font-bold text-danger">Not enough rental stock for this slot</div>
                    <div className="mt-2 space-y-1 text-xs text-muted">
                      {equipmentStockCheck.filter((item) => !item.ok).map((item) => (
                        <div key={item.name}>• {item.name}: only {item.available} free, needs {item.required} for this group.</div>
                      ))}
                    </div>
                    <div className="mt-2 text-xs text-muted">Reduce players, pick another package or slot, or bring your own gear.</div>
                  </div>
                )}

                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-sm font-bold">Dynamic price</div>
                  <div className="mt-1 text-xs text-muted">
                    {selectionMode === 'custom' ? 'Custom items × players (no discount)' : 'Calculated for your group and session type.'}
                  </div>
                  <div className="mt-3 flex items-end justify-between">
                    <div>
                      <div className="text-xs text-muted">Total</div>
                      <div className="text-2xl font-bold text-gold">{formatCurrency(dynamicPricing.total)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted">Per player</div>
                      <div className="text-sm font-bold">{formatCurrency(dynamicPricing.perPlayer)}</div>
                    </div>
                  </div>

                  {selectionMode === 'package' && dynamicPricing.discountAmount > 0 && (
                    <div className="mt-2 text-xs text-muted">
                      Discount applied: {dynamicPricing.discountSummary}
                      {dynamicPricing.savings > 0 && ` (save ${formatCurrency(dynamicPricing.savings)})`}
                    </div>
                  )}
                </div>

                {/* Single column: this panel is a narrow sidebar, and two columns cut off longer mode names. */}
                <div className="grid gap-3">
                  <label className="block min-w-0">
                    <div className="mb-2 text-sm font-semibold text-text">Preferred game mode</div>
                    <select
                      value={gameModePreference}
                      onChange={(e) => setGameModePreference(e.target.value)}
                      title={gameModePreference}
                      className="w-full min-w-0 truncate rounded-xl border border-white/10 bg-background py-3 pl-4 pr-10 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                    >
                      {GAME_MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
                    </select>
                  </label>
                  <Input
                    label="Field layout request (Optional)"
                    hint="Obstacles, objectives, or spawn setup for the marshals to prepare."
                    value={layoutRequest}
                    maxLength={500}
                    onChange={(e) => setLayoutRequest(e.target.value)}
                  />
                  <div className="sm:col-span-2">
                    <div className="mb-2 text-sm font-semibold text-text">Layout blueprint (Optional)</div>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="cursor-pointer rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10">
                        {uploadingBlueprint ? 'Uploading…' : layoutBlueprintUrl ? 'Replace image' : 'Upload a sketch or diagram'}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={uploadingBlueprint}
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            e.target.value = ''
                            if (file) void uploadBlueprint(file)
                          }}
                        />
                      </label>
                      {layoutBlueprintUrl ? (
                        <>
                          <a href={layoutBlueprintUrl} target="_blank" rel="noreferrer">
                            <img src={layoutBlueprintUrl} alt="Layout blueprint" className="h-14 w-20 rounded-lg border border-white/10 object-cover" />
                          </a>
                          <button type="button" className="text-xs text-muted hover:text-text" onClick={() => setLayoutBlueprintUrl('')}>Remove</button>
                        </>
                      ) : null}
                    </div>
                    <div className="mt-2 text-xs text-muted">Marshals use it to set up the field. Image files up to 5 MB.</div>
                  </div>
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
                  disabled={
                    players < effectiveMinPlayers ||
                    !canProceed ||
                    (selectionMode === 'package' && !selectedPackage) ||
                    hasInsufficientEquipmentStock
                  }
                  onClick={() => {
                    if (hasInsufficientEquipmentStock) {
                      const shortage = equipmentStockCheck.find((item) => !item.ok)
                      toast.error(`${shortage?.name || 'Equipment'}: needs ${shortage?.required ?? players}, only ${shortage?.available ?? 0} free this slot.`)
                      return
                    }
                    setStep(3)
                  }}
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
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Selection Mode</div>
                  <div className="mt-2 text-sm font-bold">{reservationSummary.packageName}</div>
                </div>
              </div>

              {/* Custom mode items */}
              {selectionMode === 'custom' && (
                <div className="mt-4 space-y-3">
                  {reservationSummary.customWeapons.length > 0 && (
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Rental Weapons</div>
                      <div className="mt-2 space-y-2">
                        {reservationSummary.customWeapons.map((w) => (
                          <div key={w.id} className="flex items-center justify-between text-sm">
                            <span>{w.name}</span>
                            <span className="text-accent">₱{w.price} each</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {reservationSummary.customEquipment.length > 0 && (
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Rental Equipment</div>
                      <div className="mt-2 space-y-2">
                        {reservationSummary.customEquipment.map((e) => (
                          <div key={e.id} className="flex items-center justify-between text-sm">
                            <span>{e.name}</span>
                            <span className="text-accent">₱{e.price} each</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {reservationSummary.ownWeapons && (
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Own Weapons (Free)</div>
                      <div className="mt-2 text-sm">{reservationSummary.ownWeapons}</div>
                    </div>
                  )}

                  {reservationSummary.ownEquipment && (
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Own Equipment (Free)</div>
                      <div className="mt-2 text-sm">{reservationSummary.ownEquipment}</div>
                    </div>
                  )}
                </div>
              )}

              {reservationSummary.notes && (
                <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Notes</div>
                  <div className="mt-2 text-sm text-text">{reservationSummary.notes}</div>
                </div>
              )}

              <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Gameplay request</div>
                <div className="mt-2 text-sm text-text">{gameModePreference}</div>
                {layoutRequest.trim() && <div className="mt-1 text-sm text-muted">Layout: {layoutRequest.trim()}</div>}
              </div>

              <div className="mt-4 rounded-2xl border border-accent/30 bg-accent/10 p-4">
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Payment breakdown</div>
                <div className="mt-3 space-y-2 text-sm">
                  {paymentBreakdown.itemizedBreakdown.map((item) => (
                    <div key={`${item.label}-${item.amount}`} className="flex items-center justify-between gap-3">
                      <span className="text-muted">{item.label}</span>
                      <span className="font-semibold">{formatCurrency(item.amount)}</span>
                    </div>
                  ))}
                  <div className="h-px bg-white/10" />
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted">Total</span>
                    <span className="text-base font-bold text-gold">{formatCurrency(dynamicPricing.total)}</span>
                  </div>
                </div>
              </div>
            </Card>

            <Card className="p-4 md:p-6">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiTag /> <span>Pricing Breakdown</span>
              </div>

              {selectionMode === 'package' ? (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs text-muted">Base package (per player)</div>
                    <div className="mt-2 text-sm font-bold">{formatCurrency(selectedPackage?.basePrice)}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs text-muted">Equipment add-ons (per player)</div>
                    <div className="mt-2 text-sm font-bold">{formatCurrency(equipmentTotalPerPlayer)}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs text-muted">Session multiplier</div>
                    <div className="mt-2 text-sm font-bold">{dynamicPricing.sessionMultiplier}×</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs text-muted">Discount</div>
                    <div className="mt-2 text-sm font-bold">{dynamicPricing.discountSummary}</div>
                  </div>
                </div>
              ) : (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4 md:col-span-2">
                    <div className="text-xs text-muted">Rental pieces picked</div>
                    <div className="mt-2 text-sm font-bold">{customSelectedWeapons.length} weapons, {customSelectedEquipment.length} equipment</div>
                    {customSelectedWeapons.length + customSelectedEquipment.length > 0 ? (
                      <div className="mt-1 text-xs text-muted">{[...customSelectedWeapons, ...customSelectedEquipment].map((item) => item.name).join(', ')}</div>
                    ) : null}
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs text-muted">Pieces total</div>
                    <div className="mt-2 text-sm font-bold">{formatCurrency(customItemsTotal)}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs text-muted">Entrance ({players} × ₱{ENTRANCE_FEE_PER_PLAYER})</div>
                    <div className="mt-2 text-sm font-bold">{formatCurrency(ENTRANCE_FEE_PER_PLAYER * players)}</div>
                  </div>
                  {(reservationSummary.ownWeapons || reservationSummary.ownEquipment) && (
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 md:col-span-2">
                      <div className="text-xs text-muted">Own items (free)</div>
                      <div className="mt-2 text-sm font-bold text-success">₱0</div>
                    </div>
                  )}
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs text-muted">No discount (custom mode)</div>
                    <div className="mt-2 text-sm font-bold text-muted">—</div>
                  </div>
                </div>
              )}

              {dynamicPricing.savings > 0 && (
                <div className="mt-3 text-xs text-muted">
                  You save {formatCurrency(dynamicPricing.savings)} compared to the original price
                </div>
              )}

              <div className="mt-4 rounded-2xl border border-accent/30 bg-accent/10 p-4">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <div className="text-xs text-muted">Total reservation</div>
                    <div className="mt-1 text-3xl font-black text-gold">{formatCurrency(dynamicPricing.total)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted">Per player</div>
                    <div className="mt-1 text-sm font-bold">{formatCurrency(dynamicPricing.perPlayer)}</div>
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
                  <div className="text-2xl font-bold text-gold">{formatCurrency(dynamicPricing.total)}</div>
                  <div className="mt-1 text-xs text-muted">
                    {dynamicPricing.savings > 0 ? 'Including all fees and discounts' : 'Before optional discounts'}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs text-muted">Status</div>
                  <div className="mt-1 text-sm font-bold text-accent">Pending Review</div>
                  <div className="mt-1 text-xs text-muted">Your reservation will be reviewed by staff</div>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-2">
                <Button variant="ghost" onClick={() => setStep(2)}>Back</Button>
                <Button variant="primary" disabled={!canSubmitReservation} onClick={() => setStep(4)}>
                  Confirm Reservation <FiChevronRight />
                </Button>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Step 4 - Teammates & Payment (after confirm, before payment) */}
      {step === 4 && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            <Card className="p-4 md:p-6">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiUsers /> <span>Select Your Teammates</span>
              </div>
              <p className="mt-1 text-xs text-muted">
                Optionally add registered players joining this reservation (up to {maxTeammates}). Find each one by the email on their account. You are already counted, and any spots you don't fill are treated as walk-in players. Only players with an approved waiver can be added.
              </p>

              <div className="mt-4 space-y-4">
                <form
                  className="flex flex-col gap-2 sm:flex-row sm:items-end"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void findTeammate()
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <Input
                      label="Teammate email"
                      type="email"
                      value={teamEmail}
                      onChange={(e) => {
                        setTeamEmail(e.target.value)
                        if (teamLookup.status !== 'idle') setTeamLookup({ status: 'idle' })
                      }}
                      placeholder="teammate@gmail.com"
                      disabled={!hasCurrentUserWaiver || selectedTeammates.length >= maxTeammates}
                    />
                  </div>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={!teamEmail.trim() || teamLookup.status === 'searching' || !hasCurrentUserWaiver || selectedTeammates.length >= maxTeammates}
                  >
                    <FiSearch /> {teamLookup.status === 'searching' ? 'Finding…' : 'Find'}
                  </Button>
                </form>

                {teamLookup.status === 'error' && (
                  <div className="rounded-2xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{teamLookup.error}</div>
                )}

                {teamLookup.status === 'found' && teamLookup.member && (() => {
                  const member = teamLookup.member
                  const alreadyAdded = selectedTeammateIds.includes(member.id)
                  return (
                    <div className="flex flex-col gap-3 rounded-2xl border border-accent/30 bg-accent/5 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold">{member.name}</div>
                        <div className="truncate text-xs text-muted">{member.email}</div>
                        {!member.waiverSubmitted && (
                          <div className="mt-1 text-xs font-semibold text-warning">Waiver not approved yet — they can't be added until it is.</div>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="primary"
                        disabled={alreadyAdded || !member.waiverSubmitted}
                        onClick={() => addTeammate(member)}
                      >
                        {alreadyAdded ? <><FiCheck /> Added</> : <><FiPlus /> Add</>}
                      </Button>
                    </div>
                  )
                })()}

                {loadingWaiverEligibility ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-muted">
                    Checking waiver approval...
                  </div>
                ) : !hasCurrentUserWaiver ? (
                  <div className="rounded-2xl border border-warning/20 bg-warning/10 p-4 text-sm text-warning">
                    Your waiver must be approved before you can confirm a reservation or add teammates.
                  </div>
                ) : null}

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between gap-3 text-xs uppercase tracking-[0.18em] text-muted">
                    <span>Your team</span>
                    <span>{selectedTeammates.length}/{maxTeammates} teammates</span>
                  </div>

                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/10 p-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold">{user?.name || 'You'}</div>
                        <div className="truncate text-xs text-muted">{user?.email}</div>
                      </div>
                      <span className="text-[10px] uppercase tracking-[0.18em] text-gold">Captain</span>
                    </div>

                    {selectedTeammates.map((member) => {
                      const bringsOwn = teammateOwnWeaponIds.includes(member.id)
                      return (
                        <div key={member.id} className="flex items-start justify-between gap-3 rounded-2xl border border-accent/30 bg-accent/10 p-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-bold">{member.name}</div>
                            <div className="truncate text-xs text-muted">{member.email}</div>
                            {ownWeaponTarget > 0 ? (
                              <button
                                type="button"
                                role="checkbox"
                                aria-checked={bringsOwn}
                                onClick={() => toggleTeammateOwnWeapon(member)}
                                className={[
                                  'mt-2 inline-flex items-center gap-1.5 rounded-xl border px-2 py-1 text-[11px] font-semibold',
                                  bringsOwn
                                    ? member.hasApprovedWeapon
                                      ? 'border-success/30 bg-success/10 text-success'
                                      : 'border-warning/30 bg-warning/10 text-warning'
                                    : 'border-white/10 bg-white/5 text-muted',
                                ].join(' ')}
                              >
                                <FiCrosshair className="h-3 w-3" />
                                {bringsOwn
                                  ? member.hasApprovedWeapon ? 'Brings own weapon' : 'No registered weapon'
                                  : 'Brings own weapon?'}
                              </button>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedTeammates((current) => current.filter((m) => m.id !== member.id))
                              setTeammateOwnWeaponIds((current) => current.filter((id) => id !== member.id))
                            }}
                            className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-muted transition hover:bg-white/10"
                            aria-label={`Remove ${member.name}`}
                          >
                            <FiX /> Remove
                          </button>
                        </div>
                      )
                    })}

                    {selectedTeammates.length === 0 && maxTeammates > 0 && (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-3 text-xs text-muted">
                        No teammates added yet. Find a teammate by email above.
                      </div>
                    )}
                  </div>
                </div>

                {maxTeammates > 0 && (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-muted">
                    {walkInSpots === 0
                      ? `All ${players} players have accounts.`
                      : `${walkInSpots} of ${players} player${players === 1 ? '' : 's'} will be walk-in${walkInSpots === 1 ? '' : 's'} without an account. They'll sign their waiver at the field.`}
                  </div>
                )}

                {ownWeaponTarget > 0 && (
                  <div className={[
                    'rounded-2xl border p-3 text-xs',
                    ownWeaponShortfall > 0 ? 'border-warning/25 bg-warning/10 text-warning' : 'border-success/25 bg-success/10 text-success',
                  ].join(' ')}>
                    <div className="font-bold">
                      Own weapons: {verifiedOwnWeaponCount} of {ownWeaponTarget} verified
                    </div>
                    <div className="mt-1 text-muted">
                      {captainBringsOwnWeapon ? 'You are bringing one of your approved weapons. ' : ''}
                      {ownWeaponShortfall > 0
                        ? `${ownWeaponShortfall} more player${ownWeaponShortfall === 1 ? '' : 's'} will rent a weapon instead — you can still continue, and the price below already includes those rentals.`
                        : 'Every own weapon is verified, so those rental charges are removed from the total.'}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="p-4 md:p-6">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiTag /> <span>Payment</span>
              </div>
              <p className="mt-1 text-xs text-muted">Choose who pays for this reservation.</p>

              <div className="mt-4 grid gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentMode('self')}
                  className={[
                    'rounded-2xl border px-4 py-3 text-left transition',
                    paymentMode === 'self' ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25' : 'border-white/10 bg-white/5 hover:bg-white/8',
                  ].join(' ')}
                >
                  <div className="text-sm font-bold">I'll pay for everyone</div>
                  <div className="mt-1 text-xs text-muted">This player pays the full reservation.</div>
                </button>

                <button
                  type="button"
                  disabled={!canSplitPayment}
                  onClick={() => setPaymentMode('split')}
                  className={[
                    'rounded-2xl border px-4 py-3 text-left transition',
                    paymentMode === 'split' ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25' : 'border-white/10 bg-white/5 hover:bg-white/8',
                    !canSplitPayment ? 'cursor-not-allowed opacity-50' : '',
                  ].join(' ')}
                >
                  <div className="text-sm font-bold">Split among the team</div>
                  <div className="mt-1 text-xs text-muted">
                    {canSplitPayment
                      ? 'Divide the total equally among you and your selected teammates.'
                      : 'Add at least one registered teammate to enable splitting.'}
                  </div>
                </button>
              </div>

              <div className="mt-5 text-xs uppercase tracking-widest text-muted">How you'll pay</div>
              <div className="mt-2 grid gap-2">
                {([
                  ['full', 'Pay in full online', 'Pay the whole amount now with GCash or card. Nothing to pay at the field.'],
                  ['cash_balance', '50% online + cash at the field', 'Pay the 50% downpayment online now, then the rest in cash at the counter on game day.'],
                ] as const).map(([plan, title, description]) => (
                  <button
                    key={plan}
                    type="button"
                    onClick={() => setPaymentPlan(plan)}
                    className={[
                      'rounded-2xl border px-4 py-3 text-left transition',
                      paymentPlan === plan ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25' : 'border-white/10 bg-white/5 hover:bg-white/8',
                    ].join(' ')}
                  >
                    <div className="text-sm font-bold">{title}</div>
                    <div className="mt-1 text-xs text-muted">{description}</div>
                  </button>
                ))}
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center justify-between gap-3 text-xs text-muted">
                  <span>Payment mode</span>
                  <span>{teamPaymentLabel}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted">
                  <span>Pay online now</span>
                  <span>
                    {paymentPlan === 'full'
                      ? formatCurrency(payerShareAmount)
                      : `about ${formatCurrency(Math.round(payerShareAmount * 0.5))} (50% downpayment)`}
                  </span>
                </div>
                {paymentPlan === 'cash_balance' ? (
                  <div className="mt-1 text-[11px] text-muted">The exact downpayment is confirmed on the next page; the balance is paid in cash at the field.</div>
                ) : null}
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-xs text-muted">Reservation total</span>
                  <span className="text-sm font-bold">{formatCurrency(dynamicPricing.total)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-xs text-muted">Your share</span>
                  <span className="text-xl font-bold text-gold">{formatCurrency(payerShareAmount)}</span>
                </div>
                {selectedTeammates.length > 0 && (
                  <div className="mt-3 text-xs text-muted">
                    Team: you, {selectedTeammates.map((member) => member.name).join(', ')}
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-col gap-2">
                <Button variant="ghost" onClick={() => setStep(3)}>Back</Button>
                <Button
                  variant="primary"
                  disabled={isConfirming || !canSubmitReservation}
                  onClick={handleConfirm}
                >
                  {isConfirming ? 'Processing...' : 'Proceed to Payment'} <FiChevronRight />
                </Button>
              </div>
            </Card>
          </div>
        </div>
      )}

      {noWeaponWarning ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" role="dialog" aria-modal="true" aria-labelledby="no-weapon-title">
          <Card className="w-full max-w-md p-5">
            <div className="flex items-start gap-3">
              <FiAlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-warning" />
              <div>
                <div id="no-weapon-title" className="text-base font-bold">No registered weapon on file</div>
                <p className="mt-2 text-sm text-muted">
                  {noWeaponWarning.name} hasn't registered an approved weapon on their profile, so it can't be counted as an own weapon.
                  If you keep them marked, they'll still be charged for a rental weapon.
                </p>
              </div>
            </div>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={() => setNoWeaponWarning(null)}>Keep as rental</Button>
              <Button
                variant="primary"
                onClick={() => {
                  const member = noWeaponWarning
                  setTeammateOwnWeaponIds((current) => current.includes(member.id) ? current : [...current, member.id])
                  setNoWeaponWarning(null)
                }}
              >
                Mark anyway
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  )
}