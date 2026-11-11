import { fpsBlockReason, gameFpsStatus } from './fpsChecks.js'
import { manilaDateISO } from './reminders.js'
import { getSlotHours, slotHasStarted } from './slotHours.js'
import { notifyRole } from './paymentProgress.js'

// Today's games whose slot has begun but that are still Scheduled. Each one is started
// automatically when every gun in it has passed today's chronograph (FPS) check, the same rule
// as the Start button. Otherwise it stays Scheduled, marked "due to start" with what's missing,
// and the marshals are told once, so a person still checks the guns before play.

const slotOfSchedule = (schedule) => String(schedule || '').split('•')[1]?.trim().toLowerCase() || ''

export async function startDueGames(db, {
  now = new Date(),
  todayISO = manilaDateISO(),
  hours,
  fpsStatusOf = (reservation) => gameFpsStatus(db, reservation, { now }),
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

    const reason = reservation ? fpsBlockReason(await fpsStatusOf(reservation)) : ''
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
      await notifyRole(db, {
        role: 'marshal',
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
