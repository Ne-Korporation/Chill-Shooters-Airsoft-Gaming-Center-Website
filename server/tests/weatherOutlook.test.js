import test from 'node:test'
import assert from 'node:assert/strict'
import { WEATHER_DAILY, WEATHER_OUTLOOK, refreshWeatherOutlook } from '../utils/weather.js'
import { manilaDateISO } from '../utils/reminders.js'

// Minimal in-memory stand-in for the two collections the outlook touches.
function fakeDb(initial = []) {
  const docs = new Map(initial.map((d) => [d._id, d]))
  const matches = (doc, filter) => Object.entries(filter).every(([key, cond]) => {
    const value = doc[key]
    if (cond && typeof cond === 'object') {
      if ('$nin' in cond) return !cond.$nin.includes(value)
      if ('$lt' in cond) return value < cond.$lt
    }
    return value === cond
  })
  const outlook = {
    docs,
    async updateOne({ _id }, { $set, $setOnInsert }) {
      docs.set(_id, { ...(docs.get(_id) || { _id, ...$setOnInsert }), ...$set })
    },
    async deleteMany(filter) {
      for (const [id, doc] of docs) if (matches(doc, filter)) docs.delete(id)
    },
  }
  const dailyDocs = new Map()
  const daily = {
    docs: dailyDocs,
    async updateOne({ _id }, { $set }) {
      dailyDocs.set(_id, { _id, ...$set })
    },
    async deleteMany(filter) {
      for (const [id, doc] of dailyDocs) if (matches(doc, filter)) dailyDocs.delete(id)
    },
  }
  const settings = { async findOne() { return null } }
  return { outlook, daily, collection: (name) => (name === WEATHER_OUTLOOK ? outlook : name === WEATHER_DAILY ? daily : settings) }
}

// Forecast entries for tomorrow afternoon: a thunderstorm in Salawag only.
function http(stormyLat) {
  return {
    async get(_url, { params }) {
      const date = manilaDateISO(1)
      const dt = Date.parse(`${date}T14:00:00+08:00`) / 1000
      const stormy = params.lat === stormyLat
      return { data: { list: [{ dt, pop: stormy ? 0.9 : 0, wind: { speed: 3 }, main: { temp: 29 }, weather: [{ id: stormy ? 211 : 800, description: stormy ? 'thunderstorm' : 'clear sky' }] }] } }
    },
  }
}

test('flags stormy slots for every field and clears old ones', async () => {
  const tomorrow = manilaDateISO(1)
  const db = fakeDb([
    { _id: `binan|${tomorrow}|afternoon`, locationId: 'binan', date: tomorrow, slot: 'afternoon' },
    { _id: 'salawag|2000-01-01|morning', locationId: 'salawag', date: '2000-01-01', slot: 'morning' },
  ])
  const env = { OPENWEATHER_API_KEY: 'test' }
  const result = await refreshWeatherOutlook(db, { force: true, http: http(14.3260), env })
  assert.equal(result.flagged, 1)
  const ids = [...db.outlook.docs.keys()]
  assert.deepEqual(ids, [`salawag|${tomorrow}|afternoon`])
  const doc = db.outlook.docs.get(ids[0])
  assert.equal(doc.severe, true)
  assert.match(doc.message, /Chill Shooters \(Salawag\) \(afternoon\): thunderstorms forecast\. We play rain or shine\./)
})

test('keeps the daily forecast for every field, rainy or not', async () => {
  const tomorrow = manilaDateISO(1)
  const db = fakeDb()
  await refreshWeatherOutlook(db, { force: true, http: http(14.3260), env: { OPENWEATHER_API_KEY: 'test' } })
  const binan = db.daily.docs.get(`binan|${tomorrow}`)
  assert.ok(binan, 'clear-sky field still has a daily forecast')
  assert.equal(binan.slots[0].slot, 'afternoon')
  assert.equal(binan.slots[0].rainy, false)
  assert.equal(db.daily.docs.get(`salawag|${tomorrow}`).slots[0].severe, true)
})

test('does nothing without an API key', async () => {
  const result = await refreshWeatherOutlook(fakeDb(), { force: true, env: {} })
  assert.deepEqual(result, { skipped: 'not configured' })
})
