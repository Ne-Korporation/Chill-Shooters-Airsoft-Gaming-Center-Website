import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react'
import { useLiveRefresh } from '../../utils/liveUpdates'
import { useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  FiAlertTriangle,
  FiCalendar,
  FiAlertCircle,
  FiCheck,
  FiChevronLeft,
  FiChevronRight,
  FiClock,
  FiCrosshair,
  FiFlag,
  FiMap,
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
  FiHeart,
} from 'react-icons/fi'

import { apiBase, apiDelete, apiGet, apiPost, getApiAuthHeaders, apiGetAll } from '../../utils/apiClient'
import { useAuth } from '../../context/AuthContext'
import { LANDING_PREFILL_KEY, type LandingReservationPrefill } from '../auth/LandingPage'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { calculatePackagePricing, packageEquipmentQty, packageNotForGroup, packageRegularTotal } from '../../utils/packagePricing'
import { formatDiscountTargetLabel, resolvePackageDiscountConfig } from '../../utils/packagePricing'
import { loadPackagePrefill } from '../../utils/packagePrefill'
import { isAmmo, modelOf } from '../../utils/inventoryModels'
import { cancelBookingDraftLeft, markBookingDraftLeft, peekBookingDraft, readBookingDraft, saveBookingDraft, scheduleBookingDraftLeft } from '../../utils/bookingDraft'
import type { PickerGroup } from '../../components/inventory/PiecePicker'
import { ModelQuantityPicker } from '../../components/inventory/ModelQuantityPicker'
import { FieldLayoutDesigner, type LayoutItem } from '../../components/reservations/FieldLayoutDesigner'
import { DEFAULT_LAYOUT_FEES, countLayoutPieces, layoutFeeFor, limitsForFields, useFieldObstacles } from '../../utils/fieldObstacles'
import { DEFAULT_SLOT_HOURS, formatSlotRange, manilaTodayISO, slotHasStarted, useSlotHours } from '../../utils/slotHours'
import { causeDayMessage, useCauseDays } from '../../utils/causeDays'
import { closedDayMessage, useClosedDays } from '../../utils/closedDays'
import { bookingRoles } from '../../utils/bookingRoles'
import { addDaysISO, BOOKING_WINDOW_DAYS, monthsBetween } from '../../utils/bookingWindow'
import { pieceAtBranch } from '../../utils/branches'

// Slot holds last 15 minutes on the server; refresh well before that while the player is booking.
const SLOT_HOLD_REFRESH_MS = 4 * 60 * 1000
// Step 1 of a private game: the picked field is held briefly (3 minutes on the server) and renewed
// every minute while the tab is open, so other players see it as being booked right away.
const BROWSING_HOLD_REFRESH_MS = 60 * 1000
// How often step 1 re-reads which fields and slots are taken, so it reflects other players live.
const STEP1_AVAILABILITY_REFRESH_MS = 10 * 1000

type SessionType = 'public' | 'private'
type TimeSlot = 'morning' | 'afternoon' | 'evening'
type LocationOption = 'salawag' | 'langkaan' | 'binan'

type Field = {
  id: string
  name: string
  location: string
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
  // Grams of BBs given per reload / refill (0 = not stated)
  bbReloadGrams: number
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
  // Branch that rents out this piece; blank = not assigned yet (any branch).
  locationId?: string
}

// Hybrid: a player not taking the package can rent just the package's mask or vest, and any player
// can pick rental guns (instead of the package's gun, or on top of it). Mirrors server/utils/ownGearRentals.js.
type RentPiece = 'mask' | 'vest'
const RENT_PIECES: RentPiece[] = ['mask', 'vest']
const RENT_PIECE_LABEL: Record<RentPiece, string> = { mask: 'Mask', vest: 'Vest' }
const MAX_GUNS_PER_PLAYER = 3

// The step bar (Field & slot … Review & pay): on wide screens it stays under the fixed top bar (72px)
// while the step scrolls. On phones it wraps to several rows, so it scrolls away there.
const STEP_BAR_CLASS = 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:sticky lg:top-[72px] lg:z-30 lg:-mx-2 lg:bg-background/95 lg:px-2 lg:py-3 lg:backdrop-blur'
// Each step's right-hand column (checks, totals, Back / Continue): on wide screens it stays in view
// below the sticky step bar. Taller than the screen, it scrolls on its own.
const SIDE_PANEL_CLASS = 'space-y-4 lg:sticky lg:top-[180px] lg:self-start lg:max-h-[calc(100vh-196px)] lg:overflow-y-auto lg:overscroll-contain no-scrollbar'

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
  locationId?: string
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
// package_all: everyone gets the package · own_all: everyone brings their own gun and gear
// (entrance only) · hybrid: chosen per player · custom: pick pieces one by one (solo only).
type RentMode = 'package_all' | 'own_all' | 'hybrid' | 'custom'

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
  // A minor from the booker's or a teammate's account (see "A minor will join this game").
  isMinor?: boolean
  guardianId?: string
}

// A child on the booker's or a teammate's account who could join this booking.
type TeamChild = { id: string; name: string; age: number | null; guardianId: string; guardianName: string; canPlay: boolean }

type PaymentMode = 'self' | 'split'
// full: pay everything online now. cash_balance: the 50% downpayment online now, the rest at the field.
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
  archived?: boolean
}

const locationFields: Record<LocationOption, Field[]> = {
  salawag: [
    { id: 'salawag-field-1', name: 'Upper Ground', location: 'Chill Shooters Salawag', locationId: 'salawag' },
    { id: 'salawag-field-2', name: 'Lower Ground', location: 'Chill Shooters Salawag', locationId: 'salawag' },
    { id: 'salawag-field-3', name: 'Forest', location: 'Chill Shooters Salawag', locationId: 'salawag' },
  ],
  langkaan: [
    { id: 'langkaan-field-1', name: 'Upper Ground', location: 'Chill Shooters Langkaan', locationId: 'langkaan' },
    { id: 'langkaan-field-2', name: 'Lower Ground', location: 'Chill Shooters Langkaan', locationId: 'langkaan' },
    { id: 'langkaan-field-3', name: 'Forest', location: 'Chill Shooters Langkaan', locationId: 'langkaan' },
  ],
  binan: [
    { id: 'binan-field-1', name: 'Upper Ground', location: 'BBC Airsoft Binan Laguna', locationId: 'binan' },
    { id: 'binan-field-2', name: 'Lower Ground', location: 'BBC Airsoft Binan Laguna', locationId: 'binan' },
    { id: 'binan-field-3', name: 'Forest', location: 'BBC Airsoft Binan Laguna', locationId: 'binan' },
  ],
}

// Most players a location takes in one slot. Matches the landing page and the server's
// DEFAULT_LOCATION_CAPACITIES (server/routes/crud.js); every slot takes the same number.
const locationMaxPlayers: Record<LocationOption, number> = {
  salawag: 400,
  langkaan: 400,
  binan: 200,
}

function capacityFor(location: LocationOption, _slot: TimeSlot) {
  return locationMaxPlayers[location]
}

type SlotCapacities = Record<LocationOption, Record<TimeSlot, number>>

function getFieldsForLocation(location: LocationOption): Field[] {
  return locationFields[location] || []
}

function getFieldById(fieldId: string): Field | undefined {
  for (const location of ['salawag', 'langkaan', 'binan'] as LocationOption[]) {
    const field = locationFields[location].find(f => f.id === fieldId)
    if (field) return field
  }
  return undefined
}

const locationOptions: { id: LocationOption; name: string; detail: string; capacity: string }[] = [
  { id: 'salawag', name: 'Chill Shooters (Salawag)', detail: 'Approximately 2 hectares.', capacity: 'Up to 400 players per slot' },
  { id: 'langkaan', name: 'Chill Shooters (Langkaan)', detail: 'Approximately 2 hectares.', capacity: 'Up to 400 players per slot' },
  { id: 'binan', name: 'BBC Airsoft Binan Laguna', detail: 'Approximately 1 hectare.', capacity: 'Up to 200 players per slot' },
]

const slotLabels: Record<TimeSlot, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
}

const timeSlots: TimeSlot[] = ['morning', 'afternoon', 'evening']

