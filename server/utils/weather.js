import axios from 'axios'
import { randomUUID } from 'crypto'
import { emailWeatherAdvisory } from '../services/notificationEmails.js'
import { notifyUser } from './paymentProgress.js'
import { manilaDateISO, playerIdsOf } from './reminders.js'

// Day-before weather advisories from the OpenWeatherMap 5-day / 3-hour forecast
// (OPENWEATHER_API_KEY). For every location with games tomorrow, each slot's
// forecast is checked; when it shows a thunderstorm, likely heavy rain, or strong
// wind, the booked players get an in-app notice and an email. Staff can also send
// a manual advisory for any date, location and slot.

export const ADVISORY_STATUSES = ['pending', 'needs review', 'confirmed', 'approved']

// Field coordinates. Override with WEATHER_COORDS_<LOCATION>="lat,lon".
const DEFAULT_COORDS = {
  salawag: { lat: 14.3260, lon: 120.9800, name: 'Delta Stronghold (Salawag)' },
  langkaan: { lat: 14.3070, lon: 120.9510, name: 'Delta Stronghold (Langkaan)' },
  binan: { lat: 14.3036, lon: 121.0781, name: 'LOMA Binan Laguna' },
}

// Manila-time hours each slot covers: [start, end).
export const SLOT_HOURS = { morning: [6, 12], afternoon: [12, 18], evening: [18, 23] }

export function locationCoords(locationId, env = process.env) {
  const base = DEFAULT_COORDS[locationId]
  if (!base) return null
  const override = String(env[`WEATHER_COORDS_${locationId.toUpperCase()}`] || '').split(',').map(Number)
  if (override.length === 2 && override.every(Number.isFinite)) return { ...base, lat: override[0], lon: override[1] }
  return base
}

function weatherConfig(env = process.env) {
  const pop = Number(env.WEATHER_RAIN_CHANCE_THRESHOLD)
  const rain = Number(env.WEATHER_RAIN_MM_THRESHOLD)
  const wind = Number(env.WEATHER_WIND_MS_THRESHOLD)
  return {
    apiKey: String(env.OPENWEATHER_API_KEY || '').trim(),
    // Chance of rain (0–1) and rain per 3 hours (mm) that together count as heavy rain.
    rainChance: Number.isFinite(pop) && pop > 0 ? Math.min(pop, 1) : 0.7,
    rainMm: Number.isFinite(rain) && rain >= 0 ? rain : 2.5,
    // Sustained wind (m/s); 17 m/s is gale force.
    windMs: Number.isFinite(wind) && wind > 0 ? wind : 17,
  }
}

export function isWeatherConfigured(env = process.env) {
  return Boolean(weatherConfig(env).apiKey)
}

// Manila date and hour of a forecast entry (Manila is UTC+8 with no daylight saving).
function manilaParts(unixSeconds) {
  const local = new Date(unixSeconds * 1000 + 8 * 3600_000)
  return { date: local.toISOString().slice(0, 10), hour: local.getUTCHours() }
}

// Summarizes the 3-hour forecast entries that overlap a slot, and whether they are severe.
export function summarizeSlotForecast(entries, date, slot, config = weatherConfig()) {
  const [start, end] = SLOT_HOURS[slot] || [0, 24]
  const inSlot = (entries || []).filter((entry) => {
    const { date: day, hour } = manilaParts(entry.dt)
    // A 3-hour block starting at `hour` overlaps [start, end) when it ends after start.
    return day === date && hour + 3 > start && hour < end
  })
  if (!inSlot.length) return { date, slot, available: false, severe: false, reasons: [], summary: 'No forecast yet for this slot.' }

  const maxChance = Math.max(...inSlot.map((e) => Number(e.pop) || 0))
  const maxRain = Math.max(...inSlot.map((e) => Number(e.rain?.['3h']) || 0))
  const maxWind = Math.max(...inSlot.map((e) => Number(e.wind?.speed) || 0))
  const maxTemp = Math.max(...inSlot.map((e) => Number(e.main?.temp) || 0))
  const thunder = inSlot.some((e) => (e.weather || []).some((w) => Number(w.id) >= 200 && Number(w.id) < 300))
  const descriptions = [...new Set(inSlot.flatMap((e) => (e.weather || []).map((w) => w.description)).filter(Boolean))]

  const reasons = []
  if (thunder) reasons.push('thunderstorms forecast')
  if (maxChance >= config.rainChance && maxRain >= config.rainMm) reasons.push(`heavy rain likely (${Math.round(maxChance * 100)}% chance, up to ${maxRain.toFixed(1)} mm per 3 hours)`)
  if (maxWind >= config.windMs) reasons.push(`strong wind up to ${Math.round(maxWind * 3.6)} km/h`)

  return {
    date,
    slot,
    available: true,
    severe: reasons.length > 0,
    reasons,
    rainChancePercent: Math.round(maxChance * 100),
    rainMm: Math.round(maxRain * 10) / 10,
    windKph: Math.round(maxWind * 3.6),
    tempC: Math.round(maxTemp),
    summary: `${descriptions.join(', ') || 'forecast'}; ${Math.round(maxChance * 100)}% chance of rain, up to ${Math.round(maxTemp)}°C`,
  }
}

const forecastCache = new Map()

