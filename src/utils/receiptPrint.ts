import { apiPost } from './apiClient'

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

// `record`: a payment that is not verified yet (pending, sent back, cancelled). It is printed as a
// payment record that says so, never as an official receipt, and lists the given payments as-is.
export function buildReceiptHtml(
  reservation: ReceiptReservation,
  payments: ReceiptPayment[],
  payerName: string,
  receiptNo: string,
  { record = false }: { record?: boolean } = {},
) {
  const listed = record ? payments : payments.filter(isVerifiedPayment)
  const paidPayments = listed.filter(isVerifiedPayment)
  const reservationId = String(reservation.id || reservation._id || '')
  const paid = paidPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0)
  const total = Number(reservation.totalAmount || 0)
  const lines = (reservation.pricingBreakdown || [])
    .map((item) => `<tr><td>${esc(item.label || 'Charge')}</td><td class="r">${php(item.amount)}</td></tr>`)
    .join('')
  const paymentRows = listed
    .map((p) => `<tr>
      <td>${esc((p.verifiedAtISO || p.createdAtISO || '').slice(0, 10))}</td>
      <td>${esc(p.paymentMethod || (p.stripePaymentIntentId ? 'Card' : '-'))}</td>
      <td>${esc(p.transactionReference || p.stripePaymentIntentId || p.id || '-')}</td>
      ${record ? `<td>${esc(String(p.paymentStatus || p.status || 'pending').toUpperCase())}</td>` : ''}
      <td class="r">${php(p.amount)}</td></tr>`)
    .join('')

  return `<!doctype html><html><head><meta charset="utf-8"><title>${record ? 'Payment record' : 'Receipt'} ${esc(receiptNo)}</title>
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
  @media screen { body { padding: 16px; } }
  .stamp { border: 2px solid #b45309; color: #b45309; padding: 6px 8px; margin-bottom: 10px; font-weight: bold; }
</style></head><body>
  <div class="head">
    <div><h1>Chill Shooters</h1><div class="muted">Airsoft Gaming Center · ${record ? 'Payment record' : 'Official payment receipt'}</div></div>
    <div class="r"><b>${esc(receiptNo)}</b><div class="muted">Printed ${esc(new Date().toLocaleString())}</div></div>
  </div>
  ${record ? '<div class="stamp">Not an official receipt: this payment has not been verified yet.</div>' : ''}
  <div><b>Received from:</b> ${esc(payerName || '-')}</div>
  <div><b>Reservation:</b> ${esc(reservationId)} · ${esc(reservation.reservationDate || '-')} (${esc(reservation.reservationTime || '-')})
    · ${esc(reservation.locationName || reservation.locationId || '-')} · ${esc(reservation.sessionType || '-')} · ${esc(reservation.numberOfPlayers ?? '-')} players</div>
  <div><b>Package:</b> ${esc(reservation.packageName || 'Custom selection')}</div>
  <table><thead><tr><th>Charges</th><th class="r">Amount</th></tr></thead><tbody>${lines || '<tr><td colspan="2">-</td></tr>'}</tbody></table>
  <table><thead><tr><th>Date</th><th>Method</th><th>Reference</th>${record ? '<th>Status</th>' : ''}<th class="r">${record ? 'Amount' : 'Paid'}</th></tr></thead><tbody>${paymentRows || `<tr><td colspan="${record ? 5 : 4}">-</td></tr>`}</tbody></table>
  <table class="totals">
    <tr><td>Reservation total</td><td class="r">${php(total)}</td></tr>
    <tr><td>Total paid${record ? ' (verified)' : ''}</td><td class="r">${php(paid)}</td></tr>
    <tr><td>Balance due</td><td class="r">${php(Math.max(0, total - paid))}</td></tr>
  </table>
  <div class="muted">${record ? 'Only verified payments count toward the total paid.' : 'Only payments verified by Chill Shooters staff or the payment processor are listed.'}</div>
</body></html>`
}

// The receipt number is issued and saved by the server, so reprinting the same payments
// shows the same number and every number traces back to its payments.
export async function fetchReceiptNo(reservation: ReceiptReservation) {
  const reservationId = String(reservation.id || reservation._id || '')
  const res = await apiPost<{ ok: boolean; data: { receiptNo: string } }>(`/api/reservations/${encodeURIComponent(reservationId)}/receipt`, {})
  return res.data.receiptNo
}

// Opens the browser's print dialog for a receipt; "Save as PDF" there downloads it as a PDF.
export function printReceiptHtml(html: string) {
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  document.body.appendChild(iframe)
  const win = iframe.contentWindow
  if (!win) return
  win.document.open()
  win.document.write(html)
  win.document.close()
  win.addEventListener('afterprint', () => setTimeout(() => iframe.remove(), 500), { once: true })
  win.focus()
  win.print()
}

// Saves the receipt as a file that opens (and prints) in any browser.
export function downloadReceiptHtml(html: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${fileName.replace(/[^\w.-]+/g, '_')}.html`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function printReceipt(reservation: ReceiptReservation, payments: ReceiptPayment[], payerName: string) {
  printReceiptHtml(buildReceiptHtml(reservation, payments, payerName, await fetchReceiptNo(reservation)))
}
