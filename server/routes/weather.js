import express from 'express'
import { getDb } from '../db/mongo.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { forecastForDate, isWeatherConfigured, locationCoords, sendAdvisory, sendWeatherAlerts, SLOT_HOURS } from '../utils/weather.js'

// Weather forecast for staff, manual advisories to booked players, and the advisory history.
const router = express.Router()
const STAFF = ['admin', 'registrar', 'marshal']

function actorOf(req) {
  return { actorId: String(req.user?.id || ''), actorEmail: req.user?.email || '', actorRole: req.user?.role || '' }
}

function sendError(res, err) {
  return res.status(err?.statusCode || 500).json({ ok: false, error: err?.statusCode ? err.message : String(err?.message || err) })
}

// GET /api/weather/forecast?location=salawag&date=YYYY-MM-DD — per-slot summary and severity.
router.get('/weather/forecast', requireAuth, requireRole(...STAFF), async (req, res) => {
  const locationId = String(req.query.location || '').toLowerCase()
  const date = String(req.query.date || '')
  if (!locationCoords(locationId)) return res.status(400).json({ ok: false, error: 'Choose a location.' })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ ok: false, error: 'date must be YYYY-MM-DD' })
  if (!isWeatherConfigured()) return res.json({ ok: true, configured: false, data: [] })
  try {
    return res.json({ ok: true, configured: true, data: await forecastForDate(locationId, date) })
  } catch (err) {
    return sendError(res, err)
  }
})

router.get('/weather-advisories', requireAuth, requireRole(...STAFF), async (_req, res) => {
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
  if (slot && !SLOT_HOURS[slot]) return res.status(400).json({ ok: false, error: 'slot must be morning, afternoon, or evening' })
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

// POST /api/weather-advisories/check — run tomorrow's automatic check now.
router.post('/weather-advisories/check', requireAuth, requireRole('admin'), async (_req, res) => {
  try {
    const db = await getDb()
    return res.json({ ok: true, data: await sendWeatherAlerts(db, { force: true }) })
  } catch (err) {
    return sendError(res, err)
  }
})

export default router
