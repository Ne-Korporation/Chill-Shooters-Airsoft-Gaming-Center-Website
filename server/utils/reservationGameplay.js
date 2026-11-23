import { nextShortId } from './shortIds.js'
import { notifyRole } from './paymentProgress.js'

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
    LocationId: reservation?.locationId || '',
    Location: reservation?.locationName || reservation?.locationId || '',
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
    const filled = Object.fromEntries(['Game', 'Schedule', 'Mode', 'Group', 'Package', 'LocationId', 'Location', 'LayoutRequest', 'LayoutBlueprintUrl', 'Notes', 'Status']
      .map((field) => [field, already[field] || already[field.toLowerCase()] || fresh[field]]))
    await db.collection('gameplay').updateOne({ _id: already._id }, { $set: { ...filled, updatedAtISO: new Date().toISOString() } })
    return { gameplay: already, created: false }
  }
  const id = await nextShortId(db, 'gameplay', 'GP')
  const game = mapReservationToGameplay(reservation)
  const insert = await db.collection('gameplay').insertOne({ ...game, id })
  // A new game on the board is the one thing marshals are notified about.
  const players = reservation?.numberOfPlayers ? `, ${reservation.numberOfPlayers} players` : ''
  await notifyRole(db, {
    role: 'marshal',
    type: 'gameplay_created',
    title: 'New game booked',
    message: `${game.Package !== '—' ? game.Package : 'A game'} on ${game.Schedule || 'an upcoming date'}${game.Location ? ` at ${game.Location}` : ''}${players}.`,
    linkedResourceId: id,
  })
  // Players bringing their own weapons: marshals chronograph each one before play.
  const ownWeaponIds = (reservation?.selectedOwnWeaponIds || []).map(String).filter(Boolean)
  const bringers = new Set([
    ...(reservation?.ownWeaponBringerIds || []).map(String),
    ...(reservation?.ownGearPlayerIds || []).map(String),
  ].filter(Boolean))
  const picked = ownWeaponIds.length
    ? await db.collection('weapons').find({ id: { $in: ownWeaponIds } }, { projection: { name: 1, submittedBy: 1 } }).toArray()
    : []
  for (const weapon of picked) if (weapon.submittedBy) bringers.add(String(weapon.submittedBy))
  if (bringers.size > 0) {
    const names = picked.map((w) => w.name).filter(Boolean)
    await notifyRole(db, {
      role: 'marshal',
      type: 'own_weapons_incoming',
      title: `Player weapons to check: ${game.Schedule || 'upcoming game'}`,
      message: `${bringers.size} player${bringers.size === 1 ? ' is' : 's are'} bringing their own weapon to ${game.Location || 'the field'} for ${game.Schedule || 'an upcoming game'}${names.length ? ` (${names.join(', ')})` : ''}. Chronograph each one before play.`,
      linkedResourceId: id,
    })
  }
  return { gameplay: await db.collection('gameplay').findOne({ _id: insert.insertedId }), created: true }
}

// Games created before locations were stored on them get the location from their reservation,
// so the games board can show and filter by location.
export async function backfillGameplayLocations(db) {
  const missing = await db.collection('gameplay').find(
    { $or: [{ LocationId: { $exists: false } }, { LocationId: '' }], reservationId: { $nin: ['', null] } },
    { projection: { _id: 1, reservationId: 1 } },
  ).toArray()
  if (!missing.length) return 0
  const reservations = await db.collection('reservations').find(
    { id: { $in: missing.map((game) => game.reservationId) } },
    { projection: { id: 1, locationId: 1, locationName: 1 } },
  ).toArray()
  const byId = new Map(reservations.map((reservation) => [String(reservation.id), reservation]))
  let updated = 0
  for (const game of missing) {
    const reservation = byId.get(String(game.reservationId))
    if (!reservation?.locationId) continue
    await db.collection('gameplay').updateOne(
      { _id: game._id },
      { $set: { LocationId: reservation.locationId, Location: reservation.locationName || reservation.locationId } },
    )
    updated += 1
  }
  return updated
}
