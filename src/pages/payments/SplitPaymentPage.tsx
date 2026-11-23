import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveRefresh } from '../../utils/liveUpdates'
import toast from 'react-hot-toast'
import { FiCheck, FiClock, FiEye, FiUsers, FiX } from 'react-icons/fi'
import { confirmDialog } from '../../components/ui/ConfirmDialog'

import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { apiGet, apiPost } from '../../utils/apiClient'
import { isXenditEnabled, startXenditCheckout } from '../../utils/xendit'
import { isPrivateSession } from '../../utils/bookingRoles'

export const SPLIT_PAYMENTS_CHANGED_EVENT = 'split-payments-changed'

// What the person who booked chose for a player in a package booking.
type Loadout = 'package' | 'own_gun' | 'own_gear'
const LOADOUT_LABEL: Record<Loadout, string> = {
  package: 'Package (gun + gear rented)',
  own_gun: 'Own gun, rents the gear',
  own_gear: 'Own gun + gear (entrance only)',
}
// "M4 Rifle, mask and vest".
const listOf = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`)
// A player not taking the package who rents some pieces ("Rents only the M4 Rifle and mask"), or a
// package player with extra guns ("Package + M4 Rifle").
function loadoutLabel(player: { loadout?: Loadout | null; rentOnly?: string[]; pickedGuns?: string[] } | undefined) {
  if (!player?.loadout) return '—'
  const guns = player.pickedGuns || []
  if (player.loadout !== 'own_gear') return guns.length ? `${LOADOUT_LABEL[player.loadout]} + ${listOf(guns)}` : LOADOUT_LABEL[player.loadout]
  const pieces = [...guns, ...(player.rentOnly || [])]
  return pieces.length ? `Rents only the ${listOf(pieces)}` : LOADOUT_LABEL.own_gear
}

type SplitMember = {
  id: string
  name: string
  isCaptain: boolean
  paid: boolean
  amount: number
  paymentStatus: string | null
}

export type SplitPaymentItem = {
  reservation: {
    id: string
    reservationDate: string
    reservationTime: string
    locationName: string
    numberOfPlayers: number
    packageName: string
    totalAmount: number
    depositAmount: number
    pricingBreakdown?: Array<{ label: string; amount: number }>
    paymentPlan?: 'full' | 'cash_balance'
    teamSize?: number
    unevenShares?: boolean
    paymentDueAtISO?: string
    sessionType?: string
  }
  isCaptain: boolean
  captainName: string
  // Everyone on the booking (names only), so invited players see who booked and who's playing.
  players?: Array<{ id: string; name: string; isCaptain: boolean; isMe: boolean; loadout?: Loadout | null; rentOnly?: string[]; pickedGuns?: string[]; share?: number | null; paidBy?: string | null }>
  myShareDue: number
  iHavePaid: boolean
  progress: { target: number; submitted: number; remaining: number; state: string; paidCount?: number; payerCount?: number }
  members?: SplitMember[]
}

function formatPHP(value: number) {
  return `₱${Number(value || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`
}

// How often the page re-reads the team's payments, so a teammate's share shows up on its own.
const REFRESH_MS = 10_000

// "3h 20m left" / "12m left" until the deadline (re-rendered every refresh).
function timeLeft(iso?: string) {
  if (!iso) return ''
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'Deadline passed'
  const minutes = Math.floor(ms / 60_000)
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours}h ${minutes % 60}m left` : `${Math.max(1, minutes)}m left`
}

function formatDue(iso?: string) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })
}