export async function fetchForecast(locationId, { http = axios, env = process.env } = {}) {
  const config = weatherConfig(env)
  if (!config.apiKey) throw Object.assign(new Error('Weather is not set up. Add OPENWEATHER_API_KEY to the server environment.'), { statusCode: 503 })
  const coords = locationCoords(locationId, env)
  if (!coords) throw Object.assign(new Error('Unknown location'), { statusCode: 400 })

  const cached = forecastCache.get(locationId)
  if (cached && Date.now() - cached.at < 30 * 60_000) return cached.entries
  const response = await http.get('https://api.openweathermap.org/data/2.5/forecast', {
    params: { lat: coords.lat, lon: coords.lon, appid: config.apiKey, units: 'metric' },
    timeout: 10_000,
  })
  const entries = Array.isArray(response.data?.list) ? response.data.list : []
  forecastCache.set(locationId, { at: Date.now(), entries })
  return entries
}

export async function forecastForDate(locationId, date, options) {
  const entries = await fetchForecast(locationId, options)
  return Object.keys(SLOT_HOURS).map((slot) => summarizeSlotForecast(entries, date, slot, weatherConfig(options?.env)))
}

function slotReservationsFilter({ locationId, date, slot }) {
  return {
    $and: [
      { $or: [{ reservationDate: date }, { dateISO: date }] },
      ...(slot ? [{ $or: [{ reservationTime: slot }, { slot }] }] : []),
      { $or: [{ locationId }, { location: locationId }] },
    ],
    reservationStatus: { $in: ADVISORY_STATUSES },
  }
}

// Notifies everyone booked on the reservations and records the advisory.
export async function sendAdvisory(db, { locationId, date, slot, title, message, source, forecast, actor }) {
  const advisoryId = `WX-${randomUUID().slice(0, 8).toUpperCase()}`
  const reservations = await db.collection('reservations').find(slotReservationsFilter({ locationId, date, slot })).toArray()
  let recipients = 0
  for (const reservation of reservations) {
    const reservationSlot = reservation.reservationTime || reservation.slot
    for (const userId of playerIdsOf(reservation)) {
      await notifyUser(db, {
        userId,
        type: 'weather_advisory',
        title,
        message,
        linkedResourceId: reservation.id,
      })
      void emailWeatherAdvisory(db, reservation, userId, {
        key: source === 'auto' ? `weather:auto:${reservation.id}:${date}:${userId}` : `weather:${advisoryId}:${reservation.id}:${userId}`,
        title,
        message,
        slot: reservationSlot,
      })
      recipients += 1
    }
  }
  const record = {
    id: advisoryId,
    source,
    locationId,
    date,
    slot: slot || null,
    title,
    message,
    forecast: forecast || null,
    reservationCount: reservations.length,
    recipientCount: recipients,
    createdAtISO: new Date().toISOString(),
    createdBy: actor || null,
  }
  await db.collection('weather_advisories').insertOne(record)
  return record
}

let lastRun = 0

// Checks tomorrow's booked slots and sends one automatic advisory per location, date and slot.
export async function sendWeatherAlerts(db, { force = false, http, env = process.env } = {}) {
  if (!isWeatherConfigured(env)) return { skipped: 'not configured' }
  const now = Date.now()
  if (!force && now - lastRun < 50 * 60_000) return { skipped: 'recent' }
  lastRun = now

  const tomorrow = manilaDateISO(1)
  const booked = await db.collection('reservations').find(
    { reservationDate: tomorrow, reservationStatus: { $in: ADVISORY_STATUSES } },
    { projection: { locationId: 1, reservationTime: 1 } },
  ).toArray()
  const slotsByLocation = new Map()
  for (const reservation of booked) {
    const locationId = String(reservation.locationId || '')
    if (!locationCoords(locationId, env)) continue
    if (!slotsByLocation.has(locationId)) slotsByLocation.set(locationId, new Set())
    slotsByLocation.get(locationId).add(String(reservation.reservationTime || ''))
  }

  const sent = []
  for (const [locationId, slots] of slotsByLocation) {
    let entries
    try {
      entries = await fetchForecast(locationId, { http, env })
    } catch (err) {
      console.warn('Weather forecast failed for', locationId, err?.message || err)
      continue
    }
    for (const slot of slots) {
      if (!SLOT_HOURS[slot]) continue
      const forecast = summarizeSlotForecast(entries, tomorrow, slot, weatherConfig(env))
      if (!forecast.severe) continue
      // One automatic advisory per location/date/slot, even across restarts.
      const marker = await db.collection('weather_advisories').findOne({ source: 'auto', locationId, date: tomorrow, slot })
      if (marker) continue
      const name = locationCoords(locationId, env).name
      sent.push(await sendAdvisory(db, {
        locationId,
        date: tomorrow,
        slot,
        source: 'auto',
        forecast,
        title: `Weather advisory for your game tomorrow`,
        message: `The forecast for ${name} tomorrow (${slot}) shows ${forecast.reasons.join(' and ')}. We play rain or shine unless the marshals stop play for safety. If weather stops you from coming, contact us and staff can move your booking and payment to another date; payments are not refundable.`,
      }))
    }
  }
  return { checked: slotsByLocation.size, advisories: sent.length }
}
