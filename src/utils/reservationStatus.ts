// There is no cancellation policy. A booking only ends early when its payment window runs out
// unpaid; the server stores that as status "cancelled" with reason "payment_window_expired",
// and it is shown as expired rather than cancelled.
export function reservationStatusLabel(reservation: { reservationStatus?: string; cancellationReason?: string }) {
  const status = String(reservation.reservationStatus || 'pending').toLowerCase()
  if (status === 'cancelled' && reservation.cancellationReason === 'payment_window_expired') return 'expired: not paid'
  return status
}
