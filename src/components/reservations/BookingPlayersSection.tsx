import React, { useEffect, useState } from 'react'
import { FiUsers } from 'react-icons/fi'
import { ApiError, apiGet, apiGetAll } from '../../utils/apiClient'
import { reservationStatusLabel } from '../../utils/reservationStatus'
import { ReservationIdTag } from './ReservationIdTag'
import { ReservationChargesSections, type Payment, type ReservationDetails } from './ReservationDetailsDialog'
import { formatSlotRange, useSlotHours } from '../../utils/slotHours'
import { bookingRoles } from '../../utils/bookingRoles'

type Booking = Omit<ReservationDetails, 'teamMembers'> & {
  id?: string
  userId?: string
  // Saved on the booking when it was made, so the booker still shows after their account is deleted.
  bookerName?: string
  bookerEmail?: string
  reservationDate?: string
  dateISO?: string
  reservationTime?: string
  slot?: string
  sessionType?: string
  numberOfPlayers?: number
  teamName?: string
  fieldIds?: string[]
  walkIn?: boolean
  walkInName?: string
  teamMembers?: Array<{ id?: string; name?: string; email?: string; isMinor?: boolean }>
}

type Account = { id?: string; name?: string; email?: string }

const FIELD_NAMES: Record<string, string> = { 'field-1': 'Upper Ground', 'field-2': 'Lower Ground', 'field-3': 'Forest' }
const fieldName = (id: string) => FIELD_NAMES[Object.keys(FIELD_NAMES).find((suffix) => id.endsWith(suffix)) || ''] || id

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-white/5 py-2 text-sm last:border-b-0">
      <div className="text-muted">{label}</div>
      <div className="text-right font-semibold">{children}</div>
    </div>
  )
}

