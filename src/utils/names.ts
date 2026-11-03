// Mirrors server/utils/names.js: names are entered as parts and shown as "First M. Last".

export type NameParts = { firstName: string; middleInitial: string; lastName: string }

export function cleanMiddleInitial(value: string) {
  const letter = String(value ?? '').replace(/[^A-Za-zÀ-ÿÑñ]/g, '').charAt(0)
  return letter ? letter.toUpperCase() : ''
}

export function composeFullName({ firstName, middleInitial, lastName }: Partial<NameParts>) {
  const mi = cleanMiddleInitial(middleInitial || '')
  return [String(firstName || '').trim(), mi ? `${mi}.` : '', String(lastName || '').trim()].filter(Boolean).join(' ').replace(/\s+/g, ' ')
}

// Best guess for a single full-name string: the last word is the surname, and a lone letter
// before it is the middle initial.
export function splitFullName(fullName: string): NameParts {
  const words = String(fullName || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  if (words.length === 0) return { firstName: '', middleInitial: '', lastName: '' }
  if (words.length === 1) return { firstName: words[0], middleInitial: '', lastName: '' }
  const lastName = words.pop() as string
  const maybeInitial = words[words.length - 1]
  const middleInitial = words.length > 1 && /^[A-Za-z]\.?$/.test(maybeInitial) ? cleanMiddleInitial(words.pop() as string) : ''
  return { firstName: words.join(' '), middleInitial, lastName }
}
