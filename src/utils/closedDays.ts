import { useEffect, useState } from 'react'
import { getApiBase } from './apiClient'

// A "no game" day the admin closed on the calendar: nothing can be booked that day.
export type ClosedDay = {
  dateISO: string
  reason: string
}

export function closedDayMessage(day: ClosedDay) {
  return `No games this day${day.reason ? `: ${day.reason}` : ''}.`
}

// Closed days between two dates (inclusive), readable without signing in.
export function useClosedDays(from: string, to: string) {
  const [days, setDays] = useState<Record<string, ClosedDay>>({})
  useEffect(() => {
    if (!from || !to) return
    let alive = true
    fetch(`${getApiBase()}/api/public/closed-days?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('failed'))))
      .then((body) => {
        if (!alive) return
        const list: ClosedDay[] = Array.isArray(body?.data) ? body.data : []
        setDays(Object.fromEntries(list.map((day) => [day.dateISO, day])))
      })
      .catch(() => {})
    return () => { alive = false }
  }, [from, to])
  return days
}
