// Guards for the generic collection API (routes/crud.js), where the browser sends its own
// MongoDB filter (?q=...) and sort.

// Account fields that never leave the server and can't be searched or written through the
// generic API: password hashes, one-time codes, reset/unlock/setup tokens and session cut-offs.
export const SECRET_ACCOUNT_FIELDS = [
  'password',
  'otpCode', 'otpExpiresAt', 'otpAttempts', 'otpSentAtISO', 'pendingEmailOtp',
  'resetCodeHash', 'resetCodeAttempts', 'resetCodeExpiresAt', 'resetCodeSentAtISO',
  'resetTokenHash', 'resetTokenExpiresAt',
  'unlockTokenHash', 'unlockExpiresAt',
  'passwordSetupTokenHash', 'passwordSetupExpiresAt',
  'guardianConfirmToken',
  'sessionsValidAfterISO',
]
const SECRET_SET = new Set(SECRET_ACCOUNT_FIELDS)

// Query operators the app uses. Anything else ($where, $function, $expr, $accumulator, $jsonSchema…)
// is refused: those run code on the database or can compare fields the caller isn't shown.
const ALLOWED_OPERATORS = new Set([
  '$and', '$or', '$nor', '$not',
  '$eq', '$ne', '$in', '$nin', '$lt', '$lte', '$gt', '$gte',
  '$exists', '$regex', '$options', '$elemMatch', '$size', '$all',
])

const MAX_DEPTH = 8
const MAX_REGEX_LENGTH = 200

function isSecretPath(path) {
  // "password", "resetTokenHash", or a nested path that starts with one of them.
  const head = String(path).split('.')[0]
  return SECRET_SET.has(head)
}

// Returns an error message, or '' when the filter is safe to hand to MongoDB.
export function checkQueryFilter(filter, depth = 0) {
  if (depth > MAX_DEPTH) return 'Query is nested too deeply.'
  if (filter === null || typeof filter !== 'object') return ''
  if (Array.isArray(filter)) {
    for (const item of filter) {
      const problem = checkQueryFilter(item, depth + 1)
      if (problem) return problem
    }
    return ''
  }
  for (const [key, value] of Object.entries(filter)) {
    if (key.startsWith('$')) {
      if (!ALLOWED_OPERATORS.has(key)) return `Query operator ${key} is not allowed.`
      if (key === '$regex') {
        const source = value instanceof RegExp ? value.source : String(value ?? '')
        if (source.length > MAX_REGEX_LENGTH) return 'Search text is too long.'
      }
    } else if (isSecretPath(key)) {
      return 'That field cannot be searched.'
    }
    const problem = checkQueryFilter(value, depth + 1)
    if (problem) return problem
  }
  return ''
}

// Drops sort keys on secret fields (sorting by a hash still leaks its order).
export function safeSort(sort) {
  if (!sort) return sort
  return Object.fromEntries(Object.entries(sort).filter(([field]) => !isSecretPath(field)))
}

// A MongoDB projection that hides every secret account field.
export function secretAccountProjection() {
  return Object.fromEntries(SECRET_ACCOUNT_FIELDS.map((field) => [field, 0]))
}

// Removes secret account fields from a document in place (and returns it).
export function stripAccountSecrets(doc) {
  if (!doc || typeof doc !== 'object') return doc
  for (const field of SECRET_ACCOUNT_FIELDS) delete doc[field]
  return doc
}

// Secret fields an update tries to write through the generic API.
export function blockedWriteFields(payload) {
  const fields = new Set()
  const collect = (obj) => {
    if (!obj || typeof obj !== 'object') return
    for (const key of Object.keys(obj)) {
      if (key.startsWith('$')) collect(obj[key])
      else fields.add(key.split('.')[0])
    }
  }
  collect(payload)
  return [...fields].filter((field) => SECRET_SET.has(field))
}

// A record's _id never changes: drop it if a page sent the whole record back.
export function dropIdFields(payload) {
  if (!payload || typeof payload !== 'object') return payload
  delete payload._id
  if (payload.$set && typeof payload.$set === 'object') delete payload.$set._id
  return payload
}