// Errors are shown as a label next to what they're about, not as a pop-up.
function InlineError({ message, className = '' }: { message?: string | null; className?: string }) {
  if (!message) return null
  return (
    <div role="alert" className={`flex items-start gap-2 rounded-2xl border border-danger/25 bg-danger/10 p-3 text-xs font-semibold text-danger ${className}`}>
      <FiAlertCircle className="mt-0.5 shrink-0" aria-hidden /> <span>{message}</span>
    </div>
  )
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

function slotSort(a: TimeSlot, b: TimeSlot) {
  const order: TimeSlot[] = ['morning', 'afternoon', 'evening']
  return order.indexOf(a) - order.indexOf(b)
}

const ENTRANCE_FEE_PER_PLAYER = 150
// Price of one extra BB reload until the server sends its own (AMMO_RELOAD_PRICE).
const DEFAULT_AMMO_RELOAD_PRICE = 50
// Every package includes this many BB reloads per player at no charge (matches the server).
const INCLUDED_RELOADS_PER_PLAYER = 2
const MAX_EXTRA_AMMO_RELOADS = 50

type BookingStep = 1 | 2 | 3 | 4 | 5
const STEP_LABELS: Record<BookingStep, string> = {
  1: 'Field & slot',
  2: 'Your team',
  3: 'Weapons & gear',
  4: 'Game setup',
  5: 'Review & pay',
}
// Public (weekend) games take bookings from a single player upward.
const MIN_PLAYERS = 1

const FIELD_COUNT_MINIMUMS = [0, 10, 20, 50]
function fieldCountMinimum(fieldCount: number) {
  return FIELD_COUNT_MINIMUMS[Math.min(Math.max(0, fieldCount), FIELD_COUNT_MINIMUMS.length - 1)]
}

// Upper Ground is the main field: a private booking is Upper Ground, Upper + Lower Ground, or all
// three (fields are listed in that order). Matches the server's isAllowedFieldCombination.
const FIELD_CHOICES = [
  { count: 1, label: 'Upper Ground' },
  { count: 2, label: 'Upper + Lower Ground' },
  { count: 3, label: 'All 3 fields' },
] as const

function fieldChoiceIds(location: LocationOption, count: number): string[] {
  return getFieldsForLocation(location).slice(0, Math.max(1, count)).map((field) => field.id)
}

// Fields are assigned from the group size: 10-19 players get Upper Ground, 20-49 get Upper + Lower
// Ground, 50+ get all three.
function fieldCountForPlayers(players: number): number {
  if (players >= FIELD_COUNT_MINIMUMS[3]) return 3
  if (players >= FIELD_COUNT_MINIMUMS[2]) return 2
  return 1
}

export function ReservationCalendarPage() {
  const slotHours = useSlotHours()
  const navigate = useNavigate()
  const location = useLocation()
  const today = useMemo(() => new Date(), [])
  const { user } = useAuth()

  // A booking the player left less than a minute ago (see utils/bookingDraft); its choices are restored below.
  const [restoredDraft] = useState(() => {
    // Straight back from the payment page (its Back button, or the browser's): the player never left
    // the site, so the booking isn't expired however long they spent paying. Not once the reservation
    // was created there, since changing it then would make a second booking.
    const raw = peekBookingDraft(user?.id)
    const reservationCreated = Boolean(localStorage.getItem('pending_reservation_id') || localStorage.getItem('pending_reservation_ids'))
    if (raw?.path === '/app/payment' && !raw.leftAtISO && !reservationCreated && Object.keys(raw.state || {}).length > 0) return raw
    const draft = readBookingDraft(user?.id)
    return draft?.path === '/app/reservations' ? draft : null
  })
  const draftState = (restoredDraft?.state || {}) as Record<string, any>

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

  const [step, setStep] = useState<BookingStep>(() => {
    const saved = Number(draftState.step)
    return (saved >= 1 && saved <= 5 ? saved : 1) as BookingStep
  })
  const [isConfirming, setIsConfirming] = useState(false)
  // Last check before payment: the player confirms every detail is right, or goes back to fix it.
  const [finalCheckOpen, setFinalCheckOpen] = useState(false)
  const [packages, setPackages] = useState<RentalPackage[]>([])
  const [weapons, setWeapons] = useState<WeaponItem[]>([])
  const [equipment, setEquipment] = useState<EquipmentItemDetails[]>([])
  const [loadingPackages, setLoadingPackages] = useState(true)

  const [reservations, setReservations] = useState<ReservationRecord[]>([])
  const [loadingReservations, setLoadingReservations] = useState(true)
  const [serverCapacities, setServerCapacities] = useState<SlotCapacities | null>(null)
  // Slots that are full, as "location|date|slot". Players only learn full / not full, never counts.
  const [fullSlotKeys, setFullSlotKeys] = useState<Set<string>>(new Set())
  const [loadingWaiverEligibility, setLoadingWaiverEligibility] = useState(true)
  // Teammates are found one at a time by email rather than from a list of every player.
  const [selectedTeammates, setSelectedTeammates] = useState<TeamMember[]>(() => draftState.selectedTeammates ?? [])
  const selectedTeammateIds = useMemo(() => selectedTeammates.map((member) => member.id), [selectedTeammates])

  // Children of the booker and of the adult teammates: they can join as players. A child whose
  // parent leaves the team leaves with them.
  const [teamChildren, setTeamChildren] = useState<TeamChild[]>([])
  const adultTeammateIds = useMemo(() => selectedTeammates.filter((member) => !member.isMinor).map((member) => member.id).join(','), [selectedTeammates])
  useEffect(() => {
    if (!user?.id) return
    let alive = true
    apiGet<{ ok: boolean; data: TeamChild[] }>(`/api/children/of-team?ids=${encodeURIComponent(adultTeammateIds)}`)
      .then((res) => {
        if (!alive) return
        setTeamChildren(Array.isArray(res?.data) ? res.data : [])
        const adults = new Set([String(user.id), ...adultTeammateIds.split(',').filter(Boolean)])
        setSelectedTeammates((current) => {
          const kept = current.filter((member) => !member.isMinor || adults.has(String(member.guardianId)))
          return kept.length === current.length ? current : kept
        })
      })
      .catch(() => {})
    return () => { alive = false }
  }, [user?.id, adultTeammateIds])
  const [teamEmail, setTeamEmail] = useState('')
  const [teamLookup, setTeamLookup] = useState<{ status: 'idle' | 'searching' | 'found' | 'error'; members?: TeamMember[]; error?: string }>({ status: 'idle' })
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(() => draftState.paymentMode ?? 'self')
  const [paymentPlan, setPaymentPlan] = useState<PaymentPlan>(() => draftState.paymentPlan ?? 'cash_balance')
  const [waiverEligibleUserIds, setWaiverEligibleUserIds] = useState<string[]>([])
  // Status of the logged-in user's own waiver: none = never submitted
  const [currentWaiverStatus, setCurrentWaiverStatus] = useState<'none' | 'pending' | 'approved' | 'denied'>('none')

  // Players can book up to a year ahead. The calendar shows two months at a time; the arrows page
  // through from this month to the month of the last bookable date.
  const lastBookableISO = addDaysISO(manilaTodayISO(), BOOKING_WINDOW_DAYS)
  // One month at a time (no scrolling inside the calendar); the arrows move a month, up to the
  // month of the last bookable day.
  const maxMonthOffset = Math.max(0, monthsBetween(manilaTodayISO(), lastBookableISO))
  const [monthOffset, setMonthOffset] = useState(0)

  const monthCalendars = useMemo(() => {
    const monthStarts = [new Date(today.getFullYear(), today.getMonth() + monthOffset, 1)]

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
  }, [today, monthOffset])
  // Games for a cause in the months shown: marked on the date and explained on hover.
  const causeDays = useCauseDays(
    monthCalendars[0] ? `${monthCalendars[0].key}-01` : '',
    monthCalendars[monthCalendars.length - 1] ? `${monthCalendars[monthCalendars.length - 1].key}-31` : '',
  )
  // Days the admin marked as "no game": shown but can't be picked.
  const closedDays = useClosedDays(
    monthCalendars[0] ? `${monthCalendars[0].key}-01` : '',
    monthCalendars[monthCalendars.length - 1] ? `${monthCalendars[monthCalendars.length - 1].key}-31` : '',
  )

  const [selectedLocation, setSelectedLocation] = useState<LocationOption>(() => draftState.selectedLocation ?? landingPrefill?.location ?? 'salawag')

  const availableFields = useMemo(() => {
    return getFieldsForLocation(selectedLocation)
  }, [selectedLocation])

  const [selectedFieldIds, setSelectedFieldIds] = useState<string[]>(() => {
    // Always one of the allowed choices; older drafts keep their number of fields.
    if (Array.isArray(draftState.selectedFieldIds) && draftState.selectedFieldIds.length > 0) {
      return fieldChoiceIds(draftState.selectedLocation ?? 'salawag', draftState.selectedFieldIds.length)
    }
    const location = landingPrefill?.location ?? 'salawag'
    const prefilled = FIELD_CHOICES.find((choice) => choice.label === landingPrefill?.fieldArea)
    return fieldChoiceIds(location, prefilled?.count ?? 1)
  })

  // Today is bookable until its last slot starts (Manila time); after that, start from tomorrow.
  const todayDateISO = manilaTodayISO()
  const todayStillOpen = timeSlots.some((s) => !slotHasStarted(DEFAULT_SLOT_HOURS, s, todayDateISO))
  const initialDateISO = todayStillOpen ? todayDateISO : toISODate(addDays(new Date(`${todayDateISO}T12:00:00`), 1))
  // ISO dates compare correctly as strings; ignore a prefilled date that has already passed.
  const startDateISO =
    landingPrefill?.dateISO && landingPrefill.dateISO >= initialDateISO ? landingPrefill.dateISO : initialDateISO
  const [dateISO, setDateISO] = useState<string>(() => {
    const wanted = draftState.dateISO >= initialDateISO ? draftState.dateISO : startDateISO
    return wanted > lastBookableISO ? initialDateISO : wanted
  })
  // Open the calendar on the months holding the picked date (e.g. a saved draft months ahead).
  useEffect(() => {
    const offset = monthsBetween(todayDateISO, dateISO)
    setMonthOffset(Math.min(Math.max(0, offset), maxMonthOffset))
    // Only when the date changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateISO])
  const [slot, setSlot] = useState<TimeSlot>(() => draftState.slot ?? landingPrefill?.slot ?? 'morning')
  // One slot per booking. Drafts saved before this could hold several; keep the one being booked.
  const [selectedSlots, setSelectedSlots] = useState<TimeSlot[]>(() => {
    const saved = draftState.selectedSlots ?? []
    if (saved.length <= 1) return saved
    return draftState.slot && saved.includes(draftState.slot) ? [draftState.slot] : saved.slice(-1)
  })
  const [slotTouched, setSlotTouched] = useState(Boolean(restoredDraft))
  // Several slots booked together (e.g. morning and evening, or the full day): one linked booking
  // per slot, paid at one checkout. Empty when a single slot is picked. `slot` is the first of them;
  // the checks below look at every picked slot (bookedSlots).
  const [pickedSlots, setPickedSlots] = useState<TimeSlot[]>(() => {
    const saved: string[] = Array.isArray(draftState.pickedSlots) ? draftState.pickedSlots : draftState.fullDay ? [...timeSlots] : []
    const ordered = timeSlots.filter((s) => saved.includes(s))
    return ordered.length > 1 ? ordered : []
  })
  // "fullDay" now means several slots (two or three); allDay is all three.
  const fullDay = pickedSlots.length > 1
  const allDay = pickedSlots.length === timeSlots.length
  const bookedSlots: TimeSlot[] = fullDay ? pickedSlots : [slot]
  // Sets the picked slots (any order, any number): none clears the choice, one is a normal
  // booking, two or three are booked together.
  const applyPickedSlots = (slots: TimeSlot[]) => {
    const ordered = timeSlots.filter((s) => slots.includes(s))
    if (ordered.length === 0) {
      setPickedSlots([])
      setSelectedSlots([])
      setSlotTouched(false)
      return
    }
    setSlot(ordered[0])
    setSelectedSlots([ordered[0]])
    setSlotTouched(true)
    setPickedSlots(ordered.length > 1 ? ordered : [])
  }
  // "Morning + Evening", or "Full day" for all three.
  const pickedSlotsLabel = allDay ? 'Full day' : bookedSlots.map((s) => slotLabels[s]).join(' + ')
  // Picking today (or still sitting on it as slots start) drops any picked slot that has already
  // started, keeping the rest (or moving to the first slot still open).
  useEffect(() => {
    if (dateISO !== todayDateISO) return
    if (!bookedSlots.some((s) => slotHasStarted(slotHours, s, dateISO))) return
    const stillOpen = bookedSlots.filter((s) => !slotHasStarted(slotHours, s, dateISO))
    if (stillOpen.length) {
      setSlot(stillOpen[0])
      setSelectedSlots([stillOpen[0]])
      setPickedSlots(stillOpen.length > 1 ? stillOpen : [])
      return
    }
    const firstOpen = timeSlots.find((s) => !slotHasStarted(slotHours, s, dateISO))
    setPickedSlots([])
    setSlotTouched(false)
    setSelectedSlots([])
    if (firstOpen) setSlot(firstOpen)
    // bookedSlots follows slot and pickedSlots.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateISO, todayDateISO, pickedSlots, slot, slotHours])
  const [sessionType, setSessionType] = useState<SessionType>(() => (isWeekend(dateISO) ? 'public' : 'private'))

  // Fetch only the minimal future slot data used for availability indicators.
  const fetchReservations = useCallback(async (silent = false) => {
    let cancelled = false
    try {
      if (!silent) setLoadingReservations(true)
      const res = await apiGet<{ ok: boolean; data: any[]; capacities?: SlotCapacities; fullSlots?: string[]; ammoReloadPrice?: number }>('/api/reservation-availability')
      if (cancelled) return

      if (res.capacities) setServerCapacities(res.capacities)
      setFullSlotKeys(new Set(Array.isArray(res.fullSlots) ? res.fullSlots : []))
      if (typeof res.ammoReloadPrice === 'number' && res.ammoReloadPrice >= 0) setAmmoReloadPrice(res.ammoReloadPrice)
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

  // Initial fetch, then keep availability fresh while the page is open.
  useEffect(() => {
    fetchReservations()
    const onFocus = () => fetchReservations(true)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [fetchReservations])

  // Step 1 is where fields and slots are picked, so it follows other players closely; later
  // steps (the slot is already held) only need an occasional refresh.
  useEffect(() => {
    const every = step === 1 ? STEP1_AVAILABILITY_REFRESH_MS : 60_000
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchReservations(true)
    }, every)
    return () => window.clearInterval(interval)
  }, [fetchReservations, step])

  // A slot booked, held or released anywhere shows up here within a few seconds.
  useLiveRefresh(['reservations', 'slots'], () => fetchReservations(true))

  // Refresh reservations if flagged (e.g., after returning from payment)
  useEffect(() => {
    const shouldRefresh = localStorage.getItem('refresh_reservations')
    if (shouldRefresh === 'true') {
      localStorage.removeItem('refresh_reservations')
      fetchReservations()
    }
  }, [fetchReservations])

  // Enforce session type when the date changes. Only a real change resets the slot: a restored
  // draft (e.g. coming back from the payment page) keeps the slot it had. Comparing with the last
  // date, rather than skipping the first run, also survives React running effects twice in dev.
  const lastDateRef = useRef(dateISO)
  useEffect(() => {
    if (lastDateRef.current === dateISO) return
    lastDateRef.current = dateISO
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

  const [players, setPlayers] = useState<number>(() => draftState.players ?? defaultPlayers)
  const [playersInput, setPlayersInput] = useState(() => String(draftState.players ?? defaultPlayers))
  const [notes, setNotes] = useState<string>(() => draftState.notes ?? '')
  const [teamName, setTeamName] = useState<string>(() => draftState.teamName ?? '')
  const [gameModePreference, setGameModePreference] = useState<string>(() => draftState.gameModePreference ?? GAME_MODES[0])
  const [layoutRequest, setLayoutRequest] = useState<string>(() => draftState.layoutRequest ?? '')
  // Optional sketch of the custom field layout the marshals should set up.
  const [layoutBlueprintUrl, setLayoutBlueprintUrl] = useState<string>(() => draftState.layoutBlueprintUrl ?? '')
  const [uploadingBlueprint, setUploadingBlueprint] = useState(false)
  // How many of each obstacle each field has: the layout designer only places what's there.
  const { data: fieldObstacles } = useFieldObstacles()
  // Obstacles placed in the field mock (see FieldLayoutDesigner); saved as the blueprint image.
  const [fieldLayoutItems, setFieldLayoutItems] = useState<LayoutItem[]>(() => (Array.isArray(draftState.fieldLayoutItems) ? draftState.fieldLayoutItems : []))
  const [layoutDesignerOpen, setLayoutDesignerOpen] = useState(false)
  // Extra BB reloads each player buys for themselves, on top of what the package gives. In a split
  // payment each player's reloads go on their own share (server/utils/splitShares.js).
  const [extraAmmoByPlayer, setExtraAmmoByPlayer] = useState<Record<string, number>>(() => {
    const saved = draftState.extraAmmoByPlayer
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}
  })
  // Only players still on the booking count (a removed teammate's reloads drop off).
  const validExtraAmmo = useMemo(() => {
    const onTeam = new Set([String(user?.id || ''), ...selectedTeammates.map((member) => member.id)])
    const result: Record<string, number> = {}
    for (const [id, value] of Object.entries(extraAmmoByPlayer)) {
      const count = Math.max(0, Math.round(Number(value) || 0))
      if (count && onTeam.has(id)) result[id] = count
    }
    return result
  }, [extraAmmoByPlayer, user?.id, selectedTeammates])
  const extraAmmoReloads = Object.values(validExtraAmmo).reduce((sum, n) => sum + n, 0)
  const changeExtraAmmo = (id: string, delta: number) => setExtraAmmoByPlayer((current) => {
    const mine = Math.max(0, Math.round(Number(current[id]) || 0))
    const othersTotal = extraAmmoReloads - (validExtraAmmo[id] || 0)
    const nextCount = Math.max(0, Math.min(mine + delta, MAX_EXTRA_AMMO_RELOADS - othersTotal))
    const next = { ...current }
    if (nextCount) next[id] = nextCount
    else delete next[id]
    return next
  })
  const [ammoReloadPrice, setAmmoReloadPrice] = useState(DEFAULT_AMMO_RELOAD_PRICE)
  // Inline error labels, one per area of the page.
  const [slotError, setSlotError] = useState<string | null>(null)
  const [teamError, setTeamError] = useState<string | null>(null)
  const [blueprintError, setBlueprintError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const uploadBlueprint = async (file: File): Promise<boolean> => {
    setBlueprintError(null)
    if (!file.type.startsWith('image/')) { setBlueprintError('Upload an image file (PNG or JPG).'); return false }
    if (file.size > 5 * 1024 * 1024) { setBlueprintError('The image must be 5 MB or smaller.'); return false }
    setUploadingBlueprint(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`${apiBase}/api/upload-image`, { method: 'POST', headers: getApiAuthHeaders(), body: formData })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.url) throw new Error(json?.error || 'Upload failed')
      setLayoutBlueprintUrl(json.url)
      return true
    } catch (e: any) {
      setBlueprintError(e?.message || 'Could not upload the blueprint')
      return false
    } finally {
      setUploadingBlueprint(false)
    }
  }
  const [selectedPackageId, setSelectedPackageId] = useState<string>(() => draftState.selectedPackageId ?? '')

  const [selectionMode, setSelectionMode] = useState<SelectionMode>(() => draftState.selectionMode ?? 'package')
  // How the group rents (step 3). Teams: everyone gets a package, everyone brings their own gun and
  // gear (entrance only), or a hybrid chosen per player. Solo players can also pick items one by one.
  // Each sets up the package / custom selection underneath (see chooseRentMode).
  const [rentMode, setRentMode] = useState<RentMode>(() => draftState.rentMode ?? (draftState.selectionMode === 'custom' ? 'custom' : 'package_all'))
  const [customWeaponIds, setCustomWeaponIds] = useState<string[]>(() => draftState.customWeaponIds ?? [])
  const [customEquipmentIds, setCustomEquipmentIds] = useState<string[]>(() => draftState.customEquipmentIds ?? [])
  const [ownWeapons, setOwnWeapons] = useState<string>(() => draftState.ownWeapons ?? '')
  const [ownEquipment, setOwnEquipment] = useState<string>(() => draftState.ownEquipment ?? '')

  // The booker says they bring their own gun (custom selection). Nothing is registered: it only
  // sets the price, and the gun is checked on game day (chronograph).
  const [captainOwnGun, setCaptainOwnGun] = useState<boolean>(() => draftState.captainOwnGun ?? ((draftState.selectedOwnWeaponIds?.length ?? 0) > 0))
  // How many players the group said will bring their own weapon, and which teammates were assigned.
  const [ownWeaponTarget, setOwnWeaponTarget] = useState<number>(() => draftState.ownWeaponTarget ?? Math.max(0, Math.round(packagePrefill?.ownWeapons ?? 0)))
  const [teammateOwnWeaponIds, setTeammateOwnWeaponIds] = useState<string[]>(() => draftState.teammateOwnWeaponIds ?? [])
  // Players (the booker included) bringing their own gun AND gear: entrance fee only (packages).
  const [ownGearIds, setOwnGearIds] = useState<string[]>(() => draftState.ownGearIds ?? [])
  // Hybrid: of the players not taking the package, the single pieces each one rents (gun, mask, vest).
  const [ownGearRentals, setOwnGearRentals] = useState<Record<string, RentPiece[]>>(() => draftState.ownGearRentals ?? {})
  // Hybrid: rental guns each player picked (one sample piece id per gun; the server picks free pieces).
  const [playerGuns, setPlayerGuns] = useState<Record<string, string[]>>(() => draftState.playerGuns ?? {})
  // Hybrid: players switched to "Rent some" who haven't picked a piece yet (so the row stays on it).
  const [rentSomeIds, setRentSomeIds] = useState<string[]>([])
  const [slotHoldExpiresAt, setSlotHoldExpiresAt] = useState<string | null>(null)
  const [placingHold, setPlacingHold] = useState(false)

  const findTeammate = async () => {
    // A name or an email: "@" means an exact email, anything else searches names.
    const query = teamEmail.trim()
    const byEmail = query.includes('@')
    if (byEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query)) {
      setTeamLookup({ status: 'error', error: 'Enter a valid email address.' })
      return
    }
    if (!byEmail && query.length < 3) {
      setTeamLookup({ status: 'error', error: 'Type at least 3 letters of the name, or the full email.' })
      return
    }
    if (byEmail && user?.email && query.toLowerCase() === user.email.toLowerCase()) {
      setTeamLookup({ status: 'error', error: sessionType === 'private' ? 'You are already counted as the team captain.' : 'You are already on this booking.' })
      return
    }
    setTeamLookup({ status: 'searching' })
    try {
      type Found = { id: string; name: string; email: string; waiverApproved: boolean; hasApprovedWeapon: boolean }
      const res = await apiGet<{ ok: boolean; data: Found; matches?: Found[] }>(`/api/team-directory/lookup?q=${encodeURIComponent(query)}`)
      const found = Array.isArray(res.matches) && res.matches.length ? res.matches : [res.data]
      setTeamLookup({
        status: 'found',
        members: found.map((match) => ({
          id: String(match.id),
          name: match.name || match.email,
          email: match.email,
          status: 'active',
          waiverSubmitted: match.waiverApproved === true,
          hasApprovedWeapon: match.hasApprovedWeapon === true,
        })),
      })
    } catch (err: any) {
      setTeamLookup({ status: 'error', error: err?.message || 'Could not look up that player.' })
    }
  }

  const addTeammate = (member: TeamMember) => {
    if (!member.waiverSubmitted) {
      setTeamError(`${member.name} hasn't signed their waiver yet.`)
      return
    }
    if (selectedTeammateIds.includes(member.id)) {
      setTeamError(`${member.name} is already on your team.`)
      return
    }
    if (selectedTeammates.length >= Math.max(0, players - 1)) {
      setTeamError('Your team is full for this many players. Increase the player count to add more.')
      return
    }
    setTeamError(null)
    setSelectedTeammates((current) => [...current, member])
    setTeamEmail('')
    setTeamLookup({ status: 'idle' })
    toast.success(`${member.name} added to your team.`)
  }

  // "A minor will join this game": the child fills one of the player spots, so they pay the
  // entrance fee like everyone else.
  const addMinor = (childId: string) => {
    const kid = teamChildren.find((child) => child.id === childId)
    if (!kid || selectedTeammateIds.includes(kid.id)) return
    if (!kid.canPlay) {
      setTeamError(`${kid.name} needs a confirmed guardian and an approved waiver first.`)
      return
    }
    if (selectedTeammates.length >= Math.max(0, players - 1)) {
      setTeamError('Every player spot is filled. Go back and raise the number of players to add a minor (each player pays the entrance fee).')
      return
    }
    setTeamError(null)
    setSelectedTeammates((current) => [...current, {
      id: kid.id,
      name: kid.name,
      email: '',
      status: 'Active',
      waiverSubmitted: true,
      hasApprovedWeapon: false,
      isMinor: true,
      guardianId: kid.guardianId,
    }])
    toast.success(`${kid.name} added to your team.`)
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

        const docs = (Array.isArray(res?.data) ? res.data : []).filter((doc) => !doc.archived)
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
          apiGetAll<any>('weapons').then((data) => ({ ok: true, data })),
          apiGetAll<any>('equipments').then((data) => ({ ok: true, data })),
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
            bbReloadGrams: typeof d.bbReloadGrams === 'number' && d.bbReloadGrams > 0 ? d.bbReloadGrams : 0,
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
          locationId: d.locationId || '',
        })))

        const eqDocs = Array.isArray(eqRes?.data) ? eqRes.data : []
        setEquipment(eqDocs.map((d: any) => ({
          id: d.id ?? (d._id ? String(d._id) : undefined),
          _id: d._id,
          name: d.name || 'Unnamed gear',
          model: modelOf(d),
          unitNumber: Number(d.unitNumber) || 0,
          source: d.source,
          category: d.category || 'gear',
          status: d.status || 'available',
          price: typeof d.price === 'number' ? d.price : 0,
          locationId: d.locationId || '',
        })))
      } catch (e: any) {
        if (!cancelled) setLoadError(`Couldn't load packages and gear: ${String(e?.message || e)}`)
      } finally {
        if (!cancelled) setLoadingPackages(false)
      }
    }
    fetchData()
    return () => { cancelled = true }
  }, [])

  // Only players with an approved weapon on file count; the rest are charged a rental weapon.
  // Own weapons work with a custom selection, and with a package that rents weapons: that player
  // gets the package without its weapon. A fixed group price (settled amount) can't be split.
  const pickedPackage = packages.find((p) => p.id === selectedPackageId)
  const packageAllowsOwnWeapons = Boolean(pickedPackage) && !(Number(pickedPackage?.settledAmount) > 0) && (pickedPackage?.weaponIds.length || 0) > 0
  const ownWeaponsAllowed = selectionMode === 'custom' || (selectionMode === 'package' && packageAllowsOwnWeapons)
  // Package bookings: each player gets the package, brings their own gun (rents the rest), or brings
  // their own gun and gear (entrance fee only). Own options need an approved gun on file.
  // Bringing their own gun and gear works with any package priced per player; only one price for a
  // whole group (e.g. "for 2 players only") can't leave anyone out. Mirrors the server.
  const packageIsGroupPrice = Boolean(pickedPackage) && Number(pickedPackage?.settledAmount) > 0 && Math.round(Number(pickedPackage?.players ?? 0)) > 1
  const packageAllowsOwnGear = Boolean(pickedPackage) && !packageIsGroupPrice
  const ownGearAllowed = rentMode === 'hybrid' && selectionMode === 'package' && packageAllowsOwnGear
  // The booker marks who brings their own; no registered gear is needed. Minors always get the package.
  const validOwnGearIds = useMemo(() => (ownGearAllowed
    ? ownGearIds.filter((id) => id === user?.id || selectedTeammates.some((member) => member.id === id))
    : []), [ownGearAllowed, ownGearIds, user?.id, selectedTeammates])
  const captainOwnGear = Boolean(user?.id) && validOwnGearIds.includes(String(user?.id))
  // The picked package's mask and vest, for players renting just one of them.
  const packageSingleItems = useMemo(() => {
    const result: Record<RentPiece, { model: string; price: number } | null> = { mask: null, vest: null }
    if (!pickedPackage) return result
    for (const id of pickedPackage.equipmentIds || []) {
      const item = equipment.find((piece) => piece.id === id)
      if (!item) continue
      const text = `${item.category || ''} ${item.model || item.name}`.toLowerCase()
      const kind: RentPiece | null = text.includes('mask') ? 'mask' : text.includes('vest') ? 'vest' : null
      if (kind && !result[kind]) result[kind] = { model: item.model || item.name, price: Number(item.price || 0) }
    }
    return result
  }, [pickedPackage, equipment])
  // Single pieces of the players not taking the package (only pieces the package has).
  const validOwnGearRentals = useMemo(() => {
    const result: Record<string, RentPiece[]> = {}
    for (const id of validOwnGearIds) {
      const picked = RENT_PIECES.filter((piece) => (ownGearRentals[id] || []).includes(piece) && packageSingleItems[piece])
      if (picked.length) result[id] = picked
    }
    return result
  }, [validOwnGearIds, ownGearRentals, packageSingleItems])
  const rentOnlyCounts = useMemo(() => {
    const counts: Record<RentPiece, number> = { mask: 0, vest: 0 }
    for (const pieces of Object.values(validOwnGearRentals)) for (const piece of pieces) counts[piece] += 1
    return counts
  }, [validOwnGearRentals])
  // What the single pieces cost in all (entrance fees are counted with the package pricing).
  const singlesTotal = RENT_PIECES.reduce((sum, piece) => sum + rentOnlyCounts[piece] * (packageSingleItems[piece]?.price || 0), 0)
  const singlesCostOf = (id: string) => (validOwnGearRentals[id] || []).reduce((sum, piece) => sum + (packageSingleItems[piece]?.price || 0), 0)
  // Rental guns each player picked (Hybrid only), up to MAX_GUNS_PER_PLAYER, and what they cost.
  const validPlayerGuns = useMemo(() => {
    const result: Record<string, string[]> = {}
    if (!ownGearAllowed) return result
    const onTeam = new Set([String(user?.id || ''), ...selectedTeammates.map((member) => member.id)])
    for (const [id, guns] of Object.entries(playerGuns)) {
      const list = guns.filter((gunId) => weapons.some((w) => w.id === gunId)).slice(0, MAX_GUNS_PER_PLAYER)
      if (onTeam.has(id) && list.length) result[id] = list
    }
    return result
  }, [ownGearAllowed, playerGuns, weapons, user?.id, selectedTeammates])
  const gunPrice = (gunId: string) => Number(weapons.find((w) => w.id === gunId)?.price || 0)
  const gunModel = (gunId: string) => {
    const gun = weapons.find((w) => w.id === gunId)
    return gun?.model || gun?.name || 'Gun'
  }
  const gunsCostOf = (id: string) => (validPlayerGuns[id] || []).reduce((sum, gunId) => sum + gunPrice(gunId), 0)
  const gunsTotal = Object.keys(validPlayerGuns).reduce((sum, id) => sum + gunsCostOf(id), 0)
  // Players not taking the package who rent a gun get the included BBs with it (as on the server).
  const gunRentersNotTakingPackage = validOwnGearIds.filter((id) => validPlayerGuns[id]).length
  // Players who actually get the package (Hybrid players bringing their own get nothing from it):
  // what the included items, the stock check and the gear count are based on.
  const rentalPlayers = Math.max(0, players - validOwnGearIds.length)
  // Only a solo player picking items marks an own gun this way (Hybrid is package or own gun + gear).
  const captainBringsOwnWeapon = ownWeaponsAllowed && rentMode === 'custom' && !captainOwnGear && captainOwnGun
  const verifiedTeammateBringers = useMemo(
    () => selectedTeammates.filter((member) => teammateOwnWeaponIds.includes(member.id) && !validOwnGearIds.includes(member.id)),
    [selectedTeammates, teammateOwnWeaponIds, validOwnGearIds],
  )
  // What each player gets, for the table: 'package' | 'own_gun' | 'own_gear'.
  type Loadout = 'package' | 'own_gun' | 'own_gear'
  const loadoutOf = (id: string): Loadout => {
    if (validOwnGearIds.includes(id)) return 'own_gear'
    if (id === user?.id) return captainBringsOwnWeapon ? 'own_gun' : 'package'
    return verifiedTeammateBringers.some((member) => member.id === id) ? 'own_gun' : 'package'
  }
  // Picking how the group rents sets up the package / custom selection underneath.
  const chooseRentMode = (mode: RentMode) => {
    setRentMode(mode)
    if (mode === 'package_all' || mode === 'hybrid') {
      setSelectionMode('package')
      // Each player either gets the full package or brings their own gun and gear (Hybrid), so an
      // "own gun, rent the gear" pick from before doesn't carry over.
      setTeammateOwnWeaponIds([])
      setCaptainOwnGun(false)
      if (mode === 'package_all') {
        setOwnGearIds([])
        setOwnGearRentals({})
        setPlayerGuns({})
      }
    } else {
      setSelectionMode('custom')
      setSelectedPackageId('')
      if (mode === 'own_all') {
        // Nothing rented: everyone pays the entrance fee only.
        setCustomWeaponIds([])
        setCustomEquipmentIds([])
      }
    }
  }
  // Everyone bringing their own: anyone can, minors included.
  const ownAllMissing: string[] = []
  // Hybrid table: the full package (plus any extra guns), only some pieces (picked guns, mask, vest),
  // or everything their own.
  const withoutKey = <T,>(id: string) => (current: Record<string, T>) => {
    if (!(id in current)) return current
    const next = { ...current }
    delete next[id]
    return next
  }
  const clearSingles = (id: string) => setOwnGearRentals(withoutKey<RentPiece[]>(id))
  // Switching between the package and renting only some: picked guns meant one or the other, so they're cleared.
  const chooseFullPackage = (id: string) => {
    if (validOwnGearIds.includes(id)) setPlayerGuns(withoutKey<string[]>(id))
    setLoadout(id, 'package')
    clearSingles(id)
  }
  const chooseBringsAll = (id: string) => {
    setLoadout(id, 'own_gear')
    clearSingles(id)
    setPlayerGuns(withoutKey<string[]>(id))
  }
  const addGun = (id: string, gunId: string) => {
    if (!gunId) return
    setPlayerGuns((current) => {
      const mine = (current[id] || []).filter((x) => weapons.some((w) => w.id === x))
      return mine.length >= MAX_GUNS_PER_PLAYER ? current : { ...current, [id]: [...mine, gunId] }
    })
  }
  const removeGun = (id: string, index: number) => setPlayerGuns((current) => {
    const mine = (current[id] || []).filter((_, i) => i !== index)
    const next = { ...current }
    if (mine.length) next[id] = mine
    else delete next[id]
    return next
  })
  const toggleSingle = (id: string, piece: RentPiece) => {
    if (!validOwnGearIds.includes(id)) setLoadout(id, 'own_gear')
    // Coming from the package, the other pieces start unticked.
    setOwnGearRentals((current) => {
      const mine = validOwnGearIds.includes(id) ? current[id] || [] : []
      return { ...current, [id]: mine.includes(piece) ? mine.filter((x) => x !== piece) : [...mine, piece] }
    })
  }
  const setLoadout = (id: string, loadout: Loadout) => {
    setOwnGearIds((current) => (loadout === 'own_gear' ? [...current.filter((x) => x !== id), id] : current.filter((x) => x !== id)))
    if (id === user?.id) {
      setCaptainOwnGun(loadout === 'own_gun')
    } else {
      setTeammateOwnWeaponIds((current) => (loadout === 'own_gun' ? [...current.filter((x) => x !== id), id] : current.filter((x) => x !== id)))
    }
  }
  const verifiedOwnWeaponCount = ownWeaponsAllowed
    ? Math.min(players, (captainBringsOwnWeapon ? 1 : 0) + verifiedTeammateBringers.length)
    : 0
  // How many players said they bring their own weapon (marked in Bring Your Own).
  const markedOwnWeaponCount = ownWeaponsAllowed
    ? Math.min(players, (captainBringsOwnWeapon ? 1 : 0) + teammateOwnWeaponIds.length)
    : 0
  useEffect(() => {
    setOwnWeaponTarget(markedOwnWeaponCount)
  }, [markedOwnWeaponCount])

  // Whether the gear for this booking is free for the slot, so players see a shortage here
  // instead of at payment. The server answers only yes / no (and which models are short): players
  // never see stock or how many others booked, and the server picks the exact pieces at booking.
  const [stockCheck, setStockCheck] = useState<{ enough: boolean; message: string; shortModels: string[] } | null>(null)
  const [loadingSlotStock, setLoadingSlotStock] = useState(false)
  useEffect(() => {
    if (!dateISO || !slot || !['package', 'custom'].includes(selectionMode)) {
      setStockCheck(null)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setLoadingSlotStock(true)
      apiPost<{ ok: boolean; enough: boolean; message?: string; shortModels?: string[] }>('/api/inventory-check', {
        reservationDate: dateISO,
        reservationTime: slot,
        locationId: selectedLocation,
        players,
        selectionMode,
        selectedPackageId,
        customWeaponIds,
        customEquipmentIds,
        verifiedOwnWeaponCount,
        // Hybrid players bringing their own get nothing from the package, so nothing is needed for them.
        verifiedOwnGearCount: validOwnGearIds.length,
        // Who isn't taking the package, the mask / vest they rent, and the guns players picked.
        ownGearPlayerIds: validOwnGearIds,
        ownGearRentals: validOwnGearRentals,
        playerGuns: validPlayerGuns,
      })
        .then((res) => { if (!cancelled) setStockCheck({ enough: res.enough !== false, message: res.message || '', shortModels: res.shortModels || [] }) })
        .catch(() => { if (!cancelled) setStockCheck(null) })
        .finally(() => { if (!cancelled) setLoadingSlotStock(false) })
    }, 400)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [dateISO, slot, step, selectedLocation, players, selectionMode, selectedPackageId, customWeaponIds, customEquipmentIds, verifiedOwnWeaponCount, validOwnGearIds, validOwnGearRentals, validPlayerGuns])
  const stockShort = Boolean(stockCheck && !stockCheck.enough)
  // A model is flagged short when the server named it (or named nothing in particular).
  const modelShort = useCallback((model: string) => Boolean(stockCheck && !stockCheck.enough
    && (stockCheck.shortModels.length === 0 || stockCheck.shortModels.includes(model) || stockCheck.message.includes(model))), [stockCheck])

  // A piece is free when it's in service and not reserved by another booking for this slot.
  const pieceFree = useCallback((_collection: 'weapons' | 'equipments', piece: { id: string; status: string }) => (
    String(piece.status || 'available') === 'available'
  ), [])

  // Packages name models through one piece id each, which may sit at any branch: look models up
  // in every rental piece. Free stock then comes from this branch's pieces only.
  const allRentalWeapons = useMemo(() => weapons.filter((w) => w.source !== 'player'), [weapons])
  const allRentalEquipment = useMemo(() => equipment.filter((e) => e.source !== 'player'), [equipment])
  // Each branch rents out only its own stock (plus pieces not assigned to a branch yet).
  const rentalWeapons = useMemo(() => weapons.filter((w) => w.source !== 'player' && pieceAtBranch(w, selectedLocation)), [weapons, selectedLocation])
  const rentalEquipment = useMemo(() => equipment.filter((e) => e.source !== 'player' && (isAmmo(e) || pieceAtBranch(e, selectedLocation))), [equipment, selectedLocation])

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
  // Ammo is sold as extra reloads (grams), not rented as pieces.
  const gearGroups = useMemo(() => equipmentGroups.filter((group) => !isAmmo(group)), [equipmentGroups])

  const freeOfModel = useCallback((groups: PickerGroup[], model: string) =>
    groups.find((group) => group.model === model)?.pieces.filter((piece) => piece.free).length ?? 0,
  [])

  const modelsOfIds = useCallback((items: Array<{ id: string; model: string }>, ids: string[]) =>
    [...new Set(ids.map((id) => items.find((item) => item.id === id)?.model).filter(Boolean) as string[])],
  [])

  // Mirrors the server: each player gets one of every weapon model in the package (an approved
  // own gun replaces the first, main one), from the free pieces of each model.
  const packageWeaponStock = useCallback((pkg: RentalPackage) => {
    const models = modelsOfIds(allRentalWeapons, pkg.weaponIds)
    const needs = models.map((_, index) => Math.max(0, rentalPlayers - (index === 0 ? Math.min(verifiedOwnWeaponCount, rentalPlayers) : 0)))
    const needed = needs.reduce((sum, n) => sum + n, 0)
    return { needed }
  }, [modelsOfIds, allRentalWeapons, rentalPlayers, verifiedOwnWeaponCount])

  // Only packages that fit the headcount can be picked (a group package fits exactly its size).
  const cheapestPackage = useMemo(() => {
    const fitting = packages.filter((pkg) => packageNotForGroup(pkg, players) === null)
    if (fitting.length === 0) return undefined
    return fitting.reduce((cheapest, pkg) =>
      pkg.basePrice < cheapest.basePrice ? pkg : cheapest
    )
  }, [packages, players])

  // Changing the headcount can rule out the picked group package: move to one that fits.
  useEffect(() => {
    const picked = packages.find((pkg) => pkg.id === selectedPackageId)
    if (picked && packageNotForGroup(picked, players) !== null) setSelectedPackageId(cheapestPackage?.id ?? '')
  }, [packages, selectedPackageId, players, cheapestPackage])

  // With no packages from the admin, custom selection is the only way to book.
  const noPackages = !loadingPackages && packages.length === 0
  useEffect(() => {
    if (noPackages && selectionMode !== 'custom') {
      setSelectionMode('custom')
      setSelectedPackageId('')
    }
  }, [noPackages, selectionMode])
  // Picking items one by one is for a solo player; a team uses Hybrid instead, and Hybrid needs a team.
  useEffect(() => {
    if (noPackages) return
    if (players > 1 && rentMode === 'custom') chooseRentMode('package_all')
    if (players <= 1 && rentMode === 'hybrid') chooseRentMode('package_all')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, rentMode, noPackages])

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

  // Package recommendation: the player enters a budget, the group size is the headcount from
  // step 1. Packages that fit the group and the budget are listed first, cheapest first.
  const [budgetInput, setBudgetInput] = useState<string>(() => (typeof draftState.budgetInput === 'string' ? draftState.budgetInput : ''))
  const budget = useMemo(() => {
    const value = Math.round(Number(budgetInput))
    return budgetInput.trim() !== '' && Number.isFinite(value) && value > 0 ? value : null
  }, [budgetInput])

  const rankedPackages = useMemo(() => {
    const rows = packages.map((pkg, index) => {
      const price = calculatePackagePricing({
        pkg,
        players,
        sessionMultiplier: 1,
        weapons,
        equipment,
        entranceFeePerPlayer: ENTRANCE_FEE_PER_PLAYER,
        ownWeapons: verifiedOwnWeaponCount,
      })
      // Renting the same things one by one; shown crossed out when the package is cheaper.
      const regularTotal = packageRegularTotal({
        pkg,
        players,
        weapons,
        equipment,
        entranceFeePerPlayer: ENTRANCE_FEE_PER_PLAYER,
        ownWeapons: verifiedOwnWeaponCount,
      })
      const savingsPerPlayer = regularTotal > price.total ? Math.round((regularTotal - price.total) / Math.max(1, players)) : 0
      // A group package (set price for N players) only fits exactly N players.
      const groupSize = packageNotForGroup(pkg, players)
      const fitsGroup = groupSize === null && players >= pkg.minPlayers
      const overBudgetBy = budget !== null ? Math.max(0, price.total - budget) : 0
      return { pkg, price, savingsPerPlayer, groupSize, fitsGroup, overBudgetBy, recommended: budget !== null && fitsGroup && overBudgetBy === 0, index }
    })
    if (budget === null) return rows
    return [...rows].sort((a, b) => {
      const rank = (row: typeof a) => (row.recommended ? 0 : row.fitsGroup ? 1 : 2)
      return rank(a) - rank(b) || (rank(a) < 2 ? a.price.total - b.price.total : a.index - b.index)
    })
  }, [packages, players, weapons, equipment, verifiedOwnWeaponCount, budget])

  // Only packages this team can book: right for the group size, and (Hybrid, where players can be
  // left out of the package) priced per player, not one price for a whole group.
  const isGroupPricePackage = (pkg: { settledAmount?: number; players?: number }) => Number(pkg.settledAmount) > 0 && Math.round(Number(pkg.players ?? 0)) > 1
  const shownPackages = useMemo(
    () => rankedPackages.filter((row) => row.fitsGroup && (rentMode !== 'hybrid' || !isGroupPricePackage(row.pkg as any))),
    [rankedPackages, rentMode],
  )
  const hiddenPackageCount = rankedPackages.length - shownPackages.length
  // A package that no longer fits (group size or mode changed) isn't kept selected.
  useEffect(() => {
    if (!selectedPackageId || loadingPackages || !packages.length) return
    if (!shownPackages.some((row) => row.pkg.id === selectedPackageId)) setSelectedPackageId(shownPackages[0]?.pkg.id || '')
  }, [shownPackages, selectedPackageId, loadingPackages, packages.length])

  const recommendedCount = rankedPackages.filter((row) => row.recommended).length
  // Shown when nothing fits: the cheapest package for this group and how far it is over.
  const closestOverBudget = useMemo(() => {
    if (budget === null || recommendedCount > 0) return null
    return rankedPackages.filter((row) => row.fitsGroup).sort((a, b) => a.price.total - b.price.total)[0] ?? null
  }, [budget, recommendedCount, rankedPackages])

  // Entering a budget moves the pick to the cheapest package that fits it, if the current one doesn't.
  const lastBudgetRef = useRef(budget)
  useEffect(() => {
    if (lastBudgetRef.current === budget) return
    lastBudgetRef.current = budget
    if (budget === null || selectionMode !== 'package') return
    const current = rankedPackages.find((row) => row.pkg.id === selectedPackageId)
    if (current?.recommended) return
    const best = rankedPackages.find((row) => row.recommended)
    if (best) setSelectedPackageId(best.pkg.id)
  }, [budget, rankedPackages, selectedPackageId, selectionMode])

  const isWd = useMemo(() => isWeekday(dateISO), [dateISO])

  // ---------------------------------------------------------------------
  // Field availability + minimum player rules
  // ---------------------------------------------------------------------

  // Fields aren't exclusive: several groups can book the same location, field and time until the
  // slot's player capacity is full (isSlotFullyBooked), matching the server's check.
  const isFieldSlotAvailable = useCallback((fieldId: string, _slotToCheck: TimeSlot): boolean => (
    Boolean(getFieldById(fieldId))
  ), [])

  // Taken because another player is in the middle of booking it (not yet a reservation).
  const isFieldBeingBooked = useCallback((fieldId: string, slotToCheck: TimeSlot): boolean => (
    isWd && reservations.some((r) =>
      r.reservationStatus === 'held' &&
      r.dateISO === dateISO &&
      r.fieldIds.includes(fieldId) &&
      r.slot === slotToCheck &&
      r.locationId === selectedLocation)
  ), [isWd, reservations, dateISO, selectedLocation])

  // Private games: the minimum depends on how many fields are picked (matches the server's
  // fieldCountMinimum): 1 field needs 10 players, 2 fields 20, all 3 fields 50.
  const getMinPlayersForSelection = useCallback((ids: string[], _slotToCheck?: TimeSlot): number => {
    return fieldCountMinimum(ids.filter((id) => getFieldById(id)).length)
  }, [])

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

  // Fields are assigned automatically from the group size. If a needed field is already booked for
  // the slot, the group gets the largest set that is still free (every set includes Upper Ground,
  // so nothing is left once Upper Ground is booked).
  const wantedFieldCount = fieldCountForPlayers(players)
  const autoFieldIds = useMemo(() => {
    let count = wantedFieldCount
    while (count > 0 && isWd && !fieldChoiceIds(selectedLocation, count).every((id) => isFieldSlotAvailable(id, slot))) count -= 1
    return count > 0 ? fieldChoiceIds(selectedLocation, count) : []
  }, [wantedFieldCount, isWd, isFieldSlotAvailable, selectedLocation, slot])

  useEffect(() => {
    setSelectedFieldIds((prev) => {
      const unchanged = autoFieldIds.length === prev.length && autoFieldIds.every((id, idx) => id === prev[idx])
      return unchanged ? prev : autoFieldIds
    })
  }, [autoFieldIds])

  // Why a slot can't be booked, matching the server's slotConflict check:
  // - a private game is booked there, or another player is booking one right now;
  // - picking a private game where public players are already booked.
  // (`reservations` already leaves out this player's own hold.)
  const getSlotBlockReason = (slotToCheck: TimeSlot): 'private_booked' | 'being_booked' | 'public_booked' | null => {
    const inSlot = reservations.filter((r) => r.dateISO === dateISO && r.slot === slotToCheck && r.locationId === selectedLocation)
    const isPrivateGame = (r: { sessionType?: string }) => String(r.sessionType || '').toLowerCase() === 'private'
    if (inSlot.some((r) => r.reservationStatus !== 'held' && isPrivateGame(r))) return 'private_booked'
    if (inSlot.some((r) => r.reservationStatus === 'held' && isPrivateGame(r))) return 'being_booked'
    if (sessionType === 'private' && inSlot.some((r) => r.reservationStatus !== 'held')) return 'public_booked'
    return null
  }
  const slotBlockLabels = {
    private_booked: 'Booked for a private game',
    being_booked: 'Another player is booking this slot',
    public_booked: 'Public players already booked this slot',
  } as const

  // Check if a specific slot can't take a booking (taken, or fully booked for ALL fields at this location)
  const isSlotFullyBooked = (slotToCheck: TimeSlot): boolean => {
    if (getSlotBlockReason(slotToCheck)) return true
    // Any day: the slot is full once the server reports its player capacity used up.
    return fullSlotKeys.has(`${selectedLocation}|${dateISO}|${slotToCheck}`)
  }

  // Get available fields for a specific slot at this location
  const getAvailableFieldsForSlot = (slotToCheck: TimeSlot): Field[] => {
    const fields = getFieldsForLocation(selectedLocation)
    if (isWd) {
      return fields.filter(f => isFieldSlotAvailable(f.id, slotToCheck))
    }
    return fields
  }

  // The most players one slot takes (public information). Whether this group fits is checked by
  // the server when the slot is held; players only ever see "full" or "available".
  const maxCapacity = useMemo(() => {
    return serverCapacities?.[selectedLocation]?.[slot] ?? capacityFor(selectedLocation, slot)
  }, [selectedLocation, serverCapacities, slot])
  const pickedSlotFull = bookedSlots.some((s) => isSlotFullyBooked(s))
  const hasRequiredSlotSelection = isWd ? slotTouched : selectedSlots.length > 0
  const pickedSlotStarted = bookedSlots.some((s) => slotHasStarted(slotHours, s, dateISO))
  const canProceed = hasRequiredSlotSelection && !pickedSlotStarted && !pickedSlotFull && meetsFieldRequirements

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

  const packageWeaponModels = useMemo(() => (selectedPackage ? modelsOfIds(allRentalWeapons, selectedPackage.weaponIds) : []), [selectedPackage, modelsOfIds, allRentalWeapons])
  // Ammo is given per refill (in grams), not reserved as pieces, so it has no picker or stock check.
  const packageEquipmentModels = useMemo(() => (selectedPackage ? modelsOfIds(allRentalEquipment.filter((item) => !isAmmo(item)), selectedPackage.equipmentIds) : []), [selectedPackage, modelsOfIds, allRentalEquipment])
  const packageWeaponGroups = useMemo(() => weaponGroups.filter((group) => packageWeaponModels.includes(group.model)), [weaponGroups, packageWeaponModels])
  const packageEquipmentGroups = useMemo(() => equipmentGroups.filter((group) => packageEquipmentModels.includes(group.model)), [equipmentGroups, packageEquipmentModels])

  useEffect(() => {
    if (loadingPackages) return
    const free = new Set([...weaponGroups, ...gearGroups].flatMap((group) => group.pieces.filter((piece) => piece.free).map((piece) => piece.id)))
    setCustomWeaponIds((current) => (current.every((id) => free.has(id)) ? current : current.filter((id) => free.has(id))))
    setCustomEquipmentIds((current) => (current.every((id) => free.has(id)) ? current : current.filter((id) => free.has(id))))
  }, [weaponGroups, gearGroups, loadingPackages])

  const packageWeaponsNeeded = selectedPackage ? packageWeaponStock(selectedPackage).needed : 0

  // Picked pieces from another branch can't be rented here: drop them when the location changes.
  useEffect(() => {
    if (weapons.length === 0 && equipment.length === 0) return
    const keep = (items: Array<{ id: string; locationId?: string }>) => (ids: string[]) => {
      const next = ids.filter((id) => {
        const item = items.find((piece) => piece.id === id)
        return !item || pieceAtBranch(item, selectedLocation)
      })
      return next.length === ids.length ? ids : next
    }
    setCustomWeaponIds(keep(weapons))
    setCustomEquipmentIds(keep(equipment))
  }, [selectedLocation, weapons, equipment])

  const customSelectedWeapons = useMemo(() => {
    return weapons.filter((w) => customWeaponIds.includes(w.id))
  }, [weapons, customWeaponIds])

  const customSelectedEquipment = useMemo(() => {
    return equipment.filter((e) => customEquipmentIds.includes(e.id))
  }, [equipment, customEquipmentIds])

  // Pieces of an equipment model each player gets in the selected package (set by the admin).
  const equipmentPerPlayer = useCallback((model: string) => {
    if (!selectedPackage) return 1
    const ids = selectedPackage.equipmentIds.filter((id) => allRentalEquipment.find((item) => item.id === id)?.model === model)
    return Math.max(1, ...ids.map((id) => packageEquipmentQty(selectedPackage, id)))
  }, [selectedPackage, allRentalEquipment])

  // Shortage for the selected date/slot, as the server reported it (package or custom gear).
  const equipmentStockCheck = useMemo(() => (
    stockShort ? [{ name: stockCheck?.shortModels.join(' and ') || 'Rental gear', message: stockCheck?.message || 'Not enough gear free for this slot.', ok: false }] : []
  ), [stockShort, stockCheck])

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
      ownGear: validOwnGearIds.length,
    })

    // Single pieces rented by players not taking the package, at their rental price (no discount).
    const total = packagePricing.total + singlesTotal + gunsTotal
    return {
      total,
      perPlayer: Math.round(total / Math.max(1, players)),
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
      totalBeforeOverall: total,
      details: packagePricing,
    }
  }, [players, selectedPackage, packageWeapons, packageEquipment, equipmentTotalPerPlayer, selectionMode, customTotal, customPerPlayerTotal, verifiedOwnWeaponCount, validOwnGearIds.length, singlesTotal, gunsTotal])

  // What the picked package costs for one player (the Hybrid table's "Package for 1 player").
  // Not shown for a price set for a whole group.
  const packageOnePlayerPrice = useMemo(() => {
    if (!selectedPackage || packageIsGroupPrice) return null
    return calculatePackagePricing({
      pkg: selectedPackage,
      players: 1,
      sessionMultiplier: 1,
      weapons: packageWeapons,
      equipment: packageEquipment,
      entranceFeePerPlayer: ENTRANCE_FEE_PER_PLAYER,
    }).total
  }, [selectedPackage, packageIsGroupPrice, packageWeapons, packageEquipment])

  const extraAmmoTotal = Math.round(extraAmmoReloads * ammoReloadPrice)
  // A custom field layout (private games): a tier by how many pieces staff set up. An uploaded plan
  // can't be counted, so it's the Standard tier. The server sets the actual price the same way.
  const layoutTiers = fieldObstacles?.layoutFees || DEFAULT_LAYOUT_FEES
  const layoutFee = sessionType !== 'private'
    ? null
    : fieldLayoutItems.length
      ? layoutFeeFor(countLayoutPieces(fieldLayoutItems), layoutTiers)
      : layoutBlueprintUrl ? { ...layoutTiers[1], pieces: 0, next: null, untilNext: null } : null
  const layoutFeeTotal = layoutFee?.price || 0
  const dynamicPricing = useMemo(() => {
    if (extraAmmoTotal <= 0 && layoutFeeTotal <= 0) return basePricing
    const total = basePricing.total + extraAmmoTotal + layoutFeeTotal
    return { ...basePricing, total, perPlayer: Math.round(total / Math.max(1, players)) }
  }, [basePricing, extraAmmoTotal, layoutFeeTotal, players])

  // Each slot of a full day is priced like a one-slot booking; the player pays for all of them.
  const bookingTotal = dynamicPricing.total * bookedSlots.length

  const paymentBreakdown = useMemo(() => {
    const entranceFee = ENTRANCE_FEE_PER_PLAYER * players
    const itemizedBreakdown: Array<{ label: string; amount: number }> = []
    let fieldPrice = 0
    let equipmentPrice = 0

    if (selectionMode === 'package' && selectedPackage && dynamicPricing.details) {
      const details = dynamicPricing.details
      if (details.isSettled) {
        // A set price for 1 player is per player ("Normal (₱750 × 2 players)"); a group price is one amount.
        const groupSize = Math.round(Number(selectedPackage.players || 0))
        const label = groupSize > 1
          ? `${selectedPackage.name} (set price for ${groupSize} players)`
          : `${selectedPackage.name} (₱${Math.round(details.basePriceTotal / Math.max(1, rentalPlayers)).toLocaleString('en-PH')} × ${rentalPlayers} player${rentalPlayers === 1 ? '' : 's'})`
        if (details.basePriceTotal > 0) itemizedBreakdown.push({ label, amount: details.basePriceTotal })
        if (details.ownGearPlayers > 0) {
          itemizedBreakdown.push({ label: `Entrance fee, not taking the package (${details.ownGearPlayers} × ₱${ENTRANCE_FEE_PER_PLAYER})`, amount: details.entranceFeeTotal })
        }
        fieldPrice = details.basePriceTotal
      } else {
        fieldPrice = details.basePriceTotal
        equipmentPrice = details.weaponsTotal + details.equipmentTotal
        if (details.basePriceTotal > 0) itemizedBreakdown.push({ label: `${selectedPackage.name} fee`, amount: details.basePriceTotal })
        if (details.weaponsTotal > 0) itemizedBreakdown.push({ label: `Rental weapons (${details.rentedWeaponCount})`, amount: details.weaponsTotal })
        if (details.ownWeaponsUsed > 0) itemizedBreakdown.push({ label: `Own weapons (${details.ownWeaponsUsed}) — no rental charge`, amount: 0 })
        packageEquipment.forEach((item) => {
          if (rentalPlayers > 0) itemizedBreakdown.push({ label: `${item.name} (1 per player)`, amount: Number(item.price || 0) * rentalPlayers })
        })
        itemizedBreakdown.push({ label: `Player entrance fee (${players} × ₱${ENTRANCE_FEE_PER_PLAYER})`, amount: entranceFee })
      }
      if (details.discountAmount > 0) itemizedBreakdown.push({ label: `Package discount (${details.discountSummary})`, amount: -details.discountAmount })
      // Single pieces rented by players not taking the package.
      for (const piece of RENT_PIECES) {
        const item = packageSingleItems[piece]
        if (!item || !rentOnlyCounts[piece]) continue
        equipmentPrice += item.price * rentOnlyCounts[piece]
        itemizedBreakdown.push({ label: `${item.model} rental only (${rentOnlyCounts[piece]} × ₱${item.price.toLocaleString('en-PH')})`, amount: item.price * rentOnlyCounts[piece] })
      }
      // Guns players picked, grouped by model.
      const gunGroups = new Map<string, { count: number; amount: number }>()
      for (const gunId of Object.values(validPlayerGuns).flat()) {
        const group = gunGroups.get(gunModel(gunId)) || { count: 0, amount: 0 }
        gunGroups.set(gunModel(gunId), { count: group.count + 1, amount: group.amount + gunPrice(gunId) })
      }
      for (const [model, group] of gunGroups) {
        equipmentPrice += group.amount
        itemizedBreakdown.push({ label: `${model} rental, picked by players (${group.count})`, amount: group.amount })
      }
      // The included BBs go with a rented gun: package players and players renting a picked gun.
      const withBbs = rentalPlayers + gunRentersNotTakingPackage
      if (withBbs > 0) itemizedBreakdown.push({ label: `BB reloads included (${INCLUDED_RELOADS_PER_PLAYER * withBbs}) — free`, amount: 0 })
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
    if (extraAmmoTotal > 0) {
      equipmentPrice += extraAmmoTotal
      itemizedBreakdown.push({ label: `Extra ammo reloads (${extraAmmoReloads} × ₱${ammoReloadPrice})`, amount: extraAmmoTotal })
    }
    if (layoutFee && layoutFee.price > 0) {
      itemizedBreakdown.push({ label: `Custom field layout (${layoutFee.label}, ${layoutFee.pieces > 0 ? `${layoutFee.pieces} piece${layoutFee.pieces === 1 ? '' : 's'}` : 'uploaded plan'})`, amount: layoutFee.price })
    }

    return {
      fieldPrice,
      equipmentPrice,
      entranceFee,
      serviceFee: 0,
      total: dynamicPricing.total,
      itemizedBreakdown,
    }
  }, [customItemsTotal, customSelectedEquipment, customSelectedWeapons, dynamicPricing, packageEquipment, players, selectedPackage, selectionMode, extraAmmoTotal, extraAmmoReloads, ammoReloadPrice, rentalPlayers, packageSingleItems, rentOnlyCounts, validPlayerGuns, gunRentersNotTakingPackage, weapons, layoutFee])

  // Each player's part of the booking total (every slot), the same way the server splits a payment
  // (server/utils/splitShares.js): in proportion to what each one gets, and a minor's part is paid
  // by their parent or guardian on the team. The parts add up to the total exactly.
  const playerParts = useMemo(() => {
    const roster = [
      { id: String(user?.id || ''), name: user?.name || 'You', isMinor: false, guardianId: undefined as string | undefined, isMe: true },
      ...selectedTeammates.map((member) => ({ id: member.id, name: member.name, isMinor: Boolean(member.isMinor), guardianId: member.guardianId, isMe: false })),
    ].filter((row) => row.id)
    const notTaking = (id: string) => validOwnGearIds.includes(id)
    // What a player gets, for one slot. Without per-player prices (custom picks, a group price) everyone counts the same.
    // Each player's own extra reloads go on their part. Without per-player prices, the rest is
    // shared evenly (as the server does).
    const ammoOf = (id: string) => (validExtraAmmo[id] || 0) * ammoReloadPrice
    const anyAmmo = extraAmmoReloads > 0
    const costOf = (id: string) => {
      if (selectionMode !== 'package' || packageOnePlayerPrice === null) {
        return anyAmmo ? basePricing.total / Math.max(1, players) + ammoOf(id) : 1
      }
      return (notTaking(id) ? ENTRANCE_FEE_PER_PLAYER + singlesCostOf(id) + gunsCostOf(id) : packageOnePlayerPrice + gunsCostOf(id)) + ammoOf(id)
    }
    const baseGetsOf = (id: string) => {
      if (selectionMode !== 'package') return rentMode === 'own_all' ? 'Brings everything' : 'Picked items'
      const guns = (validPlayerGuns[id] || []).map(gunModel)
      if (!notTaking(id)) return guns.length ? `Package + ${guns.join(', ')}` : 'Package'
      const pieces = [...guns, ...(validOwnGearRentals[id] || []).map((piece) => RENT_PIECE_LABEL[piece].toLowerCase())]
      return pieces.length ? `Rents only: ${pieces.join(', ')}` : 'Brings everything'
    }
    const getsOf = (id: string) => {
      const reloads = validExtraAmmo[id] || 0
      return reloads ? `${baseGetsOf(id)} + ${reloads} extra reload${reloads === 1 ? '' : 's'}` : baseGetsOf(id)
    }
    const payerIds = new Set(roster.filter((row) => !row.isMinor).map((row) => row.id))
    const weight = new Map(roster.filter((row) => !row.isMinor).map((row) => [row.id, costOf(row.id)]))
    // A minor's part goes on their parent or guardian on the team (else it's spread over everyone).
    for (const row of roster) {
      if (row.isMinor && row.guardianId && payerIds.has(row.guardianId)) weight.set(row.guardianId, (weight.get(row.guardianId) || 0) + costOf(row.id))
    }
    const sum = [...weight.values()].reduce((a, b) => a + b, 0)
    const parts = new Map<string, number>()
    let given = 0
    const payers = [...weight.keys()]
    payers.forEach((id, index) => {
      const amount = index === payers.length - 1
        ? Math.round((bookingTotal - given) * 100) / 100
        : Math.round(((bookingTotal * (weight.get(id) || 0)) / Math.max(1, sum)) * 100) / 100
      parts.set(id, amount)
      given = Math.round((given + amount) * 100) / 100
    })
    return roster.map((row) => ({
      ...row,
      gets: getsOf(row.id),
      part: row.isMinor ? null : parts.get(row.id) ?? 0,
      paidBy: row.isMinor ? roster.find((other) => other.id === row.guardianId)?.name || null : null,
    }))
    // gunModel / singlesCostOf / gunsCostOf follow the state listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.name, selectedTeammates, validOwnGearIds, validOwnGearRentals, validPlayerGuns, selectionMode, packageOnePlayerPrice, bookingTotal, rentMode, weapons, packageSingleItems, validExtraAmmo, extraAmmoReloads, ammoReloadPrice, basePricing.total, players])

  const reservationSummary = useMemo(() => {
    const selectedFields = availableFields.filter((f) => selectedFieldIds.includes(f.id))
    const pkgName = selectionMode === 'custom'
      ? 'Custom Selection (No Package)'
      : (selectedPackage?.name || 'No package selected')
    return {
      locationLabel: locationOptions.find((loc) => loc.id === selectedLocation)?.name ?? 'Location',
      fields: selectedFields,
      dateISO,
      slotLabel: allDay ? 'Full day (Morning, Afternoon & Evening)' : pickedSlotsLabel,
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
  }, [dateISO, selectedFieldIds, selectedLocation, selectionMode, selectedPackage?.name, sessionType, slot, allDay, pickedSlotsLabel, players, notes, customSelectedWeapons, customSelectedEquipment, ownWeapons, ownEquipment, availableFields])

  const maxTeammates = Math.max(0, players - 1)
  // Booking for yourself only: there is no team to add, so the team step is skipped.
  const soloBooking = maxTeammates === 0
  // Public games are an open roster run by the marshals: no game mode or layout to request.
  const publicGame = sessionType === 'public'
  const visibleSteps = ([1, 2, 3, 4, 5] as BookingStep[]).filter((s) => !(s === 2 && soloBooking) && !(s === 4 && publicGame))
  // The number shown to the player, which shifts down when the team step is hidden.
  const stepNumber = (s: BookingStep) => visibleSteps.indexOf(s) + 1
  useEffect(() => {
    if (soloBooking && step === 2) setStep(3)
    if (publicGame && step === 4) setStep(5)
  }, [soloBooking, publicGame, step])
  const hasCurrentUserWaiver = !user?.id ? false : waiverEligibleSet.has(String(user.id))
  // Only registered players can be booked: every spot besides the captain needs a teammate account.
  const teamSelectionComplete = maxTeammates === 0 || selectedTeammateIds.length === maxTeammates
  const missingTeammates = Math.max(0, maxTeammates - selectedTeammateIds.length)
  const canSplitPayment = players > 1 && selectedTeammateIds.length > 0 && !fullDay
  const splitPartySize = Math.max(1, selectedTeammateIds.length + 1)
  // In a split, each player pays for what they get (playerParts, as the server splits it): the
  // booker's part of the total, and that part as a fraction of it, which the payment page uses to
  // estimate their share of the online amount before the server records the exact shares.
  const myPart = playerParts.find((row) => row.isMe)?.part ?? 0
  const partsTotal = playerParts.reduce((sum, row) => sum + (row.part || 0), 0)
  const myShareFraction = partsTotal > 0 ? myPart / partsTotal : 1
  const payerShareAmount = paymentMode === 'split'
    ? Number((dynamicPricing.total * myShareFraction).toFixed(2))
    : dynamicPricing.total
  // Public games allow one booking per player for each time slot and location (other slots that
  // day stay open). The server enforces it; this shows it on step 1 before the player continues.
  const [myActiveBookings, setMyActiveBookings] = useState<Array<{ id?: string; sessionType?: string; locationId?: string; reservationDate?: string; reservationTime?: string; reservationStatus?: string }>>([])
  useEffect(() => {
    if (!user?.id) return
    let alive = true
    apiGet<{ ok: boolean; data: typeof myActiveBookings }>('/api/reservations?limit=200')
      .then((res) => { if (alive) setMyActiveBookings(Array.isArray(res?.data) ? res.data : []) })
      .catch(() => {})
    return () => { alive = false }
  }, [user?.id])
  const publicSlotClash = publicGame
    ? myActiveBookings.find((booking) => String(booking.sessionType || 'public').toLowerCase() === 'public'
      && booking.locationId === selectedLocation
      && booking.reservationDate === dateISO
      && (bookedSlots as string[]).includes(String(booking.reservationTime || '').toLowerCase())
      && !['cancelled', 'rejected', 'declined', 'expired'].includes(String(booking.reservationStatus || '').toLowerCase())) || null
    : null
  const canSubmitReservation = canProceed && hasCurrentUserWaiver && !publicSlotClash  // true only once we KNOW the user has no waiver (avoids flashing the warning while loading)
  // Step 3 (weapons & gear): what still has to be answered before Continue.
  const step3Block: string | null = players < effectiveMinPlayers
    ? `This needs at least ${effectiveMinPlayers} players.`
    : selectionMode === 'package' && !selectedPackage
      ? 'Pick a package.'
      : rentMode === 'custom' && customWeaponIds.length + customEquipmentIds.length === 0
        ? 'Pick at least one weapon or piece of gear, or choose "Everyone brings their own".'
        : ownAllMissing.length > 0
          ? `${ownAllMissing.join(', ')} can't bring their own.`
          : null

  // The first step with a required answer missing. A later step can't be open before it's done
  // (e.g. a restored booking whose slot was lost): the page goes back to it. Only answers already
  // on the page count, so nothing is sent back while the packages are still loading.
  const firstIncompleteStep: BookingStep | null = !hasRequiredSlotSelection
    ? 1
    : !teamSelectionComplete
      ? 2
      : !loadingPackages && step3Block
        ? 3
        : null
  useEffect(() => {
    if (firstIncompleteStep && step > firstIncompleteStep) {
      setStep(firstIncompleteStep)
      toast.error(firstIncompleteStep === 1 ? 'Pick a time slot first.' : firstIncompleteStep === 2 ? 'Add every teammate first.' : step3Block || 'Finish the weapons & gear step first.')
    }
    // Only when the incomplete step or the open step changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstIncompleteStep, step])

  // Why "Proceed to Payment" is off, shown under the button with the step that fixes it.
  const paymentBlock: { message: string; step: BookingStep } | null = !hasCurrentUserWaiver
    ? { message: 'Your waiver must be approved before you can book.', step: 1 }
    : !hasRequiredSlotSelection
      ? { message: 'Pick a time slot.', step: 1 }
      : pickedSlotStarted
        ? { message: 'This time slot has already started. Pick another slot or date.', step: 1 }
        : pickedSlotFull
          ? { message: 'This time slot is full. Pick another slot or date.', step: 1 }
          : !meetsFieldRequirements
            ? { message: `The chosen fields don't fit ${players} players. Change the fields.`, step: 1 }
            : publicSlotClash
              ? { message: `You already have a booking (${publicSlotClash.id}) in this public game. Cancel it on My Reservations, or pick another slot.`, step: 1 }
              : null
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
    // Public games are never locked: anyone can keep booking while spots remain, and the
    // server checks the remaining spots when the reservation is created. Drop any hold left
    // from a private slot picked earlier.
    if (slotHoldPayload.sessionType === 'public') {
      if (hasSlotHoldRef.current) apiDelete('/api/slot-holds/mine').catch(() => null)
      setSlotHoldExpiresAt(null)
      return true
    }
    try {
      const res = await apiPost<{ ok: boolean; data: { expiresAtISO: string } }>('/api/slot-holds', slotHoldPayload)
      setSlotHoldExpiresAt(res.data.expiresAtISO)
      return true
    } catch (e: any) {
      setSlotHoldExpiresAt(null)
      setSlotError(e?.message || 'That slot was just taken. Please choose another one.')
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

  // Private games: hold the picked field while the player is still on step 1, so others see it
  // as being booked straight away. It is a short hold, renewed only while this tab is open.
  const [browsingHoldError, setBrowsingHoldError] = useState<string | null>(null)
  const browsingHoldKey = JSON.stringify(slotHoldPayload)
  const canHoldWhileBrowsing = step === 1 && sessionType === 'private' && canProceed && hasCurrentUserWaiver && !!user?.id
  const placeBrowsingHold = useCallback(async () => {
    try {
      const res = await apiPost<{ ok: boolean; data: { expiresAtISO: string } }>('/api/slot-holds', { ...slotHoldPayload, browsing: true })
      setSlotHoldExpiresAt(res.data.expiresAtISO)
      setBrowsingHoldError(null)
    } catch (e: any) {
      setSlotHoldExpiresAt(null)
      setBrowsingHoldError(e?.message || 'That field was just taken. Please choose another one.')
      fetchReservations(true)
    }
  }, [slotHoldPayload, fetchReservations])

  useEffect(() => {
    if (step !== 1) return
    if (!canHoldWhileBrowsing) {
      setBrowsingHoldError(null)
      // The choice is no longer a bookable private slot: let the field go.
      if (hasSlotHoldRef.current) {
        apiDelete('/api/slot-holds/mine').catch(() => null)
        setSlotHoldExpiresAt(null)
      }
      return
    }
    // Wait for the player to settle on a choice before holding it.
    const timer = window.setTimeout(() => { void placeBrowsingHold() }, 500)
    return () => window.clearTimeout(timer)
    // browsingHoldKey stands for the slot, field and headcount being held.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, canHoldWhileBrowsing, browsingHoldKey])

  useEffect(() => {
    if (!canHoldWhileBrowsing || !slotHoldExpiresAt) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void placeBrowsingHold()
    }, BROWSING_HOLD_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [canHoldWhileBrowsing, slotHoldExpiresAt, placeBrowsingHold])

  useEffect(() => {
    setTeamError(null)
    setBlueprintError(null)
    setConfirmError(null)
  }, [step])
  useEffect(() => { setSlotError(null) }, [dateISO, slot, fullDay, selectedLocation])

  const goToStep2 = async () => {
    setPlacingHold(true)
    setSlotError(null)
    const held = await placeSlotHold()
    setPlacingHold(false)
    if (held) setStep(soloBooking ? 3 : 2)
  }

  // Once the slot is held, every choice is saved as a draft so a player who leaves can come back
  // to it within a minute (see utils/bookingDraft).
  const draftLabel = `${dateISO} • ${pickedSlotsLabel} • ${locationOptions.find((l) => l.id === selectedLocation)?.name || selectedLocation}`
  useEffect(() => {
    if (!user?.id || step === 1) return
    saveBookingDraft(user.id, {
      path: '/app/reservations',
      label: draftLabel,
      state: {
        step, selectedLocation, selectedFieldIds, dateISO, slot, selectedSlots, pickedSlots, players, notes, teamName, gameModePreference,
        layoutRequest, layoutBlueprintUrl, selectedPackageId, selectionMode, customWeaponIds, customEquipmentIds,
        ownWeapons, ownEquipment, captainOwnGun, ownWeaponTarget, teammateOwnWeaponIds,
        ownGearIds, ownGearRentals, playerGuns, rentMode, selectedTeammates, paymentMode, paymentPlan, extraAmmoByPlayer, fieldLayoutItems, budgetInput,
      },
    })
  }, [
    user?.id, step, draftLabel, selectedLocation, selectedFieldIds, dateISO, slot, selectedSlots, pickedSlots, players, notes, teamName,
    gameModePreference, layoutRequest, layoutBlueprintUrl, selectedPackageId, selectionMode, customWeaponIds,
    customEquipmentIds, ownWeapons, ownEquipment, captainOwnGun, ownWeaponTarget,
    teammateOwnWeaponIds, ownGearIds, ownGearRentals, playerGuns, rentMode, selectedTeammates, paymentMode, paymentPlan, extraAmmoByPlayer, fieldLayoutItems, budgetInput,
  ])

  // Coming back to a draft: hold the slot again (it may have been taken in the meantime).
  useEffect(() => {
    if (!restoredDraft) return
    toast.success('Welcome back. Your booking was restored.')
    if (step > 1) void placeSlotHold(true)
    // Runs once, for the draft found when the page opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Leaving the page (another page, a refresh, or closing the tab) keeps the slot for one more
  // minute instead of freeing it at once, so the player can still come back.
  const proceedingToPaymentRef = useRef(false)
  const hasSlotHoldRef = useRef(false)
  hasSlotHoldRef.current = !!slotHoldExpiresAt
  useEffect(() => {
    cancelBookingDraftLeft()
    const leaving = () => hasSlotHoldRef.current && !proceedingToPaymentRef.current
    const onPageHide = () => { if (leaving()) markBookingDraftLeft(user?.id) }
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      if (leaving()) scheduleBookingDraftLeft(user?.id)
    }
  }, [user?.id])

  const formatCurrency = (value: number | string | null | undefined) => {
    const numeric = Number(value ?? 0)
    if (!Number.isFinite(numeric)) return '₱0'
    const amount = Math.abs(numeric).toLocaleString()
    return numeric < 0 ? `−₱${amount}` : `₱${amount}`
  }

  const StepHeader = ({ title, subtitle }: { title: string; subtitle: string }) => (
    <div>
      <div className="text-sm font-medium text-accent">Book a game</div>
      <h1 className="mt-3 text-3xl font-bold">{title}</h1>
      <p className="mt-1 text-sm text-muted">{subtitle}</p>
    </div>
  )

  const handleConfirm = async () => {
    setConfirmError(null)
    if (!user?.id) {
      setConfirmError('Please login to continue.')
      return
    }

    if (!hasCurrentUserWaiver) {
      setConfirmError('Your waiver must be approved before you can make a reservation.')
      return
    }

    if (!hasRequiredSlotSelection) {
      setConfirmError('Please select a time slot before proceeding.')
      return
    }

    if (sessionType === 'private' && !meetsFieldRequirements) {
      setConfirmError('The selected field combination is not valid for the current group size.')
      return
    }

    if (isWd) {
      const isAvailable = selectedFieldIds.every(fieldId =>
        isFieldSlotAvailable(fieldId, slot)
      )
      if (!isAvailable) {
        setConfirmError('One or more selected fields are no longer available for this time slot.')
        return
      }
    }

    if (pickedSlotFull) {
      setConfirmError('This slot is full. Please pick another time or date.')
      return
    }

    if (!canProceed || players < effectiveMinPlayers) {
      setConfirmError('Invalid reservation details. Please check your selections.')
      return
    }

    if (selectionMode === 'package' && !selectedPackage) {
      setConfirmError('Please select a package.')
      return
    }

    if (selectedTeammateIds.length > maxTeammates) {
      setConfirmError(`You can add at most ${maxTeammates} teammate${maxTeammates === 1 ? '' : 's'} for ${players} players.`)
      return
    }
    if (!teamSelectionComplete) {
      setConfirmError(`Add ${missingTeammates} more registered teammate${missingTeammates === 1 ? '' : 's'}. Every player needs an account.`)
      return
    }

    // Every selected teammate must have a waiver too
    const teammateWithoutWaiver = selectedTeammates.find((member) => !member.waiverSubmitted)
    if (teammateWithoutWaiver) {
      setConfirmError(`${teammateWithoutWaiver.name}'s waiver isn't approved yet.`)
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
        ...(fullDay ? { fullDay: true, fullDaySlots: pickedSlots } : {}),
        sessionType,
        numberOfPlayers: players,
        totalAmount: dynamicPricing.total,
        fieldPrice,
        equipmentPrice,
        entranceFee,
        serviceFee,
        itemizedBreakdown,
        notes,
        teamName: teamName.trim(),
        gameModePreference: publicGame ? GAME_MODES[0] : gameModePreference,
        layoutRequest: publicGame ? '' : layoutRequest.trim(),
        ...(layoutBlueprintUrl && !publicGame ? { layoutBlueprintUrl } : {}),
        // The pieces placed in the designer: the server checks them against the field and prices the layout.
        ...(layoutBlueprintUrl && !publicGame && fieldLayoutItems.length ? { fieldLayoutItems } : {}),
        ...(extraAmmoReloads > 0 ? { extraAmmoReloads, extraAmmoByPlayer: validExtraAmmo } : {}),
        reservationStatus: 'pending',
        packageName: pkgName,
        selectionMode,
        teamMembers: selectedTeammates.map((member) => ({
          id: member.id,
          name: member.name,
          email: member.email,
          ...(member.isMinor ? { isMinor: true } : {}),
        })),
        selectedTeammateIds,
        paymentMode,
        paymentPlan,
        teamSize: paymentMode === 'split' ? splitPartySize : 1,
        payerShareAmount,
        // The booker's part of a split, by what each player gets (the payment page's estimate).
        myShareFraction,
        ownWeaponTarget: ownWeaponsAllowed ? ownWeaponTarget : 0,
        ownWeaponBringerIds: ownWeaponsAllowed
          ? [...(captainBringsOwnWeapon ? [user.id] : []), ...teammateOwnWeaponIds.filter((id) => !validOwnGearIds.includes(id))]
          : [],
        // Players bringing their own gun and gear: entrance fee only (checked again by the server).
        ownGearPlayerIds: validOwnGearIds,
        // Of them, the single pieces each one rents (gun, mask, vest).
        ownGearRentals: validOwnGearRentals,
        // Rental guns players picked (instead of the package's gun, or on top of it).
        playerGuns: validPlayerGuns,
        // 'own_all': everyone brings their own gun and gear (the server checks each has an approved gun).
        rentMode,
      }

      if (selectionMode === 'package') {
        pendingReservation.selectedPackageId = selectedPackage?.id
        pendingReservation.selectedGameplayName = selectedPackage?.name
      } else {
        pendingReservation.customWeaponIds = customWeaponIds
        pendingReservation.customEquipmentIds = customEquipmentIds
        pendingReservation.ownWeapons = ownWeapons.trim()
        pendingReservation.ownEquipment = ownEquipment.trim()
        pendingReservation.selectedGameplayName = 'Custom Selection'
      }

      localStorage.setItem('pending_reservation', JSON.stringify(pendingReservation))
      // A reservation id left over from an earlier, unfinished payment belongs to
      // different booking details; drop it so the payment page creates this one.
      localStorage.removeItem('pending_reservation_id')
      localStorage.removeItem('pending_reservation_ids')

      // Flag to refresh reservations when user returns
      localStorage.setItem('refresh_reservations', 'true')

      proceedingToPaymentRef.current = true
      // From here the unfinished booking continues on the payment page. Its choices are kept, so
      // "Back" on the payment page returns to this review step with everything filled in.
      saveBookingDraft(user?.id, { path: '/app/payment', label: draftLabel, state: { ...(readBookingDraft(user?.id)?.state || {}), step: 5 } })
      toast.success('Proceed to payment to complete your reservation.')
      navigate('/app/payment')
    } catch (e: any) {
      setConfirmError(e instanceof Error ? e.message : 'Failed to process reservation')
    } finally {
      setIsConfirming(false)
    }
  }

  const getStepTitle = () => {
    switch (step) {
      case 1: return 'Choose Date, Time & Field'
      case 2: return 'Add Your Team'
      case 3: return 'Select Package & Gear'
      case 4: return 'Game Setup'
      default: return 'Review & Pay'
    }
  }

  // Gate: hide the step indicator and every step until the user has answered the waiver
  if (!hasCurrentUserWaiver) {
    return (
      <div className="space-y-4">
        <StepHeader
          title="Book a game"
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

  // What the booking includes, line by line, with the total and per-player price. Shown on the
  // gear step and again in the Briefing panel, so the price is in front of the player at both.
  const renderWhatYouGet = () => (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="text-sm font-bold">What you're getting</div>
      {/* The same lines the receipt shows, so the player sees what they availed. */}
      {paymentBreakdown.itemizedBreakdown.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs">
          {paymentBreakdown.itemizedBreakdown.map((item, index) => (
            <li key={`${item.label}-${index}`} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 text-muted">{item.label}</span>
              <span className={`shrink-0 font-semibold ${item.amount < 0 ? 'text-success' : item.amount === 0 ? 'text-muted' : ''}`}>
                {item.amount === 0 ? 'Free' : formatCurrency(item.amount)}
              </span>
            </li>
          ))}
          {fullDay ? (
            <>
              {/* The lines above are one slot for the whole group; a full day books three. */}
              <li className="flex items-baseline justify-between gap-3 border-t border-white/10 pt-1">
                <span className="text-muted">One slot, whole group</span>
                <span className="shrink-0 font-semibold">{formatCurrency(dynamicPricing.total)}</span>
              </li>
              <li className="flex items-baseline justify-between gap-3">
                <span className="text-muted">{allDay ? 'Full day: morning, afternoon & evening' : pickedSlotsLabel}</span>
                <span className="shrink-0 font-semibold">× {bookedSlots.length} slots</span>
              </li>
            </>
          ) : null}
        </ul>
      ) : (
        <div className="mt-1 text-xs text-muted">Pick a package or items to see what's included.</div>
      )}
      <div className="mt-3 flex items-end justify-between border-t border-white/10 pt-3">
        <div>
          <div className="text-xs text-muted">Total{players > 1 ? `, all ${players} players` : ''}</div>
          <div className="text-2xl font-bold text-gold">{formatCurrency(bookingTotal)}</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted">Per player</div>
          <div className="text-sm font-bold">{formatCurrency(Math.round(bookingTotal / Math.max(1, players)))}</div>
          {fullDay ? (
            <div className="text-[11px] text-muted">
              {formatCurrency(Math.round(dynamicPricing.total / Math.max(1, players)))} × {bookedSlots.length} slots
            </div>
          ) : null}
        </div>
      </div>

      {selectionMode === 'package' && dynamicPricing.discountAmount > 0 && (
        <div className="mt-2 text-xs text-muted">
          Discount applied: {dynamicPricing.discountSummary}
          {dynamicPricing.savings > 0 && ` (save ${formatCurrency(dynamicPricing.savings)})`}
        </div>
      )}
    </div>
  )

  return (
    <div className="space-y-4">
      <StepHeader
        title={getStepTitle()}
        subtitle="Pick a date, time, and field; slots that are taken can't be chosen."
      />

      {packagePrefill?.selectedPackageId && selectionMode === 'package' && selectedPackageId === packagePrefill.selectedPackageId ? (
        <div className="flex items-start gap-3 rounded-2xl border border-accent/25 bg-accent/10 px-4 py-3 text-sm">
          <FiPackage className="mt-0.5 h-4 w-4 flex-shrink-0 text-gold" />
          <div>
            <div className="font-bold">Package from your recommendation: {selectedPackage?.name || packagePrefill.selectedPackageName}</div>
            <div className="mt-0.5 text-xs text-muted">
              {packagePrefill.players ? `${packagePrefill.players} players` : ''}
              {' '}· You can still change it in step {stepNumber(3)}.
            </div>
          </div>
        </div>
      ) : null}

      {slotHoldExpiresAt && step > 1 ? (
        <div className="flex items-center gap-2 rounded-2xl border border-success/25 bg-success/10 px-4 py-2 text-xs text-success">
          <FiClock className="h-4 w-4 flex-shrink-0" />
          <span>
            {fullDay ? `Your ${pickedSlotsLabel.toLowerCase()}` : slotLabels[slot]} on {dateISO} is locked for you while you finish booking. It's released if you leave without paying.
          </span>
        </div>
      ) : null}

      <div className={[STEP_BAR_CLASS, ({ 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5' } as Record<number, string>)[visibleSteps.length]].join(' ')}>
        {visibleSteps.map((s) => {
          const active = s === step
          const done = s < step
          const labels = STEP_LABELS

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
                  <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">Step {stepNumber(s)}</div>
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
                <FiCalendar /> <span>Date & Time</span>
              </div>
              <p className="mt-1 text-xs text-muted">
                {isWd
                  ? 'Weekdays: Private sessions only. Fields can be shared until the time slot is full. Minimum players: 10 for 1 field, 20 for 2, 50 for all 3.'
                  : 'Weekends: Public sessions only. Multiple time slots available.'}
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Date</div>
                    {/* One month at a time, up to a year ahead. */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label="Earlier months"
                        disabled={monthOffset === 0}
                        onClick={() => setMonthOffset((o) => Math.max(0, o - 1))}
                        className="grid h-7 w-7 place-items-center rounded-lg border border-white/10 text-muted transition hover:text-text disabled:opacity-30"
                      >
                        <FiChevronLeft className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Later months"
                        disabled={monthOffset >= maxMonthOffset}
                        onClick={() => setMonthOffset((o) => Math.min(maxMonthOffset, o + 1))}
                        className="grid h-7 w-7 place-items-center rounded-lg border border-white/10 text-muted transition hover:text-text disabled:opacity-30"
                      >
                        <FiChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-1 text-[11px] text-muted">Book up to 1 year ahead (until {new Date(`${lastBookableISO}T12:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}).</div>
                  <div className="mt-2">
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
                                // Today stays open while it still has a slot that hasn't started.
                                const isPastOrToday = iso < todayDateISO || (iso === todayDateISO && timeSlots.every((ts) => slotHasStarted(slotHours, ts, iso)))
                                const isWd = isWeekday(iso)
                                const closedDay = closedDays[iso]
                                const cause = closedDay ? undefined : causeDays[iso]
                                // Beyond the one-year booking window.
                                const tooFar = iso > lastBookableISO
                                const unavailable = isPastOrToday || tooFar || Boolean(closedDay)

                                return (
                                  <button
                                    key={iso}
                                    type="button"
                                    title={closedDay ? closedDayMessage(closedDay) : cause ? causeDayMessage(cause) : undefined}
                                    aria-label={closedDay ? `${iso}: ${closedDayMessage(closedDay)}` : cause ? `${iso}: ${causeDayMessage(cause)}` : undefined}
                                    disabled={unavailable}
                                    onClick={() => {
                                      if (unavailable) return
                                      setDateISO(iso)
                                    }}
                                    className={[
                                      'group relative h-12 rounded-xl border px-1 text-center text-[11px] transition',
                                      active ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25' : closedDay ? 'border-dashed border-white/15 bg-white/[0.03]' : cause ? 'border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/15' : 'border-white/10 bg-white/5 hover:bg-white/8',
                                      unavailable ? 'cursor-not-allowed opacity-40 hover:bg-white/5' : 'cursor-pointer',
                                    ].join(' ')}
                                  >
                                    <div className="font-bold leading-tight">{d.getDate()}</div>
                                    <div className="text-[9px] leading-tight text-muted/70">{closedDay ? 'NO GAME' : isWd ? 'PRIV' : 'PUB'}</div>
                                    {cause ? (
                                      <>
                                        <FiHeart className="absolute right-1 top-1 h-2.5 w-2.5 text-rose-500" aria-hidden="true" />
                                        {/* Hover message, above the date (below it on the first row so it isn't cut off). */}
                                        <span
                                          role="tooltip"
                                          className={`pointer-events-none absolute ${weekIndex === 0 ? 'top-full mt-1' : 'bottom-full mb-1'} left-1/2 z-20 hidden w-44 -translate-x-1/2 rounded-lg border border-rose-500/30 bg-background px-2 py-1.5 text-left text-[10px] font-semibold normal-case leading-snug text-text shadow-soft group-hover:block group-focus-visible:block`}
                                        >
                                          <span className="flex items-center gap-1 text-rose-500"><FiHeart /> Game for a cause</span>
                                          <span className="mt-0.5 block">{cause.title}</span>
                                        </span>
                                      </>
                                    ) : null}
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
                  <div className="mt-1 text-xs text-muted">Pick one or more; each slot is its own game, paid together.</div>
                  <div className="mt-2 grid grid-cols-1 gap-2" role="group" aria-label="Time window">
                    {loadingReservations ? (
                      <div className="py-4 text-center text-sm text-muted">Loading slots...</div>
                    ) : (
                      [...timeSlots].sort(slotSort).map((s) => {
                        const started = slotHasStarted(slotHours, s, dateISO)
                        const isSlotFull = isSlotFullyBooked(s)
                        const slotFields = getAvailableFieldsForSlot(s)
                        const unavailableFields = isWd
                          ? getFieldsForLocation(selectedLocation).filter((f) => !slotFields.some((open) => open.id === f.id))
                          : []
                        const singlePicked = isWd ? slotTouched : selectedSlots.length > 0
                        const active = fullDay ? pickedSlots.includes(s) : singlePicked && s === slot

                        const handleSlotClick = () => {
                          // Unticking a picked slot never needs a check.
                          if (active) {
                            setSlotError(null)
                            applyPickedSlots(bookedSlots.filter((x) => x !== s))
                            return
                          }
                          if (started) {
                            setSlotError(`Today's ${slotLabels[s]} slot has already started. Pick a later slot or another day.`)
                            return
                          }
                          if (isSlotFull) {
                            const blocked = getSlotBlockReason(s)
                            setSlotError(blocked
                              ? `${slotLabels[s]}: ${slotBlockLabels[blocked].toLowerCase()}. Pick another slot or day.`
                              : `All fields are booked for ${slotLabels[s]}. Pick another slot or day.`)
                            return
                          }
                          // Ticking adds it to the slots already picked.
                          applyPickedSlots([...(singlePicked || fullDay ? bookedSlots : []), s])
                        }

                        return (
                          <button
                            key={s}
                            type="button"
                            role="checkbox"
                            aria-checked={active}
                            onClick={handleSlotClick}
                            disabled={isSlotFull || started}
                            className={[
                              'rounded-2xl border p-3 text-left transition',
                              active ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25' : 'border-white/10 bg-white/5 hover:bg-white/8',
                              isSlotFull || started ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                            ].join(' ')}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span
                                aria-hidden
                                className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 ${active ? 'border-accent bg-accent text-background' : 'border-[rgba(var(--text),0.3)]'}`}
                              >
                                {active ? <FiCheck className="h-3.5 w-3.5" /> : null}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-bold">{slotLabels[s]} <span className="text-xs font-semibold text-muted">{formatSlotRange(slotHours, s)}</span></div>
                                {/* Only what's not available is listed; nothing when every field is open. */}
                                {started || isSlotFull || unavailableFields.length > 0 ? (
                                  <div className="mt-1 text-xs flex items-center gap-2 text-danger">
                                    <FiClock />
                                    <span>{started ? 'Already started today' : isSlotFull ? (getSlotBlockReason(s) ? slotBlockLabels[getSlotBlockReason(s)!] : 'Fully booked') : `Unavailable: ${unavailableFields.map((f) => f.name).join(', ')}`}</span>
                                  </div>
                                ) : null}
                              </div>
                              {started ? (
                                <div className="rounded-2xl px-3 py-1 text-xs font-bold bg-[rgba(var(--text),0.08)] text-muted">STARTED</div>
                              ) : isSlotFull ? (
                                <div className="rounded-2xl px-3 py-1 text-xs font-bold bg-danger/15 text-danger">{getSlotBlockReason(s) === 'being_booked' ? 'ON HOLD' : getSlotBlockReason(s) ? 'BOOKED' : 'FULL'}</div>
                              ) : (
                                <div className="rounded-2xl px-3 py-1 text-xs font-bold bg-success/15 text-success">AVAILABLE</div>
                              )}
                            </div>
                          </button>
                        )
                      })
                    )}
                    {!loadingReservations ? (() => {
                      // Full day: all three slots, priced and booked as three slots, paid at one checkout.
                      const fullDayStarted = slotHasStarted(slotHours, 'morning', dateISO)
                      const fullSlot = timeSlots.find((s) => isSlotFullyBooked(s))
                      const dayStart = formatSlotRange(slotHours, 'morning').split(/\s[–-]\s/)[0]
                      const dayEnd = formatSlotRange(slotHours, 'evening').split(/\s[–-]\s/).pop()
                      return (
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={allDay}
                          disabled={Boolean(fullSlot) || fullDayStarted}
                          onClick={() => {
                            // A shortcut: ticks all three slots, or unticks them all.
                            if (allDay) {
                              applyPickedSlots([])
                              return
                            }
                            if (fullDayStarted) {
                              setSlotError("Today's morning slot has already started, so a full day isn't available.")
                              return
                            }
                            if (fullSlot) {
                              setSlotError(`${slotLabels[fullSlot]} is fully booked, so a full day isn't available.`)
                              return
                            }
                            applyPickedSlots([...timeSlots])
                          }}
                          className={[
                            'rounded-2xl border p-3 text-left transition',
                            allDay ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25' : 'border-white/10 bg-white/5 hover:bg-white/8',
                            fullSlot || fullDayStarted ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                          ].join(' ')}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span aria-hidden className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 ${allDay ? 'border-accent bg-accent text-background' : 'border-[rgba(var(--text),0.3)]'}`}>
                              {allDay ? <FiCheck className="h-3.5 w-3.5" /> : null}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-bold">Full day <span className="text-xs font-semibold text-muted">{dayStart} – {dayEnd}</span></div>
                              {fullDayStarted ? (
                                <div className="mt-1 text-xs text-danger">Today's morning slot has already started</div>
                              ) : fullSlot ? (
                                <div className="mt-1 text-xs text-danger">{slotLabels[fullSlot]} is fully booked</div>
                              ) : null}
                            </div>
                            {fullSlot ? (
                              <div className="rounded-2xl px-3 py-1 text-xs font-bold bg-danger/15 text-danger">FULL</div>
                            ) : (
                              <div className="rounded-2xl px-3 py-1 text-xs font-bold bg-success/15 text-success">AVAILABLE</div>
                            )}
                          </div>
                        </button>
                      )
                    })() : null}
                  </div>
                  {!hasRequiredSlotSelection && (
                    <div className="mt-3 text-xs text-danger">
                      Please select a time slot to continue.
                    </div>
                  )}
                  {isWd && (
                    <div className="mt-3 text-xs text-muted/60">
                      Fields can be shared by several groups until the time slot is full
                    </div>
                  )}
                </div>
              </div>
            </Card>

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

            {/* Public games share the slot: the server opens grounds from the slot's total headcount, so there is no field to pick. */}
            {publicGame && (
            <Card className="p-4 md:p-6">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiMapPin /> <span>Field</span>
              </div>
              <div className="mt-3 flex items-start gap-3 rounded-2xl border border-accent/40 bg-accent/10 p-3 ring-2 ring-accent/25">
                <span aria-hidden className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-accent bg-accent text-white">
                  <FiCheck className="h-3 w-3" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold">Assigned automatically</div>
                  <div className="mt-1 text-xs text-muted">{availableFields.map((f) => f.name).join(' · ')}</div>
                  {/* No player counts here: players only see availability, never how many are booked. */}
                  <div className="mt-1 text-xs text-muted">
                    Assigned automatically. More grounds open as more players book this slot. The marshals place players on arrival.
                  </div>
                </div>
              </div>
            </Card>
            )}
            {!publicGame && (
            <Card className="p-4 md:p-6">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiMapPin /> <span>Field</span>
              </div>
              <p className="mt-1 text-xs text-muted">Assigned automatically from your group size. Change the number of players to change your fields.</p>

              {loadingReservations ? (
                <div className="mt-4 text-sm text-muted">Loading availability...</div>
              ) : (
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {FIELD_CHOICES.map((choice) => {
                    const names = availableFields.slice(0, choice.count).map((f) => f.name)
                    const active = selectedFieldIds.length === choice.count
                    const bookedField = isWd ? availableFields.slice(0, choice.count).find((f) => !isFieldSlotAvailable(f.id, slot)) : undefined
                    const beingBooked = Boolean(bookedField && isFieldBeingBooked(bookedField.id, slot))

                    return (
                      <div
                        key={choice.count}
                        aria-current={active ? 'true' : undefined}
                        className={[
                          'flex items-start gap-3 rounded-2xl border p-3 text-left transition',
                          active ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25' : 'border-white/10 bg-white/5 opacity-60',
                          bookedField && !active ? 'bg-danger/5 border-danger/20' : '',
                        ].join(' ')}
                      >
                        <span aria-hidden className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${active ? 'border-accent bg-accent text-white' : 'border-[rgba(var(--text),0.3)]'}`}>
                          {active ? <FiCheck className="h-3 w-3" /> : null}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-bold">{choice.label}</div>
                            <div className="shrink-0 rounded-full bg-[rgba(var(--text),0.08)] px-2 py-0.5 text-[10px] font-semibold text-muted">{fieldCountMinimum(choice.count)}+ players</div>
                          </div>
                          <div className="mt-1 text-xs text-muted">{names.join(' · ')}</div>
                          {active ? <div className="mt-1 text-xs font-semibold text-accent">Your fields</div> : null}
                          {bookedField && !active ? (
                            <div className={`mt-1 text-xs ${beingBooked ? 'text-amber-600 dark:text-amber-400' : 'text-danger'}`}>
                              {beingBooked ? `${bookedField.name} is being booked right now` : `${bookedField.name} is already reserved for this slot`}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {sessionType === 'private' && !loadingReservations && selectedFieldIds.length === 0 ? (
                <div className="mt-3 text-xs font-semibold text-danger">Upper Ground is already booked for this slot. Pick another time slot or date.</div>
              ) : sessionType === 'private' && !loadingReservations && selectedFieldIds.length < wantedFieldCount ? (
                <div className="mt-3 text-xs font-semibold text-amber-600 dark:text-amber-400">
                  Your group would normally get {FIELD_CHOICES[wantedFieldCount - 1].label}, but some of those fields are already booked for this slot. You get {FIELD_CHOICES[selectedFieldIds.length - 1].label} instead.
                </div>
              ) : null}

              {sessionType === 'private' && (
                <div className="mt-4 rounded-2xl border border-accent/20 bg-accent/5 p-4">
                  <div className="text-xs font-bold text-accent">Field Requirements</div>
                  <div className="mt-2 space-y-1 text-xs text-muted">
                    {[1, 2, 3].map((count) => {
                      const current = selectedFieldIds.length === count
                      return (
                        <div key={count} className={current ? 'font-semibold text-accent' : ''}>
                          • {fieldCountMinimum(count)}{count < 3 ? `–${fieldCountMinimum(count + 1) - 1}` : '+'} players: {FIELD_CHOICES[count - 1].label}{current ? ' (your group)' : ''}
                        </div>
                      )
                    })}
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
            )}
          </div>

          <div className={SIDE_PANEL_CLASS}>
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
                      <div className="text-xs text-muted">This slot</div>
                      <div className={`rounded-xl px-3 py-1 text-xs font-bold ${pickedSlotFull ? 'bg-danger/15 text-danger' : 'bg-success/15 text-success'}`}>
                        {pickedSlotFull ? 'FULL' : 'AVAILABLE'}
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
                              : pickedSlotFull
                                ? 'This slot is full. Pick another time or date.'
                                : 'Cannot proceed.'
                            }
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {publicSlotClash ? (
                <div className="mt-4 rounded-2xl border border-danger/25 bg-danger/10 p-3 text-xs font-semibold text-danger">
                  You already booked this public game ({publicSlotClash.id}). Only one booking per player is allowed for each time slot and location. Pick another time slot or location.
                </div>
              ) : null}

              <InlineError className="mt-4" message={slotError} />
              {sessionType === 'private' && browsingHoldError ? (
                <div className="mt-4 rounded-2xl border border-danger/25 bg-danger/10 p-3 text-xs font-semibold text-danger">
                  {browsingHoldError}
                </div>
              ) : sessionType === 'private' && canHoldWhileBrowsing && slotHoldExpiresAt ? (
                <div className="mt-4 flex items-center gap-2 rounded-2xl border border-success/25 bg-success/10 p-3 text-xs font-semibold text-success">
                  <FiCheck /> This field and time are held for you while you finish booking. Other players see it as being booked.
                </div>
              ) : null}

              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Button variant="primary" disabled={!canProceed || !hasCurrentUserWaiver || placingHold || Boolean(publicSlotClash) || (sessionType === 'private' && Boolean(browsingHoldError))} onClick={goToStep2}>
                  {placingHold ? 'Locking slot…' : 'Continue'} <FiChevronRight />
                </Button>
                <Button variant="ghost" onClick={() => {
                  const newDateISO = toISODate(addDays(today, 1))
                  const newIsWeekend = isWeekend(newDateISO)
                  const newDefault = newIsWeekend ? 1 : 10
                  setSelectedFieldIds(fieldChoiceIds(selectedLocation, 1))
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

      {/* Step 2 - Team */}
      {step === 2 && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            <Card className="p-4 md:p-6">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiUsers /> <span>Select Your Teammates</span>
              </div>
              <p className="mt-1 text-xs text-muted">
                Add the {maxTeammates} registered player{maxTeammates === 1 ? '' : 's'} joining this reservation. Find each one by name or by the email on their account. You are already counted. Every player needs an account with an approved waiver.
              </p>

              <div className="mt-4 space-y-4">
                <Input
                  label="Team name (optional)"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value.slice(0, 60))}
                  placeholder="e.g., Bravo Squad"
                  maxLength={60}
                />

                <form
                  className="flex flex-col gap-2 sm:flex-row sm:items-end"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void findTeammate()
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <Input
                      label="Teammate name or email"
                      value={teamEmail}
                      onChange={(e) => {
                        setTeamEmail(e.target.value)
                        if (teamLookup.status !== 'idle') setTeamLookup({ status: 'idle' })
                      }}
                      placeholder="e.g., Juan Dela Cruz or teammate@gmail.com"
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

                {teamChildren.length > 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <div className="text-sm font-semibold">A minor will join this game</div>
                    <div className="mt-1 text-xs text-muted">
                      Children on your account or your teammates' accounts. Each one takes a player spot and pays the entrance fee.
                    </div>
                    <select
                      value=""
                      onChange={(event) => { if (event.target.value) addMinor(event.target.value) }}
                      disabled={!hasCurrentUserWaiver}
                      className="mt-2 w-full rounded-xl border border-white/10 bg-background px-3 py-2 text-sm text-text [&>option]:bg-background"
                      aria-label="Add a minor to the team"
                    >
                      <option value="">Choose a child to add…</option>
                      {teamChildren.filter((child) => !selectedTeammateIds.includes(child.id)).map((child) => (
                        <option key={child.id} value={child.id} disabled={!child.canPlay}>
                          {child.name} (age {child.age ?? '—'}, {child.guardianId === user?.id ? 'your child' : `${child.guardianName || 'a teammate'}'s child`}){child.canPlay ? '' : ' · waiver not approved yet'}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                <InlineError message={teamError} />
                {teamLookup.status === 'error' && (
                  <div className="rounded-2xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{teamLookup.error}</div>
                )}

                {teamLookup.status === 'found' && teamLookup.members?.map((member) => {
                  const alreadyAdded = selectedTeammateIds.includes(member.id)
                  return (
                    <div key={member.id} className="flex flex-col gap-3 rounded-2xl border border-accent/30 bg-accent/5 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-bold">{member.name}</span>
                          {member.waiverSubmitted ? <span className="shrink-0 rounded-full border border-success/30 bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">Verified</span> : null}
                        </div>
                        <div className="truncate text-xs text-muted">{member.email}</div>
                        {!member.waiverSubmitted && (
                          <div className="mt-1 text-xs font-semibold text-amber-600 dark:text-amber-400">ID verified, but they haven't signed their waiver yet. They can be added once they do.</div>
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
                })}

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
                    <span>{sessionType === 'private' ? 'Your team' : 'Players on this booking'}</span>
                    <span>{selectedTeammates.length}/{maxTeammates} {sessionType === 'private' ? 'teammates' : 'players'}</span>
                  </div>

                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/10 p-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold">{user?.name || 'You'}</div>
                        <div className="truncate text-xs text-muted">{user?.email}</div>
                      </div>
                      <span className="text-[10px] uppercase tracking-[0.18em] text-gold">{bookingRoles(sessionType).booker}</span>
                    </div>

                    {selectedTeammates.map((member) => {
                      return (
                        <div key={member.id} className="flex items-start justify-between gap-3 rounded-2xl border border-accent/30 bg-accent/10 p-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-bold">{member.name}</div>
                            <div className="truncate text-xs text-muted">{member.email}</div>
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

                {maxTeammates > 0 && missingTeammates > 0 && (
                  <div className="rounded-2xl border border-warning/25 bg-warning/10 p-3 text-xs text-warning">
                    Add {missingTeammates} more teammate{missingTeammates === 1 ? '' : 's'} to continue.
                  </div>
                )}

              </div>
            </Card>
          </div>

          <div className={SIDE_PANEL_CLASS}>
            <Card className="p-4 md:p-6">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiUsers /> <span>Team</span>
              </div>
              <p className="mt-1 text-xs text-muted">Every player spot needs a registered account. Next you'll pick weapons and gear.</p>

              <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted">Players</span>
                  <span className="text-xl font-bold text-gold">{selectedTeammates.length + 1}/{players}</span>
                </div>
                {/* Everyone on the team, one per line (a child under their parent's care is marked). */}
                <ol className="mt-3 divide-y divide-white/5 text-sm">
                  <li className="flex items-center gap-2 py-1.5">
                    <span className="w-5 shrink-0 text-right text-xs text-muted">1</span>
                    <span className="min-w-0 flex-1 truncate font-semibold">{user?.name || 'You'}</span>
                    <span className="shrink-0 text-[11px] text-muted">you</span>
                  </li>
                  {selectedTeammates.map((member, index) => (
                    <li key={member.id} className="flex items-center gap-2 py-1.5">
                      <span className="w-5 shrink-0 text-right text-xs text-muted">{index + 2}</span>
                      <span className="min-w-0 flex-1 truncate">{member.name}</span>
                      {member.isMinor ? <span className="shrink-0 rounded-full bg-[rgba(var(--text),0.08)] px-2 py-0.5 text-[10px] text-muted">minor</span> : null}
                    </li>
                  ))}
                  {Array.from({ length: Math.max(0, maxTeammates - selectedTeammates.length) }).map((_, index) => (
                    <li key={`empty-${index}`} className="flex items-center gap-2 py-1.5 text-muted">
                      <span className="w-5 shrink-0 text-right text-xs">{selectedTeammates.length + index + 2}</span>
                      <span className="flex-1 text-xs italic">Empty spot: add a player</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="mt-4 flex flex-col gap-2">
                <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
                <Button
                  variant="primary"
                  disabled={!canSubmitReservation || !teamSelectionComplete}
                  onClick={() => setStep(3)}
                >
                  Continue <FiChevronRight />
                </Button>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Step 3 - Gear */}
      {step === 3 && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            {noPackages ? null : (
            <Card className="p-4 md:p-6">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiSliders /> <span>How do you want to rent?</span>
              </div>
              <p className="mt-1 text-xs text-muted">
                {players > 1 ? 'Pick one for the whole team, or choose per player with Hybrid.' : 'Pick one.'}
              </p>

              {/* Three choices, one at a time: a radio-style card for each. A solo player gets
                  "Pick items yourself" in place of Hybrid (which needs a team). */}
              <div className="mt-4 grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="How do you want to rent?">
                {([
                  {
                    mode: 'package_all' as const,
                    icon: <FiPackage className="text-gold" />,
                    title: players > 1 ? 'Everyone gets a package' : 'Rental package',
                    tag: 'Best value',
                    lines: [players > 1 ? 'Every player gets the package: weapon, vest, mask and BBs.' : 'A ready set: weapon, vest, mask and BBs.', 'Cheaper than renting each item.'],
                  },
                  {
                    mode: 'own_all' as const,
                    icon: <FiCrosshair className="text-gold" />,
                    title: players > 1 ? 'Everyone brings their own' : 'I bring my own',
                    tag: '',
                    lines: [`Own gun and gear, nothing rented. Entrance fee only (${formatCurrency(ENTRANCE_FEE_PER_PLAYER)} each).`, 'Guns are still tested on the chronograph before the game.'],
                  },
                  players > 1
                    ? {
                      mode: 'hybrid' as const,
                      icon: <FiUsers className="text-gold" />,
                      title: 'Hybrid',
                      tag: '',
                      lines: ['Choose per player: package, own gun, or own gun and gear.', 'Each pays for what they get.'],
                    }
                    : {
                      mode: 'custom' as const,
                      icon: <FiTool className="text-gold" />,
                      title: 'Pick items yourself',
                      tag: '',
                      lines: ['Choose exactly which weapons and gear to rent.', 'Good if you bring your own vest or mask.'],
                    },
                ]).map((option) => {
                  const active = rentMode === option.mode
                  return (
                    <button
                      key={option.mode}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => chooseRentMode(option.mode)}
                      className={[
                        'flex items-start gap-3 rounded-2xl border p-4 text-left transition',
                        active ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25' : 'border-white/10 bg-white/5 hover:bg-white/8',
                      ].join(' ')}
                    >
                      <span aria-hidden className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${active ? 'border-accent bg-accent text-white' : 'border-[rgba(var(--text),0.3)]'}`}>
                        {active ? <FiCheck className="h-3 w-3" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          {option.icon}
                          <span className="text-sm font-bold">{option.title}</span>
                          {option.tag ? <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">{option.tag}</span> : null}
                        </span>
                        {option.lines.map((line) => <span key={line} className="mt-1 block text-xs text-muted">{line}</span>)}
                      </span>
                    </button>
                  )
                })}
              </div>
            </Card>
            )}

            {selectionMode === 'package' ? (
              <>
                <Card className="p-4 md:p-6">
                  <div className="flex items-center gap-2 text-sm font-bold">
                    <FiTag /> <span>{rentMode === 'hybrid' ? 'Package for the players who take it' : 'Choose a package'}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {rentMode === 'hybrid'
                      ? 'Players set to "Package" below get this one. The others rent only some pieces or bring their own.'
                      : 'Select a rental package, or enter your budget and we will show the packages that match your group and fit it.'}
                    {hiddenPackageCount > 0 && !loadingPackages
                      ? ` Showing only packages for a group of ${players}${rentMode === 'hybrid' ? ', priced per player' : ''} (${hiddenPackageCount} other${hiddenPackageCount === 1 ? '' : 's'} hidden).`
                      : ''}
                  </p>

                  {packages.length > 0 ? (
                    <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block">
                          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Budget (₱, optional)</div>
                          <input
                            type="text"
                            inputMode="numeric"
                            placeholder="e.g. 5000"
                            value={budgetInput}
                            onChange={(event) => setBudgetInput(event.target.value.replace(/[^\d]/g, '').slice(0, 9))}
                            className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-text"
                          />
                        </label>
                        <div>
                          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Group size</div>
                          <div className="mt-1.5 flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                            <span className="flex items-center gap-2 text-sm font-semibold"><FiUsers className="text-gold" /> {players} player{players === 1 ? '' : 's'}</span>
                            <Button size="xs" variant="ghost" onClick={() => setStep(1)}>Change</Button>
                          </div>
                        </div>
                      </div>
                      {/* Hybrid: the budget is checked against the booking as it stands, with each
                          player's choice (package, some pieces, or their own gear). */}
                      {budget !== null && rentMode === 'hybrid' ? (
                        <div className={`mt-3 text-xs ${bookingTotal <= budget ? 'text-success' : 'text-warning'}`}>
                          {bookingTotal <= budget
                            ? `Your booking is ${formatCurrency(bookingTotal)} with each player's choice: ${formatCurrency(budget - bookingTotal)} under your ${formatCurrency(budget)} budget.`
                            : `Your booking is ${formatCurrency(bookingTotal)} with each player's choice: ${formatCurrency(bookingTotal - budget)} over your ${formatCurrency(budget)} budget. Pick a cheaper package, or set more players to "Rent some" or "Bring all" below.`}
                        </div>
                      ) : null}
                      {budget !== null && rentMode !== 'hybrid' ? (
                        <div className={['mt-3 text-xs', recommendedCount > 0 ? 'text-success' : 'text-warning'].join(' ')}>
                          {recommendedCount > 0
                            ? `${recommendedCount} package${recommendedCount === 1 ? '' : 's'} fit${recommendedCount === 1 ? 's' : ''} ${formatCurrency(budget)} for ${players} player${players === 1 ? '' : 's'}, cheapest first.`
                            : closestOverBudget
                              ? `No package fits ${formatCurrency(budget)} for ${players} player${players === 1 ? '' : 's'}. The closest is "${closestOverBudget.pkg.name}" at ${formatCurrency(closestOverBudget.price.total)} (${formatCurrency(closestOverBudget.overBudgetBy)} more).`
                              : `No package matches a group of ${players}. Try changing your group size or use Custom Selection.`}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <InlineError className="mt-4" message={loadError} />
                  {loadingPackages ? (
                    <div className="mt-4 text-sm text-muted">Loading packages...</div>
                  ) : packages.length === 0 ? (
                    <div className="mt-4 text-sm text-muted">No packages available yet. Ask admin to create rental packages.</div>
                  ) : (
                    <div className="mt-4 grid gap-3 lg:grid-cols-2">
                      {shownPackages.length === 0 ? (
                        <div className="text-sm text-muted lg:col-span-2">
                          No package fits a group of {players}{rentMode === 'hybrid' ? ' priced per player' : ''}. Change your group size, or use {rentMode === 'hybrid' ? 'another rent mode' : 'Custom Selection'}.
                        </div>
                      ) : null}
                      {shownPackages.map(({ pkg, price, savingsPerPlayer, groupSize, recommended, overBudgetBy }) => {
                        const active = pkg.id === selectedPackageId
                        return (
                          <button
                            key={pkg.id}
                            type="button"
                            disabled={groupSize !== null}
                            title={groupSize !== null ? `This package is priced for a group of ${groupSize} players.` : undefined}
                            onClick={() => setSelectedPackageId(pkg.id)}
                            className={[
                              'rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50',
                              active ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25' : 'border-white/10 bg-white/5 hover:bg-white/8',
                              budget !== null && !recommended && !active ? 'opacity-60' : '',
                            ].join(' ')}
                          >
                            {(() => {
                              const discount = resolvePackageDiscountConfig(pkg)
                              const includes = [
                                ...modelsOfIds(allRentalWeapons, pkg.weaponIds),
                                ...modelsOfIds(allRentalEquipment.filter((item) => !isAmmo(item)), pkg.equipmentIds),
                                `${INCLUDED_RELOADS_PER_PLAYER} BB reloads`,
                                `Entrance fee (${formatCurrency(ENTRANCE_FEE_PER_PLAYER)})`,
                              ]
                              return (
                                <>
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2 text-sm font-bold">
                                        {active ? <FiCheck className="shrink-0 text-gold" /> : null}
                                        <span className="truncate">{pkg.name}</span>
                                      </div>
                                      {discount.value > 0 && discount.mode !== 'settled' ? (
                                        <div className="mt-0.5 text-[11px] font-semibold text-success">
                                          {discount.mode === 'percent' ? `${discount.value}% off` : `₱${Math.round(discount.value).toLocaleString()} off`}
                                        </div>
                                      ) : null}
                                    </div>
                                    <div className="shrink-0 text-right">
                                      {groupSize !== null ? (
                                        <div className="text-xs font-semibold text-muted">For {groupSize} players only</div>
                                      ) : (
                                        <>
                                          {savingsPerPlayer > 0 ? (
                                            <div className="text-[11px] text-muted line-through" title="Price when renting the same items separately">
                                              {formatCurrency(price.perPlayer + savingsPerPlayer)}
                                            </div>
                                          ) : null}
                                          <div className="text-base font-bold text-accent">{formatCurrency(price.perPlayer)}</div>
                                          <div className="text-[11px] text-muted">per player</div>
                                          {savingsPerPlayer > 0 ? (
                                            <div className="mt-0.5 text-[11px] font-semibold text-success">Save {formatCurrency(savingsPerPlayer)}</div>
                                          ) : null}
                                          {budget !== null ? (
                                            <div className="mt-0.5 text-[11px] text-muted">{formatCurrency(price.total)} total</div>
                                          ) : null}
                                        </>
                                      )}
                                    </div>
                                  </div>

                                  {budget !== null && groupSize === null ? (
                                    recommended ? (
                                      <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
                                        <FiCheck className="h-3 w-3" /> Fits your budget · {formatCurrency(budget - price.total)} left
                                      </div>
                                    ) : overBudgetBy > 0 ? (
                                      <div className="mt-2 inline-flex items-center rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">
                                        {formatCurrency(overBudgetBy)} over budget
                                      </div>
                                    ) : null
                                  ) : null}

                                  <div className="mt-3 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Each player gets</div>
                                  <ul className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-text">
                                    {includes.map((label) => (
                                      <li key={label} className="flex items-center gap-1.5">
                                        <FiCheck className="h-3 w-3 shrink-0 text-success" />
                                        <span className="truncate">{label}</span>
                                      </li>
                                    ))}
                                  </ul>

                                  {players < pkg.minPlayers ? (
                                    <div className="mt-3 text-xs text-warning">Needs at least {pkg.minPlayers} players</div>
                                  ) : null}
                                  {active && stockShort ? (
                                    <div className="mt-3 text-xs text-danger">Not enough gear free this slot for your group.</div>
                                  ) : null}
                                </>
                              )
                            })()}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </Card>

                {/* Hybrid: the booker decides for each player whether they get the package or bring their own gun and gear. */}
                {rentMode === 'hybrid' ? (
                <Card className="p-4 md:p-6">
                  <div className="flex items-center gap-2 text-sm font-bold">
                    <FiUsers /> <span>Who gets the package</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    For each player: the <b>package</b>, <b>rent some</b> pieces (+ entrance {formatCurrency(ENTRANCE_FEE_PER_PLAYER)}), or <b>bring all</b> their own (entrance only). Each player pays for what they get.
                  </p>
                  {selectedPackage && packageIsGroupPrice ? (
                    <div className="mt-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs">
                      <span className="font-semibold">{selectedPackage.name}</span> is one price for a group of {Math.round(Number(selectedPackage.players ?? 0))}, so nobody can be left out of it. Pick a package priced per player above to let players bring their own.
                    </div>
                  ) : null}
                  {(() => {
                    // Rental guns free at this branch (one sample piece per model; the server picks the actual pieces).
                    const gunOptions = weaponGroups
                      .filter((group) => String(group.category || '').toLowerCase() !== 'grenades' && group.pieces.some((piece) => piece.free))
                      .map((group) => ({ id: group.pieces.find((piece) => piece.free)!.id, model: group.model, price: Number(group.price || 0) }))
                    const canBringOwn = !(selectedPackage && packageIsGroupPrice)
                    const rows = [
                      { id: String(user?.id || ''), name: user?.name || 'You', isMe: true, isMinor: false },
                      ...selectedTeammates.map((member) => ({ id: member.id, name: member.name, isMe: false, isMinor: Boolean(member.isMinor) })),
                    ].filter((row) => row.id)
                    // Each player: the package, renting only some pieces, or bringing everything.
                    type Choice = 'package' | 'some' | 'own'
                    const choiceOf = (id: string): Choice => {
                      if (!canBringOwn || !validOwnGearIds.includes(id)) return 'package'
                      return rentSomeIds.includes(id) || (validOwnGearRentals[id] || []).length > 0 || (validPlayerGuns[id] || []).length > 0 ? 'some' : 'own'
                    }
                    const choose = (id: string, choice: Choice) => {
                      setRentSomeIds((current) => (choice === 'some' ? [...current.filter((x) => x !== id), id] : current.filter((x) => x !== id)))
                      if (choice === 'package') chooseFullPackage(id)
                      else if (choice === 'own') chooseBringsAll(id)
                      else if (!validOwnGearIds.includes(id)) chooseBringsAll(id)
                    }
                    const segment = (id: string, current: Choice, value: Choice, label: string, price: string, disabled = false) => (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={current === value}
                        disabled={disabled}
                        onClick={() => choose(id, value)}
                        className={[
                          'flex-1 rounded-lg px-2 py-1.5 text-center text-xs font-semibold leading-tight transition disabled:cursor-not-allowed disabled:opacity-30',
                          current === value ? 'bg-primary text-white shadow' : 'text-muted hover:bg-white/10 hover:text-text',
                        ].join(' ')}
                      >
                        {label}
                        <span className={`block text-[10px] font-normal ${current === value ? 'text-white/80' : 'text-muted'}`}>{price}</span>
                      </button>
                    )
                    const gunPicker = (row: { id: string; name: string }, notTaking: boolean, guns: string[]) => (
                      canBringOwn && guns.length < MAX_GUNS_PER_PLAYER && gunOptions.length > 0 ? (
                        <select
                          value=""
                          onChange={(event) => addGun(row.id, event.target.value)}
                          aria-label={`${row.name}: ${guns.length ? 'add another gun' : notTaking ? 'pick a gun to rent' : 'add an extra gun'}`}
                          className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-text [&>option]:bg-background"
                        >
                          <option value="">{guns.length ? '+ Another gun' : notTaking ? '+ Rent a gun' : '+ Extra gun'}</option>
                          {gunOptions.map((option) => (
                            <option key={option.id} value={option.id}>{option.model} · {formatCurrency(option.price)}</option>
                          ))}
                        </select>
                      ) : null
                    )
                    const packagePrice = packageOnePlayerPrice !== null ? formatCurrency(packageOnePlayerPrice) : '—'
                    return (
                      <>
                        {/* Set everyone at once, then change the few who differ. */}
                        {canBringOwn && rows.length > 2 ? (
                          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                            <span className="text-muted">Set everyone:</span>
                            <button type="button" onClick={() => rows.forEach((row) => choose(row.id, 'package'))} className="rounded-full border border-white/10 px-3 py-1 font-semibold hover:bg-white/10">Package</button>
                            <button type="button" onClick={() => rows.forEach((row) => choose(row.id, 'own'))} className="rounded-full border border-white/10 px-3 py-1 font-semibold hover:bg-white/10">Bring all</button>
                          </div>
                        ) : null}
                        <ul className="mt-3 divide-y divide-white/5 rounded-xl border border-white/10">
                          {rows.map((row) => {
                            const choice = choiceOf(row.id)
                            const notTaking = choice !== 'package'
                            const singles = validOwnGearRentals[row.id] || []
                            const guns = validPlayerGuns[row.id] || []
                            const pays = notTaking
                              ? ENTRANCE_FEE_PER_PLAYER + singlesCostOf(row.id) + gunsCostOf(row.id)
                              : packageOnePlayerPrice !== null ? packageOnePlayerPrice + gunsCostOf(row.id) : null
                            return (
                              <li key={row.id} className={`px-3 py-2 ${row.isMe ? 'bg-accent/5' : ''}`}>
                                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)_4.5rem]">
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-semibold">
                                      {row.name}{row.isMe ? <span className="ml-1 text-xs font-normal text-muted">(you)</span> : null}
                                    </div>
                                    {row.isMinor ? <div className="text-[11px] text-muted">Minor · paid by their parent</div> : null}
                                  </div>
                                  <div className="order-3 col-span-2 flex gap-1 rounded-xl border border-white/10 bg-black/20 p-1 sm:order-none sm:col-span-1" role="radiogroup" aria-label={`${row.name}: what they get`}>
                                    {segment(row.id, choice, 'package', 'Package', packagePrice)}
                                    {segment(row.id, choice, 'some', 'Rent some', '+ pieces', !canBringOwn)}
                                    {segment(row.id, choice, 'own', 'Bring all', formatCurrency(ENTRANCE_FEE_PER_PLAYER), !canBringOwn)}
                                  </div>
                                  <div className="text-right text-sm font-bold tabular-nums">{pays !== null ? formatCurrency(pays) : '—'}</div>
                                </div>
                                {/* Only when there's something to pick: the pieces to rent, and guns. */}
                                {choice === 'some' || guns.length > 0 || (choice === 'package' && canBringOwn) ? (
                                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                                    {choice === 'some' ? (
                                      <>
                                        <span className="text-muted">Rents:</span>
                                        {RENT_PIECES.filter((piece) => packageSingleItems[piece]).map((piece) => {
                                          const on = singles.includes(piece)
                                          return (
                                            <button
                                              key={piece}
                                              type="button"
                                              aria-pressed={on}
                                              onClick={() => toggleSingle(row.id, piece)}
                                              className={[
                                                'rounded-full border px-2 py-0.5 font-semibold transition',
                                                on ? 'border-accent/40 bg-accent/15 text-accent' : 'border-white/10 text-muted hover:bg-white/10',
                                              ].join(' ')}
                                            >
                                              {on ? '✓ ' : '+ '}{RENT_PIECE_LABEL[piece]} {formatCurrency(packageSingleItems[piece]!.price)}
                                            </button>
                                          )
                                        })}
                                      </>
                                    ) : null}
                                    {guns.map((gunId, index) => (
                                      <span key={`${gunId}-${index}`} className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-semibold text-accent">
                                        {notTaking || index > 0 ? '' : '+ '}{gunModel(gunId)} · {formatCurrency(gunPrice(gunId))}
                                        <button type="button" onClick={() => removeGun(row.id, index)} aria-label={`Remove ${gunModel(gunId)} from ${row.name}`} className="rounded-full px-0.5 text-muted hover:text-danger">×</button>
                                      </span>
                                    ))}
                                    {choice !== 'own' ? gunPicker(row, notTaking, guns) : null}
                                  </div>
                                ) : null}
                              </li>
                            )
                          })}
                        </ul>
                      </>
                    )
                  })()}
                  <div className="mt-2 text-xs text-muted">
                    {(() => {
                      const own = validOwnGearIds.length
                      const renting = validOwnGearIds.filter((id) => validOwnGearRentals[id] || validPlayerGuns[id]).length
                      const total = selectedTeammates.length + 1
                      return [
                        `${total - own} with the full package`,
                        renting ? `${renting} renting only some` : '',
                        `${own - renting} bringing everything`,
                      ].filter(Boolean).join(' · ')
                    })()}
                    {gunRentersNotTakingPackage > 0 ? ' · A rented gun comes with the included BBs.' : ''}
                  </div>
                </Card>
                ) : null}

                {/* Included items, for the players who get the package (not those bringing their own). */}
                {selectedPackage && rentalPlayers > 0 && (packageWeaponGroups.length > 0 || packageEquipmentGroups.length > 0) && (
                  <Card className="p-4 md:p-6">
                    <div className="flex items-center gap-2 text-sm font-bold">
                      <FiShield /> <span>What the package includes</span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      For the {rentalPlayers} player{rentalPlayers === 1 ? '' : 's'} getting the package
                      {validOwnGearIds.length ? ` (${validOwnGearIds.length} bringing their own get none)` : ''}.
                      Everything is assigned automatically from what's free for your slot.
                    </p>

                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                        {packageWeaponGroups.length > 0 && packageWeaponsNeeded > 0 && (() => {
                          const short = packageWeaponGroups.some((group) => modelShort(group.model))
                          return (
                            <div className={['flex items-center justify-between gap-3 rounded-2xl border p-3', short ? 'border-danger/30 bg-danger/10' : 'border-white/10 bg-white/5'].join(' ')}>
                              <div className="min-w-0">
                                <div className="truncate text-sm font-bold">{packageWeaponGroups.map((group) => group.model).join(' / ')}</div>
                                <div className="text-xs text-muted">Weapon · {short ? <span className="text-danger">not enough free</span> : 'auto-assigned'}</div>
                              </div>
                              <div className="shrink-0 rounded-xl bg-black/30 px-2.5 py-1 text-xs font-bold">× {packageWeaponsNeeded}</div>
                            </div>
                          )
                        })()}
                        {packageEquipmentGroups.map((group) => {
                          const needed = rentalPlayers * equipmentPerPlayer(group.model)
                          const short = modelShort(group.model)
                          return (
                            <div key={group.model} className={['flex items-center justify-between gap-3 rounded-2xl border p-3', short ? 'border-danger/30 bg-danger/10' : 'border-white/10 bg-white/5'].join(' ')}>
                              <div className="min-w-0">
                                <div className="truncate text-sm font-bold">{group.model}</div>
                                <div className="text-xs text-muted">{equipmentPerPlayer(group.model)} per player · {short ? <span className="text-danger">not enough free</span> : 'auto-assigned'}</div>
                              </div>
                              <div className="shrink-0 rounded-xl bg-black/30 px-2.5 py-1 text-xs font-bold">× {needed}</div>
                            </div>
                          )
                        })}
                    </div>

                  </Card>
                )}
              </>
            ) : rentMode === 'own_all' ? (
              // Everyone brings their own gun and gear: nothing to rent, entrance fee only.
              <Card className="p-4 md:p-6">
                <div className="flex items-center gap-2 text-sm font-bold">
                  <FiCrosshair /> <span>{players > 1 ? 'Everyone brings their own gun and gear' : 'You bring your own gun and gear'}</span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  Nothing is rented, so each player pays the entrance fee only ({formatCurrency(ENTRANCE_FEE_PER_PLAYER)}). Guns are still tested on the chronograph before the game.
                </p>
                <ul className="mt-3 divide-y divide-white/5 rounded-xl border border-white/10">
                  {[
                    { id: String(user?.id || 'me'), name: `${user?.name || 'You'} (you)`, isMinor: false },
                    ...selectedTeammates.map((member) => ({ id: member.id, name: member.name, isMinor: Boolean(member.isMinor) })),
                  ].map((row) => (
                    <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="font-semibold">{row.name}</span>
                      <span className="text-xs text-muted">{row.isMinor ? 'Minor · ' : ''}Entrance {formatCurrency(ENTRANCE_FEE_PER_PLAYER)}</span>
                    </li>
                  ))}
                </ul>
                {ownAllMissing.length ? (
                  <div className="mt-3 text-xs text-danger">
                    {ownAllMissing.join(', ')} can't bring their own. Choose Hybrid so they get the package.
                  </div>
                ) : null}
              </Card>
            ) : (
              <>
                {/* Custom mode: pick individual pieces */}
                <Card className="p-4 md:p-6">
                  <div className="flex items-center gap-2 text-sm font-bold">
                    <FiCrosshair /> <span>Weapons to Rent</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    Set how many of each weapon your group needs. Units are assigned automatically from what's free for your slot.
                  </p>
                  <ModelQuantityPicker
                    groups={weaponGroups}
                    selected={customWeaponIds}
                    onChange={setCustomWeaponIds}
                    shortModels={stockShort ? stockCheck?.shortModels : []}
                    emptyText="No rental weapons in inventory."
                  />
                </Card>

                <Card className="p-4 md:p-6">
                  <div className="flex items-center gap-2 text-sm font-bold">
                    <FiShield /> <span>Gear to Rent</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">Masks, vests, and other gear. Units are assigned automatically.</p>
                  <ModelQuantityPicker
                    groups={gearGroups}
                    selected={customEquipmentIds}
                    onChange={setCustomEquipmentIds}
                    shortModels={stockShort ? stockCheck?.shortModels : []}
                    emptyText="No rental gear in inventory."
                  />
                </Card>
              </>
            )}

            {/* Extra ammo: each player buys their own reloads, on top of what the package gives.
                In a split payment a player's reloads go on their share only. */}
            <Card className="p-4 md:p-6">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiPlus /> <span>Additional Ammo</span>
              </div>
              <p className="mt-1 text-xs text-muted">
                {selectionMode === 'package'
                  ? `${INCLUDED_RELOADS_PER_PLAYER} reloads per player are free with your package. Need more? `
                  : 'Add BB reloads. '}
                ₱{ammoReloadPrice.toLocaleString()} per extra reload
                {selectedTeammates.length > 0 ? ", charged to the player who buys it." : '.'}
              </p>
              <div className="mt-3 divide-y divide-white/5 rounded-xl border border-white/10">
                {[
                  { id: String(user?.id || ''), name: user?.name || 'You', isMe: true, isMinor: false },
                  ...selectedTeammates.map((member) => ({ id: member.id, name: member.name, isMe: false, isMinor: Boolean(member.isMinor) })),
                ].filter((row) => row.id).map((row) => {
                  const count = validExtraAmmo[row.id] || 0
                  return (
                    <div key={row.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">
                          {row.name}{row.isMe ? <span className="ml-1.5 text-xs font-normal text-muted">(you)</span> : null}
                        </div>
                        <div className="text-[11px] text-muted">
                          {count > 0 ? `+ ${formatCurrency(count * ammoReloadPrice)}` : 'No extra reloads'}
                          {row.isMinor ? ' · paid by their guardian' : ''}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={() => changeExtraAmmo(row.id, -1)} disabled={count === 0} aria-label={`Fewer ammo reloads for ${row.name}`}><FiMinus /></Button>
                        <span className="w-8 text-center text-lg font-bold" aria-live="polite">{count}</span>
                        <Button variant="ghost" size="sm" onClick={() => changeExtraAmmo(row.id, 1)} disabled={extraAmmoReloads >= MAX_EXTRA_AMMO_RELOADS} aria-label={`More ammo reloads for ${row.name}`}><FiPlus /></Button>
                      </div>
                    </div>
                  )
                })}
              </div>
              {extraAmmoReloads > 0 ? (
                <div className="mt-3 text-xs font-semibold text-accent">+ {formatCurrency(extraAmmoTotal)} for {extraAmmoReloads} extra reload{extraAmmoReloads === 1 ? '' : 's'} in all</div>
              ) : null}
            </Card>

            {/* Bring Your Own: with a custom selection, or with a package (that player skips its weapon). */}
            {/* A solo player picking items marks the gun or gear they bring (Hybrid decides per player in its table). */}
            {ownWeaponsAllowed && rentMode === 'custom' && (
            <Card className="p-4 md:p-6">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiTool /> <span>Bring Your Own (Free)</span>
              </div>
              <p className="mt-1 text-xs text-muted">
                {selectionMode === 'package'
                  ? "Anyone bringing their own weapon gets the package without its weapon, so it isn't charged."
                  : 'Bringing your own weapon? Mark who is and rent fewer weapons above.'}
                {' '}Nothing to register: just bring it. Every gun is checked on the chronograph (FPS) before the game.
              </p>

              <div className="mt-4">
                <div className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-muted">Who brings their own weapon</div>
                <div className="flex flex-wrap gap-2">
                  {[
                    ...(captainOwnGear ? [] : [{ id: String(user?.id || ''), name: 'You', isCaptain: true }]),
                    ...(ownGearAllowed ? [] : selectedTeammates.filter((member) => !member.isMinor).map((member) => ({ id: member.id, name: member.name, isCaptain: false }))),
                  ].filter((player) => player.id).map((player) => {
                    const bringsOwn = player.isCaptain ? captainOwnGun : teammateOwnWeaponIds.includes(player.id)
                    const toggle = () => {
                      if (player.isCaptain) setCaptainOwnGun((current) => !current)
                      else setTeammateOwnWeaponIds((current) => (current.includes(player.id) ? current.filter((id) => id !== player.id) : [...current, player.id]))
                    }
                    return (
                      <button
                        key={player.id}
                        type="button"
                        role="checkbox"
                        aria-checked={bringsOwn}
                        onClick={toggle}
                        className={[
                          'inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition',
                          bringsOwn ? 'border-success/30 bg-success/10 text-success' : 'border-white/10 bg-white/5 text-muted hover:bg-white/10',
                        ].join(' ')}
                      >
                        {bringsOwn ? <FiCheck className="h-3 w-3" /> : <FiCrosshair className="h-3 w-3" />}
                        {player.name}
                      </button>
                    )
                  })}
                </div>
              </div>
            </Card>
            )}
          </div>

          <div className={SIDE_PANEL_CLASS}>
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
                    {selectionMode === 'custom' ? `Minimum ${effectiveMinPlayers} player${effectiveMinPlayers === 1 ? '' : 's'}` : `Package requires ${selectedPackage?.minPlayers || '—'} players`}
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
                        <div key={item.name}>• {item.message}</div>
                      ))}
                    </div>
                    <div className="mt-2 text-xs text-muted">Reduce players, pick another package or slot, or bring your own gear.</div>
                  </div>
                )}

                {renderWhatYouGet()}

              </div>

              {hasInsufficientEquipmentStock ? (() => {
                const shortage = equipmentStockCheck.find((item) => !item.ok)
                return <InlineError className="mt-4" message={shortage?.message || 'Not enough gear free for this slot. Pick other gear or another slot.'} />
              })() : null}
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Button variant="ghost" onClick={() => setStep(soloBooking ? 1 : 2)}>Back</Button>
                <Button
                  variant="primary"
                  disabled={Boolean(step3Block) || !canProceed || hasInsufficientEquipmentStock}
                  onClick={() => {
                    if (hasInsufficientEquipmentStock || step3Block) return
                    setStep(publicGame ? 5 : 4)
                  }}
                >
                  Continue <FiChevronRight />
                </Button>
              </div>
              {step3Block ? (
                <div className="mt-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">{step3Block}</div>
              ) : null}
            </Card>
          </div>
        </div>
      )}

      {/* Step 4 - Game setup */}
      {step === 4 && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            <Card className="p-4 md:p-6">
              <div className="flex items-center gap-2 text-sm font-bold" id="game-mode-label">
                <FiFlag /> <span>Preferred Game Mode</span>
              </div>
              <p className="mt-1 text-xs text-muted">Pick one or more; the marshals plan the game around them. Not sure? Leave it to the marshal.</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2" role="group" aria-labelledby="game-mode-label">
                {GAME_MODES.map((mode) => {
                  const picked = gameModePreference.split(',').map((m) => m.trim()).filter((m) => GAME_MODES.includes(m))
                  const active = picked.includes(mode)
                  // Several modes can be picked; "Marshal's choice" stands alone, and unticking the
                  // last mode goes back to it. Saved as "Team Deathmatch, VIP Escort".
                  const toggle = () => {
                    if (mode === GAME_MODES[0]) return setGameModePreference(GAME_MODES[0])
                    const specific = picked.filter((m) => m !== GAME_MODES[0])
                    const next = active ? specific.filter((m) => m !== mode) : [...specific, mode]
                    setGameModePreference(next.length ? GAME_MODES.filter((m) => next.includes(m)).join(', ') : GAME_MODES[0])
                  }
                  return (
                    <button
                      key={mode}
                      type="button"
                      role="checkbox"
                      aria-checked={active}
                      onClick={toggle}
                      className={[
                        'flex items-center justify-between gap-2 rounded-2xl border p-3 text-left text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-accent/40',
                        active ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25' : 'border-white/10 bg-white/5 hover:bg-white/8',
                      ].join(' ')}
                    >
                      <span>{mode}</span>
                      {active ? <FiCheck className="shrink-0 text-gold" /> : null}
                    </button>
                  )
                })}
              </div>
            </Card>

            <Card className="p-4 md:p-6">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiMap /> <span>Field Layout (Optional)</span>
              </div>
              <p className="mt-1 text-xs text-muted">Design the obstacle setup on a mock of the field, or upload your own sketch. Marshals use it to set up before you arrive.</p>

              <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-white/10 bg-black/20 p-4 sm:flex-row sm:items-center">
                {layoutBlueprintUrl ? (
                  <a href={layoutBlueprintUrl} target="_blank" rel="noreferrer" className="shrink-0">
                    <img src={layoutBlueprintUrl} alt="Field layout" className="h-24 w-36 rounded-lg border border-white/10 object-cover" />
                  </a>
                ) : (
                  <div className="grid h-24 w-36 shrink-0 place-items-center rounded-lg border border-dashed border-white/15 text-xs text-muted">No layout yet</div>
                )}
                <div className="flex flex-1 flex-wrap items-center gap-2">
                  <Button variant="primary" size="sm" disabled={uploadingBlueprint} onClick={() => setLayoutDesignerOpen(true)}>
                    <FiMap /> {fieldLayoutItems.length > 0 ? 'Edit field layout' : 'Design field layout'}
                  </Button>
                  <label className="cursor-pointer rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10">
                    {uploadingBlueprint ? 'Uploading…' : 'Upload a sketch'}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={uploadingBlueprint}
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        e.target.value = ''
                        if (file) {
                          void uploadBlueprint(file).then((ok) => { if (ok) setFieldLayoutItems([]) })
                        }
                      }}
                    />
                  </label>
                  {layoutBlueprintUrl ? (
                    <button type="button" className="text-xs text-muted hover:text-text" onClick={() => { setLayoutBlueprintUrl(''); setFieldLayoutItems([]) }}>Remove</button>
                  ) : null}
                  {/* What the layout adds to the booking (the standard field is free). */}
                  <div className="basis-full text-xs">
                    {layoutFee ? (
                      <span>
                        <span className="font-semibold">{layoutFee.label} layout: +{formatCurrency(layoutFee.price)}</span>
                        <span className="text-muted"> · {layoutFee.pieces > 0 ? `${layoutFee.pieces} piece${layoutFee.pieces === 1 ? '' : 's'} to set up` : 'an uploaded sketch is charged as Standard'}</span>
                      </span>
                    ) : (
                      <span className="text-muted">
                        The standard field is free. A custom layout is {layoutTiers.map((tier, index) => `${tier.label} ${formatCurrency(tier.price)} (${tier.maxPieces == null ? `${(layoutTiers[index - 1]?.maxPieces ?? 0) + 1}+ pieces` : `up to ${tier.maxPieces}`})`).join(', ')}.
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <Input
                  label="Layout notes (Optional)"
                  hint="Anything the drawing doesn't show: objectives, spawn rules, special setup."
                  value={layoutRequest}
                  maxLength={500}
                  onChange={(e) => setLayoutRequest(e.target.value)}
                />
              </div>
            </Card>
          </div>

          <div className={SIDE_PANEL_CLASS}>
            <Card className="p-4 md:p-6">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiTool /> <span>Briefing</span>
              </div>
              <p className="mt-1 text-xs text-muted">Shared with the marshals for the briefing and gear readiness.</p>
              <div className="mt-4">
                <Input
                  label="Operation notes (Optional)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
              {!layoutDesignerOpen ? <InlineError className="mt-4" message={blueprintError} /> : null}
              <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-xs text-muted">
                <div><span className="font-semibold text-text">Mode:</span> {gameModePreference}</div>
                <div className="mt-1">
                  <span className="font-semibold text-text">Layout:</span>{' '}
                  {layoutBlueprintUrl
                    ? (fieldLayoutItems.length > 0 ? `Designed (${countLayoutPieces(fieldLayoutItems)} pieces)` : 'Sketch uploaded')
                    : 'Marshal decides · free'}
                </div>
              </div>
              {/* The price with the layout fee included, line by line. */}
              <div className="mt-4">{renderWhatYouGet()}</div>
              <div className="mt-4 flex flex-col gap-2">
                <Button variant="ghost" onClick={() => setStep(3)}>Back</Button>
                <Button variant="primary" disabled={uploadingBlueprint} onClick={() => setStep(5)}>
                  Continue <FiChevronRight />
                </Button>
              </div>
            </Card>
          </div>

          <FieldLayoutDesigner
            open={layoutDesignerOpen}
            fieldName={(availableFields.filter((f) => selectedFieldIds.includes(f.id)).map((f) => f.name).join(' + ') || 'Field')}
            initialItems={fieldLayoutItems}
            limits={limitsForFields(fieldObstacles, selectedFieldIds)}
            fees={layoutTiers}
            saving={uploadingBlueprint}
            error={blueprintError}
            onClose={() => { setLayoutDesignerOpen(false); setBlueprintError(null) }}
            onSave={async (items, image) => {
              const ok = await uploadBlueprint(image)
              if (!ok) return
              setFieldLayoutItems(items)
              setLayoutDesignerOpen(false)
              toast.success('Field layout saved.')
            }}
          />
        </div>
      )}

      {/* Step 5 - Review */}
      {step === 5 && (
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
                  {!publicGame && <div className="mt-1 text-xs text-muted">{reservationSummary.fields.map((field) => field.name).join(', ')}</div>}
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Field</div>
                  <div className="mt-2 text-sm font-bold">{publicGame ? 'Assigned by the marshals' : reservationSummary.fields.map((field) => field.name).join(', ')}</div>
                  <div className="mt-1 text-xs text-muted">{publicGame ? 'Open public game' : reservationSummary.fields.map((field) => field.location).join(' • ')}</div>
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
                          <div key={w.id} className="flex items-center justify-between gap-3 text-sm">
                            <span className="min-w-0">{w.name}</span>
                            <span className="shrink-0 text-accent">₱{w.price} each</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {reservationSummary.customEquipment.length > 0 && (
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Rental Gear</div>
                      <div className="mt-2 space-y-2">
                        {reservationSummary.customEquipment.map((e) => (
                          <div key={e.id} className="flex items-center justify-between gap-3 text-sm">
                            <span className="min-w-0">{e.name}</span>
                            <span className="shrink-0 text-accent">₱{e.price} each</span>
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
                      <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Own Gear (Free)</div>
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

              {!publicGame && (
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Gameplay request</div>
                <div className="mt-2 text-sm text-text">{gameModePreference}</div>
                {layoutRequest.trim() && <div className="mt-1 text-sm text-muted">Layout: {layoutRequest.trim()}</div>}
                {layoutBlueprintUrl ? (
                  <a href={layoutBlueprintUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block">
                    <img src={layoutBlueprintUrl} alt="Field layout" className="h-24 w-36 rounded-lg border border-white/10 object-cover" />
                  </a>
                ) : null}
              </div>
              )}

              <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Team{teamName.trim() ? ` · ${teamName.trim()}` : ''}</div>
                  <div className="text-xs text-muted">{selectedTeammates.length + 1} player{selectedTeammates.length === 0 ? '' : 's'}</div>
                </div>
                {/* Every player, what they get, and their part of the total. */}
                <div className="mt-3 overflow-x-auto rounded-xl border border-white/10">
                  <table className="w-full min-w-[420px] text-sm">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/5 text-left text-[11px] uppercase tracking-wider text-muted">
                        <th className="w-8 px-3 py-2 font-semibold">#</th>
                        <th className="px-3 py-2 font-semibold">Player</th>
                        <th className="px-3 py-2 font-semibold">Gets</th>
                        <th className="px-3 py-2 text-right font-semibold">Their part</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {playerParts.map((row, index) => (
                        <tr key={row.id} className={row.isMe ? 'bg-accent/5' : ''}>
                          <td className="px-3 py-2 text-muted">{index + 1}</td>
                          <td className="px-3 py-2">
                            <div className="font-semibold">{row.name}{row.isMe ? <span className="ml-1.5 text-xs font-normal text-muted">(you)</span> : null}</div>
                            {row.isMinor ? <div className="text-[11px] text-muted">Minor</div> : null}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted">{row.gets}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right">
                            {row.part === null
                              ? <span className="text-xs text-muted">{row.paidBy ? `Paid by ${row.paidBy}` : 'Covered by the team'}</span>
                              : <span className="font-semibold tabular-nums">{formatCurrency(row.part)}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-white/10">
                        <td colSpan={3} className="px-3 py-2 text-xs text-muted">Total{fullDay ? ` (${bookedSlots.length} slots)` : ''}</td>
                        <td className="px-3 py-2 text-right font-bold tabular-nums text-gold">{formatCurrency(bookingTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div className="mt-2 text-[11px] text-muted">
                  On the payment page you choose who pays: you for everyone, or split, where each player pays their part above
                  {paymentPlan === 'cash_balance' ? ' (half online now, the rest at the field)' : ''}.
                  {playerParts.some((row) => row.paidBy) ? " A minor's part is paid by their parent or guardian." : ''}
                </div>
                {extraAmmoReloads > 0 ? (
                  <div className="mt-1 text-xs text-muted">Extra ammo: {extraAmmoReloads} reload{extraAmmoReloads === 1 ? '' : 's'}</div>
                ) : null}
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
                    <span className="text-base font-bold text-gold">{formatCurrency(bookingTotal)}</span>
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
                  {/* Package price as the player pays it (gear, weapons and entrance included), not the
                      package's optional base fee, which is often ₱0. */}
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs text-muted">Package price (per player)</div>
                    <div className="mt-2 text-sm font-bold">{formatCurrency(basePricing.perPlayer)}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs text-muted">Players</div>
                    <div className="mt-2 text-sm font-bold">× {players}</div>
                  </div>
                  {basePricing.discountAmount > 0 ? (
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="text-xs text-muted">Discount</div>
                      <div className="mt-2 text-sm font-bold text-success">−{formatCurrency(basePricing.discountAmount)}</div>
                    </div>
                  ) : null}
                  {extraAmmoTotal > 0 ? (
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="text-xs text-muted">Extra ammo ({extraAmmoReloads} × ₱{ammoReloadPrice})</div>
                      <div className="mt-2 text-sm font-bold">{formatCurrency(extraAmmoTotal)}</div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4 md:col-span-2">
                    <div className="text-xs text-muted">Rental pieces picked</div>
                    <div className="mt-2 text-sm font-bold">{customSelectedWeapons.length} weapons, {customSelectedEquipment.length} gear</div>
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
                    <div className="mt-1 text-3xl font-black text-gold">{formatCurrency(bookingTotal)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted">Per player</div>
                    <div className="mt-1 text-sm font-bold">{formatCurrency(dynamicPricing.perPlayer)}</div>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          <div className={SIDE_PANEL_CLASS}>
            <Card className="p-4 md:p-6">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiCheck /> <span>Confirm Reservation</span>
              </div>
              <p className="mt-1 text-xs text-muted">Review all details before confirming.</p>

              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs text-muted">Total</div>
                  <div className="text-2xl font-bold text-gold">{formatCurrency(bookingTotal)}</div>
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

              <InlineError className="mt-4" message={confirmError} />
              <div className="mt-4 flex flex-col gap-2">
                <Button variant="ghost" onClick={() => setStep(publicGame ? 3 : 4)}>Back</Button>
                <Button
                  variant="primary"
                  disabled={isConfirming || !canSubmitReservation || !teamSelectionComplete}
                  onClick={() => setFinalCheckOpen(true)}
                >
                  {isConfirming ? 'Processing...' : 'Proceed to Payment'} <FiChevronRight />
                </Button>
                {paymentBlock ? (
                  <div className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                    {paymentBlock.message}{' '}
                    <button type="button" className="font-semibold underline" onClick={() => setStep(paymentBlock.step)}>
                      Go to step {stepNumber(paymentBlock.step)}
                    </button>
                  </div>
                ) : null}
                {!teamSelectionComplete ? (
                  <button type="button" className="text-xs text-warning underline" onClick={() => setStep(2)}>
                    Add {missingTeammates} more teammate{missingTeammates === 1 ? '' : 's'} first
                  </button>
                ) : null}
              </div>
            </Card>
          </div>
        </div>
      )}

      {finalCheckOpen ? (
        <Modal
          title="Are all details correct?"
          eyebrow="Before you pay"
          size="md"
          onClose={() => { if (!isConfirming) setFinalCheckOpen(false) }}
          footer={(
            <>
              <Button variant="ghost" disabled={isConfirming} onClick={() => setFinalCheckOpen(false)}>No, go back and edit</Button>
              <Button
                variant="primary"
                disabled={isConfirming}
                onClick={async () => {
                  await handleConfirm()
                  setFinalCheckOpen(false)
                }}
              >
                {isConfirming ? 'Processing…' : 'Yes, proceed to payment'} <FiChevronRight />
              </Button>
            </>
          )}
        >
          <p className="text-sm text-muted">
            This is your last chance to make changes. Check your booking below; if something is wrong, go back and edit it before paying.
          </p>
          <dl className="mt-4 divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/5 text-sm">
            {[
              { label: 'Date', value: reservationSummary.dateISO },
              { label: 'Time slot', value: reservationSummary.slotLabel },
              { label: 'Location', value: reservationSummary.locationLabel },
              { label: 'Session', value: reservationSummary.sessionTypeLabel },
              ...(publicGame ? [] : [{ label: 'Field', value: reservationSummary.fields.map((field) => field.name).join(', ') || '—' }]),
              { label: 'Players', value: String(reservationSummary.players) },
              {
                label: 'Team',
                value: (
                  <ol className="space-y-0.5">
                    {[user?.name || 'You', ...selectedTeammates.map((member) => member.name)].map((name, index) => (
                      <li key={`${name}-${index}`}>{name}</li>
                    ))}
                  </ol>
                ),
              },
              { label: 'Package', value: reservationSummary.packageName },
              ...(extraAmmoReloads > 0 ? [{ label: 'Extra ammo', value: `${extraAmmoReloads} reload${extraAmmoReloads === 1 ? '' : 's'}` }] : []),
            ].map((row) => (
              <div key={row.label} className="flex items-start justify-between gap-4 px-4 py-2.5">
                <dt className="shrink-0 text-muted">{row.label}</dt>
                <dd className="min-w-0 break-words text-right font-semibold">{row.value || '—'}</dd>
              </div>
            ))}
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <dt className="text-muted">Total</dt>
              <dd className="text-lg font-bold text-gold">{formatCurrency(bookingTotal)}</dd>
            </div>
          </dl>
        </Modal>
      ) : null}

    </div>
  )
}
