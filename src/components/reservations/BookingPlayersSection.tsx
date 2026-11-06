import React, { useEffect, useState } from 'react'
import { FiUsers } from 'react-icons/fi'
import { apiGet } from '../../utils/apiClient'
import { formatSlotRange, useSlotHours } from '../../utils/slotHours'

type Booking = {
  id?: string
  userId?: string
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
export function BookingPlayersSection({ reservationId }: { reservationId?: string }) {
  const slotHours = useSlotHours()
  const [state, setState] = useState<{ loading: boolean; booking?: Booking; captain?: Account; error?: string }>({ loading: true })

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
        let captain: Account | undefined
        if (booking?.userId && !booking.walkIn) {
          captain = await apiGet<{ ok: boolean; data: Account }>(`/api/user_accounts/${encodeURIComponent(booking.userId)}`)
            .then((r) => r.data)
            .catch(() => undefined)
        }
        if (alive) setState({ loading: false, booking, captain })
      } catch (e: any) {
        if (alive) setState({ loading: false, error: e?.message || 'Could not load the booking.' })
      }
    })()
    return () => { alive = false }
  }, [reservationId])

  if (state.loading) return <div className="text-sm text-muted">Loading players…</div>
  if (state.error || !state.booking) return <div className="text-sm text-muted">{state.error || 'Booking not found.'}</div>

  const booking = state.booking
  const date = booking.reservationDate || booking.dateISO || ''
  const slot = String(booking.reservationTime || booking.slot || '').toLowerCase()
  const fields = (booking.fieldIds || []).map(fieldName).join(' + ')
  const players = booking.walkIn
    ? [{ name: booking.walkInName || 'Walk-in guest', detail: 'Walk-in' }]
    : [
      { name: state.captain?.name || 'Captain', detail: ['Captain', state.captain?.email].filter(Boolean).join(' · ') },
      ...(booking.teamMembers || []).map((member) => ({
        name: member.name || member.id || 'Teammate',
        detail: [member.isMinor ? 'Minor' : 'Teammate', member.email].filter(Boolean).join(' · '),
      })),
    ]
  const guests = Math.max(0, Number(booking.numberOfPlayers || 0) - players.length)

  return (
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
          {booking.id ? <Row label="Reservation">{booking.id}</Row> : null}
        </div>
      </section>
      <section>
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted"><FiUsers /> Players ({players.length + guests})</div>
        <ul className="mt-2 max-h-64 space-y-1.5 overflow-y-auto pr-1 text-sm">
          {players.map((player, index) => (
            <li key={`${player.name}-${index}`}>
              <span className="font-semibold">{player.name}</span>
              <span className="text-xs text-muted"> · {player.detail}</span>
            </li>
          ))}
          {guests > 0 ? <li className="text-muted">+ {guests} guest{guests === 1 ? '' : 's'} without an account</li> : null}
        </ul>
      </section>
    </div>
  )
}
