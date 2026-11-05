import { useEffect, useState } from 'react'
import { getApiBase } from './apiClient'

// A "game for a cause" day: a share of the booking money for games that day is reserved for a donation.
export type CauseDay = {
  dateISO: string
  title: string
  description: string
  beneficiary: string
  donationPercent: number
}

export function causeDayMessage(cause: CauseDay) {
  return `Game for a cause: ${cause.title}${cause.beneficiary ? ` (for ${cause.beneficiary})` : ''}. ${cause.donationPercent}% of bookings that day go to the donation.`
}

// Active cause days between two dates (inclusive), readable without signing in.
export function useCauseDays(from: string, to: string) {
  const [days, setDays] = useState<Record<string, CauseDay>>({})
  useEffect(() => {
    if (!from || !to) return
    let alive = true
    fetch(`${getApiBase()}/api/public/cause-days?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('failed'))))
      .then((body) => {
        if (!alive) return
        const list: CauseDay[] = Array.isArray(body?.data) ? body.data : []
        setDays(Object.fromEntries(list.map((day) => [day.dateISO, day])))
      })
      .catch(() => {})
    return () => { alive = false }
  }, [from, to])
  return days
}
