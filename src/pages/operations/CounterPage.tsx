import React, { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { FiAlertTriangle, FiCheck, FiChevronRight, FiClock, FiCreditCard, FiCrosshair, FiMapPin, FiPlusCircle, FiPrinter, FiRefreshCw, FiTarget, FiTrash2, FiUsers, FiZap } from 'react-icons/fi'

import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { BookingPlayersSection } from '../../components/reservations/BookingPlayersSection'
import { apiGet, apiGetAll, apiPost, apiPut } from '../../utils/apiClient'
import { ItemCombobox, type ComboItem } from '../../components/ui/ItemCombobox'
import { useAuth } from '../../context/AuthContext'
import { formatSchedule, locationName } from '../registrar/RegistrarOngoingGamesPage'
import { RentalsPanel, StillOutPanel } from './RentalsPage'
import { FpsCheckPanel, loadFpsStatus, type FpsStatus } from './FpsCheckPanel'
import { TeamCheckIn, fetchCheckInTeams, type CheckInSession, type CheckInTeam } from './FieldCheckInPage'
import { SessionTeams } from './TeamGroupingPage'
import { categoryLabel, formatDateTime, formatPHP, manilaTodayISO, selectClass } from './shared'
import { BRANCHES } from '../../utils/branches'
import { formatClock, formatSlotRange, slotHasEnded, useSlotHours, type SlotName } from '../../utils/slotHours'
import { confirmDialog } from '../../components/ui/ConfirmDialog'

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
    userId?: string
    teamMembers?: Array<{ id: string; name: string }>
  }
  total: number
  depositAmount: number
  breakdown: Array<{ label: string; amount: number }>
  extraCharges?: Array<{ id: string; type: string; label: string; quantity: number; unitPrice: number; amount: number; atISO?: string }>
  payments: Array<{ id: string; amount: number; paymentMethod: string; paymentStatus: string; kind: string; transactionReference: string; createdAtISO: string }>
  collected: number
  balanceDue: number
  // Additional charges added at the counter, and the balance of the booking itself without them.
  additionalTotal?: number
  bookingBalanceDue?: number
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

const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string))

