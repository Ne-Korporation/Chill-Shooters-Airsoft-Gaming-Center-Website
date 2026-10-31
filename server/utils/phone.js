// Philippine mobile numbers are stored as 09XXXXXXXXX (shown as "09XX XXX XXXX"). Mirrors src/utils/phone.ts.
// Accepts any typed form ("0917 123 4567", "+63 917 123 4567", older "+63-917-123-4567") and
// returns the 11 digits, or null when the value isn't a PH mobile number.
export function normalizePhPhone(value) {
  let digits = String(value || '').replace(/\D/g, '')
  if (digits.startsWith('63')) digits = digits.slice(2)
  if (digits.startsWith('0')) digits = digits.slice(1)
  if (!/^9\d{9}$/.test(digits)) return null
  return `0${digits}`
}
