import { useEffect, useState } from 'react'
import { apiGet } from './apiClient'

// Clock hours of each game slot, set by the admin (GET /api/slot-hours). The defaults match
// server/utils/slotHours.js and are used until the server answers.
export type SlotName = 'morning' | 'afternoon' | 'evening'
export type SlotHours = Record<SlotName, { start: string; end: string }>

export const DEFAULT_SLOT_HOURS: SlotHours = {
  morning: { start: '06:00', end: '12:00' },
  afternoon: { start: '12:00', end: '18:00' },
  evening: { start: '18:00', end: '23:00' },
}

let cached: Promise<SlotHours> | null = null

export function loadSlotHours(force = false): Promise<SlotHours> {
  if (!cached || force) {
    cached = apiGet<{ ok: boolean; data: { hours: SlotHours } }>('/api/slot-hours')
      .then((res) => res.data?.hours || DEFAULT_SLOT_HOURS)
      .catch(() => {
        cached = null
        return DEFAULT_SLOT_HOURS
      })
  }
  return cached
}

export function useSlotHours(): SlotHours {
  const [hours, setHours] = useState<SlotHours>(DEFAULT_SLOT_HOURS)
  useEffect(() => {
    let active = true
    void loadSlotHours().then((next) => { if (active) setHours(next) })
    return () => {
      active = false
    }
  }, [])
  return hours
}

// "18:00" -> "6:00 PM", "12:00" -> "12:00 NN"
export function formatClock(time: string) {
  const [h, m] = time.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return time
  if (h === 12 && m === 0) return '12:00 NN'
  const suffix = h < 12 ? 'AM' : 'PM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`
}

export function formatSlotRange(hours: SlotHours, slot: string) {
  const range = hours[slot as SlotName]
  return range ? `${formatClock(range.start)} – ${formatClock(range.end)}` : ''
}
