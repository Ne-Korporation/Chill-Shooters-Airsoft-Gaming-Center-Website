import { apiGet, apiPost } from './apiClient'

let enabledCache: Promise<boolean> | null = null

// Whether the server has PayMongo (test mode) set up.
export function isPaymongoEnabled() {
  enabledCache ??= apiGet<{ ok: boolean; data: { enabled: boolean } }>('/api/paymongo/config')
    .then((res) => Boolean(res?.data?.enabled))
    .catch(() => false)
  return enabledCache
}

// Sends the player to PayMongo's checkout for what they owe on this reservation right now.
export async function startPaymongoCheckout(reservationId: string) {
  const res = await apiPost<{ ok: boolean; data: { checkoutUrl: string } }>('/api/paymongo/checkout', { reservationId })
  window.location.assign(res.data.checkoutUrl)
}
