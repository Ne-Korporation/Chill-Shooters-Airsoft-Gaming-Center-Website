// An invited player declining a team booking (before paying their share): the team without them.
// The booking shrinks by one player; the route re-prices it, re-reserves its gear for the smaller
// group, and the remaining shares re-split on their own (see getGcashAmountDue).
//
// Returns the reservation fields to change, or throws an error with a statusCode.

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode })

export function teamWithout(reservation, playerId) {
  const me = String(playerId)
  if (String(reservation.userId) === me) throw fail('You booked this game, so you can\'t decline it. Cancel the booking instead.', 409)
  const members = Array.isArray(reservation.teamMembers) ? reservation.teamMembers : []
  const leaving = members.find((member) => String(member?.id) === me)
  if (!leaving) throw fail('You are not on this booking.', 404)
  // A child can only play with their guardian on the team.
  const child = members.find((member) => member?.isMinor && String(member.guardianId) === me)
  if (child) throw fail(`${child.name || 'Your child'} is on this team and can only play with you. Ask the person who booked to change the booking.`, 409)

  const teamMembers = members.filter((member) => String(member?.id) !== me)
  const payers = (Array.isArray(reservation.splitPayerIds) ? reservation.splitPayerIds : []).map(String).filter((id) => id !== me)
  const split = String(reservation.paymentMode || 'self').toLowerCase() === 'split' && payers.length > 0
  const numberOfPlayers = Math.max(1, Number(reservation.numberOfPlayers || members.length + 1) - 1)
  const bringerIds = (reservation.ownWeaponBringerIds || []).map(String).filter((id) => id !== me)
  const ownWeaponBringers = (reservation.ownWeaponBringers || []).filter((b) => String(b?.userId) !== me)
  const ownGearPlayerIds = (reservation.ownGearPlayerIds || []).map(String).filter((id) => id !== me)

  return {
    leaving: { id: me, name: leaving.name || '' },
    changes: {
      teamMembers,
      selectedTeammateIds: teamMembers.map((member) => String(member.id)),
      numberOfPlayers,
      // With no one left to split with, the person who booked pays the rest alone.
      paymentMode: split ? 'split' : 'self',
      teamSize: split ? payers.length + 1 : 1,
      splitPayerIds: split ? payers : [],
      ownWeaponBringerIds: bringerIds,
      ownWeaponBringers,
      verifiedOwnWeaponCount: Math.min(numberOfPlayers, ownWeaponBringers.filter((b) => b?.verified).length),
      ownGearPlayerIds,
      ownGearRentals: Object.fromEntries(Object.entries(reservation.ownGearRentals || {}).filter(([id]) => String(id) !== me)),
      playerGuns: Object.fromEntries(Object.entries(reservation.playerGuns || {}).filter(([id]) => String(id) !== me)),
      verifiedOwnGearCount: Math.min(numberOfPlayers, ownGearPlayerIds.length),
    },
  }
}
