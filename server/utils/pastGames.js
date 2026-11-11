import { ObjectId } from 'mongodb'
import { manilaDateISO } from './reminders.js'

// The game's day from its Schedule ("2026-11-07 • afternoon"), or '' when it has none.
export function gameDateOf(game) {
  const date = String(game?.Schedule || game?.schedule || '').trim().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : ''
}

// Games still Scheduled or Ongoing once their day is over (Manila time) are closed automatically:
// Completed, or Cancelled when their booking was cancelled (cancelling a booking leaves its game
// as it was). Games staff already completed, cancelled or archived are left alone.
export async function closePastGames(db, { todayISO = manilaDateISO(), now = new Date() } = {}) {
  const open = await db.collection('gameplay')
    .find({ Status: { $regex: '^(sched|ongo)', $options: 'i' } }, { projection: { _id: 1, Schedule: 1, schedule: 1, reservationId: 1 } })
    .toArray()
  const past = open.filter((game) => {
    const date = gameDateOf(game)
    return date && date < todayISO
  })
  if (!past.length) return { completed: 0, cancelled: 0 }

  const reservationIds = [...new Set(past.map((game) => String(game.reservationId || '')).filter(Boolean))]
  const reservations = reservationIds.length
    ? await db.collection('reservations').find(
      { $or: [{ id: { $in: reservationIds } }, { _id: { $in: reservationIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id)) } }] },
      { projection: { _id: 1, id: 1, reservationStatus: 1 } },
    ).toArray()
    : []
  const cancelledBookings = new Set(
    reservations
      .filter((reservation) => String(reservation.reservationStatus || '').toLowerCase() === 'cancelled')
      .flatMap((reservation) => [reservation.id, String(reservation._id)].filter(Boolean).map(String)),
  )

  const nowISO = now.toISOString()
  const byStatus = { Completed: [], Cancelled: [] }
  for (const game of past) byStatus[cancelledBookings.has(String(game.reservationId || '')) ? 'Cancelled' : 'Completed'].push(game._id)

  const close = async (status, ids) => {
    if (!ids.length) return 0
    const stamp = status === 'Completed' ? { completedAtISO: nowISO } : { cancelledAtISO: nowISO }
    const result = await db.collection('gameplay').updateMany(
      // Re-check the status so a game staff closed in the meantime isn't touched.
      { _id: { $in: ids }, Status: { $regex: '^(sched|ongo)', $options: 'i' } },
      { $set: { Status: status, ...stamp, autoCompletedBy: 'day passed', updatedAtISO: nowISO } },
    )
    return result.modifiedCount
  }
  return { completed: await close('Completed', byStatus.Completed), cancelled: await close('Cancelled', byStatus.Cancelled) }
}
