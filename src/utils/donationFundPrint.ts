// The printable donation fund report: totals for a period, the games for a cause in it, and the
// ledger with a running balance. Printed through the browser's print dialog ("Save as PDF" there
// downloads it), like receipts.

export type FundLedgerEntry = {
  type: 'allocation' | 'cause_day' | 'donation' | 'expenditure'
  amount: number
  description: string
  donorName?: string
  dateISO?: string
  atISO: string
  recordedBy?: { actorEmail?: string }
}

export type FundCauseDay = {
  dateISO: string
  title: string
  beneficiary: string
  donationPercent: number
  bookings: number
  players: number
  collected: number
  donation: number
  added: number
  toAdd: number
}

const TYPE_LABELS: Record<FundLedgerEntry['type'], string> = {
  allocation: 'Allocation',
  cause_day: 'Game for a cause',
  donation: 'Donation',
  expenditure: 'Expenditure',
}

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

// Money in one style everywhere: ₱1,234.50, and a negative as −₱760.00.
const php = (value: number) => {
  const amount = Number(value || 0)
  const text = `₱${Math.abs(amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return amount < 0 ? `−${text}` : text
}

const longDate = (dateISO: string) => {
  const date = new Date(`${dateISO}T12:00:00`)
  return Number.isNaN(date.getTime()) ? dateISO : date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}

// The day an entry counts on: the date typed in, else when it was recorded.
export const entryDay = (entry: FundLedgerEntry) => entry.dateISO || String(entry.atISO || '').slice(0, 10)

const signed = (entry: FundLedgerEntry) => (entry.type === 'expenditure' ? -1 : 1) * Number(entry.amount || 0)
const round = (value: number) => Math.round(value * 100) / 100
// "maria.santos@…" → "maria.santos": the ledger shows who recorded an entry without the long address.
const recorder = (entry: FundLedgerEntry) => String(entry.recordedBy?.actorEmail || '').split('@')[0]

// `from` / `to`: YYYY-MM-DD, both optional (empty = from the start / up to today).
export function buildDonationFundReportHtml({ entries, causeDays, from, to, preparedBy }: {
  entries: FundLedgerEntry[]
  causeDays: FundCauseDay[]
  from: string
  to: string
  preparedBy: string
}) {
  const inPeriod = (day: string) => (!from || day >= from) && (!to || day <= to)
  // Oldest first, so the running balance reads down the page.
  const ordered = [...entries].sort((a, b) => entryDay(a).localeCompare(entryDay(b)) || String(a.atISO).localeCompare(String(b.atISO)))
  const opening = round(ordered.filter((entry) => from && entryDay(entry) < from).reduce((sum, entry) => sum + signed(entry), 0))
  const rows = ordered.filter((entry) => inPeriod(entryDay(entry)))
  const total = (type: FundLedgerEntry['type']) => round(rows.filter((entry) => entry.type === type).reduce((sum, entry) => sum + Number(entry.amount || 0), 0))
  const fromCauses = total('cause_day')
  const donations = total('donation')
  const allocated = total('allocation')
  const spent = total('expenditure')
  const received = round(fromCauses + donations + allocated)
  const closing = round(opening + received - spent)

  let running = opening
  const ledgerRows = rows.map((entry) => {
    running = round(running + signed(entry))
    const out = entry.type === 'expenditure'
    const by = recorder(entry)
    return `<tr>
      <td>${esc(longDate(entryDay(entry)))}</td>
      <td>${esc(TYPE_LABELS[entry.type] || entry.type)}${entry.type === 'allocation' ? '<div class="sub">from revenue, earlier</div>' : ''}</td>
      <td>${esc(entry.description)}${entry.donorName ? `<div class="sub">Donor: ${esc(entry.donorName)}</div>` : ''}${by ? `<div class="sub">Recorded by ${esc(by)}</div>` : ''}</td>
      <td class="num">${out ? '' : php(entry.amount)}</td>
      <td class="num">${out ? php(entry.amount) : ''}</td>
      <td class="num strong${running < 0 ? ' neg' : ''}">${php(running)}</td>
    </tr>`
  }).join('')

  const days = causeDays.filter((day) => inPeriod(day.dateISO)).sort((a, b) => a.dateISO.localeCompare(b.dateISO))
  const dayRows = days.map((day) => `<tr>
      <td>${esc(longDate(day.dateISO))}</td>
      <td>${esc(day.title)}${day.beneficiary ? `<div class="sub">For ${esc(day.beneficiary)}</div>` : ''}</td>
      <td class="num">${day.bookings}</td>
      <td class="num">${day.players}</td>
      <td class="num">${php(day.collected)}</td>
      <td class="num">${day.donationPercent}%</td>
      <td class="num">${php(day.donation)}</td>
      <td class="num">${php(day.added)}${day.toAdd > 0 ? `<div class="sub warn">${php(day.toAdd)} not added yet</div>` : ''}</td>
    </tr>`).join('')

  const period = from || to
    ? `${from ? longDate(from) : 'Start of the fund'} – ${to ? longDate(to) : 'today'}`
    : 'All time'
  const printedAt = new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })

  // The summary as a statement: what the fund started with, what came in, what went out, what's left.
  const line = (label: string, value: number, cls = '') => `<tr class="${cls}"><td>${esc(label)}</td><td class="num">${php(value)}</td></tr>`
  const statement = [
    from ? line('Opening balance', opening, 'head-row') : '',
    `<tr class="group"><td colspan="2">Received</td></tr>`,
    line('From games for a cause', fromCauses, 'indent'),
    line('Donations', donations, 'indent'),
    allocated ? line('Allocations from revenue (earlier)', allocated, 'indent') : '',
    line('Total received', received, 'subtotal'),
    `<tr class="group"><td colspan="2">Spent</td></tr>`,
    line('Spent on outreach', spent, 'indent'),
    line(from ? 'Closing balance' : 'Fund balance', closing, `total${closing < 0 ? ' neg' : ''}`),
  ].join('')

  return `<!doctype html><html><head><meta charset="utf-8"><title>Donation fund report · ${esc(period)}</title>
<style>
  /* Side margins come from the page's padding, so they stay even if the print dialog's margins are off. */
  @page { size: A4; margin: 14mm 0; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 10.5px; line-height: 1.35; margin: 0; padding: 0 16mm; }
  @media screen { body { padding: 16mm; max-width: 210mm; margin: 0 auto; } }

  .top { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; padding-bottom: 8px; border-bottom: 2px solid #111; }
  .brand { font-size: 20px; font-weight: 700; letter-spacing: -.01em; }
  .doc { font-size: 12px; color: #444; margin-top: 2px; }
  .meta { text-align: right; }
  .meta .label { font-size: 8.5px; text-transform: uppercase; letter-spacing: .08em; color: #666; }
  .meta .period { font-size: 12px; font-weight: 700; }
  .meta .printed { font-size: 9px; color: #666; margin-top: 2px; }
  .intro { color: #555; margin: 8px 0 0; }

  h2 { font-size: 10px; text-transform: uppercase; letter-spacing: .1em; margin: 18px 0 6px; padding-bottom: 3px; border-bottom: 1px solid #111; }
  table { width: 100%; border-collapse: collapse; }
  th { font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #555; text-align: left; padding: 4px 6px; border-bottom: 1px solid #999; vertical-align: bottom; }
  td { padding: 5px 6px; border-bottom: 1px solid #e3e3e3; vertical-align: top; }
  th:first-child, td:first-child { padding-left: 0; }
  th:last-child, td:last-child { padding-right: 0; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .strong { font-weight: 700; }
  .sub { font-size: 9px; color: #666; margin-top: 1px; }
  .warn { color: #b45309; }
  .neg { color: #b91c1c; }
  .empty { color: #666; padding: 6px 0; }

  .statement { width: 100%; max-width: 92mm; }
  .statement td { border-bottom: 0; padding: 3px 0; }
  .statement .group td { padding-top: 7px; font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #555; }
  .statement .indent td:first-child { padding-left: 10px; }
  .statement .head-row td { font-weight: 700; border-bottom: 1px solid #e3e3e3; padding-bottom: 5px; }
  .statement .subtotal td { font-weight: 700; border-top: 1px solid #999; }
  .statement .total td { font-size: 12.5px; font-weight: 700; border-top: 2px solid #111; padding-top: 6px; }

  .opening td { color: #555; font-style: italic; }
  .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 24mm; margin-top: 22mm; break-inside: avoid; }
  .sign > div { text-align: center; }
  .sign .name { font-weight: 700; height: 18px; line-height: 14px; border-bottom: 1px solid #111; }
  .sign .role { margin-top: 4px; }
  .sign .role { font-size: 9px; color: #555; }
</style></head><body>
  <div class="top">
    <div>
      <div class="brand">Chill Shooters</div>
      <div class="doc">Airsoft Game Center · Donation fund report</div>
    </div>
    <div class="meta">
      <div class="label">Period</div>
      <div class="period">${esc(period)}</div>
      <div class="printed">Printed ${esc(printedAt)}</div>
    </div>
  </div>
  <p class="intro">The community outreach fund is kept in its own ledger and is not counted as operating revenue.</p>

  <h2>Summary</h2>
  <table class="statement"><tbody>${statement}</tbody></table>

  <h2>Games for a cause</h2>
  ${days.length ? `<table>
    <colgroup><col style="width:15%"><col><col style="width:8%"><col style="width:8%"><col style="width:13%"><col style="width:7%"><col style="width:12%"><col style="width:14%"></colgroup>
    <thead><tr><th>Date</th><th>Game</th><th class="num">Bookings</th><th class="num">Players</th><th class="num">Collected</th><th class="num">Share</th><th class="num">Raised</th><th class="num">Added to fund</th></tr></thead>
    <tbody>${dayRows}</tbody>
  </table>` : '<div class="empty">No games for a cause in this period.</div>'}

  <h2>Ledger</h2>
  ${rows.length ? `<table>
    <colgroup><col style="width:14%"><col style="width:15%"><col><col style="width:13%"><col style="width:13%"><col style="width:14%"></colgroup>
    <thead><tr><th>Date</th><th>Type</th><th>Description</th><th class="num">In</th><th class="num">Out</th><th class="num">Balance</th></tr></thead>
    <tbody>
      ${from ? `<tr class="opening"><td colspan="5">Opening balance</td><td class="num${opening < 0 ? ' neg' : ''}">${php(opening)}</td></tr>` : ''}
      ${ledgerRows}
    </tbody>
  </table>` : '<div class="empty">No ledger entries in this period.</div>'}

  <div class="sign">
    <div><div class="name">${esc(preparedBy)}</div><div class="role">Prepared by</div></div>
    <div><div class="name"></div><div class="role">Reviewed and approved by</div></div>
  </div>
</body></html>`
}