// The booking behind a game: when it is, how many play, on which fields, and who the players are.
// Loads the reservation (and the captain's account) by id, so any game screen can show it.
// `detailed`: also the booking's status, package, rentals, charges, payments and reschedules, so
// staff see everything about the reservation from the game itself.
export function BookingPlayersSection({ reservationId, detailed = false }: { reservationId?: string; detailed?: boolean }) {
  const slotHours = useSlotHours()
  const [state, setState] = useState<{ loading: boolean; booking?: Booking; captain?: Account | null; payments?: Payment[] | null; error?: string }>({ loading: true })

  useEffect(() => {
    if (!reservationId) {
      setState({ loading: false, error: 'This game has no linked booking.' })
      return
    }
    let alive = true
    setState({ loading: true })
    ;(async () => {
      try {
        const res = await apiGet<{ ok: boolean; data: Booking }>(`/api/reservations/${encodeURIComponent(reservationId)}`)
        const booking = res.data
        const ids = [booking?.id, booking?._id, reservationId].filter(Boolean).map(String)
        const [captain, payments] = await Promise.all([
          booking?.userId && !booking.walkIn
            ? apiGet<{ ok: boolean; data: Account }>(`/api/user_accounts/${encodeURIComponent(booking.userId)}`).then((r) => r.data)
              // null: the account was deleted (404); undefined: it just couldn't be loaded right now.
              .catch((e) => (e instanceof ApiError && e.status === 404 ? null : undefined))
            : Promise.resolve(undefined),
          // Roles that can't read payments get null, and the charges are left out instead of showing ₱0 paid.
          detailed
            ? apiGetAll<Payment>('payments', `q=${encodeURIComponent(JSON.stringify({ reservationId: { $in: [...new Set(ids)] } }))}`).catch(() => null)
            : Promise.resolve(null),
        ])
        if (alive) setState({ loading: false, booking, captain, payments })
      } catch (e: any) {
        if (alive) setState({ loading: false, error: e?.message || 'Could not load the booking.' })
      }
    })()
    return () => { alive = false }
  }, [reservationId, detailed])

  if (state.loading) return <div className="text-sm text-muted">Loading players…</div>
  if (state.error || !state.booking) return <div className="text-sm text-muted">{state.error || 'Booking not found.'}</div>

  const booking = state.booking
  const date = booking.reservationDate || booking.dateISO || ''
  const slot = String(booking.reservationTime || booking.slot || '').toLowerCase()
  const fields = (booking.fieldIds || []).map(fieldName).join(' + ')
  const roles = bookingRoles(booking.sessionType)
  // Each player: name, their role on the booking, email, and a note when something's special.
  type PlayerRow = { name: string; role: string; lead?: boolean; email?: string; note?: string }
  const players: PlayerRow[] = booking.walkIn
    ? [{ name: booking.walkInName || 'Walk-in guest', role: 'Walk-in', lead: true }]
    : [
      state.captain === null
        // The booker's account was deleted: show the name saved on the booking, if any.
        ? { name: booking.bookerName || 'Deleted account', role: roles.booker, lead: true, email: booking.bookerEmail, note: 'Account deleted' }
        : { name: state.captain?.name || booking.bookerName || roles.booker, role: roles.booker, lead: true, email: state.captain?.email || booking.bookerEmail },
      ...(booking.teamMembers || []).map((member) => ({
        name: member.name || member.id || roles.member,
        role: member.isMinor ? 'Minor' : roles.member,
        email: member.email,
      })),
    ]
  const guests = Math.max(0, Number(booking.numberOfPlayers || 0) - players.length)

  return (
    <>
    <div className="grid gap-4 md:grid-cols-2">
      <section>
        <div className="text-xs uppercase tracking-widest text-muted">Booking</div>
        <div className="mt-1">
          <Row label="Date">
            {date ? new Date(`${date}T12:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—'}
          </Row>
          <Row label="Time"><span className="capitalize">{slot || '—'}</span>{slot ? ` · ${formatSlotRange(slotHours, slot)}` : ''}</Row>
          <Row label="Players">{booking.numberOfPlayers || players.length}</Row>
          <Row label="Session"><span className="capitalize">{booking.sessionType || 'public'}</span></Row>
          <Row label="Fields">{booking.sessionType === 'public' ? 'All 3 fields' : fields || '—'}</Row>
          {booking.teamName ? <Row label="Team">{booking.teamName}</Row> : null}
          {booking.id ? <Row label="Reservation"><ReservationIdTag id={booking.id} /></Row> : null}
          {detailed ? (
            <>
              <Row label="Booking status"><span className="capitalize">{reservationStatusLabel(booking)}</span></Row>
              <Row label="Package">{booking.packageName || 'Custom selection'}</Row>
              {booking.createdAtISO ? <Row label="Booked on">{new Date(booking.createdAtISO).toLocaleDateString('en-PH', { dateStyle: 'medium' })}</Row> : null}
            </>
          ) : null}
        </div>
      </section>
      <section>
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted"><FiUsers /> Players ({players.length + guests})</div>
        {/* One row per player; the whole list shows (the window scrolls, not the list). */}
        <ul className="mt-2 divide-y divide-white/5 rounded-xl border border-white/10">
          {players.map((player, index) => (
            <li key={`${player.name}-${index}`} className="flex items-center gap-2.5 px-3 py-2">
              <span aria-hidden className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold ${player.lead ? 'bg-accent/20 text-accent' : 'bg-white/10 text-muted'}`}>
                {String(player.name || '?').trim().charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-semibold" title={player.name}>{player.name}</span>
                  <span className={`rounded-full border px-1.5 py-px text-[10px] font-semibold ${player.lead ? 'border-accent/30 bg-accent/10 text-accent' : 'border-white/10 text-muted'}`}>{player.role}</span>
                  {player.note ? <span className="text-[10px] font-semibold text-danger">{player.note}</span> : null}
                </div>
                {player.email ? <div className="truncate text-[11px] text-muted" title={player.email}>{player.email}</div> : null}
              </div>
            </li>
          ))}
          {guests > 0 ? <li className="px-3 py-2 text-xs text-muted">+ {guests} guest{guests === 1 ? '' : 's'} without an account</li> : null}
        </ul>
      </section>
    </div>
    {detailed && state.payments ? <ReservationChargesSections reservation={booking} payments={state.payments} /> : null}
    </>
  )
}
