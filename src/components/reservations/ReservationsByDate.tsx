import React, { useEffect, useMemo, useState } from 'react'
import { FiCalendar, FiRefreshCw, FiUsers } from 'react-icons/fi'
import toast from 'react-hot-toast'

import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { apiGet } from '../../utils/apiClient'

type ReservationDoc = {
  _id?: any
  id?: string
  userId?: string
  reservationStatus?: string
  reservationDate?: string
  dateISO?: string
  reservationTime?: string
  slot?: string
  locationName?: string
  locationId?: string
  sessionType?: string
  numberOfPlayers?: number
  packageName?: string
  teamName?: string
  walkIn?: boolean
  walkInName?: string
  teamMembers?: Array<{ id?: string; name?: string; email?: string }>
}

type AccountDoc = { _id?: any; id?: string; name?: string; email?: string }

type Player = { name: string; email: string; role: 'Captain' | 'Teammate' | 'Walk-in' }

const SLOT_ORDER = ['morning', 'afternoon', 'evening']

function manilaTodayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())
}

function formatDate(iso: string) {
  const date = new Date(`${iso}T12:00:00Z`)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

const statusTone = (status: string) =>
  status === 'confirmed' || status === 'approved'
    ? 'border-success/30 bg-success/15 text-success'
    : status === 'needs review'
      ? 'border-accent/30 bg-accent/15 text-accent'
      : status === 'cancelled'
        ? 'border-danger/30 bg-danger/15 text-danger'
        : 'border-white/10 bg-white/5 text-muted'

// Reservations grouped by game date: each date lists its bookings and every player in them.
// Payment review and status decisions live on the Payments page.
export function ReservationsByDate() {
  const [reservations, setReservations] = useState<ReservationDoc[]>([])
  const [accounts, setAccounts] = useState<AccountDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [showPast, setShowPast] = useState(false)
  const [showCancelled, setShowCancelled] = useState(false)
  const [openDate, setOpenDate] = useState<string | null>(null)
  const today = manilaTodayISO()

  const load = async () => {
    setLoading(true)
    try {
      const [reservationRes, accountRes] = await Promise.all([
        apiGet<{ ok: boolean; data: ReservationDoc[] }>('/api/reservations?limit=200'),
        apiGet<{ ok: boolean; data: AccountDoc[] }>('/api/user_accounts?limit=200'),
      ])
      setReservations(Array.isArray(reservationRes?.data) ? reservationRes.data : [])
      setAccounts(Array.isArray(accountRes?.data) ? accountRes.data : [])
    } catch (e: any) {
      toast.error(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const accountById = useMemo(() => new Map(accounts.map((account) => [String(account.id || account._id || ''), account])), [accounts])

  const playersOf = (reservation: ReservationDoc): Player[] => {
    if (reservation.walkIn) {
      return [{ name: reservation.walkInName || 'Walk-in guest', email: '', role: 'Walk-in' }]
    }
    const captain = accountById.get(String(reservation.userId || ''))
    const list: Player[] = [{ name: captain?.name || String(reservation.userId || 'Unknown'), email: captain?.email || '', role: 'Captain' }]
    for (const member of reservation.teamMembers || []) {
      const account = accountById.get(String(member.id || ''))
      list.push({ name: account?.name || member.name || String(member.id || 'Teammate'), email: account?.email || member.email || '', role: 'Teammate' })
    }
    return list
  }

  const days = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const byDate = new Map<string, ReservationDoc[]>()
    for (const reservation of reservations) {
      const date = String(reservation.reservationDate || reservation.dateISO || '')
      if (!date) continue
      const status = String(reservation.reservationStatus || 'pending').toLowerCase()
      if (!showCancelled && status === 'cancelled') continue
      if (!showPast && date < today) continue
      if (needle) {
        const haystack = [
          reservation.id, reservation.teamName, reservation.locationName, reservation.packageName,
          ...playersOf(reservation).flatMap((player) => [player.name, player.email]),
        ].join(' ').toLowerCase()
        if (!haystack.includes(needle)) continue
      }
      byDate.set(date, [...(byDate.get(date) || []), reservation])
    }
    return [...byDate.entries()]
      .sort(([a], [b]) => (showPast ? b.localeCompare(a) : a.localeCompare(b)))
      .map(([date, items]) => ({
        date,
        bookings: items.sort((a, b) =>
          SLOT_ORDER.indexOf(String(a.reservationTime || a.slot || '').toLowerCase()) -
          SLOT_ORDER.indexOf(String(b.reservationTime || b.slot || '').toLowerCase())),
      }))
    // playersOf only depends on accountById
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservations, accountById, query, showPast, showCancelled, today])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Reservations</h1>
          <p className="mt-1 text-sm text-muted">Dates with bookings and the players in each booking. Review payments and booking decisions on the Payments page.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
          <FiRefreshCw /> Refresh
        </Button>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-end">
          <Input label="Search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Player name, email, team name, or reservation ID" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} /> Past dates
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> Cancelled
          </label>
        </div>
      </Card>

      {loading ? <Card className="p-4 text-sm text-muted">Loading reservations…</Card> : null}
      {!loading && days.length === 0 ? (
        <Card className="p-4 text-sm text-muted">{query ? 'No bookings match your search.' : 'No upcoming dates have bookings.'}</Card>
      ) : null}

      {days.map(({ date, bookings }) => {
        const isOpen = openDate === date || Boolean(query.trim())
        const totalPlayers = bookings.reduce((sum, booking) => sum + Number(booking.numberOfPlayers || 0), 0)
        return (
          <Card key={date} className="p-0">
            <button
              type="button"
              onClick={() => setOpenDate(isOpen && !query.trim() ? null : date)}
              className="flex w-full items-center justify-between gap-3 p-4 text-left"
              aria-expanded={isOpen}
            >
              <div className="flex items-center gap-3">
                <FiCalendar className="text-gold" />
                <div>
                  <div className="font-bold">{formatDate(date)}{date === today ? ' (today)' : ''}</div>
                  <div className="text-xs text-muted">{bookings.length} booking{bookings.length === 1 ? '' : 's'} • {totalPlayers} players</div>
                </div>
              </div>
              <span className="text-xs text-muted">{isOpen ? 'Hide' : 'Show players'}</span>
            </button>

            {isOpen ? (
              <div className="space-y-3 border-t border-white/5 p-4">
                {bookings.map((booking) => {
                  const status = String(booking.reservationStatus || 'pending').toLowerCase()
                  const players = playersOf(booking)
                  const guests = Math.max(0, Number(booking.numberOfPlayers || 0) - players.length)
                  return (
                    <div key={booking.id || String(booking._id)} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="font-semibold">
                            <span className="capitalize">{booking.reservationTime || booking.slot || '—'}</span> • {booking.locationName || booking.locationId || '—'}
                            {booking.teamName ? <> • {booking.teamName}</> : null}
                          </div>
                          <div className="text-xs text-muted">
                            {booking.id} • <span className="capitalize">{booking.sessionType || 'public'}</span> • {booking.numberOfPlayers || 0} players • {booking.packageName || 'Custom selection'}
                          </div>
                        </div>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase ${statusTone(status)}`}>{status}</span>
                      </div>
                      <div className="mt-3 flex items-center gap-2 text-xs uppercase tracking-widest text-muted"><FiUsers /> Players</div>
                      <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                        {players.map((player, index) => (
                          <li key={`${player.name}-${index}`} className="text-sm">
                            <span className="font-semibold">{player.name}</span>
                            <span className="text-xs text-muted"> • {player.role}{player.email ? ` • ${player.email}` : ''}</span>
                          </li>
                        ))}
                        {guests > 0 ? (
                          <li className="text-sm text-muted">+ {guests} guest{guests === 1 ? '' : 's'} without an account</li>
                        ) : null}
                      </ul>
                    </div>
                  )
                })}
              </div>
            ) : null}
          </Card>
        )
      })}
    </div>
  )
}
