import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  FiBox,
  FiCalendar,
  FiCheck,
  FiChevronDown,
  FiChevronLeft,
  FiChevronRight,
  FiClock,
  FiCreditCard,
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
import { useAuth } from '../../context/AuthContext'

type FAQ = {
  q: string
  a: string
}

type LocationOption = 'salawag' | 'langkaan' | 'binan'
type FieldArea = 'Upper Ground' | 'Lower Ground' | 'Forest'
type TimeSlot = 'morning' | 'afternoon' | 'evening'
type BookingMenu = 'location' | 'field' | 'date' | 'players'

// Read (and cleared) by ReservationCalendarPage to prefill step 1.
export const LANDING_PREFILL_KEY = 'landing_reservation_prefill'

export type LandingReservationPrefill = {
  location: LocationOption
  fieldArea: FieldArea
  dateISO: string
  slot: TimeSlot
  players: number
}

const bookingLocations: { id: LocationOption; name: string; detail: string }[] = [
  { id: 'salawag', name: 'Delta Stronghold (Salawag)', detail: 'About 2 hectares · up to 400 players' },
  { id: 'langkaan', name: 'Delta Stronghold (Langkaan)', detail: 'About 2 hectares · up to 400 players' },
  { id: 'binan', name: 'LOMA Binan Laguna', detail: 'About 4 hectares · up to 600 players' },
]

const fieldAreas: { id: FieldArea; detail: string }[] = [
  { id: 'Upper Ground', detail: 'Private games from 10 players' },
  { id: 'Lower Ground', detail: 'Private games from 20 players' },
  { id: 'Forest', detail: 'Private games from 50 players' },
]

const MIN_BOOKING_PLAYERS = 2
const MAX_BOOKING_PLAYERS = 100

const bookingSlots: { id: TimeSlot; label: string }[] = [
  { id: 'morning', label: 'Morning' },
  { id: 'afternoon', label: 'Afternoon' },
  { id: 'evening', label: 'Evening' },
]

const howItWorks = [
  { icon: FiCalendar, title: 'Pick your slot', desc: 'Choose a field, date, and time that fits your group.' },
  { icon: FiShield, title: 'Sign the waiver', desc: 'A quick online form. Players under 18 need a guardian.' },
  { icon: FiCreditCard, title: 'Pay online', desc: 'Settle by GCash or bank transfer and upload your receipt.' },
  { icon: FiTarget, title: 'Show up and play', desc: 'Our marshals brief your squad and get you in the game.' },
]

