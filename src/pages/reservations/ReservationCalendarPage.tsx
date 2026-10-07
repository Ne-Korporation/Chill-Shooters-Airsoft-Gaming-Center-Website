import React, { useMemo, useState, useEffect, useCallback } from 'react'
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
  FiShield,
  FiSliders,
  FiTag,
  FiTool,
  FiUsers,
} from 'react-icons/fi'

import { apiGet, apiPost } from '../../utils/apiClient'
import { useAuth } from '../../context/AuthContext'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { calculatePackagePricing } from '../../utils/packagePricing'
import { formatDiscountTargetLabel, resolvePackageDiscountConfig } from '../../utils/packagePricing'

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
  discountMode?: 'percent' | 'amount'
  discountValue?: number
  discountTargets?: Array<'package_total' | 'weapons' | 'equipment' | 'entrance'>
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
  fieldIds: string[]
  slot: TimeSlot
  sessionType: SessionType
  players: number
  reservationStatus?: string
  locationId?: string
}

type PackageRecommendationPrefill = {
  fromPackageRecommendation?: boolean
  players?: number
  sessionType?: SessionType
  selectedPackageId?: string
}

type SelectionMode = 'package' | 'custom'

type TeamMember = {
  id: string
  name: string
  email: string
  status: string
  waiverSubmitted: boolean
}

type PaymentMode = 'self' | 'split'

type WaiverRecord = {
  userId?: string
  playerId?: string
  accountId?: string
  status?: string
}

