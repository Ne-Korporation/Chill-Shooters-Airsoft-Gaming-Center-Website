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

// Password reset codes per email: the first code plus 3 resends, at least a minute apart. After
// the 3rd resend the next code can be asked for 10 minutes later. Counted per email whether or
// not it has an account, so the limit never shows who is registered.
// `waitMs`: the wait after the 3rd resend; 10 quiet minutes also start a fresh round.
// `windowMs`: how long sends are kept, long enough to cover a whole round.
export const RESET_SENDS = { max: 4, waitMs: 10 * MINUTE, gapMs: MINUTE, windowMs: 45 * MINUTE }
export const resetSendKey = (email) => `reset:send:${email}`

// How long until another reset code can be sent, given when the earlier ones were (Dates or ms).
// The sends form rounds: a round ends 10 minutes after its last code, and holds at most `max`.
// `limit`: the round is full (3 resends used); `gap`: one was sent less than a minute ago.
// `sent`: codes in the current round; `resendsLeft`: resends still allowed in it.
export function resetSendWait(sentTimes, now = Date.now(), rule = RESET_SENDS) {
  const times = sentTimes.map((t) => new Date(t).getTime()).filter((t) => t <= now && t > now - rule.windowMs).sort((a, b) => a - b)
  let sent = 0
  let last = null
  for (const t of times) {
    if (last !== null && t - last >= rule.waitMs) sent = 0
    sent += 1
    last = t
  }
  if (last !== null && now - last >= rule.waitMs) sent = 0
  const resendsLeft = Math.max(0, rule.max - Math.max(1, sent))
  if (sent >= rule.max) return { waitMs: last + rule.waitMs - now, reason: 'limit', sent, resendsLeft: 0 }
  if (sent && now - last < rule.gapMs) return { waitMs: last + rule.gapMs - now, reason: 'gap', sent, resendsLeft }
  return { waitMs: 0, reason: null, sent, resendsLeft }
}

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
    // When the attempts for `key` within its window were made.
    async times(key, { windowMs }, now = Date.now()) {
      const col = await collection()
      const docs = await col.find({ key, at: { $gt: new Date(now - windowMs) } }, { projection: { at: 1 } }).toArray()
      return docs.map((doc) => doc.at)
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
