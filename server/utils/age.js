// Whole years since a YYYY-MM-DD birth date, counted in Philippine time; null when the
// date is missing, malformed, or in the future. Mirrors src/utils/age.ts.
export function ageFromBirthDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''))
  if (!match) return null
  const [year, month, day] = match.slice(1).map(Number)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const [todayYear, todayMonth, todayDay] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' })
    .format(new Date())
    .split('-')
    .map(Number)
  let age = todayYear - year
  if (todayMonth < month || (todayMonth === month && todayDay < day)) age -= 1
  return age >= 0 ? age : null
}
