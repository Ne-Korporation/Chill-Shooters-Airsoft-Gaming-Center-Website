import React, { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { FiAlertTriangle, FiClock, FiCreditCard, FiMapPin, FiPlusCircle, FiRefreshCw, FiSearch, FiTarget, FiUsers, FiZap } from 'react-icons/fi'

import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { BookingPlayersSection } from '../../components/reservations/BookingPlayersSection'
import { apiGet, apiPost } from '../../utils/apiClient'
import { useAuth } from '../../context/AuthContext'
import { formatSchedule, locationName } from '../registrar/RegistrarOngoingGamesPage'
import { RentalsPanel, StillOutPanel } from './RentalsPage'
import { TeamCheckIn, fetchCheckInTeams, type CheckInSession, type CheckInTeam } from './FieldCheckInPage'
import { SessionTeams } from './TeamGroupingPage'
import { formatDateTime, formatPHP, manilaTodayISO, selectClass } from './shared'

type Ledger = {
  reservation: {
    id: string
    walkIn: boolean
    walkInName: string
    reservationDate: string
    reservationTime: string
    locationId?: string
    locationName?: string
    numberOfPlayers: number
    packageName?: string
    reservationStatus: string
    captainName?: string
  }
  total: number
  depositAmount: number
  breakdown: Array<{ label: string; amount: number }>
  payments: Array<{ id: string; amount: number; paymentMethod: string; paymentStatus: string; kind: string; transactionReference: string; createdAtISO: string }>
  collected: number
  balanceDue: number
}

type ChargeConfig = Record<string, { label: string; unitPrice: number }>

type GameDoc = {
  id?: string
  _id?: any
  reservationId?: string
  Schedule?: string
  LocationId?: string
  Location?: string
  Package?: string
  Group?: string
  Mode?: string
  Status?: string
}

type BookingSummary = { id?: string; walkIn?: boolean; walkInName?: string; numberOfPlayers?: number; packageName?: string }

export const PAYMENT_METHODS = [
  { id: 'cash', label: 'Cash' },
  { id: 'gcash', label: 'GCash' },
  { id: 'bank_transfer', label: 'Bank transfer' },
]

const gameKey = (doc: GameDoc) => String(doc.id || doc._id?.$oid || doc._id || doc.reservationId || '')

// The check-in session a game belongs to, from its "YYYY-MM-DD • slot" schedule and location.
function sessionOfGame(doc: GameDoc): CheckInSession | null {
  const date = String(doc.Schedule || '').slice(0, 10)
  const slot = String(doc.Schedule || '').split('•')[1]?.trim().toLowerCase() || ''
  const location = String(doc.LocationId || '').toLowerCase()
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && slot && location ? { location, date, slot } : null
}
const sessionId = (s: CheckInSession) => `${s.location}|${s.date}|${s.slot}`

// The bill for one booking: what was charged and paid, quick ammo reloads, any other charge, and
// the onsite payment form.
// `canTakePayment`: marshals add ammo and charges on the field; only admins and registrars take payment.
function LedgerPanel({ reservationId, canTakePayment, onLoaded }: { reservationId: string; canTakePayment: boolean; onLoaded?: (ledger: Ledger) => void }) {
  const [ledger, setLedger] = useState<Ledger | null>(null)
  const [config, setConfig] = useState<ChargeConfig>({})
  const [payment, setPayment] = useState({ amount: '', method: 'cash', reference: '', note: '' })
  const [charge, setCharge] = useState({ type: 'ammo_reload', quantity: '1', unitPrice: '', note: '' })
  const [busy, setBusy] = useState(false)

  const applyLedger = useCallback((next: Ledger) => {
    setLedger(next)
    setPayment((p) => ({ ...p, amount: String(next.balanceDue || '') }))
    onLoaded?.(next)
  }, [onLoaded])

  useEffect(() => {
    apiGet<{ data: ChargeConfig }>('/api/charge-config').then((res) => setConfig(res.data)).catch(() => null)
  }, [])

  useEffect(() => {
    setLedger(null)
    apiGet<{ data: Ledger }>(`/api/reservations/${encodeURIComponent(reservationId)}/ledger`)
      .then((res) => applyLedger(res.data))
      .catch((e) => toast.error(e?.message || 'Reservation not found'))
    // applyLedger only changes with onLoaded; reload just when the booking changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservationId])

  useEffect(() => {
    if (config[charge.type]) setCharge((c) => ({ ...c, unitPrice: String(config[c.type]?.unitPrice || '') }))
  }, [charge.type, config])

  const postCharge = async (body: { type: string; quantity: number; unitPrice: number; note: string }, message: string) => {
    setBusy(true)
    try {
      const res = await apiPost<{ ledger: Ledger }>(`/api/reservations/${encodeURIComponent(reservationId)}/charges`, body)
      applyLedger(res.ledger)
      toast.success(message)
      return true
    } catch (e: any) {
      toast.error(e?.message || 'Could not add the charge')
      return false
    } finally {
      setBusy(false)
    }
  }

  const quickAmmo = (quantity: number) => {
    const unitPrice = Number(config.ammo_reload?.unitPrice || 0)
    void postCharge({ type: 'ammo_reload', quantity, unitPrice, note: '' }, `Added ${quantity} ammo reload${quantity === 1 ? '' : 's'}.`)
  }

  const addCharge = async (event: React.FormEvent) => {
    event.preventDefault()
    const ok = await postCharge({ ...charge, quantity: Number(charge.quantity), unitPrice: Number(charge.unitPrice) }, 'Charge added to the bill.')
    if (ok) setCharge((c) => ({ ...c, quantity: '1', note: '' }))
  }

  const recordPayment = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      const res = await apiPost<{ ledger: Ledger }>('/api/payments/onsite', { reservationId, ...payment, amount: Number(payment.amount) })
      applyLedger(res.ledger)
      setPayment((p) => ({ ...p, reference: '', note: '' }))
      toast.success('Payment recorded.')
    } catch (e: any) {
      toast.error(e?.message || 'Could not record the payment')
    } finally {
      setBusy(false)
    }
  }

  if (!ledger) return <div className="text-sm text-muted">Loading the bill…</div>
  const ammoPrice = Number(config.ammo_reload?.unitPrice || 0)

  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
      <Card className="p-4">
        <div className="text-xs uppercase tracking-widest text-muted">Bill</div>
        <div className="mt-2 space-y-1 text-sm">
          {ledger.breakdown.map((item, index) => (
            <div key={`${item.label}-${index}`} className="flex justify-between gap-3">
              <span className="text-muted">{item.label}</span>
              <span>{formatPHP(item.amount)}</span>
            </div>
          ))}
          <div className="my-2 h-px bg-white/10" />
          <div className="flex justify-between font-semibold"><span>Total</span><span>{formatPHP(ledger.total)}</span></div>
          <div className="flex justify-between"><span className="text-muted">Paid so far</span><span>{formatPHP(ledger.collected)}</span></div>
          <div className="flex justify-between text-base font-bold text-gold"><span>Balance due</span><span>{formatPHP(ledger.balanceDue)}</span></div>
        </div>
        <div className="mt-4 text-xs uppercase tracking-widest text-muted">Payments</div>
        <ul className="mt-2 space-y-1 text-xs">
          {ledger.payments.length === 0 ? <li className="text-muted">None yet.</li> : ledger.payments.map((p) => (
            <li key={p.id} className="flex justify-between gap-2">
              <span>{p.paymentMethod} · {p.kind === 'onsite' ? 'onsite' : 'online'} · <span className="capitalize">{p.paymentStatus}</span>{p.transactionReference ? ` · ${p.transactionReference}` : ''}</span>
              <span>{formatPHP(p.amount)} · {formatDateTime(p.createdAtISO)}</span>
            </li>
          ))}
        </ul>
      </Card>

      <div className="space-y-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm font-bold"><FiTarget /> Extra ammo</div>
          <p className="mt-1 text-xs text-muted">{ammoPrice ? `${formatPHP(ammoPrice)} per reload.` : 'Loading price…'}</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[1, 2, 5].map((qty) => (
              <Button key={qty} type="button" variant="ghost" disabled={busy || !ammoPrice} onClick={() => quickAmmo(qty)}>
                +{qty}
              </Button>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm font-bold"><FiPlusCircle /> Add a charge</div>
          <form className="mt-3 space-y-3" onSubmit={addCharge}>
            <label className="block">
              <div className="mb-2 text-sm font-semibold">Type</div>
              <select value={charge.type} onChange={(e) => setCharge((c) => ({ ...c, type: e.target.value }))} className={selectClass}>
                {Object.entries(config).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Quantity" type="number" min={1} value={charge.quantity} onChange={(e) => setCharge((c) => ({ ...c, quantity: e.target.value }))} />
              <Input label="Price each" type="number" min={0} step="0.01" value={charge.unitPrice} onChange={(e) => setCharge((c) => ({ ...c, unitPrice: e.target.value }))} />
            </div>
            <Input
              label={charge.type === 'other' ? 'Description' : 'Note (optional)'}
              value={charge.note}
              onChange={(e) => setCharge((c) => ({ ...c, note: e.target.value }))}
            />
            <Button type="submit" variant="ghost" className="w-full" disabled={busy}>Add to bill</Button>
          </form>
        </Card>

        {canTakePayment ? (
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm font-bold"><FiCreditCard /> Record onsite payment</div>
          <form className="mt-3 space-y-3" onSubmit={recordPayment}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Amount" type="number" min={0} step="0.01" value={payment.amount} onChange={(e) => setPayment((p) => ({ ...p, amount: e.target.value }))} />
              <label className="block">
                <div className="mb-2 text-sm font-semibold">Method</div>
                <select value={payment.method} onChange={(e) => setPayment((p) => ({ ...p, method: e.target.value }))} className={selectClass}>
                  {PAYMENT_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </label>
            </div>
            {payment.method !== 'cash' ? (
              <Input label="Reference number" value={payment.reference} onChange={(e) => setPayment((p) => ({ ...p, reference: e.target.value }))} />
            ) : null}
            <Button type="submit" className="w-full" disabled={busy || ledger.balanceDue <= 0}>
              {ledger.balanceDue <= 0 ? 'Fully paid' : 'Record payment'}
            </Button>
          </form>
        </Card>
        ) : (
          <p className="text-xs text-muted">The registrar collects the balance at the counter.</p>
        )}
      </div>
    </div>
  )
}

type DialogTab = 'checkin' | 'teams' | 'bill' | 'rentals'

// Pop-up for one game, in the order a game day runs: Check-in (tick off players as they arrive),
// Teams (balanced teams for the whole session; admins and marshals), Bill & ammo (extra ammo,
// charges, payment) and Rentals (which player has which unit).
function GameDialog({ reservationId, game, canTakePayment, canGroupTeams, onClose }: { reservationId: string; game?: GameDoc; canTakePayment: boolean; canGroupTeams: boolean; onClose: () => void }) {
  const [ledger, setLedger] = useState<Ledger | null>(null)
  // A game that hasn't started is usually opened to check players in; a running one to bill it.
  const [tab, setTab] = useState<DialogTab>(/^ongo/i.test(String(game?.Status || '')) ? 'bill' : 'checkin')
  const r = ledger?.reservation
  const title = r ? (r.walkIn ? `Walk-in: ${r.walkInName}` : r.captainName || r.packageName || 'Reservation') : 'Game'
  const subtitle = game ? formatSchedule(game) : r ? `${r.reservationDate} · ${r.reservationTime}` : ''
  // The check-in session: from the game when opened from a card, otherwise from the booking.
  const session: CheckInSession | null = (game && sessionOfGame(game))
    || (r?.locationId && r.reservationDate && r.reservationTime
      ? { location: r.locationId.toLowerCase(), date: r.reservationDate, slot: r.reservationTime.toLowerCase() }
      : null)

  return (
    <Modal eyebrow={`${game?.id ? `Game ${game.id} · ` : ''}${reservationId}`} title={title} size="xl" onClose={onClose}>
      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        {subtitle ? <span className="inline-flex items-center gap-1"><FiClock /> {subtitle}</span> : null}
        <span className="inline-flex items-center gap-1"><FiMapPin /> {game ? locationName(game) : r?.locationName || '—'}</span>
        {r ? <span className="inline-flex items-center gap-1"><FiUsers /> {r.numberOfPlayers} players</span> : null}
        {r ? <span className="capitalize">{r.reservationStatus}</span> : null}
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          ['checkin', 'Check-in'],
          ...(canGroupTeams ? [['teams', 'Teams'] as const] : []),
          ['bill', 'Bill & ammo'],
          ['rentals', 'Rentals'],
        ]}
      />
      {/* All tabs stay mounted so switching keeps what was typed and what was loaded. */}
      <div className={`mt-4 ${tab === 'checkin' ? '' : 'hidden'}`}>
        {session ? (
          <TeamCheckIn key={sessionId(session)} session={session} reservationId={reservationId} />
        ) : r ? (
          <BookingPlayersSection reservationId={reservationId} />
        ) : (
          <div className="text-sm text-muted">Loading check-in…</div>
        )}
      </div>
      {canGroupTeams ? (
        <div className={`mt-4 ${tab === 'teams' ? '' : 'hidden'}`}>
          {session ? (
            <SessionTeams key={sessionId(session)} session={session} active={tab === 'teams'} />
          ) : (
            <div className="text-sm text-muted">{r ? 'This booking has no session to group.' : 'Loading teams…'}</div>
          )}
        </div>
      ) : null}
      <div className={`mt-4 ${tab === 'bill' ? '' : 'hidden'}`}>
        <LedgerPanel reservationId={reservationId} canTakePayment={canTakePayment} onLoaded={setLedger} />
      </div>
      <div className={`mt-4 ${tab === 'rentals' ? '' : 'hidden'}`}>
        <RentalsPanel reservationId={reservationId} />
      </div>
    </Modal>
  )
}

function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (value: T) => void; options: ReadonlyArray<readonly [T, React.ReactNode]> }) {
  return (
    <div className="inline-flex flex-wrap rounded-2xl border border-white/10 bg-white/5 p-1 text-sm">
      {options.map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={`rounded-xl px-3 py-1.5 font-semibold ${value === id ? 'bg-accent/20 text-accent' : 'text-muted hover:text-text'}`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

type View = 'ongoing' | 'today' | 'out'
const VIEWS: View[] = ['ongoing', 'today', 'out']

// Games: every game on the field right now. Click one to add extra ammo, field fees or other
// charges, issue and check in rentals, and (admins and registrars) take payment. The "Still out"
// tab lists every rental not yet returned. Walk-ins open their new booking here (?reservation=<id>).
export function CounterPage() {
  const { user } = useAuth()
  const canTakePayment = user?.role === 'admin' || user?.role === 'registrar'
  const canGroupTeams = user?.role === 'admin' || user?.role === 'marshal'
  const [searchParams, setSearchParams] = useSearchParams()
  const fromLink = searchParams.get('reservation') || ''
  const fromView = searchParams.get('view') as View | null
  const [view, setView] = useState<View>(fromView && VIEWS.includes(fromView) ? fromView : 'ongoing')
  const [games, setGames] = useState<GameDoc[]>([])
  const [bookings, setBookings] = useState<Map<string, BookingSummary>>(new Map())
  const [arrivals, setArrivals] = useState<Map<string, { arrived: number; total: number }>>(new Map())
  const [loading, setLoading] = useState(true)
  const [lookup, setLookup] = useState('')
  const [stillOut, setStillOut] = useState<number | null>(null)
  const [open, setOpen] = useState<{ reservationId: string; game?: GameDoc } | null>(fromLink ? { reservationId: fromLink } : null)

  const load = useCallback(async (silent = false) => {
    if (view === 'out') return
    if (!silent) setLoading(true)
    const today = manilaTodayISO()
    // Schedule is stored as "YYYY-MM-DD • slot".
    const q = view === 'ongoing'
      ? { Status: { $regex: '^ongo', $options: 'i' } }
      : { $and: [{ Schedule: { $regex: `^${today}` } }, { Status: { $not: { $regex: 'arch|cancel', $options: 'i' } } }] }
    try {
      const res = await apiGet<{ data: GameDoc[] }>(`/api/gameplay?q=${encodeURIComponent(JSON.stringify(q))}&sort=${encodeURIComponent(JSON.stringify({ Schedule: 1 }))}&limit=100`)
      const docs = Array.isArray(res?.data) ? res.data : []
      setGames(docs)
      const ids = [...new Set(docs.map((d) => String(d.reservationId || '')).filter(Boolean))]
      // Check-in counts for each card: one request per session (location + date + slot), not per game.
      const sessions = new Map(docs.map(sessionOfGame).filter((s): s is CheckInSession => Boolean(s)).map((s) => [sessionId(s), s]))
      const [bRes, sessionTeams] = await Promise.all([
        ids.length
          ? apiGet<{ data: BookingSummary[] }>(`/api/reservations?q=${encodeURIComponent(JSON.stringify({ id: { $in: ids } }))}&limit=${ids.length}`).catch(() => null)
          : null,
        Promise.all([...sessions.values()].map((s) => fetchCheckInTeams(s).catch(() => [] as CheckInTeam[]))),
      ])
      setBookings(new Map((bRes?.data || []).map((b) => [String(b.id), b])))
      setArrivals(new Map(sessionTeams.flat().map((team) => [
        team.reservationId,
        { arrived: team.players.filter((p) => p.checkedIn).length, total: team.players.length },
      ])))
    } catch (e: any) {
      if (!silent) toast.error(e?.message || 'Could not load games')
    } finally {
      setLoading(false)
    }
  }, [view])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(true), 15000)
    return () => window.clearInterval(timer)
  }, [load])

  // Count for the "Still out" tab label, refreshed whenever a pop-up closes.
  const loadStillOut = useCallback(() => {
    apiGet<{ data: unknown[] }>('/api/rentals?status=out').then((res) => setStillOut(res.data.length)).catch(() => null)
  }, [])
  useEffect(() => { loadStillOut() }, [loadStillOut])

  const close = () => {
    setOpen(null)
    loadStillOut()
    void load(true)
    if (fromLink) setSearchParams({}, { replace: true })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Games</h1>
          <p className="mt-1 text-sm text-muted">
            Click a game to check players in, add extra ammo or charges, hand out rentals{canTakePayment ? ', and collect payment' : ''}.
          </p>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => { e.preventDefault(); if (lookup.trim()) setOpen({ reservationId: lookup.trim() }) }}
        >
          <div className="relative">
            <FiSearch className="absolute left-3 top-3 h-4 w-4 text-muted" />
            <input
              value={lookup}
              onChange={(e) => setLookup(e.target.value)}
              placeholder="Open by reservation ID (R-…)"
              className="h-10 w-64 rounded-2xl border border-white/10 bg-white/5 pl-9 pr-3 text-sm outline-none focus:border-accent/40"
            />
          </div>
          <Button type="submit" variant="ghost">Open</Button>
        </form>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Tabs
          value={view}
          onChange={setView}
          options={[
            ['ongoing', 'Ongoing'],
            ['today', "Today's games"],
            ['out', <span key="out" className="inline-flex items-center gap-1"><FiAlertTriangle /> Still out{stillOut ? ` (${stillOut})` : ''}</span>],
          ]}
        />
        {view !== 'out' ? <Button size="sm" variant="ghost" onClick={() => void load()} aria-label="Refresh"><FiRefreshCw /></Button> : null}
      </div>

      {view === 'out' ? (
        <StillOutPanel onCountChange={setStillOut} />
      ) : loading ? (
        <Card className="p-6 text-sm text-muted">Loading games…</Card>
      ) : games.length === 0 ? (
        <Card className="p-6 text-sm text-muted">
          {view === 'ongoing' ? "No games are in progress. Games appear here once they're started." : 'No games are scheduled for today.'}
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {games.map((game) => {
            const booking = bookings.get(String(game.reservationId || ''))
            const ongoing = /^ongo/i.test(String(game.Status || ''))
            const arrival = arrivals.get(String(game.reservationId || ''))
            return (
              <button
                key={gameKey(game)}
                type="button"
                disabled={!game.reservationId}
                onClick={() => game.reservationId && setOpen({ reservationId: game.reservationId, game })}
                className="rounded-2xl border border-white/10 bg-white/5 p-4 text-left transition hover:border-accent/40 hover:bg-accent/5 disabled:opacity-50"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-bold">{booking?.walkIn ? `Walk-in: ${booking.walkInName}` : game.Group || booking?.packageName || game.Package || 'Game'}</div>
                    <div className="text-[11px] text-muted">{game.id} · {game.reservationId}</div>
                  </div>
                  <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${ongoing ? 'border-success/30 bg-success/15 text-success' : 'border-accent/30 bg-accent/15 text-accent'}`}>
                    {ongoing ? <FiZap /> : null}{String(game.Status || 'Scheduled').toUpperCase()}
                  </span>
                </div>
                <div className="mt-3 space-y-1 text-xs text-muted">
                  <div className="flex items-center gap-1"><FiClock /> {formatSchedule(game)}</div>
                  <div className="flex items-center gap-1"><FiMapPin /> {locationName(game)}</div>
                  {arrival ? (
                    <div className={`flex items-center gap-1 ${arrival.total > 0 && arrival.arrived === arrival.total ? 'font-semibold text-success' : ''}`}>
                      <FiUsers /> {arrival.arrived} of {arrival.total} checked in
                    </div>
                  ) : booking?.numberOfPlayers ? <div className="flex items-center gap-1"><FiUsers /> {booking.numberOfPlayers} players</div> : null}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {open ? <GameDialog key={open.reservationId} reservationId={open.reservationId} game={open.game} canTakePayment={canTakePayment} canGroupTeams={canGroupTeams} onClose={close} /> : null}
    </div>
  )
}
