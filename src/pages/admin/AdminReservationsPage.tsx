import React from 'react'
import { ReservationsByDate } from '../../components/reservations/ReservationsByDate'

// Dates with bookings and their players. Reviewing payments and confirming, flagging or sending
// back a booking happens on the Payments page (components/payments/BookingPaymentReview).
export function AdminReservationsPage() {
  return <ReservationsByDate />
}
