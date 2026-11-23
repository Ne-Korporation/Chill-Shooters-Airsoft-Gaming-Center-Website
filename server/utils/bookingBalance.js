// What a booking still owes, split into the booking itself and the additional charges added at
// the counter. Payments count toward the booking first. Failed or rejected payments don't count.
// Used by the Counter's bill (routes/fieldOps.js) and by the Start rules: a game can't start while
// the booking balance is unpaid (additional charges are collected after the game).

const round = (value) => Math.round(value * 100) / 100

export function bookingBalances(reservation, payments) {
  const active = (payments || []).filter((p) => !['failed', 'rejected'].includes(String(p.paymentStatus || p.status || '').toLowerCase()))
  const collected = round(active.reduce((sum, p) => sum + Number(p.amount || 0), 0))
  const total = round(Number(reservation?.totalAmount || 0))
  const extraTotal = round((reservation?.extraCharges || []).reduce((sum, c) => sum + Number(c.amount || 0), 0))
  return {
    collected,
    total,
    extraTotal,
    balanceDue: Math.max(0, round(total - collected)),
    bookingBalanceDue: Math.max(0, round(total - extraTotal - collected)),
  }
}

// The reason a game can't start yet because of money, or '' when it can.
export function unpaidStartReason(reservation, payments) {
  const { bookingBalanceDue } = bookingBalances(reservation, payments)
  if (bookingBalanceDue <= 0.01) return ''
  return `The booking still has ₱${bookingBalanceDue.toLocaleString()} unpaid. Collect it at the Counter before starting the game.`
}
