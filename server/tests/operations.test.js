import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateFpsReading, getFpsLimits } from '../routes/operations.js'
import { nextShortId } from '../utils/shortIds.js'

test('FPS readings pass at the limit and fail above it for each weapon class', () => {
  const limits = { aeg: 450, sniper: 550 }
  assert.deepEqual(evaluateFpsReading('aeg', 450, limits), { limit: 450, result: 'pass' })
  assert.deepEqual(evaluateFpsReading('aeg', 451, limits), { limit: 450, result: 'fail' })
  assert.deepEqual(evaluateFpsReading('sniper', 550, limits), { limit: 550, result: 'pass' })
  assert.deepEqual(evaluateFpsReading('sniper', 551, limits), { limit: 550, result: 'fail' })
})

test('FPS limits default to the approved ceilings and accept overrides', () => {
  assert.deepEqual(getFpsLimits({}), { aeg: 450, sniper: 550 })
  assert.deepEqual(getFpsLimits({ FPS_LIMIT_AEG: '400', FPS_LIMIT_SNIPER: '500' }), { aeg: 400, sniper: 500 })
  assert.deepEqual(getFpsLimits({ FPS_LIMIT_AEG: 'bad', FPS_LIMIT_SNIPER: '-1' }), { aeg: 450, sniper: 550 })
})

function fakeDb(ids) {
  return {
    collection: () => ({
      find: (filter) => {
        const pattern = new RegExp(filter.id.$regex)
        let matches = ids.filter((id) => pattern.test(id))
        return {
          sort: () => {
            matches = matches.sort().reverse()
            return { limit: (n) => ({ toArray: async () => matches.slice(0, n).map((id) => ({ id })) }) }
          },
        }
      },
      countDocuments: async () => ids.length,
    }),
  }
}

test('short ids continue after the highest existing id even when documents were deleted', async () => {
  // P-000002 was deleted: count is 2, but P-000003 is taken
  assert.equal(await nextShortId(fakeDb(['P-000001', 'P-000003']), 'user_accounts', 'P'), 'P-000004')
})

test('short ids ignore other id formats and start at 1 for an empty collection', async () => {
  assert.equal(await nextShortId(fakeDb([]), 'gameplay', 'GP'), 'GP-000001')
  assert.equal(await nextShortId(fakeDb(['P-ADMIN-0001', 'P-000005']), 'user_accounts', 'P'), 'P-000006')
})
