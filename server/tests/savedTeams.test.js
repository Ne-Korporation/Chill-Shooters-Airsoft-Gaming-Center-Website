import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanMemberIds, cleanTeamName } from '../routes/savedTeams.js'

test('team names are trimmed, single-spaced and at most 60 characters', () => {
  assert.equal(cleanTeamName('  Bravo   Squad  '), 'Bravo Squad')
  assert.equal(cleanTeamName(''), '')
  assert.equal(cleanTeamName(undefined), '')
  assert.equal(cleanTeamName('x'.repeat(80)).length, 60)
})

test('member ids are unique and never include the owner', () => {
  assert.deepEqual(cleanMemberIds(['P-2', 'P-3', 'P-2', ' P-4 ', 'P-1', ''], 'P-1'), ['P-2', 'P-3', 'P-4'])
  assert.deepEqual(cleanMemberIds('P-2', 'P-1'), [])
  assert.deepEqual(cleanMemberIds(undefined, 'P-1'), [])
})
