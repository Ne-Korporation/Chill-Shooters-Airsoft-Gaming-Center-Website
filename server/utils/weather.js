import axios from 'axios'
import { randomUUID } from 'crypto'
import { emailWeatherAdvisory } from '../services/notificationEmails.js'
import { notifyUser } from './paymentProgress.js'
import { manilaDateISO, playerIdsOf } from './reminders.js'
import { DEFAULT_SLOT_HOURS, SLOT_ORDER, getSlotHours, slotHasStarted, slotWindow } from './slotHours.js'

// Day-before weather advisories from the OpenWeatherMap 5-day / 3-hour forecast
// (OPENWEATHER_API_KEY). For every location with games tomorrow, each slot's
// forecast is checked; when it shows rain is likely, a thunderstorm, or strong
// wind, the booked players get an in-app notice and an email. Staff can also send
// a manual advisory for any date, location and slot.

export const ADVISORY_STATUSES = ['pending', 'needs review', 'confirmed', 'approved']

// Field coordinates. Override with WEATHER_COORDS_<LOCATION>="lat,lon".
const DEFAULT_COORDS = {
  salawag: { lat: 14.3260, lon: 120.9800, name: 'Chill Shooters (Salawag)' },
  langkaan: { lat: 14.3070, lon: 120.9510, name: 'Chill Shooters (Langkaan)' },
  binan: { lat: 14.3036, lon: 121.0781, name: 'BBC Airsoft Binan Laguna' },
}


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
  const rainy = Number(env.WEATHER_RAINY_CHANCE_THRESHOLD)
  return {
    apiKey: String(env.OPENWEATHER_API_KEY || '').trim(),
    // Chance of rain (0–1) and rain per 3 hours (mm) that together count as heavy rain.
    rainChance: Number.isFinite(pop) && pop > 0 ? Math.min(pop, 1) : 0.7,
    rainMm: Number.isFinite(rain) && rain >= 0 ? rain : 2.5,
    // Chance of rain (0–1) at which a slot counts as rainy, even when the rain is light.
    rainyChance: Number.isFinite(rainy) && rainy > 0 ? Math.min(rainy, 1) : 0.6,
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
// `hours` is the slot-hours setting (utils/slotHours.js).
export function summarizeSlotForecast(entries, date, slot, config = weatherConfig(), hours = DEFAULT_SLOT_HOURS) {
  const [start, end] = slotWindow(hours, slot)
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

  // Rain or drizzle (OpenWeather condition codes 3xx and 5xx) in any of the slot's blocks.
  const wet = maxRain > 0 || inSlot.some((e) => (e.weather || []).some((w) => Number(w.id) >= 300 && Number(w.id) < 600))
  const heavy = maxChance >= config.rainChance && maxRain >= config.rainMm

  const reasons = []
  if (thunder) reasons.push('thunderstorms forecast')
  if (heavy) reasons.push(`heavy rain likely (${Math.round(maxChance * 100)}% chance, up to ${maxRain.toFixed(1)} mm per 3 hours)`)
  if (maxWind >= config.windMs) reasons.push(`strong wind up to ${Math.round(maxWind * 3.6)} km/h`)
  const severe = reasons.length > 0
  // Light rain is not severe, but booked players are still told about it the day before.
  const lightRain = !heavy && wet && maxChance >= (config.rainyChance ?? 0.6)
  if (lightRain) reasons.push(`rain likely (${Math.round(maxChance * 100)}% chance)`)

  return {
    date,
    slot,
    available: true,
    severe,
    rainy: heavy || lightRain,
    reasons,
    rainChancePercent: Math.round(maxChance * 100),
    rainMm: Math.round(maxRain * 10) / 10,
    windKph: Math.round(maxWind * 3.6),
    tempC: Math.round(maxTemp),
    summary: `${descriptions.join(', ') || 'forecast'}; ${Math.round(maxChance * 100)}% chance of rain, up to ${Math.round(maxTemp)}°C`,
  }
}

const forecastCache = new Map()
// For tests: forget cached forecasts so the next fetch hits the (fake) API.
export const clearForecastCache = () => forecastCache.clear()

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

export async function forecastForDate(db, locationId, date, options) {
  const [entries, { hours }] = await Promise.all([fetchForecast(locationId, options), getSlotHours(db)])
  return SLOT_ORDER.map((slot) => ({
    ...summarizeSlotForecast(entries, date, slot, weatherConfig(options?.env), hours),
    hours: hours[slot],
  }))
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
      // Automatic advisories are email only: the in-app notice comes from the hourly forecast
      // check (refreshWeatherOutlook), which keeps it in line with the latest forecast.
      if (source !== 'auto') {
        await notifyUser(db, {
          userId,
          type: 'weather_advisory',
          title,
          message,
          linkedResourceId: reservation.id,
        })
      }
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
  const { hours } = await getSlotHours(db)
  for (const [locationId, slots] of slotsByLocation) {
    let entries
    try {
      entries = await fetchForecast(locationId, { http, env })
    } catch (err) {
      console.warn('Weather forecast failed for', locationId, err?.message || err)
      continue
    }
    for (const slot of slots) {
      if (!SLOT_ORDER.includes(slot)) continue
      const forecast = summarizeSlotForecast(entries, tomorrow, slot, weatherConfig(env), hours)
      if (!forecast.severe && !forecast.rainy) continue
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
        message: `The forecast for ${name} tomorrow (${slot}) shows ${forecast.reasons.join(' and ')}. We play rain or shine.`,
      }))
    }
  }
  return { checked: slotsByLocation.size, advisories: sent.length }
}

