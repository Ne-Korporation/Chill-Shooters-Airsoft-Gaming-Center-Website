import { apiPost } from './apiClient'

// Online payment (capstone demo): GCash and QR Ph are simulated on our own payment screen,
// opened in a new tab (/pay/demo), instead of Xendit's. The server records the payment like a
// real one. The tab that opened it waits on /app/payment/complete?waiting=1.
export type OnlineChannel = 'gcash' | 'qrph'

// The payment tab tells the waiting tab when it paid or was cancelled.
export const DEMO_PAY_CHANNEL = 'chill-shooters-demo-pay'

export const demoPayUrl = (ref: string) => `/pay/demo?ref=${encodeURIComponent(ref)}`
export const waitingUrl = (ref: string) => `/app/payment/complete?ref=${encodeURIComponent(ref)}&waiting=1`

// Online (demo) payment is always offered; the demo screen needs no outside provider.
export function isOnlinePaymentEnabled() {
  return Promise.resolve(true)
}

// Opens the payment tab right away, while the click still counts (browsers block tabs opened
// later, after waiting on the server). It shows a loading note until sendToPaymentTab fills it.
// Not opened with noopener, so the new tab shares this tab's login.
export function openPaymentTab(): Window | null {
  const tab = window.open('', '_blank')
  if (tab) {
    try {
      tab.document.title = 'Opening payment…'
      tab.document.body.innerHTML = '<p style="font-family:system-ui,sans-serif;padding:2rem;color:#333">Opening payment…</p>'
    } catch {
      // the tab still works without the note
    }
  }
  return tab
}

// Points the payment tab at the checkout and makes this tab wait for it. With no tab (blocked
// pop-up), the payment screen opens here instead.
export function sendToPaymentTab(tab: Window | null, ref: string, goHere: (url: string) => void) {
  if (tab && !tab.closed) {
    tab.location.href = demoPayUrl(ref)
    goHere(waitingUrl(ref))
  } else {
    goHere(demoPayUrl(ref))
  }
}

// Opens the payment tab for what the player owes on this reservation right now.
export async function startOnlineCheckout(reservationId: string, channel: OnlineChannel = 'gcash') {
  const tab = openPaymentTab()
  try {
    const res = await apiPost<{ ok: boolean; data: { ref: string } }>('/api/demo-pay/checkout', { reservationId, channel })
    sendToPaymentTab(tab, res.data.ref, (url) => window.location.assign(url))
  } catch (err) {
    tab?.close()
    throw err
  }
}

// Older names, still used by a few pages.
export const isXenditEnabled = isOnlinePaymentEnabled
export const startXenditCheckout = startOnlineCheckout
