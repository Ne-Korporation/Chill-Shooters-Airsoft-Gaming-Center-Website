import React from 'react'
import { createPortal } from 'react-dom'
import { FiX } from 'react-icons/fi'
import { Button } from '../ui/Button'
import { formatSlotRange, type SlotHours } from '../../utils/slotHours'
import { reservationStatusLabel } from '../../utils/reservationStatus'
import { ReservationIdTag } from './ReservationIdTag'
import { bookingRoles } from '../../utils/bookingRoles'

export type ReservationDetails = {
  id?: string
  _id?: string
  reservationDate?: string
  dateISO?: string
  reservationTime?: string
  slot?: string
  reservationStatus?: string
  cancellationReason?: string
  locationName?: string
  locationId?: string
  fieldNames?: string
  fieldIds?: string[]
  sessionType?: string
  numberOfPlayers?: number
  teamName?: string
  packageName?: string
  selectionMode?: string
  gameModePreference?: string
  layoutRequest?: string
  layoutBlueprintUrl?: string
  notes?: string
  totalAmount?: number
  depositAmount?: number
  balanceAmount?: number
  paymentMode?: string
  paymentState?: string
  pricingBreakdown?: Array<{ label?: string; amount?: number }>
  teamMembers?: Array<{ id?: string; name?: string }>
  ownWeapons?: string
  ownEquipment?: string
  createdAtISO?: string
  rescheduleHistory?: Array<{ fromDate?: string; fromTime?: string; toDate?: string; toTime?: string; reason?: string; atISO?: string }>
}

export type Payment = { amount?: number; paymentMethod?: string; paymentStatus?: string; createdAtISO?: string; transactionReference?: string }