// ---- Automatic forecast outlook ---------------------------------------------------------------
// Every hour the 5-day forecast for every field is checked. Each slot that looks rainy, stormy, or
// windy is kept in `weather_outlook` (one record per location, date and slot) and shown to every
// account on the dashboard weather widget. Slots that clear up are removed, so the outlook always
// matches the latest forecast. Players booked on a flagged slot get one in-app notification for
// it, which is rewritten when the forecast changes and removed once the slot clears up, starts, or
// the booking is cancelled. The day-before email still comes from sendWeatherAlerts.

export const WEATHER_OUTLOOK = 'weather_outlook'
// The full daily forecast (every slot, rainy or not), one record per location and date, so the
// dashboard widget can show the forecast for every day and not only the rainy ones.
export const WEATHER_DAILY = 'weather_daily'
const OUTLOOK_DAYS = 5

// The fields of a slot summary shown to every account.
function publicSlotForecast(forecast, hours) {
  return {
    slot: forecast.slot,
    hours: hours[forecast.slot] || null,
    severe: forecast.severe,
    rainy: Boolean(forecast.rainy),
    summary: forecast.summary,
    rainChancePercent: forecast.rainChancePercent,
    rainMm: forecast.rainMm,
    windKph: forecast.windKph,
    tempC: forecast.tempC,
  }
}

// The daily forecast for every field and date, straight from the API (cached 30 minutes by
// fetchForecast). Fields whose forecast can't be fetched are left out.
export async function liveDailyForecast(db, dates, { http, env = process.env } = {}) {
  if (!isWeatherConfigured(env)) return []
  const { hours } = await getSlotHours(db)
  const results = await Promise.all(Object.keys(DEFAULT_COORDS).map(async (locationId) => {
    let entries
    try {
      entries = await fetchForecast(locationId, { http, env })
    } catch (err) {
      console.warn('Weather forecast failed for', locationId, err?.message || err)
      return []
    }
    return dates.map((date) => ({
      locationId,
      date,
      slots: SLOT_ORDER
        .map((slot) => summarizeSlotForecast(entries, date, slot, weatherConfig(env), hours))
        .filter((forecast) => forecast.available)
        .map((forecast) => publicSlotForecast(forecast, hours)),
    })).filter((day) => day.slots.length > 0)
  }))
  return results.flat()
}

export function outlookMessage(name, slot, forecast) {
  return `Forecast for ${name} (${slot}): ${forecast.reasons.join(' and ')}. We play rain or shine.`
}

// "Thu, Nov 12" for a YYYY-MM-DD date.
const noticeDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })

export function forecastNotice(name, date, slot, forecast) {
  return {
    title: forecast.severe ? 'Severe weather forecast for your game' : 'Rain forecast for your game',
    message: `Your ${slot} game at ${name} on ${noticeDate(date)}: ${forecast.reasons.join(' and ')}. We play rain or shine.`,
  }
}

// Creates or rewrites a player's forecast notification for one slot. A changed forecast updates
// the text without marking it unread again, so hourly changes don't keep pinging the player.
async function upsertForecastNotice(db, { key, userId, reservationId, locationId, date, title, message }) {
  const notifications = db.collection('notifications')
  const existing = await notifications.findOne({ weatherKey: key })
  if (existing) {
    if (existing.title !== title || existing.message !== message) {
      await notifications.updateOne({ weatherKey: key }, { $set: { title, message, updatedAtISO: new Date().toISOString() } })
    }
    return
  }
  await notifyUser(db, {
    userId,
    type: 'weather_advisory',
    title,
    message,
    linkedResourceId: reservationId,
    fields: { weatherKey: key, weatherLocationId: locationId, weatherDate: date },
  })
}

