import React from 'react'
import { ReservationsByDate } from '../../components/reservations/ReservationsByDate'
import { SlotHoursCard } from '../../components/reservations/SlotHoursCard'

// Dates with bookings and their players. Bookings confirm themselves once their payment is
// verified (by Xendit, or by staff on the Payments page's Verification & receipts).
export function AdminReservationsPage() {
  return (
    <>
      <SlotHoursCard />
      <ReservationsByDate />
    </>
  )
}
