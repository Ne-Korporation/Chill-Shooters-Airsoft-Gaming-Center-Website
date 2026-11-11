import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  FiAward,
  FiBox,
  FiCalendar,
  FiCheck,
  FiChevronDown,
  FiChevronLeft,
  FiChevronRight,
  FiClock,
  FiUserCheck,
  FiMail,
  FiMapPin,
  FiMenu,
  FiMinus,
  FiPlus,
  FiShield,
  FiTarget,
  FiUsers,
  FiX,
} from 'react-icons/fi'
import toast from 'react-hot-toast'

import { Button } from '../../components/ui/Button'
import { CapacityCalendar } from '../../components/booking/CapacityCalendar'
import { useAuth } from '../../context/AuthContext'
import { getApiBase } from '../../utils/apiClient'
import { DEFAULT_SLOT_HOURS, formatSlotRange, manilaTodayISO, slotHasStarted, useSlotHours } from '../../utils/slotHours'
import { PACKAGE_ENTRANCE_FEE_PER_PLAYER, calculatePackagePricing, packageEquipmentQty, type PackageLike } from '../../utils/packagePricing'

type FAQ = {
  q: string
  a: string
}

type LocationOption = 'salawag' | 'langkaan' | 'binan'
// Labels match FIELD_CHOICES on the booking page, which reads them from the prefill.
type FieldArea = 'Upper Ground' | 'Upper + Lower Ground' | 'All 3 fields'
type TimeSlot = 'morning' | 'afternoon' | 'evening'
type BookingMenu = 'location' | 'date' | 'players'

// Read (and cleared) by ReservationCalendarPage to prefill step 1.
export const LANDING_PREFILL_KEY = 'landing_reservation_prefill'

export type LandingReservationPrefill = {
  location: LocationOption
  fieldArea: FieldArea
  dateISO: string
  slot: TimeSlot
  players: number
}

// maxPlayers is the most a location takes in one slot (server DEFAULT_LOCATION_CAPACITIES, morning).
const bookingLocations: { id: LocationOption; name: string; detail: string; maxPlayers: number }[] = [
  { id: 'salawag', name: 'Chill Shooters (Salawag)', detail: 'About 2 hectares · up to 400 players per slot', maxPlayers: 400 },
  { id: 'langkaan', name: 'Chill Shooters (Langkaan)', detail: 'About 2 hectares · up to 400 players per slot', maxPlayers: 400 },
  { id: 'binan', name: 'BBC Airsoft Binan Laguna', detail: 'About 4 hectares · up to 600 players per slot', maxPlayers: 600 },
]

// Fields are assigned from the group size, same as the booking page: 10-19 players get Upper Ground,
// 20-49 get Upper + Lower Ground, 50+ get all three. Weekday private games start at 10 players;
// weekends are public games with no minimum.
const PRIVATE_MIN_PLAYERS = 10

function fieldAreaForPlayers(players: number): FieldArea {
  if (players >= 50) return 'All 3 fields'
  if (players >= 20) return 'Upper + Lower Ground'
  return 'Upper Ground'
}

const MIN_BOOKING_PLAYERS = 1

function isWeekendISO(dateISO: string) {
  const day = new Date(`${dateISO}T12:00:00`).getDay()
  return day === 0 || day === 6
}

// Allowed group size for the current booking bar choices.
function playerLimits(booking: { location: LocationOption; dateISO: string }) {
  const max = bookingLocations.find((l) => l.id === booking.location)?.maxPlayers ?? 400
  const weekend = isWeekendISO(booking.dateISO)
  return { min: weekend ? MIN_BOOKING_PLAYERS : PRIVATE_MIN_PLAYERS, max, weekend }
}

const bookingSlots: { id: TimeSlot; label: string }[] = [
  { id: 'morning', label: 'Morning' },
  { id: 'afternoon', label: 'Afternoon' },
  { id: 'evening', label: 'Evening' },
]

const howItWorks = [
  { icon: FiUserCheck, title: 'Sign up and verify your ID', desc: 'Create your account and upload a valid ID so we can verify you.' },
  { icon: FiShield, title: 'Fill out the waiver', desc: 'A quick online form. Players under 18 need a guardian.' },
  { icon: FiCalendar, title: 'Book your game', desc: 'Choose a field, date, and time that fits your group.' },
  { icon: FiTarget, title: 'Show up and play', desc: 'Our marshals brief your squad and get you in the game.' },
]

const navLinks = [
  { href: '#about', label: 'About' },
  { href: '#packages', label: 'Packages' },
  { href: '#guidelines', label: 'Guidelines' },
  { href: '#location', label: 'Location' },
  { href: '#contact', label: 'Contact Us' },
]

// The three fields, shown as cards and on the map. mapQuery is what the embedded Google map searches for.
const fieldLocations = [
  {
    name: 'Chill Shooters (Salawag)',
    img: '/delta.png',
    size: '~2 hectares',
    capacity: 'Up to 400 players per slot',
    desc: 'Home of Chill Shooters Airsoft Game Center and Delta Stronghold Airsoft Field, at Toledo Compound, Salawag. Enter through the Grey Gate, the farthest gate at the corner of the compound.',
    mapQuery: 'Chill Shooters Airsoft Game Center, Toledo Compound, Salawag, Dasmariñas, Cavite',
  },
  {
    name: 'Chill Shooters (Langkaan)',
    img: '/langkaanPlaceholder.png',
    size: '~2 hectares',
    capacity: 'Up to 400 players per slot',
    desc: 'Ideal for small to medium groups and tournaments.',
    mapQuery: 'Chill Shooters Airsoft, Langkaan, Dasmariñas, Cavite',
  },
  {
    name: 'BBC Airsoft Binan Laguna',
    img: '/loma.png',
    size: '~4 hectares',
    capacity: 'Up to 600 players per slot',
    desc: 'Ideal for large groups and tournaments.',
    mapQuery: 'BBC Airsoft, Biñan, Laguna',
  },
] as const

