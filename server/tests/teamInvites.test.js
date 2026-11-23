import test from 'node:test'
import assert from 'node:assert/strict'
import { buildInvites, gameStartMs, inviteOutstanding, latestInvite } from '../utils/teamInvites.js'
import { getGcashAmountDue, getPaymentProgress } from '../utils/paymentRules.js'
import { roleReceivesNotification } from '../utils/roleNotifications.js'

const booking = (extra = {}) => ({
  id: 'R1',
  userId: 'C1',
  reservationDate: '2099-01-10',
  reservationTime: 'afternoon',
  sessionType: 'private',
  numberOfPlayers: 4,
  teamMembers: [
    { id: 'P1', name: 'Ana' },
    { id: 'P2', name: 'Ben' },
    { id: 'K1', name: 'Kid', isMinor: true, guardianId: 'C1' },
  ],
  ...extra,
})

test('every adult teammate is invited with 24 hours to answer; minors are not', () => {
  const now = Date.parse('2099-01-01T00:00:00Z')
  const invites = buildInvites(booking(), now)
  assert.deepEqual(invites.map((i) => i.playerId), ['P1', 'P2'])
  assert.equal(invites[0].status, 'pending')
  assert.equal(invites[0].deadlineISO, '2099-01-02T00:00:00.000Z')
})

test('an invite never runs past the start of the game', () => {
  const reservation = booking({ reservationDate: '2099-01-01' })
  const now = Date.parse('2098-12-31T20:00:00Z')
  const [invite] = buildInvites(reservation, now)
  // Afternoon starts at 12:00 Manila (04:00 UTC).
  assert.equal(invite.deadlineISO, new Date(gameStartMs(reservation)).toISOString())
  assert.equal(invite.deadlineISO, '2099-01-01T04:00:00.000Z')
})

test('an invite is outstanding until accepted, and in a split payment until paid too', () => {
  const split = booking({ paymentMode: 'split', splitPayerIds: ['P1', 'P2'] })
  const pending = { playerId: 'P1', status: 'pending' }
  const accepted = { playerId: 'P1', status: 'accepted' }
  assert.equal(inviteOutstanding(split, pending, []), true)
  assert.equal(inviteOutstanding(split, accepted, []), true)
  assert.equal(inviteOutstanding(split, accepted, [{ userId: 'P1', amount: 100, paymentStatus: 'paid' }]), false)
  assert.equal(inviteOutstanding(booking(), accepted, []), false)
  assert.equal(inviteOutstanding(split, { playerId: 'P1', status: 'declined' }, []), false)
})

test('the latest invite for a player is the one that counts', () => {
  const reservation = booking({ invites: [
    { playerId: 'P1', status: 'declined' },
    { playerId: 'P1', status: 'pending' },
  ] })
  assert.equal(latestInvite(reservation, 'P1').status, 'pending')
  assert.equal(latestInvite(reservation, 'P9'), null)
})

test('an open spot is held back: nobody pays its share online until the captain decides', () => {
  const reservation = booking({
    paymentMode: 'split', teamSize: 2, depositAmount: 900,
    splitPayerIds: ['P1'], splitShares: { C1: 300, P1: 300 },
    openSlots: [{ id: 'S1', amount: 300, status: 'open' }],
  })
  // The last teammate to pay doesn't pick up the open spot.
  assert.equal(getGcashAmountDue(reservation, [{ userId: 'C1', amount: 300, paymentStatus: 'paid' }], 'P1'), 300)
  // Every share in, but the open spot keeps the booking from being fully paid.
  const all = [{ userId: 'C1', amount: 300, paymentStatus: 'paid' }, { userId: 'P1', amount: 300, paymentStatus: 'paid' }]
  assert.equal(getPaymentProgress(reservation, all).state, 'partial')
  assert.equal(getGcashAmountDue(reservation, all, 'C1'), 0)
})

test('a spot the captain pays for is added to what the captain pays', () => {
  const reservation = booking({
    paymentMode: 'split', teamSize: 2, depositAmount: 900,
    splitPayerIds: ['P1'], splitShares: { C1: 300, P1: 300 },
    openSlots: [{ id: 'S1', amount: 300, status: 'covering' }],
  })
  // Captain hasn't paid yet: their share plus the spot.
  assert.equal(getGcashAmountDue(reservation, [], 'C1'), 600)
  // Captain already paid their own share: just the spot.
  const captainPaid = [{ userId: 'C1', amount: 300, paymentStatus: 'paid' }]
  assert.equal(getGcashAmountDue(reservation, captainPaid, 'C1'), 300)
  // The teammate still pays only their own share.
  assert.equal(getGcashAmountDue(reservation, captainPaid, 'P1'), 300)
  const everyone = [...captainPaid, { userId: 'C1', amount: 300, paymentStatus: 'paid' }, { userId: 'P1', amount: 300, paymentStatus: 'paid' }]
  assert.equal(getPaymentProgress(reservation, everyone).state, 'finalized')
})

test('a team down to the captain alone can still pay', () => {
  const reservation = booking({ paymentMode: 'split', teamSize: 1, depositAmount: 600, splitPayerIds: [], splitShares: { C1: 300 }, openSlots: [{ id: 'S1', amount: 300, status: 'open' }] })
  assert.equal(getGcashAmountDue(reservation, [], 'C1'), 300)
})

test('marshals hear about player weapons; registrars about money to collect onsite', () => {
  assert.equal(roleReceivesNotification('marshal', { type: 'own_weapons_incoming' }), true)
  assert.equal(roleReceivesNotification('registrar', { type: 'onsite_payment_due' }), true)
  assert.equal(roleReceivesNotification('marshal', { type: 'onsite_payment_due' }), false)
})
