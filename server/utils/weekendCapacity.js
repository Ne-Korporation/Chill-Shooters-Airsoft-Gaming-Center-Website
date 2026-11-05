import { getBlockingSlotReservations, getSlotPlayerCount } from './bookingSlots.js'

// The Saturday and Sunday of the week (Monday to Sunday) that holds `todayISO` (YYYY-MM-DD).
export function weekendDatesOf(todayISO) {
  const today = new Date(`${todayISO}T00:00:00Z`)
  const isoWeekday = today.getUTCDay() || 7 // Monday = 1 ... Sunday = 7
  const shift = (days) => new Date(today.getTime() + days * 86_400_000).toISOString().slice(0, 10)
  return [shift(6 - isoWeekday), shift(7 - isoWeekday)]
}

// Players booked against each location and slot on the given dates, out of the slot's capacity.
// Counts the same bookings that block a slot when booking (plus live slot holds).
export function summarizeWeekendCapacity({ dates, todayISO, capacities, locationNames, reservations, holds, normalizeLocationId }) {
  const dateOf = (doc) => doc.reservationDate || doc.dateISO || ''
  const slotOf = (doc) => doc.reservationTime || doc.slot || 'morning'

  return dates.map((dateISO) => {
    const dayReservations = reservations.filter((reservation) => dateOf(reservation) === dateISO)
    const dayHolds = holds.filter((hold) => hold.reservationDate === dateISO)
    const locations = Object.entries(capacities).map(([locationId, slotCapacities]) => {
      const slots = Object.entries(slotCapacities).map(([slot, capacity]) => {
        const blocking = getBlockingSlotReservations({
          reservations: dayReservations.filter((reservation) => slotOf(reservation) === slot),
          locationId,
          normalizeLocationId,
        })
        const booked = getSlotPlayerCount(blocking) + dayHolds
          .filter((hold) => hold.locationId === locationId && hold.reservationTime === slot)
          .reduce((sum, hold) => sum + Number(hold.players || 0), 0)
        // `groups`: how many bookings (not players) are in this slot.
        return { slot, capacity, booked: Math.min(booked, capacity), remaining: Math.max(0, capacity - booked), groups: blocking.length }
      })
      return {
        id: locationId,
        name: locationNames[locationId] || locationId,
        capacity: slots.reduce((sum, slot) => sum + slot.capacity, 0),
        booked: slots.reduce((sum, slot) => sum + slot.booked, 0),
        groups: slots.reduce((sum, slot) => sum + slot.groups, 0),
        slots,
      }
    })
    return {
      dateISO,
      past: dateISO < todayISO,
      capacity: locations.reduce((sum, location) => sum + location.capacity, 0),
      booked: locations.reduce((sum, location) => sum + location.booked, 0),
      groups: locations.reduce((sum, location) => sum + location.groups, 0),
      locations,
    }
  })
}
