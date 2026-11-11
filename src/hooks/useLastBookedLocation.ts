import { useEffect, useState } from 'react'
import { apiGet } from '../utils/apiClient'

// Reservations have stored the location as an id or as a full name ("Chill Shooters (Salawag)");
// match the ids the capacity calendar uses.
function locationIdOf(value: unknown) {
  const text = String(value || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (text.includes('salawag')) return 'salawag'
  if (text.includes('langkaan')) return 'langkaan'
  if (text.includes('binan')) return 'binan'
  return text
}

const mine = (reservation: any, userId: string) =>
  [reservation?.userId, reservation?.playerId, reservation?.accountId, reservation?.submittedBy]
    .some((value) => value != null && String(value) === userId)

const time = (value: unknown) => {
  const parsed = Date.parse(String(value || ''))
  return Number.isNaN(parsed) ? 0 : parsed
}

// The location of a player's most recent booking (not cancelled), so the games calendar can start
// there. Undefined until loaded, when there's no player, or when they've never booked.
export function useLastBookedLocation(userId?: string | null) {
  const [locationId, setLocationId] = useState<string | undefined>()
  useEffect(() => {
    if (!userId) return
    let alive = true
    apiGet<{ ok: boolean; data: any[] }>('/api/reservations?limit=200')
      .then((res) => {
        const latest = (Array.isArray(res?.data) ? res.data : [])
          .filter((reservation) => mine(reservation, String(userId)) && String(reservation?.reservationStatus || '').toLowerCase() !== 'cancelled')
          .sort((a, b) => time(b.createdAtISO || b.submittedAtISO) - time(a.createdAtISO || a.submittedAtISO))[0]
        const id = latest ? locationIdOf(latest.locationId || latest.location || latest.locationName) : ''
        if (alive && id) setLocationId(id)
      })
      .catch(() => { /* no default: the calendar shows all locations */ })
    return () => { alive = false }
  }, [userId])
  return locationId
}
