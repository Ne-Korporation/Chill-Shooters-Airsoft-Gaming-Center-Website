// Limits on guessing: wrong passwords and wrong one-time codes.
//
// Every attempt is saved in the `auth_attempts` collection with an expiry, and MongoDB deletes it
// once it is old (a TTL index), so the counts survive a server restart and are shared if the API
// ever runs on more than one server.
//
// Login uses three counts, so a stranger can't lock a real player out:
// - this email from this address: a few wrong passwords block only that address for that email;
//   the real player, on their own phone or network, is not affected.
// - this address, any emails: stops one password being tried against many accounts.
// - this email, any addresses: a high cap against guessing from many addresses. Reaching it
//   doesn't lock the owner out: they are emailed a one-time sign-in link instead (see auth.js).
// Unknown emails are counted the same way, so the answers never show whether an email has an
// account.

export const ATTEMPTS_COLLECTION = 'auth_attempts'
const MINUTE = 60 * 1000

export const LIMITS = {
  loginPair: { max: 5, windowMs: 15 * MINUTE },
  loginAddress: { max: 20, windowMs: 15 * MINUTE },
  loginAccount: { max: 30, windowMs: 60 * MINUTE },
  codeAddress: { max: 30, windowMs: 15 * MINUTE },
}

export const OTP_MAX_ATTEMPTS = 5

export const loginKeys = (email, address) => ({
  pair: `login:pair:${email}:${address}`,
  address: `login:address:${address}`,
  account: `login:account:${email}`,
})
export const codeAddressKey = (address) => `code:address:${address}`

export function clientAddress(req) {
  return String(req?.ip || req?.socket?.remoteAddress || 'unknown')
}

export function minutesLeft(untilMs, now = Date.now()) {
  return Math.max(1, Math.ceil((untilMs - now) / MINUTE))
}

// `getCollection` returns the attempts collection (a function, so tests can pass a fake one).
export function createAttemptStore(getCollection) {
  let ready = null
  const collection = async () => {
    const col = await getCollection()
    ready ??= Promise.all([
      col.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }),
      col.createIndex({ key: 1, at: 1 }),
      col.createIndex({ account: 1 }),
    ]).catch((err) => { ready = null; console.error('auth_attempts indexes', err?.message || err) })
    await ready
    return col
  }

  return {
    // Attempts for `key` within its window.
    async count(key, { windowMs }, now = Date.now()) {
      const col = await collection()
      return col.countDocuments({ key, at: { $gt: new Date(now - windowMs) } })
    },
    // Records attempts for several keys at once (before the password or code is checked, so a
    // burst of guesses sent together is counted) and returns their ids, to give back on success.
    async record(entries, now = Date.now()) {
      if (!entries.length) return []
      const col = await collection()
      const docs = entries.map(({ key, limit, account }) => ({
        key,
        ...(account ? { account } : {}),
        at: new Date(now),
        expireAt: new Date(now + limit.windowMs),
      }))
      const result = await col.insertMany(docs)
      return Object.values(result.insertedIds)
    },
    async forgive(ids) {
      if (!ids?.length) return
      const col = await collection()
      await col.deleteMany({ _id: { $in: ids } })
    },
    // Clears every login count tied to an email (after its owner proves who they are).
    async clearAccount(email) {
      const col = await collection()
      await col.deleteMany({ account: email })
    },
  }
}
