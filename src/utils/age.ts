// Ages are counted in Philippine time so a birthday rolls over at Manila midnight.
function manilaTodayParts() {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' })
    .format(new Date())
    .split('-')
    .map(Number)
  return { year, month, day }
}

export function isValidBirthDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const age = ageFromBirthDate(value)
  return age !== null && age >= 1 && age <= 120
}

// Whole years since the birth date, or null for a missing or future date.
export function ageFromBirthDate(value?: string | null): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''))
  if (!match) return null
  const [year, month, day] = match.slice(1).map(Number)
  const today = manilaTodayParts()
  let age = today.year - year
  if (today.month < month || (today.month === month && today.day < day)) age -= 1
  return age >= 0 ? age : null
}

// Latest selectable birth date (today) for date inputs.
export function maxBirthDate() {
  const { year, month, day } = manilaTodayParts()
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
