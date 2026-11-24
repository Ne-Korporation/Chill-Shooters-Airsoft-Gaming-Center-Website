// FPS checks before a game: every gun that will be fired in it must pass the chronograph on game
// day. The guns are the rental guns handed out for the booking (still out) and the guns players
// bring from home (picked on the booking, or the approved guns of players who said they'd bring
// their own). A reading counts when it was taken today (Manila time).

const NOT_GUNS = ['grenades']
const keyOf = (doc) => String(doc?.id || doc?._id || '')

// Start of today in Manila (UTC+8, no daylight saving), as an ISO time.
export function manilaDayStartISO(now = new Date()) {
  const manila = new Date(now.getTime() + 8 * 3600_000)
  const day = manila.toISOString().slice(0, 10)
  return new Date(`${day}T00:00:00+08:00`).toISOString()
}

export async function gameGuns(db, reservation) {
  const reservationId = keyOf(reservation)
  const guns = new Map()

  // Rental guns handed out for this booking and not yet returned.
  const rentals = await db.collection('rentals')
    .find({ reservationId, itemCollection: 'weapons', status: 'out' })
    .toArray()
  for (const r of rentals) {
    if (NOT_GUNS.includes(String(r.itemCategory || '').toLowerCase())) continue
    guns.set(String(r.itemId), { weaponId: String(r.itemId), name: `${r.itemName}${r.unitLabel && !String(r.itemName).includes(r.unitLabel) ? ` ${r.unitLabel}` : ''}`, source: 'rental', playerName: r.playerName || '' })
  }

  // Players' own guns.
  const memberIds = [String(reservation.userId || ''), ...(reservation.teamMembers || []).map((m) => String(m.id || ''))].filter(Boolean)
  if (memberIds.length) {
    const picked = (reservation.selectedOwnWeaponIds || []).map(String)
    const bringers = new Set((reservation.ownWeaponBringerIds || []).map(String))
    const own = await db.collection('weapons')
      .find({ source: 'player', submittedBy: { $in: memberIds }, approvalStatus: { $ne: 'rejected' } })
      .toArray()
    const names = new Map((reservation.teamMembers || []).map((m) => [String(m.id), m.name || '']))
    for (const w of own) {
      if (NOT_GUNS.includes(String(w.category || '').toLowerCase())) continue
      const id = keyOf(w)
      const brought = picked.includes(id) || (bringers.has(String(w.submittedBy)) && w.approvalStatus === 'approved')
      if (!brought || guns.has(id)) continue
      guns.set(id, { weaponId: id, name: w.name || 'Own gun', source: 'own', playerName: names.get(String(w.submittedBy)) || '' })
    }

    // Players who said they bring their own gun (own gun, or own gun and gear). Nothing is
    // registered, so each one gets a line of their own, keyed by booking and player, that the
    // marshal fills in with today's reading. Players who rent a gun instead don't get one.
    const declared = new Set([
      ...(reservation.ownWeaponBringerIds || []).map(String),
      ...(reservation.ownGearPlayerIds || []).map(String).filter((id) => !(reservation.playerGuns?.[id] || []).length),
    ])
    const captainName = String(reservation.bookerName || '')
    for (const playerId of declared) {
      if (own.some((w) => String(w.submittedBy) === playerId && guns.has(keyOf(w)))) continue
      const weaponId = ownGunKey(reservationId, playerId)
      guns.set(weaponId, {
        weaponId,
        name: 'Own gun',
        source: 'own',
        playerName: names.get(playerId) || (playerId === String(reservation.userId) ? captainName : '') || 'Player',
      })
    }
  }
  return [...guns.values()]
}

// The chronograph key for a gun a player brings from home (not in inventory).
export const OWN_GUN_PREFIX = 'own:'
export function ownGunKey(reservationId, playerId) {
  return `${OWN_GUN_PREFIX}${reservationId}:${playerId}`
}

// Each gun with today's latest reading: 'pass', 'fail', or 'pending' (not tested yet today).
export async function gameFpsStatus(db, reservation, { now = new Date() } = {}) {
  const guns = await gameGuns(db, reservation)
  const since = manilaDayStartISO(now)
  const logs = guns.length
    ? await db.collection('fps_logs')
      .find({ weaponId: { $in: guns.map((g) => g.weaponId) }, testedAtISO: { $gte: since } })
      .sort({ testedAtISO: -1 })
      .toArray()
    : []
  const latest = new Map()
  for (const log of logs) if (!latest.has(log.weaponId)) latest.set(log.weaponId, log)
  const items = guns.map((gun) => {
    const log = latest.get(gun.weaponId)
    return {
      ...gun,
      status: log ? log.result : 'pending',
      fps: log?.fps ?? null,
      limit: log?.limit ?? null,
      testedAtISO: log?.testedAtISO || null,
    }
  })
  return {
    items,
    allPassed: items.every((i) => i.status === 'pass'),
    pending: items.filter((i) => i.status === 'pending').length,
    failed: items.filter((i) => i.status === 'fail').length,
  }
}

// The reason a game can't start yet, or '' when every gun has passed today.
export function fpsBlockReason(status) {
  if (status.allPassed) return ''
  const parts = []
  if (status.failed) parts.push(`${status.failed} failed (swap ${status.failed === 1 ? 'it' : 'them'} for another gun)`)
  if (status.pending) parts.push(`${status.pending} not tested yet`)
  return `Every gun must pass the FPS check before the game starts: ${parts.join(', ')}.`
}
