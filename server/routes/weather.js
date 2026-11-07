import express from 'express'
import { getDb } from '../db/mongo.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { WEATHER_DAILY, WEATHER_OUTLOOK, forecastForDate, isWeatherConfigured, liveDailyForecast, locationCoords, refreshWeatherOutlook, sendAdvisory, sendWeatherAlerts } from '../utils/weather.js'
import { SLOT_HOURS_ID, SLOT_ORDER, getSlotHours, validateSlotHours } from '../utils/slotHours.js'
import { manilaDateISO } from '../utils/reminders.js'

// Game slot hours, the weather forecast for staff, manual advisories to booked players,
// and the advisory history.
const router = express.Router()
const STAFF = ['admin', 'registrar', 'marshal']

function actorOf(req) {
  return { actorId: String(req.user?.id || ''), actorEmail: req.user?.email || '', actorRole: req.user?.role || '' }
}

function sendError(res, err) {
  return res.status(err?.statusCode || 500).json({ ok: false, error: err?.statusCode ? err.message : String(err?.message || err) })
}

// GET /api/slot-hours — public: the booking pages and landing page show these times.
router.get('/slot-hours', async (_req, res) => {
  try {
    const db = await getDb()
    return res.json({ ok: true, data: await getSlotHours(db) })
  } catch (err) {
    return sendError(res, err)
  }
})

// PUT /api/slot-hours { morning: { start, end }, afternoon: {...}, evening: {...} } — HH:MM, 24-hour.
router.put('/slot-hours', requireAuth, requireRole('admin'), async (req, res) => {
  const checked = validateSlotHours(req.body || {})
  if (checked.error) return res.status(400).json({ ok: false, error: checked.error })
  try {
    const db = await getDb()
    const previous = await getSlotHours(db)
    const nowISO = new Date().toISOString()
    await db.collection('settings').updateOne(
      { _id: SLOT_HOURS_ID },
      {
        $set: { hours: checked.hours, updatedAtISO: nowISO, updatedBy: actorOf(req) },
        $push: { history: { from: previous.hours, to: checked.hours, atISO: nowISO, ...actorOf(req) } },
      },
      { upsert: true },
    )
    return res.json({ ok: true, data: await getSlotHours(db) })
  } catch (err) {
    return sendError(res, err)
  }
})

// GET /api/weather/forecast?location=salawag&date=YYYY-MM-DD — per-slot summary and severity.
router.get('/weather/forecast', requireAuth, requireRole(...STAFF), async (req, res) => {
  const locationId = String(req.query.location || '').toLowerCase()
  const date = String(req.query.date || '')
  if (!locationCoords(locationId)) return res.status(400).json({ ok: false, error: 'Choose a location.' })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ ok: false, error: 'date must be YYYY-MM-DD' })
  if (!isWeatherConfigured()) return res.json({ ok: true, configured: false, data: [] })
  try {
    return res.json({ ok: true, configured: true, data: await forecastForDate(await getDb(), locationId, date) })
  } catch (err) {
    return sendError(res, err)
  }
})

