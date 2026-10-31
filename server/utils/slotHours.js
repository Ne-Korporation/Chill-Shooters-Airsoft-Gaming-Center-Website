// The clock hours of each game slot (Manila time). Shown to players when they book and
// used by the weather check to read the right part of the forecast. An admin can change
// them; until then the defaults below apply.

export const SLOT_HOURS_ID = 'slot_hours'
export const SLOT_ORDER = ['morning', 'afternoon', 'evening']

export const DEFAULT_SLOT_HOURS = {
  morning: { start: '06:00', end: '12:00' },
  afternoon: { start: '12:00', end: '18:00' },
  evening: { start: '18:00', end: '23:00' },
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

export function toMinutes(time) {
  const match = TIME.exec(String(time || ''))
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

// Returns { hours } or { error }. Slots must be in order, each start before its end,
// and no slot may start before the previous one ends.
export function validateSlotHours(input) {
  const hours = {}
  let previousEnd = -1
  for (const slot of SLOT_ORDER) {
    const start = String(input?.[slot]?.start || '')
    const end = String(input?.[slot]?.end || '')
    const startMin = toMinutes(start)
    const endMin = toMinutes(end)
    if (startMin === null || endMin === null) return { error: `Enter the ${slot} start and end as HH:MM (24-hour).` }
    if (startMin >= endMin) return { error: `The ${slot} slot must end after it starts.` }
    if (startMin < previousEnd) return { error: `The ${slot} slot starts before the previous slot ends.` }
    previousEnd = endMin
    hours[slot] = { start, end }
  }
  return { hours }
}

export async function getSlotHours(db) {
  const saved = await db.collection('settings').findOne({ _id: SLOT_HOURS_ID })
  const checked = saved ? validateSlotHours(saved.hours) : null
  return {
    hours: checked?.hours || DEFAULT_SLOT_HOURS,
    isDefault: !checked?.hours,
    updatedAtISO: saved?.updatedAtISO || null,
  }
}

// [startHour, endHour) as decimal hours, for matching forecast blocks.
export function slotWindow(hours, slot) {
  const range = (hours || DEFAULT_SLOT_HOURS)[slot] || DEFAULT_SLOT_HOURS[slot]
  return [toMinutes(range.start) / 60, toMinutes(range.end) / 60]
}
