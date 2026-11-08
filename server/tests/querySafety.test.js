import test from 'node:test'
import assert from 'node:assert/strict'
import { blockedWriteFields, checkQueryFilter, dropIdFields, safeSort, secretAccountProjection, stripAccountSecrets } from '../utils/querySafety.js'

test('ordinary app filters pass', () => {
  assert.equal(checkQueryFilter({ userId: 'u1', archived: { $ne: true } }), '')
  assert.equal(checkQueryFilter({ $or: [{ status: { $in: ['pending', 'review'] } }, { name: { $regex: 'ann', $options: 'i' } }] }), '')
  assert.equal(checkQueryFilter({ createdAtISO: { $gte: '2026-01-01', $lt: '2026-02-01' } }), '')
})

test('code-running and field-comparing operators are refused', () => {
  assert.match(checkQueryFilter({ $where: 'sleep(5000)' }), /\$where/)
  assert.match(checkQueryFilter({ $expr: { $eq: ['$role', 'admin'] } }), /\$expr/)
  assert.match(checkQueryFilter({ a: { $function: { body: 'x', args: [], lang: 'js' } } }), /\$function/)
  assert.match(checkQueryFilter({ $and: [{ ok: 1 }, { $where: '1' }] }), /\$where/)
})

test('secret account fields cannot be searched (no guessing a code or hash letter by letter)', () => {
  assert.notEqual(checkQueryFilter({ email: 'a@b.c', otpCode: { $regex: '^1' } }), '')
  assert.notEqual(checkQueryFilter({ password: { $exists: true } }), '')
  assert.notEqual(checkQueryFilter({ $or: [{ resetTokenHash: 'x' }] }), '')
  assert.notEqual(checkQueryFilter({ 'password.0': 'x' }), '')
})

test('very long regexes and very deep filters are refused', () => {
  assert.notEqual(checkQueryFilter({ name: { $regex: 'a'.repeat(500) } }), '')
  let deep = { x: 1 }
  for (let i = 0; i < 20; i += 1) deep = { $and: [deep] }
  assert.notEqual(checkQueryFilter(deep), '')
})

test('sorting by a secret field is dropped', () => {
  assert.deepEqual(safeSort({ password: 1, createdAtISO: -1 }), { createdAtISO: -1 })
})

test('secrets are hidden from account answers', () => {
  const doc = stripAccountSecrets({ id: 'u1', name: 'A', password: 'hash', otpCode: '123456', unlockTokenHash: 'h', guardianConfirmToken: 't' })
  assert.deepEqual(doc, { id: 'u1', name: 'A' })
  const projection = secretAccountProjection()
  assert.equal(projection.password, 0)
  assert.equal(projection.resetCodeHash, 0)
})

test('updates may not write secret fields, in any shape', () => {
  assert.deepEqual(blockedWriteFields({ name: 'A' }), [])
  assert.deepEqual(blockedWriteFields({ password: 'x' }), ['password'])
  assert.deepEqual(blockedWriteFields({ $set: { otpCode: '1' } }), ['otpCode'])
  assert.deepEqual(blockedWriteFields({ $unset: { sessionsValidAfterISO: '' } }), ['sessionsValidAfterISO'])
})

test('a record sent back whole loses its _id instead of failing', () => {
  assert.deepEqual(dropIdFields({ _id: 'x', name: 'A' }), { name: 'A' })
  assert.deepEqual(dropIdFields({ $set: { _id: 'x', name: 'A' } }), { $set: { name: 'A' } })
})
