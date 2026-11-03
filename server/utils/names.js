// Player names are stored as parts (first, middle initial, last) so waivers can be filled in the
// order staff check against an ID: "Juan D. Dela Cruz". `name` keeps the composed full name for
// every screen that already reads it.

export const NAME_PART_MAX = 60
export const NICKNAME_MAX = 30

export function cleanNamePart(value, max = NAME_PART_MAX) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

// "d" / "D." / "Dizon" -> "D"
export function cleanMiddleInitial(value) {
  const letter = String(value ?? '').replace(/[^A-Za-zÀ-ÿÑñ]/g, '').charAt(0)
  return letter ? letter.toUpperCase() : ''
}

export function composeFullName({ firstName, middleInitial, lastName }) {
  const mi = cleanMiddleInitial(middleInitial)
  return [cleanNamePart(firstName), mi ? `${mi}.` : '', cleanNamePart(lastName)].filter(Boolean).join(' ')
}

// Best guess for an account that only has one full-name string (e.g. from Google): the last word
// is the surname, a single letter (with or without a dot) before it is the middle initial.
export function splitFullName(fullName) {
  const words = cleanNamePart(fullName, 200).split(' ').filter(Boolean)
  if (words.length === 0) return { firstName: '', middleInitial: '', lastName: '' }
  if (words.length === 1) return { firstName: words[0], middleInitial: '', lastName: '' }
  const lastName = words.pop()
  const maybeInitial = words[words.length - 1]
  const middleInitial = words.length > 1 && /^[A-Za-z]\.?$/.test(maybeInitial) ? cleanMiddleInitial(words.pop()) : ''
  return { firstName: words.join(' '), middleInitial, lastName }
}