type PublicPackage = PackageLike & {
  id: string
  name: string
  description?: string
  minPlayers?: number
  bbReloadGrams?: number
  // Bookings (not cancelled) that chose this package
  bookings?: number
}

const LANDING_PACKAGE_COUNT = 3
// The default package, called "Normal" (or described as "Default Package").
const isDefaultPackage = (pkg: PublicPackage) =>
  pkg.name.trim().toLowerCase() === 'normal' || /default package/i.test(pkg.description || '')
type PublicItem = { id: string; name: string; price: number }

// Active rental packages, read without signing in (GET /api/public/packages).
function usePublicPackages() {
  const [state, setState] = useState<{ loading: boolean; packages: PublicPackage[]; weapons: PublicItem[]; equipment: PublicItem[] }>({
    loading: true,
    packages: [],
    weapons: [],
    equipment: [],
  })
  useEffect(() => {
    let alive = true
    fetch(`${getApiBase()}/api/public/packages`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!alive) return
        setState({
          loading: false,
          packages: Array.isArray(body?.data) ? body.data : [],
          weapons: Array.isArray(body?.weapons) ? body.weapons : [],
          equipment: Array.isArray(body?.equipment) ? body.equipment : [],
        })
      })
      .catch(() => { if (alive) setState((current) => ({ ...current, loading: false })) })
    return () => { alive = false }
  }, [])
  return state
}