// A teammate pays their share online (GCash or QR Ph demo page); it's verified automatically and the booking
// is confirmed once every share is in.
function ShareForm({ item }: { item: SplitPaymentItem }) {
  const [submitting, setSubmitting] = useState(false)
  // null while checking whether the server has Xendit set up.
  const [xendit, setXendit] = useState<boolean | null>(null)
  useEffect(() => {
    void isXenditEnabled().then(setXendit).catch(() => setXendit(false))
  }, [])

  const payOnline = async () => {
    setSubmitting(true)
    try {
      await startXenditCheckout(item.reservation.id)
    } catch (e: any) {
      toast.error(e?.message || 'Could not open the payment page. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <div className="mt-4 space-y-4 rounded-2xl border border-accent/25 bg-accent/5 p-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted">Your share due</div>
          <div className="mt-1 text-2xl font-bold text-gold">{formatPHP(item.myShareDue)}</div>
        </div>
        {item.reservation.paymentDueAtISO ? (
          <div className={`flex items-center gap-1 text-xs ${new Date(item.reservation.paymentDueAtISO).getTime() - Date.now() < 2 * 3600_000 ? 'font-semibold text-danger' : 'text-muted'}`}>
            <FiClock /> Pay before {formatDue(item.reservation.paymentDueAtISO)} · {timeLeft(item.reservation.paymentDueAtISO)}
          </div>
        ) : null}
      </div>

      <div className="space-y-2 rounded-2xl border border-white/10 bg-black/20 p-4">
        <div className="text-sm font-bold">Pay online</div>
        <div className="text-xs text-muted">Pay with GCash or QR Ph (demo: no real money is sent). Your share is verified automatically, and the booking is confirmed once every share is in.</div>
        {xendit === false ? (
          <div className="text-xs text-danger">Online payment is not available right now. Please try again later or contact the staff.</div>
        ) : null}
        <Button variant="primary" disabled={submitting || xendit !== true} onClick={payOnline}>
          {submitting ? 'Opening payment…' : `Pay my share (${formatPHP(item.myShareDue)})`}
        </Button>
      </div>
    </div>
  )
}

function CaptainTracker({ item }: { item: SplitPaymentItem }) {
  const pct = item.progress.target > 0 ? Math.min(100, Math.round((item.progress.submitted / item.progress.target) * 100)) : 0
  const members = item.members || []
  const paid = members.filter((member) => member.paid)
  const pending = members.filter((member) => !member.paid)

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-center gap-2 text-sm font-bold"><FiUsers /> Team payment tracker</div>
      <div className="mt-3 flex items-end justify-between gap-3 text-xs text-muted">
        <span>{formatPHP(item.progress.submitted)} of {formatPHP(item.progress.target)} submitted</span>
        <span className="text-sm font-bold text-text">{formatPHP(item.progress.remaining)} remaining</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-muted">Paid ({paid.length})</div>
          <ul className="mt-2 space-y-1 text-sm">
            {paid.length === 0 ? <li className="text-xs text-muted">No one yet</li> : paid.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5"><FiCheck className="text-success" />{member.name}{member.isCaptain ? ' (you)' : ''}</span>
                <span className="text-xs text-muted">{formatPHP(member.amount)}{member.paymentStatus === 'pending' || member.paymentStatus === 'review' ? ' · in review' : ''}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-widest text-muted">Pending ({pending.length})</div>
          <ul className="mt-2 space-y-1 text-sm">
            {pending.length === 0 ? <li className="text-xs text-muted">Everyone has paid</li> : pending.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-2 text-amber-600 dark:text-amber-400">
                <span className="flex items-center gap-1.5"><FiClock />{member.name}{member.isCaptain ? ' (you)' : ''}</span>
                {/* What they still owe: their share. */}
                {(() => {
                  const share = item.players?.find((player) => player.id === member.id)?.share
                  return share != null ? <span className="text-xs tabular-nums">{formatPHP(share)}</span> : null
                })()}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mt-3 text-xs text-muted">
        Once every share is paid, the reservation is confirmed automatically.
      </div>
    </div>
  )
}

// Split payments the player has to act on: a share to pay, or (as captain) a team still paying.
// Shown at the top of My Reservations, only while there is one; links to it use #split-payments.
export function SplitPaymentsSection() {
  const [items, setItems] = useState<SplitPaymentItem[]>([])
  const [loading, setLoading] = useState(true)

  // What was on screen last time, to spot teammates who just paid.
  const previousRef = useRef<SplitPaymentItem[] | null>(null)

  const load = useCallback(async (background = false) => {
    try {
      const res = await apiGet<{ ok: boolean; data: SplitPaymentItem[] }>('/api/split-payments/mine')
      const next = Array.isArray(res?.data) ? res.data : []
      const previous = previousRef.current
      if (previous && background) {
        for (const before of previous) {
          const after = next.find((item) => item.reservation.id === before.reservation.id)
          const label = `${before.reservation.reservationDate} (${before.reservation.reservationTime})`
          if (!after) {
            // Gone from the list: every share is in (or, for a teammate, theirs was the last).
            toast.success(`Payment complete for ${label}.`)
            continue
          }
          const newlyPaid = (after.members || []).filter((member) =>
            member.paid && !member.isCaptain && !(before.members || []).find((old) => old.id === member.id)?.paid)
          newlyPaid.forEach((member) => toast.success(`${member.name} paid their share.`))
          if (!after.members && (after.progress.paidCount || 0) > (before.progress.paidCount || 0)) {
            toast.success(`A teammate paid their share (${after.progress.paidCount} of ${after.progress.payerCount}).`)
          }
        }
        // Keep the "shares to pay" badge on My Reservations in step.
        const owedCount = (list: SplitPaymentItem[]) => list.filter((item) => !item.iHavePaid && item.myShareDue > 0).length
        if (previous.length !== next.length || owedCount(previous) !== owedCount(next)) window.dispatchEvent(new Event(SPLIT_PAYMENTS_CHANGED_EVENT))
      }
      previousRef.current = next
      setItems(next)
    } catch (e: any) {
      if (!background) toast.error(e?.message || 'Could not load split payments')
    } finally {
      setLoading(false)
    }
  }, [])

  useLiveRefresh(['reservations', 'payments'], () => load(true))

  useEffect(() => {
    void load()
    const refresh = () => {
      if (document.visibilityState === 'visible') void load(true)
    }
    const timer = window.setInterval(refresh, REFRESH_MS)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [load])

  // Jump here from a notification or the dashboard (/app/my-reservations#split-payments) once loaded.
  const sectionRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!loading && items.length && window.location.hash === '#split-payments') {
      sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [loading, items.length])

  // The split payment open in the pop-up; read from the list so it stays live while open.
  const [viewId, setViewId] = useState<string | null>(null)
  const viewing = items.find((item) => item.reservation.id === viewId) || null

  // Nothing to pay or wait on: the section isn't shown at all.
  if (loading || items.length === 0) return null
  const owed = items.filter((item) => !item.iHavePaid && item.myShareDue > 0).length

  return (
    <section ref={sectionRef} id="split-payments" className="scroll-mt-4 space-y-2">
      <h2 className="flex items-center gap-2 text-base font-bold">
        {owed ? 'Your share is due' : 'Team payments in progress'}
        {owed ? <span className="grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-danger px-1 text-[11px] font-bold leading-none text-white">{owed}</span> : null}
        <span className="text-xs font-normal text-muted">· Teammates have 24 hours from their invite to pay, or their invite is void.</span>
      </h2>

      {/* One compact card per split payment; View opens everything (players, paying, progress). */}
      <div className="grid gap-2 md:grid-cols-2">
        {items.map((item) => {
          const due = !item.iHavePaid && item.myShareDue > 0
          const deadline = item.reservation.paymentDueAtISO
          const urgent = Boolean(deadline) && new Date(deadline as string).getTime() - Date.now() < 2 * 3600_000
          return (
            <Card key={item.reservation.id} className={`flex items-center gap-3 p-3 ${due ? 'border-accent/30' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">
                  {item.reservation.reservationDate} · <span className="capitalize">{item.reservation.reservationTime}</span>
                </div>
                <div className="truncate text-xs text-muted">
                  {item.isCaptain ? 'You booked this' : <>Booked by <span className="text-text">{item.captainName}</span></>} · {item.reservation.locationName}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted">
                  <span>{item.progress.paidCount || 0} of {item.progress.payerCount || 0} shares in</span>
                  {deadline ? <span className={urgent ? 'font-semibold text-danger' : ''}>· {timeLeft(deadline)}</span> : null}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                {due
                  ? <span className="text-base font-bold text-gold">{formatPHP(item.myShareDue)}</span>
                  : <span className="text-[11px] font-semibold text-muted">{item.iHavePaid ? 'Your share is in' : 'Waiting on team'}</span>}
                <Button size="xs" variant={due ? 'primary' : 'ghost'} onClick={() => setViewId(item.reservation.id)}>
                  <FiEye /> View
                </Button>
              </div>
            </Card>
          )
        })}
      </div>

      {viewing ? (
        <Modal
          eyebrow="Split payment"
          title={<>{viewing.reservation.reservationDate} · <span className="capitalize">{viewing.reservation.reservationTime}</span></>}
          // Wide enough for the "Who pays what" table without wrapping every name.
          size="xl"
          confirmDiscard={false}
          onClose={() => setViewId(null)}
        >
          <SplitPaymentDetails
            item={viewing}
            onDeclined={() => {
              setViewId(null)
              void load()
              // The badge on My Reservations, and the booking list, change too.
              window.dispatchEvent(new Event(SPLIT_PAYMENTS_CHANGED_EVENT))
            }}
          />
        </Modal>
      ) : null}
    </section>
  )
}

// How the booking's price is made up, and how it becomes this player's share: the itemized total,
// what is paid online now (the downpayment, or everything) and at the field, and the online amount
// split over the payers.
function FeeDetails({ item }: { item: SplitPaymentItem }) {
  const r = item.reservation
  const lines = r.pricingBreakdown || []
  const online = Number(r.depositAmount) || item.progress.target
  const atField = Math.max(0, Math.round((Number(r.totalAmount) - online) * 100) / 100)
  const payers = r.teamSize || item.progress.payerCount || 1
  const evenShare = Math.round((online / payers) * 100) / 100
  const me = item.players?.find((p) => p.isMe)
  const myLoadout = me?.loadout ? loadoutLabel(me) : null
  // The package line is the one the person who booked picked for the whole group; say so.
  const packageLine = (label: string) => Boolean(r.packageName) && label === r.packageName
  const chooser = item.isCaptain ? 'you' : item.captainName
  const packageLabel = (name: string) => (
    <span className="block">
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="rounded border border-accent/30 bg-accent/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-accent">Package</span>
        <span className="font-semibold">{name}</span>
      </span>
      <span className="mt-0.5 block text-[11px] text-muted">Chosen by {chooser} for all {r.numberOfPlayers} players</span>
    </span>
  )
  const row = (label: React.ReactNode, amount: number, className = '') => (
    <div className={`flex items-baseline justify-between gap-3 ${className}`}>
      <span className="min-w-0">{label}</span>
      <span className="shrink-0 tabular-nums">{amount < 0 ? `−${formatPHP(-amount)}` : formatPHP(amount)}</span>
    </div>
  )

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm">
      <div className="text-xs font-semibold uppercase tracking-widest text-muted">Fee details</div>
      <div className="mt-2 space-y-1 text-muted">
        {lines.length
          ? lines.map((line, index) => (
            <React.Fragment key={`${line.label}-${index}`}>
              {row(packageLine(line.label) ? packageLabel(line.label) : line.label, line.amount, line.amount < 0 ? 'text-success' : packageLine(line.label) ? 'text-text' : '')}
            </React.Fragment>
          ))
          : row(packageLabel(r.packageName || 'Booking'), Number(r.totalAmount) || 0, 'text-text')}
      </div>
      <div className="mt-2 space-y-1 border-t border-white/10 pt-2">
        {row(<span className="font-semibold">Reservation total</span>, Number(r.totalAmount) || 0, 'font-semibold')}
        {row(r.paymentPlan === 'full' ? 'Paid online (full amount)' : 'Paid online now (downpayment)', online, 'text-muted')}
        {atField > 0 ? row('Balance at the field on game day', atField, 'text-muted') : null}
      </div>
      <div className="mt-2 space-y-1 border-t border-white/10 pt-2">
        {r.unevenShares ? (
          <div className="text-xs text-muted">
            Shares follow what each player gets{myLoadout ? <>. You: <span className="font-semibold text-text">{myLoadout}</span></> : null}.
          </div>
        ) : row(`Online amount split ${payers} way${payers === 1 ? '' : 's'}`, evenShare, 'text-muted')}
        {item.iHavePaid
          ? <div className="font-semibold text-success">Your share is paid</div>
          : row(<span className="font-semibold">Your share now</span>, item.myShareDue, 'font-semibold text-gold')}
        {!item.iHavePaid && !r.unevenShares && Math.abs(item.myShareDue - evenShare) > 0.01 ? (
          <div className="text-[11px] text-muted">Your share differs from the even split because it covers what's left of the online amount (rounding, or a teammate who left).</div>
        ) : null}
      </div>
    </div>
  )
}

// Everything about one split payment, shown in the View pop-up: the booking, who booked it and
// who's playing, the player's share and Pay button, and the team's progress.
function SplitPaymentDetails({ item, onDeclined }: { item: SplitPaymentItem; onDeclined: () => void }) {
  const [declining, setDeclining] = useState(false)
  // An invited player who can't make it says no before paying: they leave the booking, which
  // drops to one fewer player and is re-priced; the others' shares re-split.
  const decline = async () => {
    const ok = await confirmDialog({
      title: 'Decline this game?',
      message: isPrivateSession(item.reservation.sessionType)
        ? `You'll be taken off ${item.captainName}'s team for ${item.reservation.reservationDate} (${item.reservation.reservationTime}). Your spot stays on the booking: ${item.captainName} will be told to fill it or pay for it. They would have to invite you again.`
        : `You'll be taken off ${item.captainName}'s booking for ${item.reservation.reservationDate} (${item.reservation.reservationTime}). The booking drops to ${Math.max(1, item.reservation.numberOfPlayers - 1)} players and is re-priced, and the other shares are re-split. ${item.captainName} will be notified. They would have to add you again.`,
      confirmLabel: 'Decline',
      danger: true,
    })
    if (!ok) return
    setDeclining(true)
    try {
      await apiPost(`/api/reservations/${encodeURIComponent(item.reservation.id)}/decline`, {})
      toast.success(`You declined. ${item.captainName} has been notified.`)
      onDeclined()
    } catch (e: any) {
      toast.error(e?.message || 'Could not decline this booking')
    } finally {
      setDeclining(false)
    }
  }
  const canDecline = !item.isCaptain && !item.iHavePaid

  return (
        <div>
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-sm text-muted">
                {item.reservation.locationName} · {item.reservation.numberOfPlayers} players · {item.reservation.packageName}
              </div>
              {/* Who invited you: the first thing an invited player needs to know. */}
              <div className="mt-2 text-sm">
                {item.isCaptain
                  ? <span className="font-semibold">{isPrivateSession(item.reservation.sessionType) ? 'You are the team captain' : 'You booked this game'}</span>
                  : <>{isPrivateSession(item.reservation.sessionType) ? 'Captain' : 'Booked by'} <span className="font-semibold text-accent">{item.captainName}</span>, who added you to this game</>}
              </div>
            </div>
            <span className="self-start rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-widest">
              {item.progress.state === 'partial' ? 'Partially paid' : 'Awaiting payment'}
            </span>
          </div>

          {/* Who's playing and what each one pays online. Everyone sees the amounts; who has paid is
              only shown to the captain. */}
          {item.players?.length ? (
            <div className="mt-4">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-muted"><FiUsers /> Who pays what ({item.players.length} players)</div>
              <div className="mt-2 overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5 text-left text-[11px] uppercase tracking-wider text-muted">
                      <th className="w-10 px-3 py-2 font-semibold">#</th>
                      <th className="px-3 py-2 font-semibold">Player</th>
                      {item.players.some((p) => p.loadout) ? <th className="px-3 py-2 font-semibold">Gets</th> : null}
                      <th className="px-3 py-2 text-right font-semibold">Pays online</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {item.players.map((player, index) => {
                      const status = item.members?.find((member) => member.id === player.id)
                      return (
                        <tr key={player.id} className={player.isMe ? 'bg-accent/10' : ''}>
                          <td className="px-3 py-2 text-muted">{index + 1}</td>
                          <td className="px-3 py-2">
                            <div className={`font-semibold ${player.isMe ? 'text-accent' : ''}`}>
                              {player.name}{player.isMe ? <span className="ml-1.5 text-xs font-normal text-muted">(you)</span> : null}
                            </div>
                            <div className="text-[11px] text-muted">
                              {player.isCaptain ? (isPrivateSession(item.reservation.sessionType) ? 'Captain · booked it' : 'Booked it') : 'Teammate'}
                            </div>
                          </td>
                          {item.players?.some((p) => p.loadout) ? (
                            <td className={`px-3 py-2 text-xs ${player.loadout === 'package' ? 'text-muted' : 'font-semibold text-accent'}`}>
                              {loadoutLabel(player)}
                            </td>
                          ) : null}
                          <td className="whitespace-nowrap px-3 py-2 text-right">
                            {player.share === undefined ? (
                              // Amount not sent (an older server): don't claim they pay nothing.
                              <span className="text-xs text-muted">—</span>
                            ) : player.share === null ? (
                              <span className="text-xs text-muted">{player.paidBy ? `Paid by ${player.paidBy}` : "Covered by the team"}</span>
                            ) : (
                              <>
                                <div className="font-semibold tabular-nums">{formatPHP(player.share)}</div>
                                {status ? (
                                  <div className={`text-[11px] ${status.paid ? 'text-success' : 'text-amber-600 dark:text-amber-400'}`}>{status.paid ? 'Paid' : 'Not paid yet'}</div>
                                ) : null}
                              </>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {item.players.some((p) => p.share === null) ? (
                <div className="mt-1 text-[11px] text-muted">Minors don't pay themselves: their parent or guardian on the team pays for them, as part of their share.</div>
              ) : null}
            </div>
          ) : null}

          <FeeDetails item={item} />

          {!item.iHavePaid && item.myShareDue > 0 ? (
            <ShareForm item={item} />
          ) : item.iHavePaid ? (
            <div className="mt-4 flex items-center gap-2 rounded-2xl border border-success/25 bg-success/10 px-4 py-3 text-sm text-success">
              <FiCheck /> Your share is submitted.
            </div>
          ) : null}

          {item.isCaptain ? <CaptainTracker item={item} /> : item.progress.payerCount ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-center justify-between gap-3 text-xs text-muted">
                <span className="flex items-center gap-1.5 font-semibold text-text"><FiUsers /> Team progress</span>
                <span>{item.progress.paidCount || 0} of {item.progress.payerCount} shares in</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{ width: `${Math.min(100, Math.round(((item.progress.paidCount || 0) / item.progress.payerCount) * 100))}%` }}
                />
              </div>
              <div className="mt-2 text-[11px] text-muted">Updates on its own as teammates pay.</div>
            </div>
          ) : null}

          {canDecline ? (
            <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-danger/20 bg-danger/5 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold">Can't make it?</div>
                <div className="text-xs text-muted">Decline before you pay and you're taken off the booking. {item.captainName} is told right away.</div>
              </div>
              <Button size="sm" variant="danger-soft" disabled={declining} onClick={decline}>
                <FiX /> {declining ? 'Declining…' : 'Decline'}
              </Button>
            </div>
          ) : null}
        </div>
  )
}