const locationFields: Record<LocationOption, Field[]> = {
  salawag: [
    { id: 'salawag-field-1', name: 'Upper Ground', location: 'Delta Stronghold Salawag', minPlayersPrivate: 10, locationId: 'salawag' },
    { id: 'salawag-field-2', name: 'Lower Ground', location: 'Delta Stronghold Salawag', minPlayersPrivate: 20, locationId: 'salawag' },
    { id: 'salawag-field-3', name: 'Forest', location: 'Delta Stronghold Salawag', minPlayersPrivate: 50, locationId: 'salawag' },
  ],
  langkaan: [
    { id: 'langkaan-field-1', name: 'Upper Ground', location: 'Delta Stronghold Langkaan', minPlayersPrivate: 10, locationId: 'langkaan' },
    { id: 'langkaan-field-2', name: 'Lower Ground', location: 'Delta Stronghold Langkaan', minPlayersPrivate: 20, locationId: 'langkaan' },
    { id: 'langkaan-field-3', name: 'Forest', location: 'Delta Stronghold Langkaan', minPlayersPrivate: 50, locationId: 'langkaan' },
  ],
  binan: [
    { id: 'binan-field-1', name: 'Upper Ground', location: 'LOMA Binan Laguna', minPlayersPrivate: 10, locationId: 'binan' },
    { id: 'binan-field-2', name: 'Lower Ground', location: 'LOMA Binan Laguna', minPlayersPrivate: 20, locationId: 'binan' },
    { id: 'binan-field-3', name: 'Forest', location: 'LOMA Binan Laguna', minPlayersPrivate: 50, locationId: 'binan' },
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

  const packagePrefill = (location.state as PackageRecommendationPrefill | null)?.fromPackageRecommendation
    ? (location.state as PackageRecommendationPrefill)
    : undefined

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [isConfirming, setIsConfirming] = useState(false)
  const [packages, setPackages] = useState<RentalPackage[]>([])
  const [weapons, setWeapons] = useState<WeaponItem[]>([])
  const [equipment, setEquipment] = useState<EquipmentItemDetails[]>([])
  const [loadingPackages, setLoadingPackages] = useState(true)

  const [reservations, setReservations] = useState<ReservationRecord[]>([])
  const [loadingReservations, setLoadingReservations] = useState(true)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [loadingTeamMembers, setLoadingTeamMembers] = useState(true)
  const [loadingWaiverEligibility, setLoadingWaiverEligibility] = useState(true)
  const [teamSearch, setTeamSearch] = useState('')
  const [selectedTeammateIds, setSelectedTeammateIds] = useState<string[]>([])
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('self')
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

  const [selectedLocation, setSelectedLocation] = useState<LocationOption>('salawag')

  const availableFields = useMemo(() => {
    return getFieldsForLocation(selectedLocation)
  }, [selectedLocation])

  const [selectedFieldIds, setSelectedFieldIds] = useState<string[]>(() => {
    const fields = getFieldsForLocation('salawag')
    return fields.length > 0 ? [fields[0].id] : []
  })

  const initialDateISO = toISODate(addDays(today, 1))
  const todayDateISO = toISODate(today)
  const [dateISO, setDateISO] = useState(initialDateISO)
  const initialIsWeekend = isWeekend(initialDateISO)
  const [slot, setSlot] = useState<TimeSlot>('morning')
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

  // Fetch reservations from API with proper status filtering
  const fetchReservations = useCallback(async () => {
    let cancelled = false
    try {
      setLoadingReservations(true)
      const res = await apiGet<{ ok: boolean; data: any[] }>('/api/reservations?limit=200')
      if (cancelled) return

      const data = Array.isArray(res?.data) ? res.data : []
      // Include PENDING, CONFIRMED, and APPROVED reservations
      // so slots are blocked as soon as someone books
      const mappedReservations: ReservationRecord[] = data
        .filter((item: any) => {
          const status = String(item.reservationStatus || '').toLowerCase()
          return status === 'pending' || status === 'confirmed' || status === 'approved'
        })
        .map((item: any) => ({
          id: String(item.id || item._id || ''),
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

  // Initial fetch
  useEffect(() => {
    fetchReservations()
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
    const isWd = isWeekday(dateISO)
    return isWd ? 10 : MIN_PLAYERS
  }, [dateISO, packagePrefill?.players])

  const [players, setPlayers] = useState(defaultPlayers)
  const [playersInput, setPlayersInput] = useState(String(defaultPlayers))
  const [notes, setNotes] = useState('')
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

  // Fetch the list of active players that can be added as teammates
  useEffect(() => {
    if (!user?.id) {
      setTeamMembers([])
      setLoadingTeamMembers(false)
      return
    }

    let cancelled = false

    const fetchTeamMembers = async () => {
      try {
        setLoadingTeamMembers(true)
        const res = await apiGet<{ ok: boolean; data: any[] }>('/api/user_accounts?limit=500')
        if (cancelled) return

        const docs = Array.isArray(res?.data) ? res.data : []
        const normalized = docs
          .filter((doc: any) => String(doc.role || 'user').toLowerCase() === 'user')
          .map((doc: any) => {
            const emailVerified = doc.emailVerified === true
            const status = String(doc.status || '').toLowerCase()
            const derivedStatus = status === 'active' || status === 'pending' || status === 'suspended'
              ? status
              : emailVerified
                ? 'active'
                : 'pending'

            return {
              id: String(doc.id ?? doc.playerId ?? doc.accountId ?? doc._id ?? ''),
              name: String(doc.name || doc.fullName || 'Unnamed player'),
              email: String(doc.email || ''),
              status: derivedStatus,
              waiverSubmitted: false,
            }
          })
          .filter((doc: TeamMember) => doc.id && doc.id !== user.id && doc.status === 'active')

        setTeamMembers(normalized)
      } catch {
        if (!cancelled) setTeamMembers([])
      } finally {
        if (!cancelled) setLoadingTeamMembers(false)
      }
    }

    fetchTeamMembers()
    return () => { cancelled = true }
  }, [user?.id])

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

  useEffect(() => {
    setTeamMembers((current) => current.map((member) => ({
      ...member,
      waiverSubmitted: waiverEligibleSet.has(member.id),
    })))
  }, [waiverEligibleSet])

  // Keep selected teammates within the headcount (players - 1, since the booker is one of them)
  useEffect(() => {
    const availableIds = new Set(teamMembers.filter((member) => member.waiverSubmitted).map((member) => member.id))
    const limit = Math.max(0, players - 1)

    setSelectedTeammateIds((current) => {
      const filtered = current.filter((id) => availableIds.has(id)).slice(0, limit)
      const unchanged = filtered.length === current.length && filtered.every((id, index) => id === current[index])
      return unchanged ? current : filtered
    })
  }, [players, teamMembers])

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
            discountMode: d.discountMode === 'amount' ? 'amount' : d.discountMode === 'percent' ? 'percent' : undefined,
            discountValue: typeof d.discountValue === 'number' ? d.discountValue : undefined,
            discountTargets: Array.isArray(d.discountTargets) ? d.discountTargets : undefined,
            description: d.description || '',
            basePrice: typeof d.basePrice === 'number' ? d.basePrice : 0,
            minPlayers: typeof d.minPlayers === 'number' ? d.minPlayers : 1,
            weaponIds: Array.isArray(d.weaponIds) ? d.weaponIds : [],
            equipmentIds: Array.isArray(d.equipmentIds) ? d.equipmentIds : [],
            equipmentCount: (d.weaponIds?.length || 0) + (d.equipmentIds?.length || 0),
            status: d.status || 'active',
          }))
        setPackages(parsedPackages)

        const wepDocs = Array.isArray(wepRes?.data) ? wepRes.data : []
        setWeapons(wepDocs.map((d: any) => ({
          id: d.id ?? (d._id ? String(d._id) : undefined),
          _id: d._id,
          name: d.name || 'Unnamed weapon',
          category: d.category || 'rifles',
          status: d.status || 'available',
          price: typeof d.price === 'number' ? d.price : 0,
        })))

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

  const cheapestPackage = useMemo(() => {
    if (packages.length === 0) return undefined
    return packages.reduce((cheapest, pkg) =>
      pkg.basePrice < cheapest.basePrice ? pkg : cheapest
    )
  }, [packages])

  useEffect(() => {
    if (packages.length > 0 && !selectedPackageId) {
      const prefillId = packagePrefill?.selectedPackageId
      if (prefillId && packages.find((p) => p.id === prefillId)) {
        setSelectedPackageId(prefillId)
      } else if (cheapestPackage) {
        setSelectedPackageId(cheapestPackage.id)
      }
    }
  }, [packages, packagePrefill?.selectedPackageId, selectedPackageId, cheapestPackage])

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
    const cap = capacityFor(selectedLocation, slotToCheck)
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

  // Used players from reservations
  const usedPlayers = useMemo(() => {
    return reservations
      .filter((r) => r.dateISO === dateISO &&
                     r.slot === slot &&
                     selectedFieldIds.some((fieldId) => r.fieldIds.includes(fieldId)) &&
                     r.locationId === selectedLocation)
      .reduce((sum, r) => sum + r.players, 0)
  }, [dateISO, slot, selectedFieldIds, reservations, selectedLocation])

  const maxCapacity = useMemo(() => {
    return capacityFor(selectedLocation, slot)
  }, [selectedLocation, slot])

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

  const customSelectedWeapons = useMemo(() => {
    return weapons.filter((w) => customWeaponIds.includes(w.id))
  }, [weapons, customWeaponIds])

  const customSelectedEquipment = useMemo(() => {
    return equipment.filter((e) => customEquipmentIds.includes(e.id))
  }, [equipment, customEquipmentIds])

  const equipmentStockCheck = useMemo(() => {
    const selectedEquipment = selectionMode === 'package' ? packageEquipment : customSelectedEquipment
    return selectedEquipment.map((item) => ({
      name: item.name,
      available: Math.max(0, Number(item.qty ?? 0)),
      required: players,
      ok: Math.max(0, Number(item.qty ?? 0)) >= players,
    }))
  }, [selectionMode, packageEquipment, customSelectedEquipment, players])

  const hasInsufficientEquipmentStock = equipmentStockCheck.some((item) => !item.ok)

  const customPerPlayerTotal = useMemo(() => {
    const wp = customSelectedWeapons.reduce((sum, w) => sum + (w.price || 0), 0)
    const ep = customSelectedEquipment.reduce((sum, e) => sum + (e.price || 0), 0)
    return wp + ep + ENTRANCE_FEE_PER_PLAYER
  }, [customSelectedWeapons, customSelectedEquipment])

  const customTotal = useMemo(() => {
    return customPerPlayerTotal * players
  }, [customPerPlayerTotal, players])

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
      }
    }

    if (!selectedPackage) {
      return { total: 0, perPlayer: 0, discountPct: 0, discountLabel: '—', discountSummary: '—', discountAmount: 0, equipmentTotalPerPlayer: 0, sessionMultiplier: 1, savings: 0, originalTotal: 0, mode: 'package' as const, entranceFeeTotal: 0, totalBeforeOverall: 0 }
    }
    const sessionMultiplier = sessionType === 'private' ? 1.25 : 1.0
    const packagePricing = calculatePackagePricing({
      pkg: selectedPackage,
      players,
      sessionMultiplier,
      weapons: packageWeapons,
      equipment: packageEquipment,
      entranceFeePerPlayer: ENTRANCE_FEE_PER_PLAYER,
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
      savings: Math.max(0, packagePricing.preDiscountTotal - packagePricing.discountAmount),
      originalTotal: packagePricing.preDiscountTotal,
      mode: 'package' as const,
      entranceFeeTotal: packagePricing.entranceFeeTotal,
      totalBeforeOverall: packagePricing.total,
    }
  }, [players, selectedPackage, sessionType, packageWeapons, packageEquipment, equipmentTotalPerPlayer, selectionMode, customTotal, customPerPlayerTotal])

  const dynamicPricing = basePricing

  const paymentBreakdown = useMemo(() => {
    const packageBase = selectionMode === 'package' && selectedPackage ? selectedPackage.basePrice * players : 0
    const entranceFee = ENTRANCE_FEE_PER_PLAYER * players
    const packageWeaponCharge = selectionMode === 'package'
      ? packageWeapons.reduce((sum, weapon) => sum + (Number(weapon?.price || 0) * players), 0)
      : 0
    const packageEquipmentCharge = selectionMode === 'package'
      ? packageEquipment.reduce((sum, item) => sum + (Number(item?.price || 0) * players), 0)
      : 0
    const customGearCharge = selectionMode === 'custom'
      ? customSelectedWeapons.reduce((sum, weapon) => sum + (Number(weapon?.price || 0) * players), 0)
      : 0
    const customEquipmentCharge = selectionMode === 'custom'
      ? customSelectedEquipment.reduce((sum, item) => sum + (Number(item?.price || 0) * players), 0)
      : 0

    const equipmentPrice = packageWeaponCharge + packageEquipmentCharge + customGearCharge + customEquipmentCharge
    const fieldPrice = packageBase
    const serviceFee = Math.max(0, dynamicPricing.totalBeforeOverall - fieldPrice - equipmentPrice - entranceFee)
    
    const selectedGearItems = Array.isArray(selectionMode === 'package' ? packageWeapons : customSelectedWeapons)
      ? (selectionMode === 'package' ? packageWeapons : customSelectedWeapons)
      : []
    const selectedEquipmentItems = Array.isArray(selectionMode === 'package' ? packageEquipment : customSelectedEquipment)
      ? (selectionMode === 'package' ? packageEquipment : customSelectedEquipment)
      : []

    const toPositiveNumber = (value: unknown, fallback = 0) => {
      const parsed = Number(value ?? fallback)
      return Number.isFinite(parsed) ? parsed : fallback
    }

    const itemizedBreakdown = [
      ...(fieldPrice > 0 ? [{ label: selectionMode === 'package' ? `${selectedPackage?.name || 'Package'} fee` : 'Field booking', amount: fieldPrice }] : []),
      ...selectedGearItems
        .filter((item) => item && typeof item === 'object' && typeof item.name === 'string')
        .map((item) => ({
          label: `${String(item.name)} (Qty: 1 per player)`,
          amount: toPositiveNumber(item.price) * players,
        })),
      ...selectedEquipmentItems
        .filter((item) => item && typeof item === 'object' && typeof item.name === 'string')
        .map((item) => {
          const unitPrice = toPositiveNumber(item.price)
          const availableQty = Math.max(0, toPositiveNumber(item.qty, 0))
          return {
            label: `${String(item.name)} (Qty: 1 per player, available: ${availableQty})`,
            amount: unitPrice * players,
          }
        }),
      { label: `Player entrance fee (${players} × ₱${ENTRANCE_FEE_PER_PLAYER})`, amount: entranceFee },
      ...(serviceFee > 0 ? [{ label: 'Service fee', amount: serviceFee }] : []),
    ].filter((item) => item && typeof item.label === 'string' && Number.isFinite(Number(item.amount)))

    return {
      fieldPrice,
      equipmentPrice,
      entranceFee,
      serviceFee,
      total: dynamicPricing.total,
      itemizedBreakdown,
    }
  }, [customSelectedEquipment, customSelectedWeapons, dynamicPricing.total, dynamicPricing.totalBeforeOverall, packageEquipment, packageWeapons, players, selectedPackage, selectionMode])

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
  const selectedTeammates = useMemo(
    () => teamMembers.filter((member) => selectedTeammateIds.includes(member.id)),
    [selectedTeammateIds, teamMembers],
  )
  const filteredTeamMembers = useMemo(() => {
    const query = teamSearch.trim().toLowerCase()
    return teamMembers.filter((member) => {
      if (!query) return true
      return [member.name, member.email, member.id].some((value) => value.toLowerCase().includes(query))
    })
  }, [teamMembers, teamSearch])
  const teamSelectionComplete = maxTeammates === 0 || selectedTeammateIds.length === maxTeammates
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
    if (paymentMode === 'split' && (players <= 1 || !teamSelectionComplete)) {
      setPaymentMode('self')
    }
  }, [paymentMode, players, teamSelectionComplete])

  const formatCurrency = (value: number | string | null | undefined) => {
    const numeric = Number(value ?? 0)
    if (!Number.isFinite(numeric)) return '₱0'
    const amount = Math.abs(numeric).toLocaleString()
    return numeric < 0 ? `−₱${amount}` : `₱${amount}`
  }

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

    const currentUsed = reservations
      .filter((r) => r.dateISO === dateISO &&
                     r.slot === slot &&
                     selectedFieldIds.some((fieldId) => r.fieldIds.includes(fieldId)) &&
                     r.locationId === selectedLocation)
      .reduce((sum, r) => sum + r.players, 0)
    const currentCapacity = capacityFor(selectedLocation, slot)
    const currentRemaining = currentCapacity - currentUsed

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

    if (!teamSelectionComplete) {
      toast.error(
        maxTeammates === 0
          ? 'No teammates are required for this reservation.'
          : `Select ${maxTeammates} teammate${maxTeammates === 1 ? '' : 's'} before continuing.`,
      )
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
        teamSize: splitPartySize,
        payerShareAmount,
      }

      if (selectionMode === 'package') {
        pendingReservation.selectedPackageId = selectedPackage?.id
        pendingReservation.selectedGameplayName = selectedPackage?.name
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

      // Flag to refresh reservations when user returns
      localStorage.setItem('refresh_reservations', 'true')

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
                <Button variant="primary" disabled={!canProceed || !hasCurrentUserWaiver} onClick={() => setStep(2)}>
                  Continue <FiChevronRight />
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
                                <div className="mt-1 text-xs text-muted">{w.category.toUpperCase()} • Qty: 1 per player</div>
                              </div>
                              <div className="text-xs font-semibold text-accent">₱{w.price}/player</div>
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
                                <div className="mt-1 text-xs text-muted">{e.category.toUpperCase()} • Stock: {e.qty} • Qty: 1 per player</div>
                              </div>
                              <div className="text-xs font-semibold text-accent">₱{e.price}/player</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </Card>
                )}
              </>
            ) : (
              <>
                {/* Custom mode - select weapons */}
                <Card className="p-4 md:p-6">
                  <div className="flex items-center gap-2 text-sm font-bold">
                    <FiCrosshair /> <span>Select Weapons to Rent</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">Choose from the admin inventory. Price is per item per player.</p>

                  {weapons.length === 0 ? (
                    <div className="mt-4 text-sm text-muted">No weapons available in inventory.</div>
                  ) : (
                    <div className="mt-4 grid gap-2 md:grid-cols-2">
                      {weapons.map((w) => {
                        const active = customWeaponIds.includes(w.id)
                        return (
                          <label
                            key={w.id}
                            className={[
                              'flex items-start gap-3 rounded-2xl border p-3 cursor-pointer transition',
                              active ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25' : 'border-white/10 bg-white/5 hover:bg-white/8',
                            ].join(' ')}
                          >
                            <input
                              type="checkbox"
                              checked={active}
                              onChange={() => {
                                setCustomWeaponIds((prev) =>
                                  prev.includes(w.id) ? prev.filter((id) => id !== w.id) : [...prev, w.id]
                                )
                              }}
                              className="mt-1 h-4 w-4 accent-accent"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-bold truncate">{w.name}</div>
                              <div className="text-xs text-muted">{w.category.toUpperCase()} • Qty: 1 per player</div>
                            </div>
                            <div className="text-xs font-semibold text-accent">₱{w.price}/player</div>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </Card>

                {/* Custom mode - select equipment */}
                <Card className="p-4 md:p-6">
                  <div className="flex items-center gap-2 text-sm font-bold">
                    <FiShield /> <span>Select Equipment to Rent</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">Choose from the admin inventory. Price is per item per player.</p>

                  {equipment.length === 0 ? (
                    <div className="mt-4 text-sm text-muted">No equipment available in inventory.</div>
                  ) : (
                    <div className="mt-4 grid gap-2 md:grid-cols-2">
                      {equipment.map((e) => {
                        const active = customEquipmentIds.includes(e.id)
                        return (
                          <label
                            key={e.id}
                            className={[
                              'flex items-start gap-3 rounded-2xl border p-3 cursor-pointer transition',
                              active ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25' : 'border-white/10 bg-white/5 hover:bg-white/8',
                              Number(e.qty ?? 0) < players ? 'opacity-60 cursor-not-allowed' : '',
                            ].join(' ')}
                          >
                            <input
                              type="checkbox"
                              checked={active}
                              disabled={Number(e.qty ?? 0) < players}
                              onChange={() => {
                                if (Number(e.qty ?? 0) < players) {
                                  toast.error(`${e.name} has only ${e.qty} item(s) available, which is not enough for ${players} players.`)
                                  return
                                }
                                setCustomEquipmentIds((prev) =>
                                  prev.includes(e.id) ? prev.filter((id) => id !== e.id) : [...prev, e.id]
                                )
                              }}
                              className="mt-1 h-4 w-4 accent-accent"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-bold truncate">{e.name}</div>
                              <div className="text-xs text-muted">{e.category.toUpperCase()} • Stock: {e.qty} • Qty: 1 per player</div>
                            </div>
                            <div className="text-xs font-semibold text-accent">₱{e.price}/player</div>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </Card>
              </>
            )}

            {/* Bring Your Own */}
            <Card className="p-4 md:p-6">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FiTool /> <span>Bring Your Own (Free)</span>
              </div>
              <p className="mt-1 text-xs text-muted">Select from your admin-approved weapons and equipment. No charge — you can bring these alongside your package rental.</p>

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
                    <div className="text-sm font-bold text-danger">Insufficient equipment stock</div>
                    <div className="mt-2 space-y-1 text-xs text-muted">
                      {equipmentStockCheck.filter((item) => !item.ok).map((item) => (
                        <div key={item.name}>• {item.name}: only {item.available} available, needs {item.required} for this group.</div>
                      ))}
                    </div>
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
                      toast.error(`${shortage?.name || 'Equipment'} stock is insufficient for ${players} players. Available: ${shortage?.available ?? 0}.`)
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
                            <span className="text-accent">₱{w.price}/player</span>
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
                            <span className="text-accent">₱{e.price}/player</span>
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
                    <div className="text-xs text-muted">Selected rental items (per player)</div>
                    <div className="mt-2 text-sm font-bold">{customSelectedWeapons.length} weapons, {customSelectedEquipment.length} equipment</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs text-muted">Per player total</div>
                    <div className="mt-2 text-sm font-bold">{formatCurrency(customPerPlayerTotal)}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs text-muted">× Players</div>
                    <div className="mt-2 text-sm font-bold">{players}</div>
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
                Choose the players joining this reservation. You are already counted, so pick {maxTeammates} teammate{maxTeammates === 1 ? '' : 's'}. Only players with an approved waiver can be added.
              </p>

              <div className="mt-4 space-y-4">
                <Input
                  label="Search players"
                  value={teamSearch}
                  onChange={(e) => setTeamSearch(e.target.value)}
                  placeholder="Search by name, email, or player ID"
                />

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
                    <span>Players</span>
                    <span>{selectedTeammateIds.length}/{maxTeammates} teammates</span>
                  </div>

                  <div className="mt-3 max-h-96 space-y-2 overflow-y-auto pr-1">
                    {loadingTeamMembers || loadingWaiverEligibility ? (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-muted">
                        Loading players...
                      </div>
                    ) : filteredTeamMembers.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-muted">
                        No active players found.
                      </div>
                    ) : (
                      filteredTeamMembers.map((member) => {
                        const active = selectedTeammateIds.includes(member.id)
                        const noWaiver = !member.waiverSubmitted
                        const disabled = noWaiver || (!active && selectedTeammateIds.length >= maxTeammates)

                        return (
                          <button
                            key={member.id}
                            type="button"
                            disabled={disabled}
                            onClick={() => {
                              if (noWaiver) {
                                toast.error(`${member.name}'s waiver isn't approved yet.`)
                                return
                              }
                              setSelectedTeammateIds((current) => {
                                if (current.includes(member.id)) {
                                  return current.filter((id) => id !== member.id)
                                }
                                if (current.length >= maxTeammates) return current
                                return [...current, member.id]
                              })
                            }}
                            className={[
                              'w-full rounded-2xl border p-3 text-left transition',
                              active ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25' : 'border-white/10 bg-white/5 hover:bg-white/8',
                              disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                            ].join(' ')}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-bold">{member.name}</div>
                                <div className="mt-1 text-xs text-muted">{member.email || member.id}</div>
                              </div>
                              <div className="flex items-center gap-1 text-[10px] uppercase tracking-[0.18em] text-muted">
                                {noWaiver ? (
                                  <span className="text-warning">Waiver not approved</span>
                                ) : active ? (
                                  <><FiCheck className="text-gold" /> Selected</>
                                ) : (
                                  'Tap to add'
                                )}
                              </div>
                            </div>
                          </button>
                        )
                      })
                    )}
                  </div>
                </div>

                {!teamSelectionComplete && maxTeammates > 0 && (
                  <div className="rounded-2xl border border-warning/20 bg-warning/10 p-3 text-xs text-warning">
                    Select {maxTeammates - selectedTeammateIds.length} more teammate{maxTeammates - selectedTeammateIds.length === 1 ? '' : 's'} to match the reservation headcount of {players}.
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
                  disabled={players <= 1 || !teamSelectionComplete}
                  onClick={() => setPaymentMode('split')}
                  className={[
                    'rounded-2xl border px-4 py-3 text-left transition',
                    paymentMode === 'split' ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25' : 'border-white/10 bg-white/5 hover:bg-white/8',
                    players <= 1 || !teamSelectionComplete ? 'cursor-not-allowed opacity-50' : '',
                  ].join(' ')}
                >
                  <div className="text-sm font-bold">Split among the team</div>
                  <div className="mt-1 text-xs text-muted">
                    {teamSelectionComplete
                      ? 'Divide the total equally among you and your teammates.'
                      : 'Select all teammates first to enable splitting.'}
                  </div>
                </button>
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center justify-between gap-3 text-xs text-muted">
                  <span>Payment mode</span>
                  <span>{teamPaymentLabel}</span>
                </div>
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
                  disabled={isConfirming || !canSubmitReservation || !teamSelectionComplete}
                  onClick={handleConfirm}
                >
                  {isConfirming ? 'Processing...' : 'Proceed to Payment'} <FiChevronRight />
                </Button>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}