import test from 'node:test'
import assert from 'node:assert/strict'
import { packageGroupFit } from '../routes/recommendations.js'

const perPlayer = { weaponCount: 1, minPlayers: 4, weaponIds: ['m4'] }

test('a per-player package fits groups at or above its minimum', () => {
  assert.equal(packageGroupFit(perPlayer, { players: 6, ownWeapons: 0, weaponsWanted: 0 }).ok, true)
  const small = packageGroupFit(perPlayer, { players: 3, ownWeapons: 0, weaponsWanted: 0 })
  assert.equal(small.ok, false)
  assert.match(small.reason, /at least 4/)
})

test('a fixed-headcount package fits only that exact group size', () => {
  const fixed = { players: 10, settledAmount: 7500, weaponCount: 10 }
  assert.equal(packageGroupFit(fixed, { players: 10, ownWeapons: 0, weaponsWanted: 0 }).ok, true)
  assert.match(packageGroupFit(fixed, { players: 9, ownWeapons: 0, weaponsWanted: 0 }).reason, /exactly 10/)
})

test('a settled package must include enough weapons for the group, less own weapons', () => {
  const fixed = { players: 10, settledAmount: 7500, weaponCount: 8 }
  assert.equal(packageGroupFit(fixed, { players: 10, ownWeapons: 0, weaponsWanted: 0 }).ok, false)
  assert.equal(packageGroupFit(fixed, { players: 10, ownWeapons: 2, weaponsWanted: 0 }).ok, true)
})

test('the weapons-wanted filter is respected', () => {
  const result = packageGroupFit({ weaponCount: 0, minPlayers: 1 }, { players: 5, ownWeapons: 5, weaponsWanted: 2 })
  assert.equal(result.ok, false)
  assert.match(result.reason, /asked for 2/)
})
