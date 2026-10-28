const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com'])

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

// Gmail ignores dots and anything after "+" in the local part, so
// "j.doe+x@gmail.com" and "jdoe@googlemail.com" reach the same inbox.
// Comparing on this form stops one Gmail account registering twice.
export function canonicalEmail(email) {
  const normalized = normalizeEmail(email)
  const at = normalized.lastIndexOf('@')
  if (at <= 0) return normalized
  const local = normalized.slice(0, at)
  const domain = normalized.slice(at + 1)
  if (!GMAIL_DOMAINS.has(domain)) return normalized
  return `${local.split('+')[0].replace(/\./g, '')}@gmail.com`
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Mongo filter matching any stored account that shares this email's canonical
// form, including older records saved before emailCanonical existed.
export function sameEmailFilter(email) {
  const canonical = canonicalEmail(email)
  const normalized = normalizeEmail(email)
  const clauses = [
    { emailCanonical: canonical },
    { email: { $regex: `^${escapeRegex(normalized)}$`, $options: 'i' } },
  ]
  const at = canonical.lastIndexOf('@')
  if (canonical.endsWith('@gmail.com') && at > 0) {
    const letters = canonical.slice(0, at).split('').map(escapeRegex).join('\\.*')
    clauses.push({ email: { $regex: `^${letters}(\\+[^@]*)?@(gmail|googlemail)\\.com$`, $options: 'i' } })
  }
  return { $or: clauses }
}