function PackagesSection({ onBook }: { onBook: () => void }) {
  const { loading, packages, weapons, equipment } = usePublicPackages()

  // Three packages: the default ("Normal") one first, marked as the best seller, then the two
  // other packages booked most often.
  const ordered = useMemo(() => {
    const byBookings = [...packages].sort((a, b) => (Number(b.bookings) || 0) - (Number(a.bookings) || 0))
    const best = byBookings.find(isDefaultPackage)
    return (best ? [best, ...byBookings.filter((pkg) => pkg !== best)] : byBookings).slice(0, LANDING_PACKAGE_COUNT)
  }, [packages])

  const cards = useMemo(() => ordered.map((pkg) => {
    // Priced for the package's own headcount, or its minimum group size.
    const players = Number(pkg.players) > 0 ? Number(pkg.players) : Math.max(1, Number(pkg.minPlayers) || 1)
    const pricing = calculatePackagePricing({
      pkg: { ...pkg, basePrice: Number(pkg.basePrice) || 0 },
      players,
      sessionMultiplier: 1,
      weapons,
      equipment,
      entranceFeePerPlayer: PACKAGE_ENTRANCE_FEE_PER_PLAYER,
    })
    const weaponNames = [...new Set((pkg.weaponIds || []).map((id) => weapons.find((item) => item.id === id)?.name).filter(Boolean))] as string[]
    const gear = (pkg.equipmentIds || [])
      .map((id) => ({ name: equipment.find((item) => item.id === id)?.name, qty: packageEquipmentQty(pkg, id) }))
      .filter((row): row is { name: string; qty: number } => Boolean(row.name))
    return { pkg, players, pricing, weaponNames, gear }
  }), [ordered, weapons, equipment])

  return (
    <section id="packages" className="mx-auto max-w-[1200px] scroll-mt-24 px-4 pb-16 md:px-6">
      <SectionTitle
        eyebrow="Packages"
        title="Rental packages for every squad"
        subtitle={`Gear, weapons and entrance in one price. Every package includes the ₱${PACKAGE_ENTRANCE_FEE_PER_PLAYER} entrance fee per player.`}
      />
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((key) => <div key={key} className="surface h-56 animate-pulse rounded-2xl" />)}
        </div>
      ) : cards.length === 0 ? (
        <div className="surface rounded-2xl p-6 text-sm text-muted">
          Packages are being prepared. You can still book a game and pick your rentals when you reserve.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map(({ pkg, players, pricing, weaponNames, gear }, idx) => (
            <motion.div
              key={pkg.id}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.15 }}
              transition={{ duration: 0.4, delay: idx * 0.05 }}
              className={`surface flex flex-col rounded-2xl p-5 ${isDefaultPackage(pkg) ? 'ring-1 ring-accent/50' : ''}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="chip-accent grid h-10 w-10 shrink-0 place-items-center rounded-xl">
                    <FiBox className="h-5 w-5" />
                  </span>
                  <div>
                    <div className="text-base font-bold">{pkg.name}</div>
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                      <FiUsers className="h-3.5 w-3.5" />
                      {Number(pkg.players) > 0 ? `Priced for ${players} players` : `From ${players} ${players === 1 ? 'player' : 'players'}`}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  {isDefaultPackage(pkg) ? (
                    <span className="flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-[11px] font-bold text-black">
                      <FiAward className="h-3.5 w-3.5" /> Best seller
                    </span>
                  ) : null}
                  {pricing.discountAmount > 0 ? (
                    <span className="rounded-full bg-success/15 px-2.5 py-1 text-[11px] font-semibold text-success">{pricing.discountSummary}</span>
                  ) : null}
                </div>
              </div>

              {pkg.description ? <p className="mt-3 text-sm leading-relaxed text-muted">{pkg.description}</p> : null}

              <ul className="mt-3 space-y-1.5 text-sm">
                {weaponNames.length > 0 ? (
                  <li className="flex items-start gap-2">
                    <FiTarget className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                    <span>{weaponNames.join(' or ')}</span>
                  </li>
                ) : null}
                {gear.map((row) => (
                  <li key={row.name} className="flex items-start gap-2">
                    <FiShield className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                    <span>{row.qty > 1 ? `${row.qty} × ` : ''}{row.name}</span>
                  </li>
                ))}
                {Number(pkg.bbReloadGrams) > 0 ? (
                  <li className="flex items-start gap-2">
                    <FiCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                    <span>{pkg.bbReloadGrams} g of BBs per reload</span>
                  </li>
                ) : null}
              </ul>

              <div className="mt-auto pt-5">
                <div className="divider flex items-end justify-between gap-3 border-t pt-4">
                  <div>
                    <div className="text-2xl font-bold">₱{pricing.perPlayer.toLocaleString()}</div>
                    <div className="text-xs text-muted">per player · ₱{pricing.total.toLocaleString()} for {players}</div>
                  </div>
                  <Button size="sm" variant="primary" onClick={onBook}>Book this</Button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </section>
  )
}

// Embedded Google map with arrows to move between the three fields.
function LocationsMap() {
  const [index, setIndex] = useState(0)
  const count = fieldLocations.length
  const location = fieldLocations[index]
  const step = (delta: number) => setIndex((current) => (current + delta + count) % count)
  const query = encodeURIComponent(location.mapQuery)

  return (
    <div className="surface flex flex-col overflow-hidden rounded-2xl">
      <div className="relative min-h-[260px] flex-1">
        <iframe
          key={location.name}
          title={`Map: ${location.name}`}
          src={`https://www.google.com/maps?q=${query}&z=15&output=embed`}
          className="absolute inset-0 h-full w-full border-0"
          loading="lazy"
        />
        <button
          type="button"
          onClick={() => step(-1)}
          aria-label="Previous location"
          className="absolute left-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white shadow-lg backdrop-blur transition hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(197,163,90,0.7)]"
        >
          <FiChevronLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => step(1)}
          aria-label="Next location"
          className="absolute right-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white shadow-lg backdrop-blur transition hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(197,163,90,0.7)]"
        >
          <FiChevronRight className="h-5 w-5" />
        </button>
      </div>
      <div className="flex flex-col items-start gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="min-w-0 max-w-full" aria-live="polite">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <FiMapPin className="h-4 w-4 shrink-0 text-accent" />
            <span className="truncate">{location.name}</span>
          </div>
          <div className="mt-1 flex gap-1.5" role="tablist" aria-label="Choose a location">
            {fieldLocations.map((loc, i) => (
              <button
                key={loc.name}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={loc.name}
                onClick={() => setIndex(i)}
                className={`relative h-1.5 rounded-full transition-all after:absolute after:-inset-x-1 after:-inset-y-3 after:content-[''] ${i === index ? 'w-6 bg-[rgb(197,163,90)]' : 'w-1.5 bg-[rgba(var(--text),0.25)]'}`}
              />
            ))}
          </div>
        </div>
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${query}`}
          target="_blank"
          rel="noreferrer"
          className="hover-row inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium"
        >
          Open in Google Maps <FiChevronRight className="text-muted" />
        </a>
      </div>
    </div>
  )
}

function toISODate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function SectionTitle({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string
  title: string
  subtitle?: string
}) {
  return (
    <div className="mb-6">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
        {eyebrow}
      </div>
      <h2 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">
        {title}
      </h2>
      {subtitle ? (
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted md:text-base">
          {subtitle}
        </p>
      ) : null}
    </div>
  )
}

// One segment of the hero booking bar: icon + label + current value, opening a
// popover above the bar (the bar sits at the bottom of the hero).
function BookingField({
  icon,
  label,
  value,
  open,
  onToggle,
  popoverClassName = 'w-72',
  align = 'left',
  children,
}: {
  icon: React.ReactNode
  label: string
  value: string
  open: boolean
  onToggle: () => void
  popoverClassName?: string
  align?: 'left' | 'right'
  children: React.ReactNode
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<{ side: 'top' | 'bottom'; maxHeight?: number }>({ side: 'top' })

  // Open on whichever side of the bar has room: above unless the sticky navbar
  // or the top of the window is in the way, then below. If neither side fits,
  // take the roomier one and let the popover scroll.
  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      const trigger = triggerRef.current
      const popover = popoverRef.current
      if (!trigger || !popover) return
      const rect = trigger.getBoundingClientRect()
      const navBottom = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0
      const gap = 12
      const above = rect.top - Math.max(navBottom, 0) - gap * 2
      const below = window.innerHeight - rect.bottom - gap * 2
      const needed = popover.scrollHeight
      if (needed <= above) setPlacement({ side: 'top' })
      else if (needed <= below) setPlacement({ side: 'bottom' })
      else if (above >= below) setPlacement({ side: 'top', maxHeight: above })
      else setPlacement({ side: 'bottom', maxHeight: below })
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [open])

  const slideFrom = placement.side === 'top' ? 6 : -6

  return (
    <div className="relative min-w-0 flex-1">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={onToggle}
        className={`flex w-full items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left transition ${
          open ? 'bg-[#f0f0ea]' : 'hover:bg-black/5'
        }`}
      >
        <span className="shrink-0 text-2xl text-[#4a4a4a]">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block whitespace-nowrap font-['Poppins'] text-sm font-semibold text-[#2b2b2b] md:text-base">{label}</span>
          <span className="block truncate text-xs text-[#5a5a5a]">{value}</span>
        </span>
        <FiChevronDown className={`shrink-0 text-[#4a4a4a] transition ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            ref={popoverRef}
            role="dialog"
            aria-label={label}
            initial={{ opacity: 0, y: slideFrom }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: slideFrom }}
            transition={{ duration: 0.15 }}
            style={{ maxHeight: placement.maxHeight }}
            className={`absolute ${placement.side === 'top' ? 'bottom-full mb-3' : 'top-full mt-3'} ${
              align === 'right' ? 'right-0' : 'left-0'
            } z-30 max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain rounded-2xl bg-white p-2 text-[#2b2b2b] shadow-[0_20px_50px_rgba(0,0,0,0.3)] ring-1 ring-black/5 ${popoverClassName}`}
          >
            {children}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

const weekdayLabels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

// Month grid date picker for the booking bar. ISO strings (YYYY-MM-DD) compare
// correctly as strings, which keeps the min/max checks simple.
function MiniCalendar({
  value,
  minISO,
  maxISO,
  onChange,
}: {
  value: string
  minISO: string
  maxISO: string
  onChange: (iso: string) => void
}) {
  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date(`${value || minISO}T12:00:00`)
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })

  const minMonth = new Date(`${minISO}T12:00:00`)
  const maxMonth = new Date(`${maxISO}T12:00:00`)
  const canGoPrev =
    viewMonth.getFullYear() * 12 + viewMonth.getMonth() > minMonth.getFullYear() * 12 + minMonth.getMonth()
  const canGoNext =
    viewMonth.getFullYear() * 12 + viewMonth.getMonth() < maxMonth.getFullYear() * 12 + maxMonth.getMonth()

  const cells = useMemo(() => {
    const year = viewMonth.getFullYear()
    const month = viewMonth.getMonth()
    const leading = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    return [
      ...Array.from({ length: leading }, () => null),
      ...Array.from({ length: daysInMonth }, (_, i) => toISODate(new Date(year, month, i + 1))),
    ]
  }, [viewMonth])

  const shiftMonth = (delta: number) =>
    setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1))

  return (
    <div>
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          disabled={!canGoPrev}
          onClick={() => shiftMonth(-1)}
          className="grid h-9 w-9 text-sm place-items-center rounded-full sm:h-6 sm:w-6 text-[#3d4a1e] transition hover:bg-[#f0f0ea] disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <FiChevronLeft />
        </button>
        <div className="font-['Poppins'] text-xs font-semibold">
          {viewMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </div>
        <button
          type="button"
          aria-label="Next month"
          disabled={!canGoNext}
          onClick={() => shiftMonth(1)}
          className="grid h-9 w-9 text-sm place-items-center rounded-full sm:h-6 sm:w-6 text-[#3d4a1e] transition hover:bg-[#f0f0ea] disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <FiChevronRight />
        </button>
      </div>

      <div className="mt-1 grid grid-cols-7 text-center text-[10px] font-semibold text-[#8a8a8a]">
        {weekdayLabels.map((d) => (
          <div key={d} className="py-1">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-0.5 text-center">
        {cells.map((iso, idx) => {
          if (!iso) return <div key={`blank-${idx}`} />
          const disabled = iso < minISO || iso > maxISO
          const selected = iso === value
          return (
            <button
              key={iso}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              aria-label={new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              onClick={() => onChange(iso)}
              className={`mx-auto grid h-9 w-9 place-items-center rounded-full text-sm transition sm:h-7 sm:w-7 sm:text-xs ${
                selected
                  ? 'bg-[#3d4a1e] font-semibold text-white'
                  : disabled
                    ? 'cursor-not-allowed text-[#c4c4c4]'
                    : 'text-[#2b2b2b] hover:bg-[#f0f0ea]'
              }`}
            >
              {Number(iso.slice(8))}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function BookingOption({
  selected,
  title,
  detail,
  onSelect,
}: {
  selected: boolean
  title: string
  detail?: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
        selected ? 'bg-[#3d4a1e]/10' : 'hover:bg-[#f0f0ea]'
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className={`block text-sm ${selected ? 'font-semibold text-[#3d4a1e]' : 'font-medium'}`}>{title}</span>
        {detail ? <span className="block text-xs text-[#6a6a6a]">{detail}</span> : null}
      </span>
      {selected ? <FiCheck className="shrink-0 text-[#3d4a1e]" /> : null}
    </button>
  )
}

export function LandingPage() {
  const slotHours = useSlotHours()
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const [faqOpen, setFaqOpen] = useState<number | null>(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [openMenu, setOpenMenu] = useState<BookingMenu | null>(null)
  const bookingBarRef = useRef<HTMLDivElement>(null)

  const toggleMenu = (menu: BookingMenu) => setOpenMenu((current) => (current === menu ? null : menu))

  // Close the open booking popover on an outside click or Escape.
  useEffect(() => {
    if (!openMenu) return
    const onPointerDown = (e: PointerEvent) => {
      if (!bookingBarRef.current?.contains(e.target as Node)) setOpenMenu(null)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [openMenu])

  // Today can be booked until its last slot starts (Manila time); after that, tomorrow is first.
  const minDateISO = useMemo(() => {
    const todayISO = manilaTodayISO()
    if (bookingSlots.some((s) => !slotHasStarted(DEFAULT_SLOT_HOURS, s.id, todayISO))) return todayISO
    const d = new Date(`${todayISO}T12:00:00`)
    d.setDate(d.getDate() + 1)
    return toISODate(d)
  }, [])

  // Same booking window as ReservationCalendarPage: through the end of next month.
  const maxDateISO = useMemo(() => {
    const now = new Date()
    return toISODate(new Date(now.getFullYear(), now.getMonth() + 2, 0))
  }, [])

  const [booking, setBooking] = useState<LandingReservationPrefill>({
    location: 'salawag',
    fieldArea: 'Upper Ground',
    dateISO: minDateISO,
    slot: bookingSlots.find((s) => !slotHasStarted(DEFAULT_SLOT_HOURS, s.id, minDateISO))?.id ?? 'morning',
    players: 10,
  })

  // Changing location, field area or date can change the allowed group size; keep players inside it.
  const updateBooking = <K extends keyof LandingReservationPrefill>(key: K, value: LandingReservationPrefill[K]) => {
    setBooking((prev) => {
      const next = { ...prev, [key]: value }
      // A slot that has already started today can't be booked; move to the next open one.
      if (slotHasStarted(slotHours, next.slot, next.dateISO)) {
        next.slot = bookingSlots.find((s) => !slotHasStarted(slotHours, s.id, next.dateISO))?.id ?? next.slot
      }
      const { min, max } = playerLimits(next)
      const players = Math.min(max, Math.max(min, next.players))
      return { ...next, players, fieldArea: fieldAreaForPlayers(players) }
    })
  }
  const limits = playerLimits(booking)

  const bookingDateLabel = useMemo(() => {
    const d = new Date(`${booking.dateISO}T12:00:00`)
    const date = Number.isNaN(d.getTime())
      ? 'Pick a date'
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const slot = bookingSlots.find((s) => s.id === booking.slot)?.label ?? ''
    return `${date} · ${slot}`
  }, [booking.dateISO, booking.slot])

  const handleReserve = () => {
    try {
      sessionStorage.setItem(LANDING_PREFILL_KEY, JSON.stringify(booking))
    } catch {
      // Prefill is a convenience; the reservation page still works without it.
    }
    if (isAuthenticated) {
      navigate('/app/reservations')
    } else {
      navigate('/login', { state: { from: '/app/reservations' } })
    }
  }

  const handleFaqToggle = (idx: number, open: boolean) => {
    setFaqOpen(open ? null : idx)
  }

  const [contact, setContact] = useState({ name: '', email: '', message: '' })
  const [contactSending, setContactSending] = useState(false)

  const handleContactSubmit = async (e: React.FormEvent | React.KeyboardEvent) => {
    if (e && 'preventDefault' in e) e.preventDefault()
    if (contactSending) return
    setContactSending(true)
    try {
      const apiBase = getApiBase()
      const res = await fetch(`${apiBase}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(contact),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || 'send failed')
      setContact({ name: '', email: '', message: '' })
      toast.success("Message sent. We'll reply to your email soon!")
    } catch (err: any) {
      toast.error(err?.message && err.message !== 'send failed' ? err.message : 'Sorry, your message could not be sent. Please email us instead.')
    } finally {
      setContactSending(false)
    }
  }

  const faqs: FAQ[] = useMemo(
    () => [
      {
        q: 'Who can play?',
        a: 'Everyone, whatever your experience or group size: first-time players, beginners, casual players, solo players joining public games, couples, families, organized teams, and barkadas. We ask every player to show respect, teamwork, and good sportsmanship on the field.',
      },
      {
        q: 'What is the age requirement to play?',
        a: 'Players aged 12 and up are welcome, as long as safety requirements are met. Minors must be accompanied by a parent or legal guardian and must present parental consent before playing. Every player, whatever their age, must complete and sign the consent and waiver form before playing.',
      },
      {
        q: 'When are games held?',
        a: 'Exclusive / private games run Monday to Friday, and regular / public games on Saturday and Sunday. Regular games run from 8:00 AM to 5:00 PM and night games from 5:00 PM to 10:00 PM. Night games depend on field availability and safety requirements. Please arrive early for registration, the safety orientation, and chronograph testing.',
      },
      {
        q: 'How much does it cost?',
        a: 'Players with their own guns pay the ₱150 entrance fee. The rental package is ₱750 per player: airsoft gun ₱500, mask ₱50, vest ₱50, and the ₱150 entrance fee. Equipment is limited, so rental gear must be reserved before the game.',
      },
      {
        q: 'Can I get a refund or reschedule?',
        a: 'Reservations are transferable but non-refundable. You can move your game to another date with prior notice. For group reservations, the full reserved number of players is still paid for, even if some members do not arrive. For example, a group that reserves equipment for 10 players but arrives with 8 still pays for all 10, because the equipment was set aside for the group. Please confirm everyone in your group before booking.',
      },
      {
        q: 'What should I wear?',
        a: 'Every player must wear a jacket or long-sleeved top, long pants, closed shoes or sturdy footwear, a cap or head protection, and gloves. If you have no gloves, you can buy tactical gloves at the field for ₱350. Players without the required clothing or protective gear may not be allowed to play.',
      },
      {
        q: 'What should I bring?',
        a: 'A valid ID. Minors can bring their latest school ID; everyone else needs a valid government ID.',
      },
      {
        q: 'Can players bring their own airsoft guns?',
        a: 'Yes. Every personal unit must pass chronograph testing before it is allowed on the field. The limits with 0.20 g BBs are 450 FPS for rifles and 550 FPS for BASR / sniper rifles. Units over the limit cannot be used until they are adjusted, and repeated violations or refusing chronograph testing can lead to disqualification.',
      },
      {
        q: 'Do you accept walk-in players?',
        a: 'Yes, walk-in players are accepted. However, due to limited equipment, advance reservation is highly recommended.',
      },
      {
        q: 'What facilities are on the field?',
        a: 'Parking for players and guests, a staging area for gear preparation, rest, and briefings, drinking water, comfort rooms, and chronograph testing. Certified game marshals run a safety orientation before every game, brief each scenario, and supervise play on the field.',
      },
      {
        q: 'What are the field rules?',
        a: 'Follow all field rules and marshal instructions. Respect every player, staff member, and marshal; rude or aggressive behavior is not tolerated. Practice CLAYGO (Clean As You Go) and respect the surrounding nature. Wear proper attire and protective gear at all times during games. Illegal substances and unsafe gun modifications are not allowed. Keep your belongings secure, as the field is not responsible for lost or damaged items.',
      },
      {
        q: 'What happens if it rains?',
        a: 'We play rain or shine unless the marshals stop play for safety. If weather stops you from coming, contact us and staff can move your booking and payment to another date. Payments are not refundable.',
      },
      {
        q: 'How do I get to the Salawag field?',
        a: 'Chill Shooters Airsoft Game Center and Delta Stronghold Airsoft Field are at Toledo Compound, Salawag, Dasmariñas City, Cavite. Enter through the Grey Gate, the farthest gate at the corner of the compound. On Google Maps, search for "Chill Shooters Airsoft Game Center" or "Delta Stronghold Airsoft Field".',
      },
    ],
    [],
  )

  return (
    <div className="relative min-h-screen bg-background text-text">
      <header className="sticky top-0 z-50 bg-[#5b6b3a] text-white shadow-[0_2px_12px_rgba(0,0,0,0.25)] bg-[url('/NavBar-BG.webp')] bg-cover bg-center">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-3 md:px-8">
          <Link to="/" className="flex items-center" aria-label="Chill Shooters home">
            <img src="/logingweb.png" alt="Chill Shooters" className="h-14 w-auto object-contain md:h-16" />
          </Link>

          <nav className="hidden items-center gap-10 lg:flex">
            {navLinks.map((link) => (
              <a key={link.href} href={link.href} className="text-sm font-medium text-white/90 transition hover:text-white">
                {link.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <Link
              to={isAuthenticated ? '/app' : '/login'}
              className="hidden text-sm font-medium text-white/90 transition hover:text-white sm:inline"
            >
              {isAuthenticated ? 'My Dashboard' : 'Login'}
            </Link>
            <button
              type="button"
              className="grid h-10 w-10 place-items-center rounded-xl text-white lg:hidden"
              aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen((v) => !v)}
            >
              {mobileNavOpen ? <FiX className="h-6 w-6" /> : <FiMenu className="h-6 w-6" />}
            </button>
          </div>
        </div>

        {mobileNavOpen ? (
          <nav className="border-t border-white/10 px-4 pb-4 lg:hidden">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMobileNavOpen(false)}
                className="block py-3 text-sm font-medium text-white/90"
              >
                {link.label}
              </a>
            ))}
            <Link to={isAuthenticated ? '/app' : '/login'} className="block py-3 text-sm font-medium text-white/90 sm:hidden">
              {isAuthenticated ? 'My Dashboard' : 'Login'}
            </Link>
          </nav>
        ) : null}
      </header>

      {/* Hero: full-bleed photo with the intro card and booking bar on top */}
      <section className="relative isolate z-10 flex min-h-[640px] flex-col bg-[#2f3d1c] text-white md:min-h-[calc(100svh-13.5rem)]">
        <img
          src="/LandingPage-Picture.webp"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 -z-10 h-full w-full object-cover object-[75%_center]"
          onError={(e) => {
            e.currentTarget.style.display = 'none'
          }}
        />

        <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col justify-between gap-8 px-4 pb-8 pt-8 md:gap-6 md:px-8 md:pb-6 md:pt-8">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="max-w-[540px] rounded-lg bg-[rgba(66,82,36,0.78)] px-7 py-10 backdrop-blur-[2px] md:px-8 md:py-8"
          >
            <div className="font-['Poppins'] text-xs font-semibold uppercase tracking-[0.2em] text-white md:text-sm">
              Now Booking
            </div>
            <h1 className="mt-3 font-['Poppins'] text-4xl font-bold leading-tight text-[#c9b98a] md:text-[2.75rem]">
              Gear Up for
              <br />
              Your Next Battle
            </h1>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-white/90 md:text-base">
              Three outdoor fields across Cavite and Laguna, rental gear for every player, and marshals on the
              ground. Pick your field and lock in a slot in minutes.
            </p>
          </motion.div>

          {/* Booking bar */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="mx-auto w-full max-w-[980px] rounded-3xl bg-white p-2 text-[#2b2b2b] shadow-[0_20px_50px_rgba(0,0,0,0.3)] md:rounded-full"
          >
            <div ref={bookingBarRef} className="grid grid-cols-1 gap-1 sm:grid-cols-3 md:flex md:items-center md:gap-0">
              <BookingField
                icon={<FiMapPin />}
                label="Location"
                value={bookingLocations.find((l) => l.id === booking.location)?.name ?? ''}
                open={openMenu === 'location'}
                onToggle={() => toggleMenu('location')}
                popoverClassName="w-80"
              >
                {bookingLocations.map((l) => (
                  <BookingOption
                    key={l.id}
                    selected={booking.location === l.id}
                    title={l.name}
                    detail={l.detail}
                    onSelect={() => {
                      updateBooking('location', l.id)
                      setOpenMenu(null)
                    }}
                  />
                ))}
              </BookingField>

              <span aria-hidden="true" className="hidden h-12 w-0.5 shrink-0 bg-[#d0d0d0] md:block" />

              <BookingField
                icon={<FiClock />}
                label="Date & Time"
                value={bookingDateLabel}
                open={openMenu === 'date'}
                onToggle={() => toggleMenu('date')}
                popoverClassName="w-72 sm:w-64"
              >
                <div className="p-2">
                  <MiniCalendar
                    value={booking.dateISO}
                    minISO={minDateISO}
                    maxISO={maxDateISO}
                    onChange={(iso) => updateBooking('dateISO', iso)}
                  />
                  <div className="mt-2 text-[11px] font-semibold text-[#5a5a5a]">Time slot</div>
                  <div className="mt-1 grid grid-cols-3 gap-1.5">
                    {bookingSlots.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        disabled={slotHasStarted(slotHours, s.id, booking.dateISO)}
                        title={slotHasStarted(slotHours, s.id, booking.dateISO) ? 'Already started today' : undefined}
                        onClick={() => updateBooking('slot', s.id)}
                        className={`rounded-lg px-1 py-1.5 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                          booking.slot === s.id ? 'bg-[#3d4a1e] text-white' : 'bg-[#f0f0ea] text-[#2b2b2b] hover:bg-[#e4e4da]'
                        }`}
                      >
                        {s.label}
                        <span className="block text-[10px] font-normal opacity-80 sm:text-[9px]">{formatSlotRange(slotHours, s.id)}</span>
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpenMenu(null)}
                    className="mt-3 w-full rounded-full bg-[#3d4a1e] py-1.5 text-xs font-semibold text-white transition hover:bg-[#4b5a26]"
                  >
                    Done
                  </button>
                </div>
              </BookingField>

              <span aria-hidden="true" className="hidden h-12 w-0.5 shrink-0 bg-[#d0d0d0] md:block" />

              <BookingField
                icon={<FiUsers />}
                label="Players"
                value={`${booking.players} Players`}
                open={openMenu === 'players'}
                onToggle={() => toggleMenu('players')}
                align="right"
                popoverClassName="w-64"
              >
                <div className="p-2">
                  <div className="text-xs font-semibold text-[#5a5a5a]">Number of players</div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      aria-label="Fewer players"
                      disabled={booking.players <= limits.min}
                      onClick={() => updateBooking('players', Math.max(limits.min, booking.players - 1))}
                      className="grid h-10 w-10 place-items-center rounded-full bg-[#f0f0ea] text-[#3d4a1e] transition hover:bg-[#e4e4da] disabled:opacity-40"
                    >
                      <FiMinus />
                    </button>
                    <div className="text-center">
                      <div className="font-['Poppins'] text-2xl font-semibold">{booking.players}</div>
                      <div className="text-xs text-[#6a6a6a]">players</div>
                    </div>
                    <button
                      type="button"
                      aria-label="More players"
                      disabled={booking.players >= limits.max}
                      onClick={() => updateBooking('players', Math.min(limits.max, booking.players + 1))}
                      className="grid h-10 w-10 place-items-center rounded-full bg-[#f0f0ea] text-[#3d4a1e] transition hover:bg-[#e4e4da] disabled:opacity-40"
                    >
                      <FiPlus />
                    </button>
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-2">
                    {[10, 20, 30, 50].map((n) => (
                      <button
                        key={n}
                        type="button"
                        disabled={n < limits.min || n > limits.max}
                        onClick={() => updateBooking('players', n)}
                        className={`rounded-xl py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                          booking.players === n ? 'bg-[#3d4a1e] text-white' : 'bg-[#f0f0ea] text-[#2b2b2b] hover:bg-[#e4e4da]'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-[#6a6a6a]">
                    {limits.weekend
                      ? `Weekends are public games on all 3 fields (Upper Ground, Lower Ground and Forest): join with any group size. Up to ${limits.max} players per slot.`
                      : `Weekday private game: at least ${limits.min} players, up to ${limits.max}. Your fields: ${booking.fieldArea} (20+ players get Lower Ground too, 50+ get all 3 fields).`}
                  </p>
                  <button
                    type="button"
                    onClick={() => setOpenMenu(null)}
                    className="mt-4 w-full rounded-full bg-[#3d4a1e] py-2 text-sm font-semibold text-white transition hover:bg-[#4b5a26]"
                  >
                    Done
                  </button>
                </div>
              </BookingField>

              <button
                type="button"
                onClick={handleReserve}
                className="col-span-full mt-1 shrink-0 rounded-full bg-[#3d4a1e] px-8 py-3 font-medium text-white transition hover:bg-[#4b5a26] md:col-auto md:ml-2 md:mt-0"
              >
                Reserve
              </button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* How full the coming public games are, and which days are games for a cause */}
      <section className="mx-auto max-w-[1200px] px-4 pt-14 md:px-6 md:pt-10">
        <CapacityCalendar />
      </section>

      {/* How it works */}
      <section id="about" className="mx-auto max-w-[1200px] scroll-mt-24 px-4 pb-16 pt-14 md:px-6 md:pt-10">
        <SectionTitle eyebrow="How it works" title="From booking to battle in four steps" />
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {howItWorks.map((step, idx) => (
            <motion.li
              key={step.title}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.05 }}
              transition={{ duration: 0.4, delay: idx * 0.05 }}
              className="surface rounded-2xl p-5"
            >
              <div className="flex items-center gap-3">
                <span className="chip-accent grid h-10 w-10 place-items-center rounded-xl">
                  <step.icon className="h-5 w-5" />
                </span>
                <span className="text-sm font-semibold text-muted">Step {idx + 1}</span>
              </div>
              <div className="mt-4 text-base font-bold">{step.title}</div>
              <p className="mt-1 text-sm leading-relaxed text-muted">{step.desc}</p>
            </motion.li>
          ))}
        </ol>
      </section>

      <PackagesSection onBook={() => navigate(isAuthenticated ? '/app/reservations' : '/login', isAuthenticated ? undefined : { state: { from: '/app/reservations' } })} />

      {/* FAQ */}
      <section id="guidelines" className="mx-auto max-w-[1200px] scroll-mt-24 px-4 pb-16 md:px-6">
        <div className="grid gap-8 lg:grid-cols-[1fr_2fr]">
          <SectionTitle
            eyebrow="Guidelines"
            title="Good to know before you play"
            subtitle="Still unsure? Send us a message below and we'll get back to you."
          />
          <div className="surface divider divide-y rounded-2xl px-5">
            {faqs.map((f, idx) => {
              const open = faqOpen === idx
              return (
                <div key={f.q} className="divider">
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={`faq-content-${idx}`}
                    className="flex w-full items-center justify-between gap-4 py-4 text-left"
                    onClick={() => handleFaqToggle(idx, open)}
                  >
                    <span className="text-sm font-semibold md:text-base">{f.q}</span>
                    <FiChevronDown className={`shrink-0 text-muted transition ${open ? 'rotate-180' : ''}`} />
                  </button>
                  <div
                    id={`faq-content-${idx}`}
                    className={`overflow-hidden transition-all duration-200 ${open ? 'max-h-[60rem] pb-4 opacity-100' : 'max-h-0 opacity-0'}`}
                  >
                    <p className="text-sm leading-relaxed text-muted">{f.a}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section id="location" className="mx-auto max-w-[1200px] scroll-mt-24 px-4 pb-16 md:px-6">
        <SectionTitle
          eyebrow="Our Locations"
          title="Three distinct spaces for every playstyle"
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {fieldLocations.map((loc, idx) => (
            <motion.div
              key={loc.name}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.4, delay: idx * 0.05 }}
              className="surface flex flex-col overflow-hidden rounded-2xl"
            >
              <div className="aspect-[16/9] w-full overflow-hidden">
                <img
                  src={loc.img}
                  alt={loc.name}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
              <div className="flex-1 p-4">
                <div className="flex items-start gap-2">
                  <FiMapPin className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <div className="text-base font-bold">{loc.name}</div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="chip-accent rounded-full px-2.5 py-1">{loc.size}</span>
                  <span className="chip-accent rounded-full px-2.5 py-1">{loc.capacity}</span>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-muted">{loc.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="mx-auto max-w-[1200px] scroll-mt-24 px-4 pb-12 md:px-6">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="surface rounded-2xl p-6">
            <SectionTitle
              eyebrow="Contact us"
              title="Questions? We're here to help"
              subtitle="Send us a message and we'll reply as soon as we can."
            />
            <form onSubmit={handleContactSubmit} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="sr-only">Your name</span>
                  <input
                    required
                    autoComplete="name"
                    value={contact.name}
                    onChange={(ev) => setContact((c) => ({ ...c, name: ev.target.value }))}
                    placeholder="Your name"
                    className="surface w-full rounded-xl px-4 py-2.5 text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-[rgba(197,163,90,0.4)]"
                  />
                </label>
                <label className="block">
                  <span className="sr-only">Your email</span>
                  <input
                    required
                    type="email"
                    autoComplete="email"
                    value={contact.email}
                    onChange={(ev) => setContact((c) => ({ ...c, email: ev.target.value }))}
                    placeholder="Your email"
                    className="surface w-full rounded-xl px-4 py-2.5 text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-[rgba(197,163,90,0.4)]"
                  />
                </label>
              </div>
              <label htmlFor="contactMessage" className="sr-only">Your message</label>
              <textarea
                id="contactMessage"
                required
                value={contact.message}
                onChange={(ev) => setContact((c) => ({ ...c, message: ev.target.value }))}
                onKeyDown={(ev) => {
                  if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
                    handleContactSubmit(ev)
                  }
                }}
                placeholder="Write your message here…"
                rows={4}
                className="surface w-full resize-y rounded-xl px-4 py-3 text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-[rgba(197,163,90,0.4)]"
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <a href="mailto:support@chillshooters.com" className="inline-flex items-center gap-2 text-sm text-muted hover:text-text">
                  <FiMail /> support@chillshooters.com
                </a>
                <Button type="submit" variant="primary" size="sm" disabled={contactSending}>
                  {contactSending ? 'Sending…' : 'Send message'}
                </Button>
              </div>
            </form>
          </div>

          <LocationsMap />
        </div>

        <footer className="divider mt-10 border-t pt-6 text-center text-xs text-muted">
          © {new Date().getFullYear()} Chill Shooters Airsoft — Aim. Book. Play.
        </footer>
      </section>
    </div>
  )
}
