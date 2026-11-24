import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { FiCheck, FiClock, FiCreditCard, FiEye, FiMail, FiRefreshCw, FiUserPlus, FiX } from 'react-icons/fi'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { confirmDialog } from '../../components/ui/ConfirmDialog'
import { apiGet, apiPost } from '../../utils/apiClient'
import { useLiveRefresh } from '../../utils/liveUpdates'
import { startXenditCheckout } from '../../utils/xendit'
import { isPrivateSession } from '../../utils/bookingRoles'
import { SPLIT_PAYMENTS_CHANGED_EVENT } from '../payments/SplitPaymentPage'

// Asks My Reservations to open a booking (detail: its id): the team payment pop-up, or its details.
export const OPEN_BOOKING_EVENT = 'open-booking'
// Asks this section to open "invite a player" for a booking's first free spot (detail: booking id).
export const FILL_SPOT_EVENT = 'fill-spot'

type BookingSummary = {
  id: string
  reservationDate: string
  reservationTime: string
  locationName: string
  numberOfPlayers: number
  packageName: string
  sessionType?: string
}

type Invite = {
  reservation: BookingSummary
  captainName: string
  invitedAtISO: string
  deadlineISO: string
  myShare: number
  split: boolean
}

type OpenSlot = {
  reservation: BookingSummary
  slot: { id: string; playerId: string; name: string; amount: number; status: 'open' | 'covering' | 'paid'; reason: string; deadlineISO: string
    // Its share already moved to the captain's balance at the field.
    onsite?: boolean }
}

type Found = { id: string; name: string; email: string; waiverApproved: boolean }

const REASON_LABEL: Record<string, string> = {
  declined: 'declined',
  expired: "didn't answer in 24 hours",
  expired_unpaid: "didn't pay in 24 hours",
  unavailable: 'is playing another game in that slot',
  removed: 'was removed from the team',
}

function formatPHP(value: number) {
  return `₱${Number(value || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })
}

function timeLeft(iso: string) {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'Deadline passed'
  const minutes = Math.floor(ms / 60_000)
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours}h ${minutes % 60}m left` : `${Math.max(1, minutes)}m left`
}

const changed = () => window.dispatchEvent(new Event(SPLIT_PAYMENTS_CHANGED_EVENT))