const peso = (value?: number) => `₱${Number(value || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-white/5 py-2 text-sm last:border-b-0">
      <div className="text-muted">{label}</div>
      <div className="text-right font-semibold">{children}</div>
    </div>
  )
}

function fieldLabel(id: string) {
  const names: Record<string, string> = { 'field-1': 'Upper Ground', 'field-2': 'Lower Ground', 'field-3': 'Forest' }
  const key = Object.keys(names).find((suffix) => id.endsWith(suffix))
  return key ? names[key] : id
}

// Everything about one booking on a single sheet: schedule, team, rentals and what they cost,
// game preferences, and the payments made so far.
export function ReservationDetailsDialog({
  reservation,
  payments,
  captainName,
  slotHours,
  onClose,
}: {
  reservation: ReservationDetails
  payments: Payment[]
  captainName: string
  slotHours: SlotHours
  onClose: () => void
}) {
  const date = reservation.reservationDate || reservation.dateISO || ''
  const slot = String(reservation.reservationTime || reservation.slot || '').toLowerCase()
  const fields = reservation.fieldNames || (reservation.fieldIds || []).map(fieldLabel).join(', ')

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-3 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="reservation-details-title" onClick={onClose}>
      <div className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/10 bg-background p-4 shadow-soft sm:p-5" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted">Reservation details</div>
            <h2 id="reservation-details-title" className="mt-1 text-2xl font-bold">
              {date ? new Date(`${date}T12:00:00Z`).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'No date'}
            </h2>
            <div className="mt-1 text-sm text-muted">
              <span className="capitalize">{slot || '—'}</span>{slot ? ` · ${formatSlotRange(slotHours, slot)}` : ''} · <ReservationIdTag id={reservation.id || reservation._id} />
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close" className="w-10 px-0"><FiX /></Button>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <section>
            <div className="text-xs uppercase tracking-widest text-muted">Booking</div>
            <div className="mt-1">
              <Row label="Status"><span className="capitalize">{reservationStatusLabel(reservation)}</span></Row>
              <Row label="Location">{reservation.locationName || reservation.locationId || '—'}</Row>
              <Row label="Field">{fields || '—'}</Row>
              <Row label="Session"><span className="capitalize">{reservation.sessionType || 'public'}</span></Row>
              {reservation.teamName ? <Row label="Team">{reservation.teamName}</Row> : null}
              <Row label="Players">{reservation.numberOfPlayers || 0}</Row>
              <Row label="Package">{reservation.packageName || 'Custom selection'}</Row>
              {reservation.createdAtISO ? <Row label="Booked on">{new Date(reservation.createdAtISO).toLocaleDateString('en-PH', { dateStyle: 'medium' })}</Row> : null}
            </div>
          </section>

          <section>
            <div className="text-xs uppercase tracking-widest text-muted">{bookingRoles(reservation.sessionType).group}</div>
            <ul className="mt-2 space-y-1 text-sm">
              <li><span className="font-semibold">{captainName}</span> <span className="text-xs text-muted">· {bookingRoles(reservation.sessionType).booker}</span></li>
              {(reservation.teamMembers || []).map((member) => (
                <li key={member.id || member.name}>{member.name || member.id}</li>
              ))}
            </ul>
            {reservation.gameModePreference || reservation.layoutRequest || reservation.notes ? (
              <>
                <div className="mt-4 text-xs uppercase tracking-widest text-muted">Game preferences</div>
                <div className="mt-1">
                  {reservation.gameModePreference ? <Row label="Game mode">{reservation.gameModePreference}</Row> : null}
                  {reservation.layoutRequest ? <Row label="Layout request">{reservation.layoutRequest}</Row> : null}
                  {reservation.notes ? <Row label="Notes">{reservation.notes}</Row> : null}
                </div>
                {reservation.layoutBlueprintUrl ? (
                  <a href={reservation.layoutBlueprintUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-semibold text-accent hover:underline">View layout blueprint</a>
                ) : null}
              </>
            ) : null}
          </section>
        </div>

        <ReservationChargesSections reservation={reservation} payments={payments} />
      </div>
    </div>,
    document.body,
  )
}

// Rentals, charges and payments, and reschedules of one booking. Shared by the reservation
// details sheet and the staff game details pop-up.
export function ReservationChargesSections({ reservation, payments }: { reservation: ReservationDetails; payments: Payment[] }) {
  const rentals = (reservation.pricingBreakdown || []).filter((line) => !/entrance fee|discount/i.test(String(line.label || '')))
  const otherLines = (reservation.pricingBreakdown || []).filter((line) => /entrance fee|discount/i.test(String(line.label || '')))
  const paid = payments
    .filter((payment) => !['failed', 'rejected', 'cancelled'].includes(String(payment.paymentStatus || '').toLowerCase()))
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)

  return (
    <>
      <section className="mt-4">
        <div className="text-xs uppercase tracking-widest text-muted">Rentals</div>
        {rentals.length ? (
          <div className="mt-1">
            {rentals.map((line, index) => <Row key={`${line.label}-${index}`} label={String(line.label || 'Item')}>{peso(line.amount)}</Row>)}
          </div>
        ) : (
          <div className="mt-2 text-sm text-muted">No rentals: the team brings its own gear.</div>
        )}
        {reservation.ownWeapons || reservation.ownEquipment ? (
          <div className="mt-2 text-xs text-muted">
            Bringing their own: {[reservation.ownWeapons, reservation.ownEquipment].filter(Boolean).join(' · ')}
          </div>
        ) : null}
      </section>

      <section className="mt-4">
        <div className="text-xs uppercase tracking-widest text-muted">Charges & payments</div>
        <div className="mt-1">
          {otherLines.map((line, index) => <Row key={`${line.label}-${index}`} label={String(line.label || '')}>{peso(line.amount)}</Row>)}
          <Row label="Total">{peso(reservation.totalAmount)}</Row>
          <Row label="Online deposit">{peso(reservation.depositAmount)}</Row>
          <Row label="Paid so far">{peso(paid)}</Row>
          <Row label="Balance due on game day">{peso(Math.max(0, Number(reservation.totalAmount || 0) - Math.max(paid, 0)))}</Row>
          <Row label="Payment">{reservation.paymentMode === 'split' ? 'Split with the team' : 'Single payer'}</Row>
        </div>
        {payments.length ? (
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {payments.map((payment, index) => (
              <li key={index}>
                {payment.createdAtISO ? new Date(payment.createdAtISO).toLocaleDateString('en-PH', { dateStyle: 'medium' }) : ''} · {payment.paymentMethod || '—'} · {peso(payment.amount)} ·{' '}
                <span className="capitalize">{payment.paymentStatus || 'pending'}</span>
                {payment.transactionReference ? ` · Ref ${payment.transactionReference}` : ''}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {reservation.rescheduleHistory?.length ? (
        <section className="mt-4">
          <div className="text-xs uppercase tracking-widest text-muted">Reschedules</div>
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {reservation.rescheduleHistory.map((event, index) => (
              <li key={index}>
                {event.fromDate} {event.fromTime} → {event.toDate} {event.toTime}{event.reason ? ` — ${event.reason}` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  )
}
