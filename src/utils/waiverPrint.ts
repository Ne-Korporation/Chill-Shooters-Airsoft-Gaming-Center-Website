import { signedWaiverText, type WaiverText } from './waiverText'
import { formatPhPhone } from './phone'
import { formatDateTime } from './dates'

export type PrintableWaiver = {
  id?: string
  _id?: string
  userId?: string
  reservationId?: string
  fullName?: string
  age?: number
  guardianName?: string
  guardianConsent?: boolean
  isMinor?: boolean
  signatureImage?: string
  guardianPhone?: string
  guardianIdImage?: string
  guardianSignatureImage?: string
  idType?: string
  idImage?: string
  idImageBack?: string
  guardianIdType?: string
  waiverText?: WaiverText | null
  status?: string
  submittedAtISO?: string
}

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

// `preview`: shown inside the app (a pop-up) rather than printed. The page then fits the width it's
// given instead of the fixed A4 width, so nothing is cut off; printing keeps the A4 layout.
export function buildWaiverPrintHtml(w: PrintableWaiver, { preview = false }: { preview?: boolean } = {}) {
  const T = signedWaiverText(w)
  const name = esc(w.fullName || '-')
  const submitted = esc(formatDateTime(w.submittedAtISO, '-'))
  const guardian = w.isMinor
    ? `<div class="guardian"><b>${esc(T.guardianTitle)}</b><p>${esc(T.guardianCertification)}</p>
       <p><b>Guardian:</b> ${esc(w.guardianName || '-')} &nbsp; ${w.guardianPhone ? `<b>Phone:</b> ${esc(formatPhPhone(w.guardianPhone))} &nbsp; ` : ''}<b>Consent:</b> ${w.guardianConsent ? 'Yes' : 'No'}</p></div>`
    : ''

  const idThumb = (src: string | undefined, label: string) =>
    src ? `<div class="id"><img src="${esc(src)}" alt="${esc(label)}" /><div class="cap">${esc(label)}</div></div>` : ''
  const ids = [
    idThumb(w.idImage, `Participant ID${w.idType ? ` (${w.idType})` : ''}`),
    idThumb(w.idImageBack, 'Participant ID (back)'),
    w.isMinor ? idThumb(w.guardianIdImage, `Guardian ID${w.guardianIdType ? ` (${w.guardianIdType})` : ''}`) : '',
  ].join('')

  const sigBlock = (who: string, img: string | undefined, caption: string) => `
    <div class="sigcol">
      ${img ? `<img src="${esc(img)}" alt="Signature" />` : '<div style="height:40px"></div>'}
      <div class="name">${who}</div>
      <div class="line">${esc(caption)}</div>
    </div>`
  const signatures = w.isMinor
    ? sigBlock(name, w.signatureImage, 'Signature of participant') + sigBlock(esc(w.guardianName || '-'), w.guardianSignatureImage, 'Signature of parent/guardian')
    : sigBlock(name, w.signatureImage, 'Signature of participant')

  return `<!doctype html><html><head><meta charset="utf-8"><title>Waiver ${esc(w.id || w._id || '')}</title>
<style>
  /* The 15mm margin is the page's, so every printed page gets it (not only the top of the first). */
  @page { size: A4; margin: 15mm; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; }
  /* The sheet is centred on the page, so when the print dialog's margins are set to "None" or
     "Minimum" (which overrides @page) the text still sits 15mm in from both edges instead of being
     cut off on the left. */
  body { width: auto; padding: 0; box-sizing: border-box; }
  .sheet { width: 180mm; max-width: 100%; margin: 0 auto; box-sizing: border-box; font-size: 13px; line-height: 1.4; }
  h1 { font-size: 1.5em; margin: 0 0 4px; text-align: center; }
  .meta { display: flex; flex-wrap: wrap; gap: 2px 18px; font-size: .95em; border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 4px 0; margin-bottom: 6px; }
  p { margin: 0 0 5px; }
  /* Room for two-digit numbers ("10.") inside the sheet. */
  ol { margin: 0 0 5px; padding-left: 2em; }
  li { margin-bottom: 3px; text-align: justify; padding-left: 2px; }
  .guardian { margin-top: 4px; }
  /* IDs print at real card size (about 86 x 54 mm), two side by side, never split across pages. */
  .idsec { margin-top: 8mm; page-break-inside: avoid; break-inside: avoid; }
  .idsec h2 { font-size: 1em; margin: 0 0 3mm; padding-bottom: 2px; border-bottom: 1px solid #000; }
  .ids { display: flex; flex-wrap: wrap; gap: 6mm; page-break-inside: avoid; break-inside: avoid; }
  .id { page-break-inside: avoid; break-inside: avoid; }
  .id img { display: block; width: 86mm; height: 54mm; object-fit: contain; border: 1px solid #999; background: #fff; }
  .id .cap { font-size: .85em; margin-top: 3px; }
  .sig { margin-top: 10px; page-break-inside: avoid; display: flex; gap: 24px; align-items: flex-end; }
  .sigcol { width: 240px; }
  .sigcol .name { font-size: 1.2em; font-weight: bold; }
  .sigcol img { display: block; height: 60px; max-width: 240px; object-fit: contain; margin-top: 2px; }
  .sigcol .line { border-top: 1px solid #000; width: 240px; margin-top: 2px; font-size: .85em; padding-top: 2px; }
${preview ? `  body { width: auto; padding: 20px; overflow: hidden; }
  .sheet { width: auto; max-width: 180mm; margin: 0 auto; }
  .sig { flex-wrap: wrap; }
  .ids { flex-wrap: wrap; }
  .id { max-width: 100%; }
  .id img { width: 86mm; max-width: 100%; height: auto; aspect-ratio: 86 / 54; }` : ''}
</style></head><body><div class="sheet" id="sheet">
  <h1>${esc(T.title)}</h1>
  <div class="meta">
    <span><b>Waiver ID:</b> ${esc(w.id || w._id || '-')}</span>
    <span><b>Submitted:</b> ${submitted}</span>
    <span><b>Reservation:</b> ${esc(w.reservationId || '-')}</span>
    <span><b>Age:</b> ${esc(w.age ?? '-')}</span>
    <span><b>Status:</b> ${esc(w.status || 'pending')}</span>
  </div>
  <p><b>${esc(T.preamble)}</b></p>
  <p>${esc(T.intro)}</p>
  <ol>${T.clauses.map((c) => `<li>${esc(c)}</li>`).join('')}</ol>
  <p><b>${esc(T.closing)}</b></p>
  ${guardian}
  <div class="sig">${signatures}</div>
  ${ids ? `<div class="idsec"><h2>Identification</h2><div class="ids">${ids}</div></div>` : ''}
</div></body></html>`
}

