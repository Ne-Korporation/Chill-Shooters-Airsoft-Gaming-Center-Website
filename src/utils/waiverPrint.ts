import { OFFICIAL_WAIVER_TEXT as T } from './waiverText'

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
  status?: string
  submittedAtISO?: string
}

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

export function buildWaiverPrintHtml(w: PrintableWaiver) {
  const name = esc(w.fullName || '-')
  const submitted = w.submittedAtISO ? esc(new Date(w.submittedAtISO).toLocaleString()) : '-'
  const guardian = w.isMinor
    ? `<div class="guardian"><b>${esc(T.guardianTitle)}</b><p>${esc(T.guardianCertification)}</p>
       <p><b>Guardian:</b> ${esc(w.guardianName || '-')} &nbsp; <b>Phone:</b> ${esc(w.guardianPhone || '-')} &nbsp; <b>Consent:</b> ${w.guardianConsent ? 'Yes' : 'No'}</p></div>`
    : ''

  const idThumb = (src: string | undefined, label: string) =>
    src ? `<div class="id"><img src="${esc(src)}" alt="${esc(label)}" /><div class="cap">${esc(label)}</div></div>` : ''
  const ids = w.isMinor ? idThumb(w.guardianIdImage, 'Guardian ID') : ''

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
  @page { size: A4; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; }
  body { width: 210mm; padding: 15mm; box-sizing: border-box; }
  .sheet { width: 180mm; font-size: 13px; line-height: 1.4; }
  h1 { font-size: 1.5em; margin: 0 0 4px; text-align: center; }
  .meta { display: flex; flex-wrap: wrap; gap: 2px 18px; font-size: .95em; border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 4px 0; margin-bottom: 6px; }
  p { margin: 0 0 5px; }
  ol { margin: 0 0 5px; padding-left: 18px; }
  li { margin-bottom: 3px; text-align: justify; }
  .guardian { margin-top: 4px; }
  .ids { display: flex; gap: 12px; margin-top: 6px; }
  .id img { display: block; height: 52px; max-width: 120px; object-fit: contain; border: 1px solid #999; }
  .id .cap { font-size: .8em; margin-top: 1px; }
  .sig { margin-top: 10px; page-break-inside: avoid; display: flex; gap: 24px; align-items: flex-end; }
  .sigcol { width: 240px; }
  .sigcol .name { font-size: 1.2em; font-weight: bold; }
  .sigcol img { display: block; height: 60px; max-width: 240px; object-fit: contain; margin-top: 2px; }
  .sigcol .line { border-top: 1px solid #000; width: 240px; margin-top: 2px; font-size: .85em; padding-top: 2px; }
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
  ${ids ? `<div class="ids">${ids}</div>` : ''}
</div></body></html>`
}

export function printWaiverDocument(w: PrintableWaiver) {
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
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