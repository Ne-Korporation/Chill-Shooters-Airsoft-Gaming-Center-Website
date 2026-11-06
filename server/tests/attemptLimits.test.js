import test from 'node:test'
import assert from 'node:assert/strict'
import { LIMITS, codeAddressKey, createAttemptStore, loginKeys, minutesLeft } from '../utils/attemptLimits.js'

// Just enough of a MongoDB collection for the attempt store.
function fakeCollection() {
  let nextId = 1
  const docs = []
  return {
    docs,
    async createIndex() {},
    async countDocuments({ key, at }) {
      return docs.filter((d) => d.key === key && d.at > at.$gt).length
    },
    async insertMany(list) {
      const insertedIds = {}
      list.forEach((doc, i) => { const _id = nextId++; docs.push({ ...doc, _id }); insertedIds[i] = _id })
      return { insertedIds }
    },
    async deleteMany(filter) {
      const drop = filter._id ? (d) => filter._id.$in.includes(d._id) : (d) => d.account === filter.account
      for (let i = docs.length - 1; i >= 0; i -= 1) if (drop(docs[i])) docs.splice(i, 1)
    },
  }
}

const NOW = Date.parse('2026-11-07T10:00:00Z')

test('login keys separate this email from this address, the address, and the email', () => {
  assert.deepEqual(loginKeys('a@b.co', '1.2.3.4'), {
    pair: 'login:pair:a@b.co:1.2.3.4',
    address: 'login:address:1.2.3.4',
    account: 'login:account:a@b.co',
  })
  assert.equal(codeAddressKey('1.2.3.4'), 'code:address:1.2.3.4')
})

test('attempts are counted within their window and expire with it', async () => {
  const col = fakeCollection()
  const store = createAttemptStore(async () => col)
  const limit = { windowMs: 1000 }
  await store.record([{ key: 'k', limit }], NOW)
  await store.record([{ key: 'k', limit }], NOW + 500)
  assert.equal(await store.count('k', limit, NOW + 600), 2)
  assert.equal(await store.count('k', limit, NOW + 1200), 1)
  assert.equal(col.docs[0].expireAt.getTime(), NOW + 1000)
})

test('a successful attempt is given back, and the owner can clear their counts', async () => {
  const col = fakeCollection()
  const store = createAttemptStore(async () => col)
  const keys = loginKeys('a@b.co', '1.2.3.4')
  const entries = [
    { key: keys.pair, limit: LIMITS.loginPair, account: 'a@b.co' },
    { key: keys.address, limit: LIMITS.loginAddress },
    { key: keys.account, limit: LIMITS.loginAccount, account: 'a@b.co' },
  ]
  await store.record(entries, NOW)
  const ids = await store.record(entries, NOW + 1)
  await store.forgive(ids)
  assert.equal(await store.count(keys.pair, LIMITS.loginPair, NOW + 2), 1)

  await store.clearAccount('a@b.co')
  assert.equal(await store.count(keys.pair, LIMITS.loginPair, NOW + 2), 0)
  assert.equal(await store.count(keys.account, LIMITS.loginAccount, NOW + 2), 0)
  // The address count isn't tied to the account, so it stays.
  assert.equal(await store.count(keys.address, LIMITS.loginAddress, NOW + 2), 1)
})

test('one stranger guessing does not touch the owner from another address', async () => {
  const col = fakeCollection()
  const store = createAttemptStore(async () => col)
  const stranger = loginKeys('a@b.co', '6.6.6.6')
  const owner = loginKeys('a@b.co', '1.2.3.4')
  for (let n = 0; n < LIMITS.loginPair.max + 1; n += 1) {
    await store.record([{ key: stranger.pair, limit: LIMITS.loginPair, account: 'a@b.co' }], NOW + n)
  }
  assert.ok(await store.count(stranger.pair, LIMITS.loginPair, NOW + 10) > LIMITS.loginPair.max)
  assert.equal(await store.count(owner.pair, LIMITS.loginPair, NOW + 10), 0)
})

test('minutes left rounds up', () => {
  assert.equal(minutesLeft(NOW + 61 * 1000, NOW), 2)
  assert.equal(minutesLeft(NOW, NOW), 1)
})
