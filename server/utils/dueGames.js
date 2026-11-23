import { fpsBlockReason, gameFpsStatus } from './fpsChecks.js'
import { manilaDateISO } from './reminders.js'
import { getSlotHours, slotHasStarted } from './slotHours.js'
import { getReservationPayments, notifyRole } from './paymentProgress.js'
import { unpaidStartReason } from './bookingBalance.js'

// Today's games whose slot has begun but that are still Scheduled. Each one is started
// automatically when its booking balance is paid and every gun in it has passed today's
// chronograph (FPS) check, the same rules as the Start button. Otherwise it stays Scheduled,
// marked "due to start" with what's missing, and admins are told once.

const slotOfSchedule = (schedule) => String(schedule || '').split('•')[1]?.trim().toLowerCase() || ''

export async function startDueGames(db, {
  now = new Date(),
  todayISO = manilaDateISO(),
  hours,
  fpsStatusOf = (reservation) => gameFpsStatus(db, reservation, { now }),
  paymentsOf = (reservation) => getReservationPayments(db, reservation),
} = {}) {
  const slotHours = hours || (await getSlotHours(db)).hours
  const scheduled = await db.collection('gameplay')
    .find({ Status: { $regex: '^sched', $options: 'i' }, Schedule: { $regex: `^${todayISO}` } })
    .toArray()
  const due = scheduled.filter((game) => slotHasStarted(slotHours, slotOfSchedule(game.Schedule), todayISO, todayISO, now))
  const result = { started: [], blocked: [] }
  const nowISO = now.toISOString()

  for (const game of due) {
    const reservation = game.reservationId
      ? await db.collection('reservations').findOne({ id: String(game.reservationId) })
      : null
    // A cancelled booking's game isn't started; the day-end sweep marks it Cancelled.
    if (reservation && String(reservation.reservationStatus || '').toLowerCase() === 'cancelled') continue

    // Same rules as the Start button: the booking balance is paid and every gun passed the chronograph.
    const reason = reservation
      ? unpaidStartReason(reservation, await paymentsOf(reservation)) || fpsBlockReason(await fpsStatusOf(reservation))
      : ''
    if (!reason) {
      const started = await db.collection('gameplay').updateOne(
        // Re-check the status so a game staff changed in the meantime isn't touched.
        { _id: game._id, Status: { $regex: '^sched', $options: 'i' } },
        {
          $set: { Status: 'Ongoing', startedAtISO: nowISO, autoStartedBy: 'slot time', updatedAtISO: nowISO },
          $unset: { autoStartBlockedReason: '' },
        },
      )
      if (started.modifiedCount) result.started.push(String(game.id || game._id))
      continue
    }

    const firstTime = !game.dueToStartAtISO
    await db.collection('gameplay').updateOne(
      { _id: game._id },
      { $set: { autoStartBlockedReason: reason, ...(firstTime ? { dueToStartAtISO: nowISO } : {}) } },
    )
    if (firstTime) {
      const slot = slotOfSchedule(game.Schedule)
      // Marshals are only notified of new bookings, so admins get this one (the games board
      // still shows the game as due to start, with what's missing).
      await notifyRole(db, {
        role: 'admin',
        type: 'game_due_to_start',
        title: 'Game due to start',
        message: `${game.id || 'A game'} (${slot || 'today'}${game.Location ? `, ${game.Location}` : ''}) is due to start but can't start yet. ${reason}`,
        linkedResourceId: game.id,
      })
    }
    result.blocked.push(String(game.id || game._id))
  }
  return result
}
