import { emailGameReminder, emailWaiverReminder } from '../services/notificationEmails.js'
import { notifyUser } from './paymentProgress.js'

const WAIVER_REMINDER_DAYS = 7

function manilaDateISO(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(date)
}

function playerIdsOf(reservation) {
  return [...new Set([reservation.userId, ...(reservation.teamMembers || []).map((member) => member.id)]
    .map((id) => String(id || ''))
    .filter((id) => id && id !== 'walk-in'))]
}

let lastRun = 0

// Emails (and in-app notices) for tomorrow's games and for booked players still missing an
// approved waiver. Each reminder is recorded on the reservation, so frequent sweeps never repeat one.
export async function sendDueReminders(db, { force = false } = {}) {
  const now = Date.now()
  if (!force && now - lastRun < 10 * 60_000) return { skipped: true }
  lastRun = now

  const tomorrow = manilaDateISO(1)
  const games = await db.collection('reservations').find({
    reservationDate: tomorrow,
    reservationStatus: { $in: ['confirmed', 'approved'] },
    gameReminderSentFor: { $ne: tomorrow },
  }).limit(200).toArray()
  for (const reservation of games) {
    for (const userId of playerIdsOf(reservation)) {
      await notifyUser(db, {
        userId,
        type: 'reservation_reminder',
        title: 'Your game is tomorrow',
        message: `Reminder: ${reservation.reservationDate} (${reservation.reservationTime}) at ${reservation.locationName || reservation.locationId}. Arrive 30 minutes early for orientation.`,
        linkedResourceId: reservation.id,
      })
      void emailGameReminder(db, reservation, userId)
    }
    await db.collection('reservations').updateOne({ _id: reservation._id }, { $set: { gameReminderSentFor: tomorrow } })
  }

  const upcoming = await db.collection('reservations').find({
    reservationDate: { $gte: manilaDateISO(0), $lte: manilaDateISO(WAIVER_REMINDER_DAYS) },
    reservationStatus: { $in: ['pending', 'needs review', 'confirmed', 'approved'] },
  }).limit(500).toArray()
  const ids = [...new Set(upcoming.flatMap(playerIdsOf))]
  const approved = new Set((await db.collection('waivers').find(
    { userId: { $in: ids }, status: { $regex: '^approved$', $options: 'i' } },
    { projection: { userId: 1 } },
  ).toArray()).map((waiver) => String(waiver.userId)))

  let waiverReminders = 0
  for (const reservation of upcoming) {
    const reminded = new Set((reservation.waiverRemindersSent || []).map(String))
    const missing = playerIdsOf(reservation).filter((id) => !approved.has(id) && !reminded.has(id))
    for (const userId of missing) {
      await notifyUser(db, {
        userId,
        type: 'waiver_reminder',
        title: 'Complete your waiver before the game',
        message: `You're booked for ${reservation.reservationDate} (${reservation.reservationTime}) but your waiver isn't approved yet. Complete it under Online Waiver.`,
        linkedResourceId: reservation.id,
      })
      void emailWaiverReminder(db, reservation, userId)
      waiverReminders += 1
    }
    if (missing.length) {
      await db.collection('reservations').updateOne({ _id: reservation._id }, { $addToSet: { waiverRemindersSent: { $each: missing } } })
    }
  }
  return { gameReminders: games.length, waiverReminders }
}