export function printWaiverDocument(w: PrintableWaiver) {
  const iframe = document.createElement('iframe')
  // Off-screen but full A4 width, so the page is laid out (and measured below) at its real size
  // rather than squeezed into a zero-width frame.
  iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0;visibility:hidden'
  document.body.appendChild(iframe)

  const win = iframe.contentWindow
  if (!win) return
  win.document.open()
  win.document.write(buildWaiverPrintHtml(w))
  win.document.close()

  const imgs = Array.from(win.document.images)
  const ready = Promise.all(
    imgs.map((img) => (img.complete ? Promise.resolve() : new Promise<void>((r) => { img.onload = img.onerror = () => r() }))),
  )

  ready.then(() => {
    // Shrink the text toward one A4 page (180mm x 267mm usable inside the 15mm margins), but never
    // below a legible 12px; longer waivers flow onto a second page instead.
    const sheet = win.document.getElementById('sheet') as HTMLElement
    const maxH = (267 * 96) / 25.4 - 6
    let size = 13
    while (sheet.getBoundingClientRect().height > maxH && size > 12) {
      size -= 0.25
      sheet.style.fontSize = `${size}px`
    }
    const cleanup = () => setTimeout(() => iframe.remove(), 500)
    win.addEventListener('afterprint', cleanup, { once: true })
    win.focus()
    win.print()
  })
}