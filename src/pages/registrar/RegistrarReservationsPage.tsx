import React from 'react'
import { ReservationsByDate } from '../../components/reservations/ReservationsByDate'

// Same view as the admin: dates with bookings and their players. Booking decisions are made
// on Submitted Payments.
export function RegistrarReservationsPage() {
  return <ReservationsByDate />
}
