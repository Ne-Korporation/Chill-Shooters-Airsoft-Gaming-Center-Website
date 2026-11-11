import test from 'node:test'
import assert from 'node:assert/strict'
import { accountBookingFilter, cloudinaryFileOf, planAccountClosure, summarizePlan } from '../utils/accountClosure.js'

const today = '2026-11-11'
const account = (id, extra = {}) => [id, { id, name: `Player ${id}`, email: `${id}@x.test`, role: 'user', status: 'active', ...extra }]

test('finds every booking a player is on, as booker or teammate', () => {
  const filter = accountBookingFilter('P-1')
  assert.deepEqual(filter.$or.map((rule) => Object.keys(rule)[0]), ['userId', 'teamMembers.id', 'splitPayerIds', 'selectedTeammateIds', 'ownWeaponBringerIds'])
})

test('past bookings stay; upcoming ones pass to a teammate, are cancelled, or drop the player from the team', () => {
  const reservations = [
    { id: 'R-past', userId: 'P-1', reservationDate: '2026-11-07', reservationStatus: 'confirmed' },
    { id: 'R-cancelled', userId: 'P-1', reservationDate: '2026-11-20', reservationStatus: 'cancelled' }, // already closed
    // Team booking: P-2 is an active adult teammate, so P-2 becomes captain.
    { id: 'R-team', userId: 'P-1', reservationDate: '2026-11-14', reservationStatus: 'confirmed', teamMembers: [{ id: 'P-2', name: 'Two' }] },
    // Only a minor and a suspended teammate: nobody can take over, so it's cancelled.
    {
      id: 'R-solo',
      userId: 'P-1',
      reservationDate: '2026-11-11',
      reservationStatus: 'pending',
      teamMembers: [{ id: 'C-1', name: 'Kid', isMinor: true }, { id: 'P-3', name: 'Three' }],
    },
    // Someone else's booking: P-1 is a teammate, so P-1 is taken off the team.
    { id: 'R-other', userId: 'P-9', reservationDate: '2026-11-15', reservationStatus: 'confirmed', teamMembers: [{ id: 'P-1' }] },
  ]
  const accounts = new Map([account('P-2'), account('P-3', { status: 'suspended' }), account('C-1')])
  const plan = planAccountClosure({ userId: 'P-1', reservations, accounts, todayISO: today })

  assert.deepEqual(plan.past.map((p) => p.reservation.id), ['R-past', 'R-cancelled'])
  assert.deepEqual(plan.transfer.map((p) => [p.reservation.id, p.newCaptain.id]), [['R-team', 'P-2']])
  assert.deepEqual(plan.cancel.map((p) => p.reservation.id), ['R-solo'])
  assert.deepEqual(plan.leaveTeam.map((p) => p.reservation.id), ['R-other'])

  const summary = summarizePlan(plan)
  assert.equal(summary.past, 2)
  assert.equal(summary.transfer[0].newCaptain, 'Player P-2')
})

test('a teammate whose account is gone, closed or not a player cannot become captain', () => {
  const reservations = [{
    id: 'R-1',
    userId: 'P-1',
    reservationDate: '2026-11-12',
    reservationStatus: 'confirmed',
    teamMembers: [{ id: 'P-gone' }, { id: 'P-closed' }, { id: 'S-1' }],
  }]
  const accounts = new Map([account('P-closed', { status: 'closed' }), account('S-1', { role: 'marshal' })])
  const plan = planAccountClosure({ userId: 'P-1', reservations, accounts, todayISO: today })
  assert.equal(plan.transfer.length, 0)
  assert.deepEqual(plan.cancel.map((p) => p.reservation.id), ['R-1'])
})

test('erasing finds the Cloudinary file behind each ID photo link', () => {
  assert.deepEqual(cloudinaryFileOf('https://res.cloudinary.com/demo/image/upload/v1700000000/cs-1700-front-id.jpg'), { resourceType: 'image', publicId: 'cs-1700-front-id' })
  assert.deepEqual(cloudinaryFileOf('https://res.cloudinary.com/demo/raw/upload/v1/cs-1-proof.pdf'), { resourceType: 'raw', publicId: 'cs-1-proof.pdf' })
  assert.equal(cloudinaryFileOf('https://example.com/api/files/abc'), null)
  assert.equal(cloudinaryFileOf(''), null)
})
