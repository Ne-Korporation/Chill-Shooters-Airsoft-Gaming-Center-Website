import test from 'node:test'
import assert from 'node:assert/strict'
import { teamWithout } from '../utils/teamDecline.js'

const booking = (overrides = {}) => ({
  id: 'R-1',
  userId: 'P11',
  numberOfPlayers: 3,
  paymentMode: 'split',
  teamSize: 3,
  splitPayerIds: ['P7', 'P9'],
  teamMembers: [{ id: 'P7', name: 'Player7 A. Test' }, { id: 'P9', name: 'Juan' }],
  ownWeaponBringerIds: ['P9'],
  ownWeaponBringers: [{ userId: 'P9', verified: true }],
  ...overrides,
})

test('a declining teammate leaves the team, the payers and the head count', () => {
  const { leaving, changes } = teamWithout(booking(), 'P9')
  assert.deepEqual(leaving, { id: 'P9', name: 'Juan' })
  assert.equal(changes.numberOfPlayers, 2)
  assert.deepEqual(changes.selectedTeammateIds, ['P7'])
  assert.deepEqual(changes.splitPayerIds, ['P7'])
  assert.equal(changes.teamSize, 2)
  assert.equal(changes.paymentMode, 'split')
  assert.deepEqual(changes.ownWeaponBringerIds, [])
  assert.equal(changes.verifiedOwnWeaponCount, 0)
})

test('when the last teammate declines, the booker pays the rest alone', () => {
  const { changes } = teamWithout(booking({ numberOfPlayers: 2, teamSize: 2, splitPayerIds: ['P7'], teamMembers: [{ id: 'P7', name: 'Ana' }] }), 'P7')
  assert.equal(changes.numberOfPlayers, 1)
  assert.equal(changes.paymentMode, 'self')
  assert.equal(changes.teamSize, 1)
  assert.deepEqual(changes.splitPayerIds, [])
})

test('the person who booked cannot decline their own booking', () => {
  assert.throws(() => teamWithout(booking(), 'P11'), /Cancel the booking instead/)
})

test('someone not on the booking cannot decline it', () => {
  assert.throws(() => teamWithout(booking(), 'P99'), /not on this booking/)
})

test('a guardian whose child is on the team cannot leave the child behind', () => {
  const withChild = booking({ teamMembers: [{ id: 'P7', name: 'Ana' }, { id: 'P9', name: 'Juan' }, { id: 'C1', name: 'Mia', isMinor: true, guardianId: 'P9' }] })
  assert.throws(() => teamWithout(withChild, 'P9'), /Mia is on this team/)
})