// Opens the bill as a plain printable receipt (black on white, fits A4 or a receipt printer) and
// the browser's print dialog, where it can also be saved as a PDF.
function printBill(ledger: Ledger, bookingLines: Array<{ label: string; amount: number }>, extraCharges: NonNullable<Ledger['extraCharges']>) {
  const r = ledger.reservation
  const peso = (n: number) => escapeHtml(formatPHP(Number(n || 0)))
  const date = r.reservationDate
    ? new Date(`${r.reservationDate}T12:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : ''
  const row = (label: string, amount: string, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="amt">${amount}</td></tr>`
  const additionalTotal = extraCharges.reduce((sum, c) => sum + Number(c.amount || 0), 0)
  const paid = ledger.payments.filter((p) => !['failed', 'rejected'].includes(String(p.paymentStatus || '').toLowerCase()))

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Bill ${escapeHtml(r.id)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; margin: 0; padding: 24px; font-size: 13px; }
  .sheet { max-width: 520px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0; }
  .muted { color: #555; }
  .head { border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 12px; }
  .meta td { padding: 2px 12px 2px 0; vertical-align: top; }
  table.lines { width: 100%; border-collapse: collapse; margin-top: 8px; }
  table.lines td { padding: 4px 0; border-bottom: 1px dotted #bbb; }
  .amt { text-align: right; white-space: nowrap; padding-left: 12px; }
  .section td { padding-top: 12px; border-bottom: 1px solid #000; font-weight: bold; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
  .sub td { font-weight: bold; }
  .total td { font-weight: bold; font-size: 15px; border-top: 2px solid #000; border-bottom: none; padding-top: 8px; }
  .due td { font-weight: bold; font-size: 16px; border-bottom: none; }
  .foot { margin-top: 20px; border-top: 1px solid #000; padding-top: 8px; font-size: 11px; }
  @media print { body { padding: 0; } @page { margin: 12mm; } }
</style></head><body><div class="sheet">
  <div class="head">
    <h1>Chill Shooters Airsoft</h1>
    <div class="muted">Bill / Statement of account</div>
  </div>
  <table class="meta">
    <tr><td class="muted">Reservation</td><td><b>${escapeHtml(r.id)}</b></td></tr>
    <tr><td class="muted">${r.walkIn ? 'Walk-in' : 'Booked by'}</td><td>${escapeHtml(r.walkIn ? r.walkInName : r.captainName || '')}</td></tr>
    <tr><td class="muted">Game</td><td>${escapeHtml(date)}${r.reservationTime ? ` · ${escapeHtml(r.reservationTime.charAt(0).toUpperCase() + r.reservationTime.slice(1))}` : ''}</td></tr>
    <tr><td class="muted">Field</td><td>${escapeHtml(r.locationName || r.locationId || '')}</td></tr>
    <tr><td class="muted">Players</td><td>${escapeHtml(r.numberOfPlayers || '')}${r.packageName ? ` · ${escapeHtml(r.packageName)}` : ''}</td></tr>
  </table>

  <table class="lines">
    <tr class="section"><td colspan="2">Booking</td></tr>
    ${bookingLines.map((l) => row(escapeHtml(l.label), peso(l.amount))).join('')}
    ${extraCharges.length ? `
    <tr class="section"><td colspan="2">Additional charges</td></tr>
    ${extraCharges.map((c) => row(escapeHtml(c.label), peso(c.amount))).join('')}
    ${row('Additional total', peso(additionalTotal), 'sub')}` : ''}
    ${row('Total', peso(ledger.total), 'total')}
    ${paid.length ? `<tr class="section"><td colspan="2">Payments</td></tr>
    ${paid.map((p) => row(`${escapeHtml(p.paymentMethod)} · ${p.kind === 'onsite' ? 'onsite' : 'online'} · ${escapeHtml(formatDateTime(p.createdAtISO))}${p.transactionReference ? ` · Ref ${escapeHtml(p.transactionReference)}` : ''}`, `− ${peso(p.amount)}`)).join('')}` : ''}
    ${row('Paid so far', peso(ledger.collected), 'sub')}
    ${row(ledger.balanceDue > 0 ? 'Balance due' : 'Fully paid', peso(ledger.balanceDue), 'due')}
  </table>

  <div class="foot muted">Printed ${escapeHtml(new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }))}. Thank you for playing!</div>
</div>
<script>window.onload = function () { window.focus(); window.print(); };</script>
</body></html>`

  const win = window.open('', '_blank', 'width=640,height=800')
  if (!win) {
    toast.error('Allow pop-ups for this site to print the bill.')
    return
  }
  win.document.open()
  win.document.write(html)
  win.document.close()
}

// A player rents an extra gun at the counter: pick who and which free gun; the gun is handed out
// (it shows on the Rentals tab) and its rental price goes on the bill.
function AddGunCard({ reservationId, ledger, onLedger, refreshKey = 0 }: { reservationId: string; ledger: Ledger; onLedger: (ledger: Ledger) => void; refreshKey?: number }) {
  const [guns, setGuns] = useState<any[] | null>(null)
  const [outIds, setOutIds] = useState<Set<string>>(new Set())
  const [player, setPlayer] = useState('')
  const [guestName, setGuestName] = useState('')
  const [gunKey, setGunKey] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    Promise.all([apiGetAll<any>('weapons'), apiGet<{ data: Array<{ itemId?: string }> }>('/api/rentals?status=out')])
      .then(([weapons, out]) => {
        setGuns(weapons)
        setOutIds(new Set(out.data.map((r) => String(r.itemId || ''))))
      })
      .catch(() => setGuns([]))
  }, [])
  // Reload the free guns each time the Bill tab is opened (guns handed out on Rentals drop off).
  useEffect(() => { load() }, [load, refreshKey])

  const r = ledger.reservation
  const members = r.walkIn
    ? [{ id: '', name: r.walkInName }]
    : [...(r.userId && r.captainName ? [{ id: r.userId, name: r.captainName }] : []), ...(r.teamMembers || [])].filter((m) => m.name)

  // Free center guns with a rental price ("M4 Rifle #2 · Rifles · ₱500").
  const items: ComboItem[] = (guns || [])
    .filter((g) => g.source !== 'player' && String(g.status || 'available').toLowerCase() === 'available'
      && !outIds.has(String(g.id || g._id)) && String(g.category || '').toLowerCase() !== 'grenades' && Number(g.price) > 0)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)) || Number(a.unitNumber) - Number(b.unitNumber))
    .map((g) => ({
      key: String(g.id || g._id),
      label: `${g.name}${Number(g.unitNumber) && !String(g.name).includes('#') ? ` #${g.unitNumber}` : ''}`,
      detail: `${categoryLabel(String(g.category || ''))} · ${formatPHP(Number(g.price))}`,
    }))
  const chosen = items.find((i) => i.key === gunKey)
  const member = members.find((m) => (m.id || `name:${m.name}`) === player)
  const playerName = player === 'guest' ? guestName.trim() : member?.name || ''

  const add = async () => {
    setBusy(true)
    try {
      const res = await apiPost<{ ledger: Ledger }>(`/api/reservations/${encodeURIComponent(reservationId)}/add-gun`, {
        itemId: gunKey,
        playerName,
        playerId: player === 'guest' ? '' : member?.id || '',
      })
      onLedger(res.ledger)
      toast.success(`${chosen?.label || 'Gun'} added for ${playerName}.`)
      setGunKey('')
      load()
    } catch (e: any) {
      toast.error(e?.message || 'Could not add the gun')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-sm font-bold"><FiCrosshair /> Add a gun</div>
      <p className="mt-1 text-xs text-muted">Hands the gun to the player and adds its rental price to the bill.</p>
      <div className="mt-3 space-y-3">
        <label className="block">
          <div className="mb-2 text-sm font-semibold">Player</div>
          <select value={player} onChange={(e) => setPlayer(e.target.value)} className={selectClass}>
            <option value="">Choose a player…</option>
            {members.map((m) => <option key={m.id || m.name} value={m.id || `name:${m.name}`}>{m.name}</option>)}
            <option value="guest">Someone not on this booking…</option>
          </select>
        </label>
        {player === 'guest' ? <Input label="Guest's name" value={guestName} onChange={(e) => setGuestName(e.target.value)} /> : null}
        {guns === null ? (
          <div className="text-xs text-muted">Loading guns…</div>
        ) : (
          <ItemCombobox
            label="Gun"
            items={items}
            selectedKey={gunKey}
            onSelect={(item) => setGunKey(item?.key || '')}
            placeholder={items.length ? 'Type to search, e.g. M4 #3, pistol' : 'No free guns'}
          />
        )}
        <Button type="button" className="w-full" disabled={busy || !playerName || !chosen} onClick={() => void add()}>
          {busy ? 'Adding…' : chosen ? `Add gun · ${chosen.detail?.split(' · ').pop()}` : 'Add gun'}
        </Button>
      </div>
    </Card>
  )
}

// The bill for one booking: what was charged and paid, quick ammo reloads, any other charge, and
// the onsite payment form.
// `canTakePayment`: only admins and registrars take payment. The bill (ammo and guns included) is the
// registrar's; marshals don't see it.
// `finished`: the game is completed, so the bill is closed: nothing can be added or taken off,
// and only an unpaid balance can still be collected.
function LedgerPanel({ reservationId, canTakePayment, onLoaded, active = true, onGoToRentals, onGameCompleted, finished = false }: { reservationId: string; canTakePayment: boolean; onLoaded?: (ledger: Ledger) => void; active?: boolean; onGoToRentals?: () => void; onGameCompleted?: () => void; finished?: boolean }) {
  // The registrar runs the whole bill: ammo, guns, other charges and the payments.
  const { user } = useAuth()
  const canHandleGear = !finished && (user?.role === 'admin' || user?.role === 'registrar')
  const canBill = !finished && (user?.role === 'admin' || user?.role === 'registrar')
  // The same rule as the server: registrars fix any line, marshals only ammo and gun lines.
  const canRemove = (type: string) => canBill || (canHandleGear && ['ammo_reload', 'gun_rental'].includes(type))
  // Rentals not yet checked in: payment waits until they're all back.
  const [stillOut, setStillOut] = useState<Array<{ id: string; itemName: string; unitLabel: string; playerName: string }> | null>(null)
  const loadStillOut = useCallback(() => {
    apiGet<{ data: Array<{ id: string; itemName: string; unitLabel: string; playerName: string }> }>(`/api/rentals?reservationId=${encodeURIComponent(reservationId)}&status=out`)
      .then((res) => setStillOut(res.data))
      .catch(() => setStillOut([]))
  }, [reservationId])
  const [ledger, setLedger] = useState<Ledger | null>(null)
  const [config, setConfig] = useState<ChargeConfig>({})
  const [payment, setPayment] = useState({ amount: '', method: 'cash', reference: '', note: '' })
  // The other-charge form (field fee, anything else) starts on the field fee; ammo and guns have their own cards.
  const [charge, setCharge] = useState({ type: 'field_modification', quantity: '1', unitPrice: '', note: '' })
  const [otherOpen, setOtherOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const applyLedger = useCallback((next: Ledger) => {
    setLedger(next)
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

  // The amount box starts on what can be collected now: just the booking balance while rentals
  // are out, everything once they're back.
  useEffect(() => {
    if (!ledger || stillOut === null) return
    const now = stillOut.length ? Number(ledger.bookingBalanceDue ?? ledger.balanceDue) : ledger.balanceDue
    setPayment((p) => ({ ...p, amount: now > 0 ? String(now) : '' }))
  }, [ledger, stillOut])

  // Opening the tab again picks up anything changed since (another staff member's charge or payment).
  const [shown, setShown] = useState(0)
  useEffect(() => {
    if (!active) return
    setShown((n) => n + 1)
    loadStillOut()
    apiGet<{ data: Ledger }>(`/api/reservations/${encodeURIComponent(reservationId)}/ledger`)
      .then((res) => applyLedger(res.data))
      .catch(() => null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

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

  // Ammo reloads added at the counter, oldest first.
  const ammoCharges = (ledger?.extraCharges || []).filter((c) => c.type === 'ammo_reload')

  // Takes a charge (or `quantity` units of it) back off the bill.
  const removeCharge = async (chargeId: string, quantity: number | undefined, message: string) => {
    setBusy(true)
    try {
      const res = await apiPost<{ ledger: Ledger }>(
        `/api/reservations/${encodeURIComponent(reservationId)}/charges/${encodeURIComponent(chargeId)}/remove`,
        quantity === undefined ? {} : { quantity },
      )
      applyLedger(res.ledger)
      toast.success(message)
    } catch (e: any) {
      toast.error(e?.message || 'Could not remove the charge')
    } finally {
      setBusy(false)
    }
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
      const res = await apiPost<{ ledger: Ledger; gameCompleted?: boolean }>('/api/payments/onsite', { reservationId, ...payment, amount: Number(payment.amount) })
      applyLedger(res.ledger)
      setPayment((p) => ({ ...p, reference: '', note: '' }))
      if (res.gameCompleted) {
        toast.success('Paid in full. The game is marked completed.')
        onGameCompleted?.()
      } else {
        toast.success('Payment recorded.')
      }
    } catch (e: any) {
      toast.error(e?.message || 'Could not record the payment')
    } finally {
      setBusy(false)
    }
  }

  if (!ledger) return <div className="text-sm text-muted">Loading the bill…</div>
  const ammoPrice = Number(config.ammo_reload?.unitPrice || 0)
  const extraCharges = ledger.extraCharges || []
  const ammoReloads = ammoCharges.reduce((sum, c) => sum + Number(c.quantity || 0), 0)
  // Booking balance vs. additional charges, and how much can be taken right now.
  const rentalsOut = Boolean(stillOut && stillOut.length > 0)
  const additionalTotal = Number(ledger.additionalTotal || 0)
  const bookingDue = Number(ledger.bookingBalanceDue ?? ledger.balanceDue)
  const additionalDue = Math.max(0, Math.round((ledger.balanceDue - bookingDue) * 100) / 100)
  const collectableNow = rentalsOut ? bookingDue : ledger.balanceDue
  // The booking's own bill lines: the breakdown minus one line per counter charge (same label and
  // amount), since those are listed under "Additional charges".
  const bookingLines = (() => {
    const pending = [...extraCharges]
    return ledger.breakdown.filter((line) => {
      const i = pending.findIndex((c) => c.label === line.label && Math.abs(Number(c.amount) - Number(line.amount)) < 0.01)
      if (i < 0) return true
      pending.splice(i, 1)
      return false
    })
  })()

  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
      <Card className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs uppercase tracking-widest text-muted">Bill</div>
          <Button size="sm" variant="ghost" type="button" onClick={() => printBill(ledger, bookingLines, extraCharges)}>
            <FiPrinter /> Print bill
          </Button>
        </div>
        <div className="mt-2 space-y-1 text-sm">
          {bookingLines.map((item, index) => (
            <div key={`${item.label}-${index}`} className="flex justify-between gap-3">
              <span className="text-muted">{item.label}</span>
              <span>{formatPHP(item.amount)}</span>
            </div>
          ))}
          {/* Charges added at the counter, apart from the original booking, each removable. */}
          {extraCharges.length > 0 ? (
            <>
              <div className="flex items-center gap-2 pt-3">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-gold">Additional charges</span>
                <span className="h-px flex-1 bg-gold/30" />
              </div>
              {extraCharges.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-muted">{c.label}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span>{formatPHP(c.amount)}</span>
                    {canRemove(c.type) && c.type !== 'damage' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void removeCharge(c.id, undefined, `Removed ${c.label} from the bill.`)}
                      className="rounded-lg p-1 text-muted transition hover:bg-danger/15 hover:text-danger disabled:opacity-50"
                      aria-label={`Remove ${c.label}`}
                      title="Remove from the bill"
                    >
                      <FiTrash2 />
                    </button>
                    ) : null}
                  </span>
                </div>
              ))}
              <div className="flex justify-between text-xs text-muted">
                <span>Additional total</span>
                <span>{formatPHP(extraCharges.reduce((sum, c) => sum + Number(c.amount || 0), 0))}</span>
              </div>
            </>
          ) : null}
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
        {/* Ammo and guns: added to the bill by the registrar. */}
        {canHandleGear ? (
        <>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm font-bold"><FiTarget /> Extra ammo</div>
          <p className="mt-1 text-xs text-muted">{ammoPrice ? `${formatPHP(ammoPrice)} per reload.` : 'Loading price…'}</p>
          <div className="mt-3 flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm">
            <span className="text-muted">On the bill</span>
            <span className="font-semibold">{ammoReloads} reload{ammoReloads === 1 ? '' : 's'}{ammoReloads ? ` · ${formatPHP(ammoCharges.reduce((sum, c) => sum + Number(c.amount || 0), 0))}` : ''}</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {[1, 2, 5].map((qty) => (
              <Button key={qty} type="button" variant="ghost" disabled={busy || !ammoPrice} onClick={() => quickAmmo(qty)}>
                +{qty}
              </Button>
            ))}
          </div>
        </Card>

        <AddGunCard reservationId={reservationId} ledger={ledger} onLedger={(next) => { applyLedger(next); loadStillOut() }} refreshKey={shown} />
        </>
        ) : null}

        {/* Field fees and anything else: the registrar's, kept out of the way until needed. */}
        {!canBill ? null : !otherOpen ? (
          <button type="button" onClick={() => setOtherOpen(true)} className="flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline">
            <FiPlusCircle /> Other charge (field fee, etc.)
          </button>
        ) : (
        <Card className="p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold"><FiPlusCircle /> Other charge</div>
            <button type="button" onClick={() => setOtherOpen(false)} className="text-xs text-muted hover:text-text">Close</button>
          </div>
          <form className="mt-3 space-y-3" onSubmit={addCharge}>
            <label className="block">
              <div className="mb-2 text-sm font-semibold">Type</div>
              <select value={charge.type} onChange={(e) => setCharge((c) => ({ ...c, type: e.target.value }))} className={selectClass}>
                {Object.entries(config).filter(([key]) => key !== 'ammo_reload').map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
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
        )}

        {finished ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-muted">
            The game is completed, so the bill is closed: charges can no longer be added or removed.
            {ledger.balanceDue > 0 ? ' The unpaid balance can still be collected below.' : ''}
          </div>
        ) : null}

        {canTakePayment && !(finished && ledger.balanceDue <= 0) ? (
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm font-bold"><FiCreditCard /> Record onsite payment</div>

          {/* Two parts: the booking balance (collect any time, usually at check-in), then the
              additional charges (collect after the game, once every rental is back). */}
          <div className="mt-3 space-y-1.5 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5">
                {bookingDue > 0 ? <span className="h-2 w-2 rounded-full bg-gold" /> : <FiCheck className="text-success" />}
                Booking balance
              </span>
              <span className={bookingDue > 0 ? 'font-semibold' : 'text-success'}>{bookingDue > 0 ? formatPHP(bookingDue) : 'Paid'}</span>
            </div>
            {additionalTotal > 0 ? (
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5">
                  {additionalDue <= 0 ? <FiCheck className="text-success" /> : rentalsOut ? <FiClock className="text-muted" /> : <span className="h-2 w-2 rounded-full bg-gold" />}
                  Additional charges
                </span>
                <span className={additionalDue <= 0 ? 'text-success' : rentalsOut ? 'text-muted' : 'font-semibold'}>
                  {additionalDue <= 0 ? 'Paid' : `${formatPHP(additionalDue)}${rentalsOut ? ' · after the game' : ''}`}
                </span>
              </div>
            ) : null}
          </div>

          {rentalsOut && additionalDue > 0 ? (
            <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3 text-xs">
              <div className="flex items-center gap-1.5 font-semibold text-text">
                <FiAlertTriangle className="text-warning" /> Collect the additional charges once {stillOut!.length} rental{stillOut!.length === 1 ? ' is' : 's are'} back
              </div>
              <ul className="mt-1.5 space-y-0.5 text-muted">
                {stillOut!.map((r) => (
                  <li key={r.id}>{r.itemName}{r.unitLabel && !r.itemName.includes(r.unitLabel) ? ` ${r.unitLabel}` : ''} · {r.playerName}</li>
                ))}
              </ul>
              {onGoToRentals ? (
                <button type="button" onClick={onGoToRentals} className="mt-2 font-semibold text-accent hover:underline">Go to Rentals to check them in →</button>
              ) : null}
            </div>
          ) : null}
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
            <Button type="submit" className="w-full" disabled={busy || collectableNow <= 0 || stillOut === null}>
              {ledger.balanceDue <= 0 ? 'Fully paid'
                : collectableNow <= 0 ? 'Additional charges: after rentals are back'
                : rentalsOut && additionalDue > 0 ? 'Record booking payment'
                : 'Record payment'}
            </Button>
          </form>
        </Card>
        ) : canTakePayment ? null : (
          <p className="text-xs text-muted">The registrar collects the balance at the counter.</p>
        )}
      </div>
    </div>
  )
}

type DialogTab = 'checkin' | 'teams' | 'bill' | 'rentals' | 'fps'

// Pop-up for one game, in the order a game day runs: Check-in (tick off players as they arrive),
// Teams (balanced teams for the whole session; admins and marshals), Bill & ammo (admins and
// registrars: extra ammo, guns, charges, payment), Rentals (which player has which unit) and the
// FPS check (admins and marshals).
function GameDialog({ reservationId, game, canTakePayment, canGroupTeams, canSeeBill, canCheckFps, onClose }: { reservationId: string; game?: GameDoc; canTakePayment: boolean; canGroupTeams: boolean; canSeeBill: boolean; canCheckFps: boolean; onClose: () => void }) {
  const [ledger, setLedger] = useState<Ledger | null>(null)
  // A game that hasn't started is usually opened to check players in; a running one to bill it.
  const [tab, setTab] = useState<DialogTab>(canSeeBill && /^(ongo|compl)/i.test(String(game?.Status || '')) ? 'bill' : 'checkin')
  // The game's status, kept here so Start / Done (or the final payment) update the pop-up at once.
  const [status, setStatus] = useState(String(game?.Status || 'Scheduled'))
  const setCompletedNow = () => setStatus('Completed')
  const finished = /^(compl|arch)/i.test(status)
  const ongoing = /^ongo/i.test(status)
  const gameDay = String(game?.Schedule || '').slice(0, 10)
  const canStart = !ongoing && !finished && !/^cancel/i.test(status) && Boolean(gameDay) && gameDay <= manilaTodayISO()
  const [savingStatus, setSavingStatus] = useState(false)
  const slotHours = useSlotHours()
  // Today's chronograph results for the game's guns (filled when the FPS tab loads or on Start).
  const [fpsStatus, setFpsStatus] = useState<FpsStatus | null>(null)

  const changeStatus = async (next: 'Ongoing' | 'Completed') => {
    const id = String(game?.id || game?._id?.$oid || game?._id || '')
    if (!id) return
    // Finishing before the slot is over is allowed (the squad finished early): just make sure.
    if (next === 'Completed') {
      const slot = String(game?.Schedule || '').split('•')[1]?.trim().toLowerCase() || ''
      if (gameDay && slot && !slotHasEnded(slotHours, slot, gameDay)) {
        const end = slotHours[slot as SlotName]?.end
        const ok = await confirmDialog({
          title: 'Finish this game early?',
          message: `The ${slot} slot runs until ${end ? formatClock(end) : 'later'}. Mark the game done now if the players have finished.`,
          confirmLabel: 'Mark game done',
        })
        if (!ok) return
      }
    }
    setSavingStatus(true)
    try {
      if (next === 'Ongoing') {
        // Every gun in the game must pass the chronograph today before it starts.
        const fps = await loadFpsStatus(reservationId).catch(() => null)
        if (fps?.blockReason) {
          toast.error(fps.blockReason)
          setFpsStatus(fps)
          if (canCheckFps) setTab('fps')
          return
        }
      }
      if (next === 'Completed') {
        // A game is done once every rented gun and piece of gear is back.
        const out = await apiGet<{ data: Array<{ itemName: string; playerName: string }> }>(`/api/rentals?reservationId=${encodeURIComponent(reservationId)}&status=out`)
        if (out.data.length) {
          toast.error(`Check in ${out.data.length} rental${out.data.length === 1 ? '' : 's'} first: ${out.data.map((x) => `${x.itemName} (${x.playerName})`).join(', ')}.`)
          setTab('rentals')
          return
        }
      }
      const nowISO = new Date().toISOString()
      await apiPut(`/api/gameplay/${encodeURIComponent(id)}`, {
        $set: { Status: next, updatedAtISO: nowISO, ...(next === 'Ongoing' ? { startedAtISO: nowISO } : { completedAtISO: nowISO }) },
      })
      setStatus(next)
      if (next === 'Completed') {
        toast.success(ledger && ledger.balanceDue > 0
          ? `Game marked done. ${formatPHP(ledger.balanceDue)} is still unpaid on the bill.`
          : 'Game marked done.')
        if (canSeeBill) setTab('bill')
      } else {
        toast.success('Game started.')
      }
    } catch (e: any) {
      toast.error(e?.message || 'Could not update the game')
    } finally {
      setSavingStatus(false)
    }
  }
  const r = ledger?.reservation
  const title = r ? (r.walkIn ? `Walk-in: ${r.walkInName}` : r.captainName || r.packageName || 'Reservation') : 'Game'
  const subtitle = game ? formatSchedule(game) : r ? `${r.reservationDate} · ${r.reservationTime}` : ''
  // The check-in session: from the game when opened from a card, otherwise from the booking.
  const session: CheckInSession | null = (game && sessionOfGame(game))
    || (r?.locationId && r.reservationDate && r.reservationTime
      ? { location: r.locationId.toLowerCase(), date: r.reservationDate, slot: r.reservationTime.toLowerCase() }
      : null)

  return (
    <Modal eyebrow={`${game?.id ? `Game ${game.id} · ` : ''}${reservationId}`} title={title} size="xl" onClose={onClose} confirmDiscard={false}>
      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        {subtitle ? <span className="inline-flex items-center gap-1"><FiClock /> {subtitle}</span> : null}
        <span className="inline-flex items-center gap-1"><FiMapPin /> {game ? locationName(game) : r?.locationName || '—'}</span>
        {r ? <span className="inline-flex items-center gap-1"><FiUsers /> {r.numberOfPlayers} players</span> : null}
        {r ? <span className="capitalize">{r.reservationStatus}</span> : null}
      </div>
      {/* The game's status, with the next step: Start when the squad is ready, Done when it's over. */}
      {game ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5">
          <span className="flex items-center gap-2 text-sm">
            <span className="text-muted">Game</span>
            <span className={[
              'rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase',
              finished ? 'border-success/30 bg-success/15 text-success' : ongoing ? 'border-success/30 bg-success/10 text-success' : 'border-accent/30 bg-accent/15 text-accent',
            ].join(' ')}>
              {ongoing ? <FiZap className="mr-1 inline" /> : null}{status}
            </span>
          </span>
          <span className="flex gap-2">
            {canStart ? (
              <Button size="sm" variant="ghost" disabled={savingStatus} onClick={() => void changeStatus('Ongoing')}>Start game</Button>
            ) : null}
            {ongoing || canStart ? (
              <Button size="sm" disabled={savingStatus} onClick={() => void changeStatus('Completed')}><FiCheck /> Mark game done</Button>
            ) : null}
          </span>
        </div>
      ) : null}
      {finished ? (
        <p className="-mt-2 mb-4 text-xs text-muted">This game is completed: its check-in, teams, charges and FPS readings are on record and can't be changed.</p>
      ) : null}
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          ['checkin', 'Check-in'],
          ...(canGroupTeams ? [['teams', 'Teams'] as const] : []),
          ...(canSeeBill ? [['bill', 'Bill & ammo'] as const] : []),
          ['rentals', 'Rentals'],
          // The chronograph check, done after guns are handed out and before the game starts.
          ...(canCheckFps ? [['fps', (
            <span key="fps" className="inline-flex items-center gap-1">
              FPS check
              {fpsStatus && fpsStatus.items.length ? (
                fpsStatus.allPassed ? <FiCheck className="text-success" /> : <span className="text-[11px] text-warning">({fpsStatus.pending + fpsStatus.failed})</span>
              ) : null}
            </span>
          )] as const] : []),
        ]}
      />
      {/* All tabs stay mounted so switching keeps what was typed and what was loaded. */}
      <div className={`mt-4 ${tab === 'checkin' ? '' : 'hidden'}`}>
        {session ? (
          <TeamCheckIn key={sessionId(session)} session={session} reservationId={reservationId} readOnly={finished} />
        ) : r ? (
          <BookingPlayersSection reservationId={reservationId} />
        ) : (
          <div className="text-sm text-muted">Loading check-in…</div>
        )}
      </div>
      {canGroupTeams ? (
        <div className={`mt-4 ${tab === 'teams' ? '' : 'hidden'}`}>
          {session ? (
            <SessionTeams key={sessionId(session)} session={session} active={tab === 'teams'} readOnly={finished} />
          ) : (
            <div className="text-sm text-muted">{r ? 'This booking has no session to group.' : 'Loading teams…'}</div>
          )}
        </div>
      ) : null}
      {canSeeBill ? (
      <div className={`mt-4 ${tab === 'bill' ? '' : 'hidden'}`}>
        <LedgerPanel reservationId={reservationId} canTakePayment={canTakePayment} onLoaded={setLedger} active={tab === 'bill'} onGoToRentals={() => setTab('rentals')} onGameCompleted={setCompletedNow} finished={finished} />
      </div>
      ) : null}
      <div className={`mt-4 ${tab === 'rentals' ? '' : 'hidden'}`}>
        <RentalsPanel reservationId={reservationId} active={tab === 'rentals'} finished={finished} />
      </div>
      {canCheckFps ? (
      <div className={`mt-4 ${tab === 'fps' ? '' : 'hidden'}`}>
        <FpsCheckPanel
          reservationId={reservationId}
          gameplayId={String(game?.id || '')}
          active={tab === 'fps'}
          onChange={setFpsStatus}
          onGoToRentals={() => setTab('rentals')}
          readOnly={finished}
        />
      </div>
      ) : null}
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

type View = 'ongoing' | 'today' | 'completed' | 'out'
const VIEWS: View[] = ['ongoing', 'today', 'completed', 'out']

// Games: every game on the field right now. Click one to add extra ammo, field fees or other
// charges, issue and check in rentals, and (admins and registrars) take payment. The "Still out"
// tab lists every rental not yet returned. Walk-ins open their new booking here (?reservation=<id>).
export function CounterPage() {
  const { user } = useAuth()
  const canTakePayment = user?.role === 'admin' || user?.role === 'registrar'
  // Teams are the marshal's job; the bill (ammo, guns, payments) is the registrar's. Admins get both.
  const canGroupTeams = user?.role === 'admin' || user?.role === 'marshal'
  const canSeeBill = user?.role === 'admin' || user?.role === 'registrar'
  // The chronograph (FPS) check is done by the marshals.
  const canCheckFps = user?.role === 'admin' || user?.role === 'marshal'
  const [searchParams, setSearchParams] = useSearchParams()
  const fromLink = searchParams.get('reservation') || ''
  const fromView = searchParams.get('view') as View | null
  const [view, setView] = useState<View>(fromView && VIEWS.includes(fromView) ? fromView : 'ongoing')
  const [games, setGames] = useState<GameDoc[]>([])
  const [bookings, setBookings] = useState<Map<string, BookingSummary>>(new Map())
  const [arrivals, setArrivals] = useState<Map<string, { arrived: number; total: number; label?: string }>>(new Map())
  const [loading, setLoading] = useState(true)
  const [stillOut, setStillOut] = useState<number | null>(null)
  const [open, setOpen] = useState<{ reservationId: string; game?: GameDoc } | null>(fromLink ? { reservationId: fromLink } : null)
  const slotHours = useSlotHours()
  // Every game on the "Today" tab is on today's date, so the date is shown once above the cards
  // and each card only shows its slot and hours.
  const todayLabel = new Date(`${manilaTodayISO()}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: '2-digit', year: 'numeric', timeZone: 'UTC' })
  const slotLabel = (game: GameDoc) => {
    const slot = String(game.Schedule || '').split('•')[1]?.trim().toLowerCase() || ''
    if (!slot) return formatSchedule(game)
    const range = formatSlotRange(slotHours, slot)
    const name = `${slot.charAt(0).toUpperCase()}${slot.slice(1)}`
    return range ? `${name} · ${range}` : name
  }
  // A session header's when: "Afternoon · 12–5 PM" for today's games, the full date and slot otherwise.
  const sessionWhen = (game: GameDoc) =>
    String(game.Schedule || '').slice(0, 10) === manilaTodayISO() ? slotLabel(game) : formatSchedule(game)
  // "Langkaan" from "Chill Shooters (Langkaan)": every branch is Chill Shooters.
  const branchName = (game: GameDoc) => {
    const full = locationName(game)
    return /\(([^)]+)\)\s*$/.exec(full)?.[1] || full
  }

  // Which field a game is at (its location id or name, e.g. "Chill Shooters (Biñan)"), or '' if unknown.
  const fieldOf = (game: GameDoc) => {
    const text = `${game.LocationId || ''} ${game.Location || ''}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    return BRANCHES.find((branch) => text.includes(branch.id))?.id || ''
  }
  // The field filter: all fields, or one.
  const [field, setField] = useState<string>('all')
  const fieldGames = React.useMemo(() => (field === 'all' ? games : games.filter((game) => fieldOf(game) === field)), [games, field])
  const fieldCounts = React.useMemo(() => {
    const counts: Record<string, number> = {}
    for (const game of games) {
      const id = fieldOf(game)
      if (id) counts[id] = (counts[id] || 0) + 1
    }
    return counts
  }, [games])

  // Bookings in the same session (date + slot + field) share one header, so the schedule and
  // field aren't repeated on every card. Games come sorted by schedule, so order is kept.
  const sessionGroups = React.useMemo(() => {
    const groups = new Map<string, { key: string; type: string; games: GameDoc[] }>()
    for (const game of fieldGames) {
      const key = `${game.Schedule || ''}|${game.LocationId || game.Location || ''}`
      const group = groups.get(key) || { key, type: '', games: [] }
      group.games.push(game)
      groups.set(key, group)
    }
    for (const group of groups.values()) {
      const types = new Set(group.games.map((g) => String(g.Group || '').trim().toLowerCase()).filter((t) => t === 'public' || t === 'private'))
      group.type = types.size === 1 ? [...types][0] : ''
    }
    return [...groups.values()]
  }, [fieldGames])

  // The card title names the booking (team or captain); "public"/"private" is the game type, shown on the session header.
  const gameTitle = (game: GameDoc) => {
    const booking = bookings.get(String(game.reservationId || ''))
    const label = arrivals.get(String(game.reservationId || ''))?.label
    if (label) return label
    if (booking?.walkIn) return `Walk-in: ${booking.walkInName || 'Guest'}`
    const group = String(game.Group || '').trim()
    if (group && !/^(public|private)$/i.test(group)) return group
    return booking?.packageName || game.Package || 'Booking'
  }

  const load = useCallback(async (silent = false) => {
    if (view === 'out') return
    if (!silent) setLoading(true)
    const today = manilaTodayISO()
    // Schedule is stored as "YYYY-MM-DD • slot".
    // Completed: finished games not yet archived, the latest first (for the bill or a late return).
    const q = view === 'ongoing'
      ? { Status: { $regex: '^ongo', $options: 'i' } }
      : view === 'completed'
        ? { Status: { $regex: '^compl', $options: 'i' } }
        : { $and: [{ Schedule: { $regex: `^${today}` } }, { Status: { $not: { $regex: 'arch|cancel', $options: 'i' } } }] }
    const sort = view === 'completed' ? { Schedule: -1 } : { Schedule: 1 }
    try {
      const res = await apiGet<{ data: GameDoc[] }>(`/api/gameplay?q=${encodeURIComponent(JSON.stringify(q))}&sort=${encodeURIComponent(JSON.stringify(sort))}&limit=100`)
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
        { arrived: team.players.filter((p) => p.checkedIn).length, total: team.players.length, label: team.label },
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
            {user?.role === 'registrar'
              ? 'Click a game to check players in, add ammo, guns and field fees to the bill, and collect payment.'
              : user?.role === 'marshal'
                ? 'Click a game to check players in, group teams, hand out rentals and check them back in.'
                : 'Click a game to check players in, add ammo and charges, hand out rentals, and collect payment.'}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Tabs
          value={view}
          onChange={setView}
          options={[
            ['ongoing', 'Ongoing'],
            ['today', "Today's games"],
            ['completed', 'Completed'],
            // Rentals not returned from any game: only shown while something is actually out.
            ...(stillOut || view === 'out'
              ? [['out', <span key="out" className="inline-flex items-center gap-1"><FiAlertTriangle /> Still out{stillOut ? ` (${stillOut})` : ''}</span>] as [View, React.ReactNode]]
              : []),
          ]}
        />
        {view !== 'out' ? <Button size="sm" variant="ghost" onClick={() => void load()} aria-label="Refresh"><FiRefreshCw /></Button> : null}
      </div>

      {/* Field filter: one field's games, with how many each field has in this view. */}
      {view !== 'out' ? (
        <div role="group" aria-label="Field" className="flex flex-wrap gap-1.5">
          {[{ id: 'all', label: 'All fields', count: games.length }, ...BRANCHES.map((branch) => ({ id: branch.id as string, label: branch.label as string, count: fieldCounts[branch.id] || 0 }))].map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={field === option.id}
              onClick={() => setField(option.id)}
              className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition ${field === option.id ? 'border-accent/40 bg-accent/15 text-accent' : 'border-white/10 bg-white/5 text-muted hover:text-text'}`}
            >
              <FiMapPin className="h-3.5 w-3.5" /> {option.label}
              {!loading ? <span className="rounded-full bg-black/20 px-1.5 text-[10px]">{option.count}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      {view === 'out' ? (
        <StillOutPanel onCountChange={setStillOut} />
      ) : loading ? (
        <Card className="p-6 text-sm text-muted">Loading games…</Card>
      ) : games.length > 0 && fieldGames.length === 0 ? (
        <Card className="p-6 text-sm text-muted">
          No games at {BRANCHES.find((branch) => branch.id === field)?.label || 'this field'} in this view. <button type="button" className="font-semibold text-accent hover:underline" onClick={() => setField('all')}>Show all fields</button>
        </Card>
      ) : games.length === 0 ? (
        <Card className="p-6 text-sm text-muted">
          {view === 'ongoing' ? "No games are in progress. Games appear here once they're started."
            : view === 'completed' ? 'No completed games. A game moves here once it is completed, or when its final payment is taken.'
            : 'No games are scheduled for today.'}
        </Card>
      ) : (
        <>
        {view === 'today' ? <div className="text-sm font-semibold text-muted">{todayLabel}</div> : null}
        {/* One card per session (slot + branch), two side by side on wide screens; each booking
            in it is one compact row. */}
        <div className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {sessionGroups.map((group) => (
        <section key={group.key} className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
          {/* Card header: when on the first line; where, type and booking count on the second. */}
          <div className="border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-1.5 text-sm font-bold"><FiClock className="shrink-0" /> <span className="truncate">{sessionWhen(group.games[0])}</span></div>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted">
              <span className="flex min-w-0 items-center gap-1" title={locationName(group.games[0])}><FiMapPin className="shrink-0" /> <span className="truncate">{branchName(group.games[0])}</span></span>
              {group.type ? <span className="shrink-0 rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">{group.type}</span> : null}
              <span className="ml-auto shrink-0">{group.games.length} booking{group.games.length === 1 ? '' : 's'}</span>
            </div>
          </div>
          <ul className="divide-y divide-white/5">
          {group.games.map((game) => {
            const booking = bookings.get(String(game.reservationId || ''))
            const ongoing = /^ongo/i.test(String(game.Status || ''))
            const arrival = arrivals.get(String(game.reservationId || ''))
            const allIn = Boolean(arrival && arrival.total > 0 && arrival.arrived === arrival.total)
            const packageName = booking?.packageName || game.Package
            return (
              <li key={gameKey(game)}>
              <button
                type="button"
                disabled={!game.reservationId}
                onClick={() => game.reservationId && setOpen({ reservationId: game.reservationId, game })}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-accent/5 disabled:opacity-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 truncate font-bold">{gameTitle(game)}</span>
                    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${ongoing ? 'border-success/30 bg-success/15 text-success' : 'border-accent/30 bg-accent/15 text-accent'}`}>
                      {ongoing ? <FiZap /> : null}{String(game.Status || 'Scheduled').toUpperCase()}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
                    {packageName ? <span className="flex items-center gap-1"><FiTarget /> {packageName}</span> : null}
                    {arrival ? (
                      <span className={`flex items-center gap-1 ${allIn ? 'font-semibold text-success' : ''}`}><FiUsers /> {arrival.arrived} of {arrival.total} checked in</span>
                    ) : booking?.numberOfPlayers ? <span className="flex items-center gap-1"><FiUsers /> {booking.numberOfPlayers} players</span> : null}
                  </div>
                  {/* Long reservation IDs are cut short here; the full one is in the game's pop-up. */}
                  <div className="mt-0.5 truncate text-[11px] text-muted/80" title={`${game.id} · ${game.reservationId}`}>{game.id} · {game.reservationId}</div>
                </div>
                <FiChevronRight className="shrink-0 text-muted" aria-hidden />
              </button>
              </li>
            )
          })}
          </ul>
        </section>
        ))}
        </div>
        </>
      )}

      {open ? <GameDialog key={open.reservationId} reservationId={open.reservationId} game={open.game} canTakePayment={canTakePayment} canGroupTeams={canGroupTeams} canSeeBill={canSeeBill} canCheckFps={canCheckFps} onClose={close} /> : null}
    </div>
  )
}
