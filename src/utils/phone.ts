// Philippine mobile numbers are shown and stored as +63-9XX-XXX-XXXX.
export const PH_PHONE_PLACEHOLDER = '+63-9XX-XXX-XXXX'
const PH_PHONE_PATTERN = /^\+63-9\d{2}-\d{3}-\d{4}$/

// Formats as the user types: "09171234567", "9171234567" and "+63 917 123 4567" all become
// "+63-917-123-4567". Dashes only appear once the next group has digits, so backspace works.
export function formatPhPhone(value: string) {
  let digits = String(value || '').replace(/\D/g, '')
  if (digits.startsWith('63')) digits = digits.slice(2)
  // Mobile numbers start with 9, so anything typed before it ("0", or "+63" typed key by key) is the prefix.
  digits = digits.replace(/^[^9]+/, '').slice(0, 10)
  if (!digits) return ''
  const groups = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 10)].filter(Boolean)
  return `+63-${groups.join('-')}`
}

export function isValidPhPhone(value: string) {
  return PH_PHONE_PATTERN.test(String(value || ''))
}
