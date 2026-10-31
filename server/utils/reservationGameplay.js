import { nextShortId } from './shortIds.js'

function reservationKey(reservation) {
  return String(reservation?.id || reservation?._id || '')
}

function mapReservationToGameplay(reservation) {
  const schedule = [reservation?.reservationDate, reservation?.reservationTime].filter(Boolean).join(' • ') || reservation?.createdAtISO || ''
  const nowISO = new Date().toISOString()
  return {
    Game: reservation?.game || reservation?.packageName || reservation?.selectedGameplayName || reservation?.selectedPackageId || reservation?.mode || '—',
    Schedule: schedule,
    Mode: reservation?.gameModePreference || reservation?.mode || reservation?.gameMode || reservation?.sessionType || '—',
    Group: reservation?.group || reservation?.sessionType || `${reservation?.numberOfPlayers || '—'} players`,
    Package: reservation?.packageName || reservation?.selectedGameplayName || reservation?.selectedPackageId || reservation?.package || '—',
    LayoutRequest: reservation?.layoutRequest || '',
    LayoutBlueprintUrl: reservation?.layoutBlueprintUrl || '',
    Notes: reservation?.notes || '',
    Status: 'Scheduled',
    Actions: { canStart: true, canComplete: false, canDelete: false },
    userId: String(reservation.userId),
    reservationId: reservationKey(reservation),
    createdAtISO: nowISO,
    updatedAtISO: nowISO,
  }
}

// A confirmed reservation gets one gameplay entry for the marshals' games board. Confirming again
// (or confirming automatically after payment) fills any blank fields instead of making a second one.
export async function ensureGameplayForReservation(db, reservation) {
  const reservationId = reservationKey(reservation)
  const already = await db.collection('gameplay').findOne({ reservationId })
  if (already) {
    const fresh = mapReservationToGameplay(reservation)
    const filled = Object.fromEntries(['Game', 'Schedule', 'Mode', 'Group', 'Package', 'LayoutRequest', 'LayoutBlueprintUrl', 'Notes', 'Status']
      .map((field) => [field, already[field] || already[field.toLowerCase()] || fresh[field]]))
    await db.collection('gameplay').updateOne({ _id: already._id }, { $set: { ...filled, updatedAtISO: new Date().toISOString() } })
    return { gameplay: already, created: false }
  }
  const id = await nextShortId(db, 'gameplay', 'GP')
  const insert = await db.collection('gameplay').insertOne({ ...mapReservationToGameplay(reservation), id })
  return { gameplay: await db.collection('gameplay').findOne({ _id: insert.insertedId }), created: true }
}
