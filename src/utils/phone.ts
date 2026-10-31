// Philippine mobile numbers are shown as "09XX XXX XXXX" and stored as "09XXXXXXXXX".
// Mirrors server/utils/phone.js, which accepts either form and stores the 11 digits.
export const PH_PHONE_PLACEHOLDER = '09XX XXX XXXX'
const PH_PHONE_PATTERN = /^09\d{2} \d{3} \d{4}$/

// The 10 digits after the leading 0 ("9171234567"), whatever way the number was typed or pasted:
// "09171234567", "0917 123 4567", "+63 917 123 4567" and stored "+63-917-123-4567" all work.
function mobileDigits(value: string) {
  let digits = String(value || '').replace(/\D/g, '')
  if (digits.startsWith('63')) digits = digits.slice(2)
  if (digits.startsWith('0')) digits = digits.slice(1)
  return digits.slice(0, 10)
}

// Formats as the user types. Spaces only appear once the next group has digits, so backspace works.
export function formatPhPhone(value: string) {
  const digits = mobileDigits(value)
  if (!digits) return /^\D*0/.test(String(value || '')) ? '0' : ''
  const groups = [`0${digits.slice(0, 3)}`, digits.slice(3, 6), digits.slice(6, 10)].filter((group) => group && group !== '0')
  return groups.join(' ')
}

export function isValidPhPhone(value: string) {
  return PH_PHONE_PATTERN.test(formatPhPhone(value))
}

// What gets sent to the server and saved: "09171234567", or '' when the field is empty.
export function toStoredPhPhone(value: string) {
  const digits = mobileDigits(value)
  return digits ? `0${digits}` : ''
}