// GET /api/weather-advisories/current — every signed-in account: advisories for today and later
// (the latest one per location, date and slot), for the dashboard weather widget. `mine` marks
// advisories for a game the viewer is booked on. Sender and recipient details stay staff-only.
router.get('/weather-advisories/current', requireAuth, async (req, res) => {
  try {
    const db = await getDb()
    const today = manilaDateISO(0)
    const dates = Array.from({ length: 6 }, (_, i) => manilaDateISO(i))
    const [docs, outlook, savedDaily, live] = await Promise.all([
      db.collection('weather_advisories').find({ date: { $gte: today } }).sort({ createdAtISO: -1 }).limit(50).toArray(),
      db.collection(WEATHER_OUTLOOK).find({ date: { $gte: today } }).sort({ date: 1 }).limit(100).toArray(),
      db.collection(WEATHER_DAILY).find({ date: { $gte: today } }).sort({ date: 1 }).limit(50).toArray(),
      liveDailyForecast(db, dates).catch(() => []),
    ])
    // The daily forecast for every field and day, rainy or not: live from the API, with the
    // last saved reading for any field the API couldn't return just now.
    const nowISO = new Date().toISOString()
    const liveKeys = new Set(live.map((d) => `${d.locationId}|${d.date}`))
    const dailyDocs = [
      ...live.map((d) => ({ ...d, updatedAtISO: nowISO })),
      ...savedDaily.filter((d) => !liveKeys.has(`${d.locationId}|${d.date}`)),
    ].sort((a, b) => a.date.localeCompare(b.date))
    const forecast = dailyDocs.map((d) => ({
      locationId: d.locationId,
      locationName: locationCoords(d.locationId)?.name || d.locationId,
      date: d.date,
      slots: Array.isArray(d.slots) ? d.slots : [],
      updatedAtISO: d.updatedAtISO,
    }))
    // Latest hourly API reading per location, date and slot.
    const liveSlot = new Map()
    for (const d of dailyDocs) {
      for (const s of Array.isArray(d.slots) ? d.slots : []) liveSlot.set(`${d.locationId}|${d.date}|${s.slot}`, s)
    }
    const latest = new Map()
    for (const doc of docs) {
      const key = `${doc.locationId}|${doc.date}|${doc.slot || ''}`
      // An automatic advisory is a snapshot of an older forecast. Once the latest forecast for
      // that slot no longer shows rain, storms or strong wind, it is out of date and not shown.
      // Advisories sent by staff are always shown.
      const live = doc.source === 'auto' && doc.slot ? liveSlot.get(key) : null
      if (live && !live.rainy && !live.severe) continue
      if (!latest.has(key)) latest.set(key, doc)
    }
    // The automatic forecast outlook fills in every other rainy slot. An advisory already sent
    // for the same slot (or the whole day) takes its place.
    for (const doc of outlook) {
      const key = `${doc.locationId}|${doc.date}|${doc.slot}`
      if (latest.has(key) || latest.has(`${doc.locationId}|${doc.date}|`)) continue
      const current = liveSlot.get(key)
      if (current && !current.rainy && !current.severe) continue
      latest.set(key, { ...doc, id: `FC-${String(doc._id)}`, source: 'forecast', createdAtISO: doc.updatedAtISO })
    }
    const advisories = [...latest.values()]

    const userId = String(req.user?.id || '')
    const booked = new Set()
    if (userId && advisories.length) {
      const reservations = await db.collection('reservations').find(
        { reservationDate: { $in: [...new Set(advisories.map((a) => a.date))] }, $or: [{ userId }, { 'teamMembers.id': userId }] },
        { projection: { locationId: 1, reservationDate: 1, reservationTime: 1, reservationStatus: 1 } },
      ).toArray()
      for (const r of reservations) {
        if (/cancel|reject|declin/i.test(String(r.reservationStatus || ''))) continue
        booked.add(`${String(r.locationId || '').toLowerCase()}|${r.reservationDate}|${String(r.reservationTime || '').toLowerCase()}`)
      }
    }

    const data = advisories
      .map((a) => ({
        id: a.id,
        source: a.source,
        locationId: a.locationId,
        locationName: locationCoords(a.locationId)?.name || a.locationId,
        date: a.date,
        slot: a.slot || null,
        title: a.title || 'Weather advisory',
        message: a.message,
        createdAtISO: a.createdAtISO,
        mine: a.slot
          ? booked.has(`${a.locationId}|${a.date}|${a.slot}`)
          : [...booked].some((key) => key.startsWith(`${a.locationId}|${a.date}|`)),
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || SLOT_ORDER.indexOf(a.slot || '') - SLOT_ORDER.indexOf(b.slot || ''))
    return res.json({ ok: true, data, forecast })
  } catch (err) {
    return sendError(res, err)
  }
})

router.get('/weather-advisories',requireAuth, requireRole(...STAFF), async (_req, res) => {
  try {
    const db = await getDb()
    const data = await db.collection('weather_advisories').find({}).sort({ createdAtISO: -1 }).limit(100).toArray()
    return res.json({ ok: true, configured: isWeatherConfigured(), data })
  } catch (err) {
    return sendError(res, err)
  }
})

// POST /api/weather-advisories { locationId, date, slot?, message } — in-app notice and email to
// everyone booked on that date and location (one slot, or all slots when none is given).
router.post('/weather-advisories', requireAuth, requireRole('admin', 'registrar'), async (req, res) => {
  const body = req.body || {}
  const locationId = String(body.locationId || '').toLowerCase()
  const date = String(body.date || '')
  const slot = String(body.slot || '').toLowerCase()
  const message = String(body.message || '').trim().slice(0, 1000)
  if (!locationCoords(locationId)) return res.status(400).json({ ok: false, error: 'Choose a location.' })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ ok: false, error: 'date must be YYYY-MM-DD' })
  if (slot && !SLOT_ORDER.includes(slot)) return res.status(400).json({ ok: false, error: 'slot must be morning, afternoon, or evening' })
  if (message.length < 10) return res.status(400).json({ ok: false, error: 'Write the advisory message (at least 10 characters).' })
  try {
    const db = await getDb()
    const record = await sendAdvisory(db, {
      locationId,
      date,
      slot: slot || null,
      source: 'manual',
      title: 'Weather advisory for your game',
      message,
      actor: actorOf(req),
    })
    return res.status(201).json({ ok: true, data: record })
  } catch (err) {
    return sendError(res, err)
  }
})

// POST /api/weather-advisories/check — refresh the 5-day outlook and run tomorrow's automatic check now.
router.post('/weather-advisories/check', requireAuth, requireRole('admin'), async (_req, res) => {
  try {
    const db = await getDb()
    const outlook = await refreshWeatherOutlook(db, { force: true })
    return res.json({ ok: true, data: { ...(await sendWeatherAlerts(db, { force: true })), outlook } })
  } catch (err) {
    return sendError(res, err)
  }
})

export default router
