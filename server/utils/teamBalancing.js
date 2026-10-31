// Experience is the player's total games played (games completed at the field plus games from
// before the system). Tiers: Beginner 0-10 games, Intermediate 11-25, Experienced 26 or more.
export function getExperienceLevel(experience) {
  const games = Number(experience) || 0
  if (games >= 26) return 'Experienced'
  if (games >= 11) return 'Intermediate'
  return 'Beginner'
}

export function getAgeGroup(age) {
  const value = Number(age)
  if (!Number.isFinite(value) || value <= 0) return 'Unknown'
  if (value < 18) return 'Under 18'
  if (value < 25) return '18–24'
  if (value < 35) return '25–34'
  return '35+'
}

const AGE_GROUP_ORDER = ['Under 18', '18–24', '25–34', '35+', 'Unknown']

// Splits players into teams with similar total experience and a similar spread of age groups.
// Players are taken strongest first; each goes to the team with the least experience so far
// (ties: fewest players in that player's age group, then smallest team).
export function suggestBalancedTeams(players, teamCount = 2) {
  const count = Math.min(Math.max(Math.round(Number(teamCount) || 2), 2), 6)
  const teams = Array.from({ length: count }, (_, index) => ({
    name: `Team ${index + 1}`,
    playerKeys: [],
    totalExperience: 0,
    ageGroups: {},
  }))

  const ordered = [...players].sort((a, b) =>
    (b.experience || 0) - (a.experience || 0) ||
    AGE_GROUP_ORDER.indexOf(a.ageGroup) - AGE_GROUP_ORDER.indexOf(b.ageGroup) ||
    String(a.key).localeCompare(String(b.key)),
  )

  for (const player of ordered) {
    // Only the smallest teams are candidates, so team sizes stay within one of each other.
    const smallest = Math.min(...teams.map((team) => team.playerKeys.length))
    const target = teams
      .filter((team) => team.playerKeys.length === smallest)
      .sort((a, b) =>
        a.totalExperience - b.totalExperience ||
        (a.ageGroups[player.ageGroup] || 0) - (b.ageGroups[player.ageGroup] || 0),
      )[0]

    target.playerKeys.push(player.key)
    target.totalExperience += player.experience || 0
    target.ageGroups[player.ageGroup] = (target.ageGroups[player.ageGroup] || 0) + 1
  }

  return teams.map((team) => ({
    name: team.name,
    playerKeys: team.playerKeys,
    totalExperience: team.totalExperience,
    ageGroups: team.ageGroups,
  }))
}
