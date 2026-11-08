import test from 'node:test'
import assert from 'node:assert/strict'
import { WEATHER_DAILY, WEATHER_OUTLOOK, clearForecastCache, refreshWeatherOutlook } from '../utils/weather.js'
import { manilaDateISO } from '../utils/reminders.js'

// Minimal in-memory stand-in for the two collections the outlook touches.
function fakeDb(initial = [], reservationRows = []) {
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
  const reservations = {
    rows: reservationRows,
    find() { return { toArray: async () => reservations.rows } },
  }
  const notices = []
  const notifications = {
    docs: notices,
    find() {
      const chain = { sort: () => chain, limit: () => chain, toArray: async () => [] }
      return chain
    },
    async countDocuments() { return notices.length },
    async insertOne(doc) { notices.push(doc) },
    async findOne(filter) { return notices.find((n) => matches(n, filter)) || null },
    async updateOne(filter, { $set }) {
      const doc = notices.find((n) => matches(n, filter))
      if (doc) Object.assign(doc, $set)
    },
    async deleteMany(filter) {
      for (let i = notices.length - 1; i >= 0; i -= 1) {
        if (Object.keys(filter).every((k) => k in notices[i]) && matches(notices[i], filter)) notices.splice(i, 1)
      }
    },
  }
  const byName = { [WEATHER_OUTLOOK]: outlook, [WEATHER_DAILY]: daily, reservations, notifications }
  return { outlook, daily, reservations, notifications, collection: (name) => byName[name] || settings }
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

test('notifies booked players of a stormy slot and keeps the notice in line with the forecast', async () => {
  const tomorrow = manilaDateISO(1)
  const env = { OPENWEATHER_API_KEY: 'test' }
  const booking = { id: 'R-1', userId: 'U1', teamMembers: [{ id: 'U2' }], locationId: 'salawag', reservationDate: tomorrow, reservationTime: 'afternoon', reservationStatus: 'confirmed' }
  const db = fakeDb([], [
    booking,
    // Clear field, and a cancelled booking on the stormy one: no notice for either.
    { id: 'R-2', userId: 'U3', locationId: 'binan', reservationDate: tomorrow, reservationTime: 'afternoon', reservationStatus: 'confirmed' },
    { id: 'R-3', userId: 'U4', locationId: 'salawag', reservationDate: tomorrow, reservationTime: 'afternoon', reservationStatus: 'cancelled' },
  ])

  await refreshWeatherOutlook(db, { force: true, http: http(14.3260), env })
  assert.deepEqual(db.notifications.docs.map((n) => n.userId).sort(), ['U1', 'U2'])
  const notice = db.notifications.docs[0]
  assert.equal(notice.type, 'weather_advisory')
  assert.equal(notice.linkedResourceId, 'R-1')
  assert.match(notice.message, /^Your afternoon game at Chill Shooters \(Salawag\) on .+: thunderstorms forecast\. We play rain or shine\.$/)

  // A second run with the same forecast adds nothing.
  await refreshWeatherOutlook(db, { force: true, http: http(14.3260), env })
  assert.equal(db.notifications.docs.length, 2)

  // The storm moves to Biñan: the Salawag notices are removed.
  clearForecastCache()
  await refreshWeatherOutlook(db, { force: true, http: http(14.3036), env })
  assert.deepEqual(db.notifications.docs.map((n) => n.userId), ['U3'])
})

test('does nothing without an API key', async () => {
  const result = await refreshWeatherOutlook(fakeDb(), { force: true, env: {} })
  assert.deepEqual(result, { skipped: 'not configured' })
})