// Invites waiting for this player's answer (24 hours to accept), and spots on the player's own
// bookings that a teammate left open (pay for it, invite someone, or invite them again).
// Shown at the top of My Reservations only while there is something to do.
export function InvitationsSection() {
  const [invites, setInvites] = useState<Invite[]>([])
  const [openSlots, setOpenSlots] = useState<OpenSlot[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [filling, setFilling] = useState<OpenSlot | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await apiGet<{ ok: boolean; data: { invites: Invite[]; openSlots: OpenSlot[] } }>('/api/invitations/mine')
      setInvites(res?.data?.invites || [])
      setOpenSlots(res?.data?.openSlots || [])
    } catch {
      // Leave what's on screen; the next refresh tries again.
    }
  }, [])

  useLiveRefresh(['reservations', 'notifications'], () => load())
  // "Add player" on a booking's card: invite someone into its first free spot.
  useEffect(() => {
    const fill = (event: Event) => {
      const id = String((event as CustomEvent).detail || '')
      const spot = openSlots.find((item) => String(item.reservation.id) === id)
      if (spot) setFilling(spot)
      else toast.error('No free spot on this booking. A spot opens when a teammate declines or is removed.')
    }
    window.addEventListener(FILL_SPOT_EVENT, fill)
    return () => window.removeEventListener(FILL_SPOT_EVENT, fill)
  }, [openSlots])
  useEffect(() => {
    void load()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, 30_000)
    window.addEventListener(SPLIT_PAYMENTS_CHANGED_EVENT, load)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener(SPLIT_PAYMENTS_CHANGED_EVENT, load)
    }
  }, [load])

  const act = async (key: string, run: () => Promise<unknown>, success: string) => {
    setBusy(key)
    try {
      await run()
      toast.success(success)
      await load()
      changed()
    } catch (e: any) {
      toast.error(e?.message || 'Something went wrong. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  const accept = (invite: Invite) => act(
    `accept:${invite.reservation.id}`,
    () => apiPost(`/api/reservations/${encodeURIComponent(invite.reservation.id)}/accept`, {}),
    invite.split ? 'Invite accepted. Pay your share below to keep your spot.' : `You're in! ${invite.captainName} has been told.`,
  )

  const decline = async (invite: Invite) => {
    const ok = await confirmDialog({
      title: 'Decline this game?',
      message: `${invite.captainName} will be told you can't make it on ${invite.reservation.reservationDate} (${invite.reservation.reservationTime}). They would have to invite you again.`,
      confirmLabel: 'Decline',
      danger: true,
    })
    if (!ok) return
    await act(`decline:${invite.reservation.id}`, () => apiPost(`/api/reservations/${encodeURIComponent(invite.reservation.id)}/decline`, {}), `You declined. ${invite.captainName} has been notified.`)
  }

  const cover = async (item: OpenSlot) => {
    const key = `cover:${item.slot.id}`
    setBusy(key)
    try {
      if (item.slot.status === 'open') await apiPost(`/api/reservations/${encodeURIComponent(item.reservation.id)}/open-slots/${encodeURIComponent(item.slot.id)}/cover`, {})
      await startXenditCheckout(item.reservation.id)
    } catch (e: any) {
      toast.error(e?.message || 'Could not open the payment page.')
      setBusy(null)
      void load()
    }
  }

  const reinvite = (item: OpenSlot) => act(
    `reinvite:${item.slot.id}`,
    () => apiPost(`/api/reservations/${encodeURIComponent(item.reservation.id)}/open-slots/${encodeURIComponent(item.slot.id)}/invite`, { playerId: item.slot.playerId }),
    `${item.slot.name} was invited again. They have 24 hours to accept.`,
  )

  // Jump here from a notification (/app/my-reservations#invitations) once there is something to show.
  const hasItems = invites.length > 0 || openSlots.length > 0
  const sectionRef = React.useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (hasItems && window.location.hash === '#invitations') sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [hasItems])

  if (!hasItems) return null

  return (
    <section ref={sectionRef} id="invitations" className="scroll-mt-4 space-y-3">
      {invites.length ? (
        <div className="space-y-2">
          <h2 className="flex items-center gap-2 text-base font-bold">
            <FiMail /> Game invites
            <span className="grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-danger px-1 text-[11px] font-bold leading-none text-white">{invites.length}</span>
            <span className="text-xs font-normal text-muted">· Answer within 24 hours or the invite is void.</span>
          </h2>
          <div className="grid gap-2 md:grid-cols-2">
            {invites.map((invite) => {
              const r = invite.reservation
              const urgent = new Date(invite.deadlineISO).getTime() - Date.now() < 3 * 3600_000
              return (
                <Card key={r.id} className="border-accent/30 p-3">
                  <div className="text-sm font-semibold">
                    {r.reservationDate} · <span className="capitalize">{r.reservationTime}</span>
                  </div>
                  <div className="truncate text-xs text-muted">
                    {isPrivateSession(r.sessionType) ? 'Captain' : 'Booked by'} <span className="text-text">{invite.captainName}</span> · {r.locationName} · {r.numberOfPlayers} players · {r.packageName}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
                    <span>{invite.split ? <>Your share: <span className="font-semibold text-gold">{formatPHP(invite.myShare)}</span> (pay after accepting)</> : `${invite.captainName} is paying`}</span>
                    <span className={`inline-flex items-center gap-1 ${urgent ? 'font-semibold text-danger' : ''}`}><FiClock /> {timeLeft(invite.deadlineISO)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="xs" variant="primary" disabled={Boolean(busy)} onClick={() => accept(invite)}>
                      <FiCheck /> {busy === `accept:${r.id}` ? 'Accepting…' : 'Accept'}
                    </Button>
                    <Button size="xs" variant="danger-soft" disabled={Boolean(busy)} onClick={() => decline(invite)}>
                      <FiX /> {busy === `decline:${r.id}` ? 'Declining…' : 'Decline'}
                    </Button>
                  </div>
                </Card>
              )
            })}
          </div>
        </div>
      ) : null}

      {openSlots.length ? (
        <div className="space-y-2">
          <h2 className="flex items-center gap-2 text-base font-bold">
            <FiUserPlus /> Open spots on your bookings
            <span className="text-xs font-normal text-muted">· Their share is paid at the counter before the game, unless a substitute joins and pays it online.</span>
          </h2>
          <div className="grid gap-2 md:grid-cols-2">
            {openSlots.map((item) => {
              const r = item.reservation
              const s = item.slot
              return (
                <Card key={s.id} className="border-danger/30 p-3">
                  <div className="text-sm font-semibold">
                    {r.reservationDate} · <span className="capitalize">{r.reservationTime}</span> · {r.locationName}
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    <span className="font-semibold text-text">{s.name}</span> {REASON_LABEL[s.reason] || 'left'}.
                    {s.status === 'paid'
                      ? <> You already paid <span className="font-semibold text-gold">{formatPHP(s.amount)}</span> for this spot. Put a substitute in it: <b className="text-text">they play for free</b>.</>
                      : s.amount > 0
                      ? s.onsite
                        ? <> Their share of <span className="font-semibold text-gold">{formatPHP(s.amount)}</span> is added to what you pay <b className="text-text">at the counter before the game</b>, so the booking can go through.</>
                        : <> Their share: <span className="font-semibold text-gold">{formatPHP(s.amount)}</span>.</>
                      : ' Nothing extra to pay.'}
                  </div>
                  <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted">
                    <FiClock /> {s.onsite || s.status === 'paid' ? 'Add a substitute' : 'Act'} by {formatWhen(s.deadlineISO)} · {timeLeft(s.deadlineISO)}
                    {s.onsite && s.amount > 0 ? ' · if they pay online, it comes off your field balance' : ''}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {s.amount > 0 && !s.onsite && s.status !== 'paid' ? (
                      <Button size="xs" variant="primary" disabled={Boolean(busy)} onClick={() => cover(item)}>
                        <FiCreditCard /> {busy === `cover:${s.id}` ? 'Opening payment…' : s.status === 'covering' ? `Finish paying ${formatPHP(s.amount)}` : `Pay for the spot (${formatPHP(s.amount)})`}
                      </Button>
                    ) : null}
                    <Button size="xs" variant="ghost" disabled={Boolean(busy)} onClick={() => setFilling(item)}>
                      <FiUserPlus /> {s.onsite || s.status === 'paid' ? 'Invite a substitute' : 'Invite another player'}
                    </Button>
                    {/* The booking itself: who pays what (team payment) or its details. */}
                    <Button size="xs" variant="ghost" onClick={() => window.dispatchEvent(new CustomEvent(OPEN_BOOKING_EVENT, { detail: item.reservation.id }))}>
                      <FiEye /> View
                    </Button>
                    {s.reason !== 'unavailable' ? (
                      <Button size="xs" variant="ghost" disabled={Boolean(busy)} onClick={() => reinvite(item)}>
                        <FiRefreshCw /> {busy === `reinvite:${s.id}` ? 'Inviting…' : `Invite ${s.name} again`}
                      </Button>
                    ) : null}
                  </div>
                </Card>
              )
            })}
          </div>
        </div>
      ) : null}

      {filling ? (
        <InvitePlayerDialog
          item={filling}
          onClose={() => setFilling(null)}
          onInvited={() => {
            setFilling(null)
            void load()
            changed()
          }}
        />
      ) : null}
    </section>
  )
}

// Find a registered player by name or email and invite them into the open spot.
function InvitePlayerDialog({ item, onClose, onInvited }: { item: OpenSlot; onClose: () => void; onInvited: () => void }) {
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<Found[]>([])
  const [error, setError] = useState('')
  const [searching, setSearching] = useState(false)
  const [inviting, setInviting] = useState<string | null>(null)

  const search = async (event: React.FormEvent) => {
    event.preventDefault()
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setError('')
    try {
      const res = await apiGet<{ ok: boolean; data: Found; matches?: Found[] }>(`/api/team-directory/lookup?q=${encodeURIComponent(q)}`)
      setMatches(Array.isArray(res.matches) && res.matches.length ? res.matches : res.data ? [res.data] : [])
    } catch (e: any) {
      setMatches([])
      setError(e?.message || 'No player found.')
    } finally {
      setSearching(false)
    }
  }

  const invite = async (player: Found) => {
    setInviting(player.id)
    try {
      await apiPost(`/api/reservations/${encodeURIComponent(item.reservation.id)}/open-slots/${encodeURIComponent(item.slot.id)}/invite`, { playerId: player.id })
      toast.success(`${player.name} was invited. They have 24 hours to accept.`)
      onInvited()
    } catch (e: any) {
      setError(e?.message || 'Could not invite that player.')
    } finally {
      setInviting(null)
    }
  }

  return (
    <Modal eyebrow="Open spot" title={`Fill ${item.slot.name}'s spot`} size="md" confirmDiscard={false} onClose={onClose}>
      <form onSubmit={search} className="flex gap-2">
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Player name or email"
          className="min-w-0 flex-1 rounded-full border border-white/10 bg-background px-4 py-2 text-sm text-text outline-none focus:ring-2 focus:ring-accent/40"
        />
        <Button type="submit" size="sm" disabled={searching || !query.trim()}>{searching ? 'Searching…' : 'Search'}</Button>
      </form>
      {error ? <div className="mt-3 text-sm text-danger">{error}</div> : null}
      <ul className="mt-3 space-y-2">
        {matches.map((player) => (
          <li key={player.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{player.name}</div>
              <div className="truncate text-xs text-muted">{player.email}{player.waiverApproved ? '' : ' · waiver not signed yet'}</div>
            </div>
            <Button size="xs" variant="primary" disabled={!player.waiverApproved || Boolean(inviting)} onClick={() => invite(player)}>
              {inviting === player.id ? 'Inviting…' : 'Invite'}
            </Button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">
        {item.slot.amount > 0 ? `They take over the ${formatPHP(item.slot.amount)} share and ` : 'They '}have 24 hours to accept.
      </p>
    </Modal>
  )
}