const navLinks = [
  { href: '#about', label: 'About' },
  { href: '/app/packages', label: 'Packages' },
  { href: '#guidelines', label: 'Guidelines' },
  { href: '#location', label: 'Location' },
  { href: '#contact', label: 'Contact Us' },
]

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
          className="grid h-6 w-6 text-sm place-items-center rounded-full text-[#3d4a1e] transition hover:bg-[#f0f0ea] disabled:opacity-30 disabled:hover:bg-transparent"
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
          className="grid h-6 w-6 text-sm place-items-center rounded-full text-[#3d4a1e] transition hover:bg-[#f0f0ea] disabled:opacity-30 disabled:hover:bg-transparent"
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
              className={`mx-auto grid h-7 w-7 place-items-center rounded-full text-xs transition ${
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

  const minDateISO = useMemo(() => {
    const d = new Date()
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
    slot: 'morning',
    players: 10,
  })

  const updateBooking = <K extends keyof LandingReservationPrefill>(key: K, value: LandingReservationPrefill[K]) => {
    setBooking((prev) => ({ ...prev, [key]: value }))
  }

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
      const apiBase = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001'
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
        q: 'What is the age requirement to play?',
        a: 'Players of any age may join. Minors must be accompanied by a parent or guardian and must present a valid school ID. All players are required to sign a consent form on site.',
      },
      {
        q: 'Do you accept walk-in players?',
        a: 'Yes, walk-in players are accepted. However, due to limited equipment, advance reservation is highly recommended.',
      },
      {
        q: 'Can beginners or first-time players join?',
        a: 'Yes, the field is open to beginners, casual players, and experienced players. Game marshals are present to guide first-time players.',
      },
      {
        q: 'Is safety equipment required?',
        a: 'Yes, protective masks are required at all times during gameplay. Other safety rules will be discussed during the orientation.',
      },
      {
        q: 'What happens if it rains?',
        a: 'Games may continue depending on weather conditions. In case of unsafe conditions, the field management will provide further instructions.',
      },
      {
        q: 'Can players bring their own airsoft guns?',
        a: 'Yes, players who already have their own airsoft guns may use them, provided they pass the FPS and safety checks.',
      },
    ],
    [],
  )

  return (
    <div className="relative min-h-screen bg-background text-text">
      <header className="sticky top-0 z-50 bg-[#5b6b3a] text-white shadow-[0_2px_12px_rgba(0,0,0,0.25)] bg-[url('/NavBar-BG.webp')] bg-cover bg-center">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-3 md:px-8">
          <Link to="/" className="flex items-center" aria-label="Chill Shooters home">
            <img src="/logingweb.png" alt="Chill Shooters" className="h-12 w-auto object-contain md:h-12" />
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
              {isAuthenticated ? 'My Dashboard' : 'Login/Sign in'}
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
              {isAuthenticated ? 'My Dashboard' : 'Login/Sign in'}
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
            <div ref={bookingBarRef} className="grid grid-cols-1 gap-1 sm:grid-cols-2 md:flex md:items-center md:gap-0">
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
                icon={<FiBox />}
                label="Field Area"
                value={booking.fieldArea}
                open={openMenu === 'field'}
                onToggle={() => toggleMenu('field')}
              >
                {fieldAreas.map((f) => (
                  <BookingOption
                    key={f.id}
                    selected={booking.fieldArea === f.id}
                    title={f.id}
                    detail={f.detail}
                    onSelect={() => {
                      updateBooking('fieldArea', f.id)
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
                popoverClassName="w-64"
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
                        onClick={() => updateBooking('slot', s.id)}
                        className={`rounded-lg px-1 py-1.5 text-[11px] font-semibold transition ${
                          booking.slot === s.id ? 'bg-[#3d4a1e] text-white' : 'bg-[#f0f0ea] text-[#2b2b2b] hover:bg-[#e4e4da]'
                        }`}
                      >
                        {s.label}
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
                      disabled={booking.players <= MIN_BOOKING_PLAYERS}
                      onClick={() => updateBooking('players', Math.max(MIN_BOOKING_PLAYERS, booking.players - 1))}
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
                      disabled={booking.players >= MAX_BOOKING_PLAYERS}
                      onClick={() => updateBooking('players', Math.min(MAX_BOOKING_PLAYERS, booking.players + 1))}
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
                        onClick={() => updateBooking('players', n)}
                        className={`rounded-xl py-1.5 text-xs font-semibold transition ${
                          booking.players === n ? 'bg-[#3d4a1e] text-white' : 'bg-[#f0f0ea] text-[#2b2b2b] hover:bg-[#e4e4da]'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
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
                    className={`overflow-hidden transition-all duration-200 ${open ? 'max-h-96 pb-4 opacity-100' : 'max-h-0 opacity-0'}`}
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
          {([
            {
              name: 'Delta Stronghold (Salawag)',
              img: '/delta.png',
              size: '~2 hectares',
              capacity: 'Up to 400 players',
              desc: 'Ideal for small to medium groups and tournaments.',
            },
            {
              name: 'Delta Stronghold (Langkaan)',
              img: '/langkaanPlaceholder.png',
              size: '~2 hectares',
              capacity: 'Up to 400 players',
              desc: 'Ideal for small to medium groups and tournaments.',
            },
            {
              name: 'LOMA Binan Laguna',
              img: '/loma.png',
              size: '~4 hectares',
              capacity: 'Up to 600 players',
              desc: 'Ideal for large groups and tournaments.',
            },
          ] as const).map((loc, idx) => (
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

          <div className="surface flex flex-col overflow-hidden rounded-2xl">
            <iframe
              title="Chill Shooters locations"
              src="https://www.google.com/maps?q=Chill%20Shooters%20Airsoft&output=embed"
              className="min-h-[260px] w-full flex-1 border-0"
              loading="lazy"
            />
            <a
              href="https://www.google.com/maps/search/?api=1&query=Chill+Shooters+Airsoft"
              target="_blank"
              rel="noreferrer"
              className="hover-row flex items-center justify-between px-5 py-3 text-sm font-medium"
            >
              Open in Google Maps <FiChevronRight className="text-muted" />
            </a>
          </div>
        </div>

        <footer className="divider mt-10 border-t pt-6 text-center text-xs text-muted">
          © {new Date().getFullYear()} Chill Shooters Airsoft — Aim. Book. Play.
        </footer>
      </section>
    </div>
  )
}