let lastOutlookRun = 0

export async function refreshWeatherOutlook(db, { force = false, http, env = process.env } = {}) {
  if (!isWeatherConfigured(env)) return { skipped: 'not configured' }
  const now = Date.now()
  if (!force && now - lastOutlookRun < 50 * 60_000) return { skipped: 'recent' }
  lastOutlookRun = now

  const todayISO = manilaDateISO(0)
  const dates = Array.from({ length: OUTLOOK_DAYS }, (_, i) => manilaDateISO(i))
  const { hours } = await getSlotHours(db)
  const collection = db.collection(WEATHER_OUTLOOK)
  const daily = db.collection(WEATHER_DAILY)
  const nowISO = new Date().toISOString()
  const notifications = db.collection('notifications')
  let flagged = 0

  // Active bookings in the outlook window, for the forecast notifications.
  const bookings = (await db.collection('reservations').find(
    { $or: [{ reservationDate: { $in: dates } }, { dateISO: { $in: dates } }], reservationStatus: { $in: ADVISORY_STATUSES } },
    { projection: { id: 1, userId: 1, teamMembers: 1, locationId: 1, location: 1, reservationDate: 1, dateISO: 1, reservationTime: 1, slot: 1, reservationStatus: 1 } },
  ).toArray()).filter((r) => ADVISORY_STATUSES.includes(String(r.reservationStatus || '').toLowerCase()))
  const bookedOn = (locationId, date, slot) => bookings.filter((r) =>
    String(r.locationId || r.location || '').toLowerCase() === locationId
    && (r.reservationDate || r.dateISO) === date
    && String(r.reservationTime || r.slot || '').toLowerCase() === slot)

  for (const locationId of Object.keys(DEFAULT_COORDS)) {
    const coords = locationCoords(locationId, env)
    let entries
    try {
      entries = await fetchForecast(locationId, { http, env })
    } catch (err) {
      // Keep the last outlook for this field if the API is briefly unavailable.
      console.warn('Weather outlook failed for', locationId, err?.message || err)
      continue
    }
    const keep = []
    const keepNotices = []
    for (const date of dates) {
      // Every slot with forecast data, for the daily forecast shown on the dashboard.
      const daySlots = SLOT_ORDER
        .map((slot) => summarizeSlotForecast(entries, date, slot, weatherConfig(env), hours))
        .filter((forecast) => forecast.available)
        .map((forecast) => publicSlotForecast(forecast, hours))
      if (daySlots.length) {
        await daily.updateOne(
          { _id: `${locationId}|${date}` },
          { $set: { locationId, date, slots: daySlots, updatedAtISO: nowISO } },
          { upsert: true },
        )
      }
      for (const slot of SLOT_ORDER) {
        if (slotHasStarted(hours, slot, date, todayISO)) continue
        const forecast = summarizeSlotForecast(entries, date, slot, weatherConfig(env), hours)
        if (!forecast.available || (!forecast.severe && !forecast.rainy)) continue
        const key = `${locationId}|${date}|${slot}`
        keep.push(key)
        flagged += 1
        await collection.updateOne(
          { _id: key },
          {
            $set: {
              locationId,
              date,
              slot,
              severe: forecast.severe,
              title: forecast.severe ? 'Severe weather forecast' : 'Rain forecast',
              message: outlookMessage(coords.name, slot, forecast),
              forecast,
              updatedAtISO: nowISO,
            },
            $setOnInsert: { createdAtISO: nowISO },
          },
          { upsert: true },
        )
        const { title, message } = forecastNotice(coords.name, date, slot, forecast)
        for (const reservation of bookedOn(locationId, date, slot)) {
          for (const userId of playerIdsOf(reservation)) {
            const noticeKey = `${key}|${userId}`
            if (keepNotices.includes(noticeKey)) continue
            keepNotices.push(noticeKey)
            await upsertForecastNotice(db, { key: noticeKey, userId, reservationId: reservation.id, locationId, date, title, message })
          }
        }
      }
    }
    // This field's slots that cleared up, and anything already in the past.
    await collection.deleteMany({ locationId, _id: { $nin: keep } })
    // Forecast notifications for slots that cleared up, started, or lost their booking.
    await notifications.deleteMany({ weatherLocationId: locationId, weatherKey: { $nin: keepNotices } })
  }
  await collection.deleteMany({ date: { $lt: todayISO } })
  await notifications.deleteMany({ weatherDate: { $lt: todayISO } })
  await daily.deleteMany({ date: { $lt: todayISO } })
  return { checkedDays: dates.length, flagged }
}
