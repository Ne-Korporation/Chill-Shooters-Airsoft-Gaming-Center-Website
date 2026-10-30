// Philippine mobile numbers are stored as +63-9XX-XXX-XXXX. Mirrors src/utils/phone.ts.
// Returns the formatted number, or null when the value isn't a PH mobile number.
export function normalizePhPhone(value) {
  let digits = String(value || '').replace(/\D/g, '')
  if (digits.startsWith('63')) digits = digits.slice(2)
  if (digits.startsWith('0')) digits = digits.slice(1)
  if (!/^9\d{9}$/.test(digits)) return null
  return `+63-${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
}
