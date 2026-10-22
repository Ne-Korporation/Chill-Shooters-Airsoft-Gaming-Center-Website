export type ReceiptReservation = {
  id?: string
  _id?: string
  reservationDate?: string
  reservationTime?: string
  locationName?: string
  locationId?: string
  sessionType?: string
  numberOfPlayers?: number
  packageName?: string
  totalAmount?: number
  pricingBreakdown?: Array<{ label?: string; amount?: number }>
}

export type ReceiptPayment = {
  id?: string
  _id?: string
  amount?: number
  paymentMethod?: string
  paymentStatus?: string
  status?: string
  transactionReference?: string
  stripePaymentIntentId?: string
  createdAtISO?: string
  verifiedAtISO?: string
}

// Only payments staff (or Stripe) have verified are receipted.
export const VERIFIED_PAYMENT_STATUSES = ['paid', 'confirmed', 'verified', 'approved', 'succeeded']

export function isVerifiedPayment(payment: ReceiptPayment) {
  return VERIFIED_PAYMENT_STATUSES.includes(String(payment.paymentStatus || payment.status || '').toLowerCase())
}

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

const php = (value: unknown) => `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function buildReceiptHtml(reservation: ReceiptReservation, payments: ReceiptPayment[], payerName: string) {
  const verified = payments.filter(isVerifiedPayment)
  const reservationId = String(reservation.id || reservation._id || '')
  const paid = verified.reduce((sum, p) => sum + Number(p.amount || 0), 0)
  const total = Number(reservation.totalAmount || 0)
  const receiptNo = `OR-${reservationId.replace(/[^A-Za-z0-9]/g, '').slice(-8).toUpperCase()}-${verified.length}`
  const lines = (reservation.pricingBreakdown || [])
    .map((item) => `<tr><td>${esc(item.label || 'Charge')}</td><td class="r">${php(item.amount)}</td></tr>`)
    .join('')
  const paymentRows = verified
    .map((p) => `<tr>
      <td>${esc((p.verifiedAtISO || p.createdAtISO || '').slice(0, 10))}</td>
      <td>${esc(p.paymentMethod || (p.stripePaymentIntentId ? 'Card' : '-'))}</td>
      <td>${esc(p.transactionReference || p.stripePaymentIntentId || p.id || '-')}</td>
      <td class="r">${php(p.amount)}</td></tr>`)
    .join('')

  return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${esc(receiptNo)}</title>
<style>
  @page { size: A5; margin: 12mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 12px; margin: 0; }
  h1 { font-size: 18px; margin: 0; }
  .muted { color: #555; }
  .head { display: flex; justify-content: space-between; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 12px; }
  th, td { text-align: left; padding: 4px 2px; border-bottom: 1px solid #ddd; }
  th { font-size: 10px; text-transform: uppercase; color: #555; }
  .r { text-align: right; }
  .totals td { border: 0; font-weight: bold; }
</style></head><body>
  <div class="head">
    <div><h1>Chill Shooters</h1><div class="muted">Airsoft Gaming Center · Official payment receipt</div></div>
    <div class="r"><b>${esc(receiptNo)}</b><div class="muted">Printed ${esc(new Date().toLocaleString())}</div></div>
  </div>
  <div><b>Received from:</b> ${esc(payerName || '-')}</div>
  <div><b>Reservation:</b> ${esc(reservationId)} · ${esc(reservation.reservationDate || '-')} (${esc(reservation.reservationTime || '-')})
    · ${esc(reservation.locationName || reservation.locationId || '-')} · ${esc(reservation.sessionType || '-')} · ${esc(reservation.numberOfPlayers ?? '-')} players</div>
  <div><b>Package:</b> ${esc(reservation.packageName || 'Custom selection')}</div>
  <table><thead><tr><th>Charges</th><th class="r">Amount</th></tr></thead><tbody>${lines || '<tr><td colspan="2">-</td></tr>'}</tbody></table>
  <table><thead><tr><th>Date</th><th>Method</th><th>Reference</th><th class="r">Paid</th></tr></thead><tbody>${paymentRows}</tbody></table>
  <table class="totals">
    <tr><td>Reservation total</td><td class="r">${php(total)}</td></tr>
    <tr><td>Total paid</td><td class="r">${php(paid)}</td></tr>
    <tr><td>Balance due</td><td class="r">${php(Math.max(0, total - paid))}</td></tr>
  </table>
  <div class="muted">Only payments verified by Chill Shooters staff or the card processor are listed.</div>
</body></html>`
}

export function printReceipt(reservation: ReceiptReservation, payments: ReceiptPayment[], payerName: string) {
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  document.body.appendChild(iframe)
  const win = iframe.contentWindow
  if (!win) return
  win.document.open()
  win.document.write(buildReceiptHtml(reservation, payments, payerName))
  win.document.close()
  win.addEventListener('afterprint', () => setTimeout(() => iframe.remove(), 500), { once: true })
  win.focus()
  win.print()
}
