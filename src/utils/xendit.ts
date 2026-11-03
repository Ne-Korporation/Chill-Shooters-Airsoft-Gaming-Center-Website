import { apiGet, apiPost } from './apiClient'

let enabledCache: Promise<boolean> | null = null

// Whether the server has Xendit (test mode) set up.
export function isXenditEnabled() {
  enabledCache ??= apiGet<{ ok: boolean; data: { enabled: boolean } }>('/api/xendit/config')
    .then((res) => Boolean(res?.data?.enabled))
    .catch(() => false)
  return enabledCache
}

// Sends the player to Xendit's payment page for what they owe on this reservation right now.
export async function startXenditCheckout(reservationId: string) {
  const res = await apiPost<{ ok: boolean; data: { checkoutUrl: string } }>('/api/xendit/checkout', { reservationId })
  window.location.assign(res.data.checkoutUrl)
}
