import test from 'node:test'
import assert from 'node:assert/strict'
import { getAgeGroup, getExperienceLevel, suggestBalancedTeams } from '../utils/teamBalancing.js'

test('experience levels and age groups', () => {
  assert.equal(getExperienceLevel(0), 'Beginner')
  assert.equal(getExperienceLevel(10), 'Beginner')
  assert.equal(getExperienceLevel(11), 'Intermediate')
  assert.equal(getExperienceLevel(25), 'Intermediate')
  assert.equal(getExperienceLevel(26), 'Experienced')
  assert.equal(getAgeGroup(16), 'Under 18')
  assert.equal(getAgeGroup(30), '25–34')
  assert.equal(getAgeGroup(null), 'Unknown')
})

test('balanced teams have even sizes and close experience totals', () => {
  const players = [20, 15, 10, 8, 5, 3, 1, 0, 0].map((experience, i) => ({
    key: `p${i}`, experience, ageGroup: i % 2 ? '18–24' : '25–34',
  }))
  const teams = suggestBalancedTeams(players, 2)
  const sizes = teams.map((t) => t.playerKeys.length).sort()
  assert.deepEqual(sizes, [4, 5])
  assert.ok(Math.abs(teams[0].totalExperience - teams[1].totalExperience) <= 10)
  assert.equal(new Set(teams.flatMap((t) => t.playerKeys)).size, players.length)
})
