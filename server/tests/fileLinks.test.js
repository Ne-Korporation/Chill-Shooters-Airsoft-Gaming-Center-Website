import test from 'node:test'
import assert from 'node:assert/strict'
import { signFileLink, signFileLinksIn, unsignedFileLink, verifyFileLink } from '../utils/fileLinks.js'

const ID = '0f8e2a4c-1b3d-4e5f-8a9b-0c1d2e3f4a5b'
const params = (query) => Object.fromEntries(new URLSearchParams(query))

test('a signed link opens until it expires, and only for its own file', () => {
  const now = Date.UTC(2026, 10, 20, 10, 15)
  const { exp, sig } = params(signFileLink(ID, now))
  assert.equal(verifyFileLink(ID, exp, sig, now), true)
  // Still good within the hour after, expired two hours later.
  assert.equal(verifyFileLink(ID, exp, sig, now + 60 * 60 * 1000), true)
  assert.equal(verifyFileLink(ID, exp, sig, now + 3 * 60 * 60 * 1000), false)
  // Another file, a changed expiry, or no signature: refused.
  assert.equal(verifyFileLink('11111111-2222-4333-8444-555555555555', exp, sig, now), false)
  assert.equal(verifyFileLink(ID, String(Number(exp) + 3600000), sig, now), false)
  assert.equal(verifyFileLink(ID, exp, '', now), false)
})

test('every file link in a response is signed, replacing an old signature', () => {
  const now = Date.UTC(2026, 10, 20, 10, 15)
  const body = {
    data: [
      { identityDocumentUrl: `https://api.example.com/api/files/${ID}`, name: 'Chloe' },
      { profileImageUrl: `https://api.example.com/api/files/${ID}?exp=1&sig=old`, other: 'https://cdn.example.com/x.png' },
    ],
  }
  const signed = signFileLinksIn(body, now)
  const first = new URL(signed.data[0].identityDocumentUrl)
  assert.equal(verifyFileLink(ID, first.searchParams.get('exp'), first.searchParams.get('sig'), now), true)
  assert.equal(signed.data[1].profileImageUrl, signed.data[0].identityDocumentUrl)
  assert.equal(signed.data[1].other, 'https://cdn.example.com/x.png')
  assert.equal(signed.data[0].name, 'Chloe')
})

test('signed links sent back are stored bare', () => {
  assert.equal(unsignedFileLink(`https://api.example.com/api/files/${ID}?exp=123&sig=abc`), `https://api.example.com/api/files/${ID}`)
})
