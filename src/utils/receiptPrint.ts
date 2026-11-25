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
  userId?: string
  paymentMode?: string
  splitShares?: Record<string, number> | null
  // Teammates' spots the captain paid for (see server/utils/teamInvites.js).
  openSlots?: Array<{ name?: string; amount?: number; status?: string; captainPaid?: boolean }>
}

export type ReceiptPayment = {
  id?: string
  _id?: string
  userId?: string
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

// Discounts print as "−₱395.00", not "₱-395.00".
const php = (value: unknown) => {
  const n = Number(value || 0)
  return `${n < 0 ? '−' : ''}₱${Math.abs(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Who made a payment: payments with no payer recorded are the captain's.
export function payerIdOf(payment: ReceiptPayment, reservation?: ReceiptReservation | null) {
  return String(payment.userId || reservation?.userId || '')
}

// One payer's payments on a reservation: a receipt only ever lists what that person paid.
export function paymentsOfPayer(payments: ReceiptPayment[], payerId: string, reservation?: ReceiptReservation | null) {
  return payerId ? payments.filter((payment) => payerIdOf(payment, reservation) === payerId) : payments
}

// `record`: a payment that is not verified yet (pending, sent back, cancelled). It is printed as a
// payment record that says so, never as an official receipt, and lists the given payments as-is.
// `payerId`: whose receipt this is. In a split payment it shows that payer's share and what they
// paid, not the team's total and balance.
export function buildReceiptHtml(
  reservation: ReceiptReservation,
  payments: ReceiptPayment[],
  payerName: string,
  receiptNo: string,
  { record = false, payerId = '' }: { record?: boolean; payerId?: string } = {},
) {
  const listed = record ? payments : payments.filter(isVerifiedPayment)
  const paidPayments = listed.filter(isVerifiedPayment)
  const reservationId = String(reservation.id || reservation._id || '')
  const paid = paidPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0)
  const total = Number(reservation.totalAmount || 0)
  const split = Boolean(payerId) && String(reservation.paymentMode || '').toLowerCase() === 'split'
  const recordedShare = split ? Number(reservation.splitShares?.[payerId]) : NaN
  // The captain may also have paid online for teammates' spots (a teammate who left): each one is
  // listed, so the amount received adds up.
  const coveredSpots = split && payerId === String(reservation.userId || '')
    ? (reservation.openSlots || []).filter((slot) => (['covering', 'paid'].includes(String(slot.status || '')) || slot.captainPaid) && Number(slot.amount) > 0)
    : []
  const owedTotal = (Number.isFinite(recordedShare) ? recordedShare : 0) + coveredSpots.reduce((sum, slot) => sum + Number(slot.amount || 0), 0)
  const totals = split
    ? `${Number.isFinite(recordedShare) ? `<tr><td>Your share</td><td class="r">${php(recordedShare)}</td></tr>` : ''}
    ${coveredSpots.map((slot) => `<tr><td>Spot you paid for: ${esc(slot.name || 'teammate')}</td><td class="r">${php(slot.amount)}</td></tr>`).join('')}
    ${coveredSpots.length && Number.isFinite(recordedShare) ? `<tr><td>Total you owe</td><td class="r">${php(owedTotal)}</td></tr>` : ''}
    <tr><td>Amount received${record ? ' (verified)' : ''}</td><td class="r">${php(paid)}</td></tr>
    ${Number.isFinite(recordedShare) ? `<tr><td>Still due</td><td class="r">${php(Math.max(0, owedTotal - paid))}</td></tr>` : ''}`
    : `<tr><td>Reservation total</td><td class="r">${php(total)}</td></tr>
    <tr><td>Total paid${record ? ' (verified)' : ''}</td><td class="r">${php(paid)}</td></tr>
    <tr><td>Balance due</td><td class="r">${php(Math.max(0, total - paid))}</td></tr>`
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
  * { box-sizing: border-box; }
  html, body { background: #fff; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 12px; margin: 0; }
  /* Centred with its own side padding, so nothing is cut off at the page edges even when the print
     dialog's margins are set to "None" or "Minimum". */
  .sheet { width: 100%; max-width: 124mm; margin: 0 auto; padding: 0 2mm; }
  h1 { font-size: 18px; margin: 0; }
  .muted { color: #555; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 10px; }
  .head .r { white-space: nowrap; }
  .info { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin-bottom: 4px; }
  .info .k { color: #555; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; }
  th, td { text-align: left; padding: 4px 4px; border-bottom: 1px solid #ddd; vertical-align: top; }
  th:first-child, td:first-child { padding-left: 0; }
  th:last-child, td:last-child { padding-right: 0; }
  th { font-size: 10px; text-transform: uppercase; color: #555; border-bottom: 1px solid #000; }
  .r { text-align: right; white-space: nowrap; }
  .totals { margin-left: auto; width: 60%; }
  .totals td { border: 0; padding-top: 2px; padding-bottom: 2px; }
  .totals tr:last-child td { font-weight: bold; font-size: 14px; border-top: 2px solid #000; padding-top: 6px; }
  .note { font-size: 11px; margin: 0 0 8px; }
  .foot { border-top: 1px solid #ccc; padding-top: 6px; margin-top: 12px; font-size: 10px; }
  @media screen { body { padding: 16px; } }
  .stamp { border: 2px solid #b45309; color: #b45309; padding: 6px 8px; margin-bottom: 10px; font-weight: bold; }
</style></head><body><div class="sheet">
  <div class="head">
    <div><h1>Chill Shooters</h1><div class="muted">Airsoft Game Center · ${record ? 'Payment record' : 'Official payment receipt'}</div></div>
    <div class="r"><b>${esc(receiptNo)}</b><div class="muted">Printed ${esc(new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }))}</div></div>
  </div>
  ${record ? '<div class="stamp">Not an official receipt: this payment has not been verified yet.</div>' : ''}
  <div class="info">
    <span class="k">Received from</span><b>${esc(payerName || '-')}</b>
    <span class="k">Reservation</span><span>${esc(reservationId)}</span>
    <span class="k">Game</span><span>${esc(reservation.reservationDate || '-')}${reservation.reservationTime ? ` · ${esc(reservation.reservationTime.charAt(0).toUpperCase() + reservation.reservationTime.slice(1))}` : ''}</span>
    <span class="k">Field</span><span>${esc(reservation.locationName || reservation.locationId || '-')}</span>
    <span class="k">Players</span><span>${esc(reservation.numberOfPlayers ?? '-')}${reservation.sessionType ? ` · ${esc(reservation.sessionType)}` : ''}</span>
    <span class="k">Package</span><span>${esc(reservation.packageName || 'Custom selection')}</span>
  </div>
  <table><thead><tr><th>Charges</th><th class="r">Amount</th></tr></thead><tbody>${lines || '<tr><td colspan="2">-</td></tr>'}</tbody></table>
  <table><thead><tr><th>Date</th><th>Method</th><th>Reference</th>${record ? '<th>Status</th>' : ''}<th class="r">${record ? 'Amount' : 'Paid'}</th></tr></thead><tbody>${paymentRows || `<tr><td colspan="${record ? 5 : 4}">-</td></tr>`}</tbody></table>
  ${split ? `<p class="note muted">Split payment: this receipt covers only what ${esc(payerName || 'this player')} paid toward the reservation total of ${php(total)}.</p>` : ''}
  <table class="totals">
    ${totals}
  </table>
  <div class="foot muted">${record ? 'Only verified payments count toward the total paid.' : 'Only payments verified by Chill Shooters staff or the payment processor are listed.'}</div>
</div></body></html>`
}

// The receipt number is issued and saved by the server, so reprinting the same payments
// shows the same number and every number traces back to its payments.
// `payerId`: whose payments it covers (staff choose; a player always gets their own).
export async function fetchReceiptNo(reservation: ReceiptReservation, payerId = '') {
  const reservationId = String(reservation.id || reservation._id || '')
  const res = await apiPost<{ ok: boolean; data: { receiptNo: string } }>(`/api/reservations/${encodeURIComponent(reservationId)}/receipt`, payerId ? { payerId } : {})
  return res.data.receiptNo
}

// Opens the browser's print dialog for a receipt; "Save as PDF" there downloads it as a PDF.
export function printReceiptHtml(html: string) {
  const iframe = document.createElement('iframe')
  // Off-screen at A5 width rather than zero-width, so the receipt lays out at its real size.
  iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:148mm;height:210mm;border:0;visibility:hidden'
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

export async function printReceipt(reservation: ReceiptReservation, payments: ReceiptPayment[], payerName: string, payerId = '') {
  const mine = paymentsOfPayer(payments, payerId, reservation)
  printReceiptHtml(buildReceiptHtml(reservation, mine, payerName, await fetchReceiptNo(reservation, payerId), { payerId }))
}
