import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalEmail, sameEmailFilter } from '../utils/emails.js'

test('Gmail addresses that reach the same inbox share one canonical form', () => {
  assert.equal(canonicalEmail(' Eunice.Grace+booking@GMAIL.com '), 'eunicegrace@gmail.com')
  assert.equal(canonicalEmail('eunicegrace@googlemail.com'), 'eunicegrace@gmail.com')
  assert.equal(canonicalEmail('first.last+tag@example.com'), 'first.last+tag@example.com')
})

test('duplicate lookup also matches older accounts saved without emailCanonical', () => {
  const gmailClause = sameEmailFilter('eunicegrace@gmail.com').$or[2]
  const pattern = new RegExp(gmailClause.email.$regex, gmailClause.email.$options)
  assert.ok(pattern.test('eunice.grace@gmail.com'))
  assert.ok(pattern.test('EuniceGrace+promo@googlemail.com'))
  assert.ok(!pattern.test('eunicegrace2@gmail.com'))
})
