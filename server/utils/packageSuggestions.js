import { isAmmo } from './ammoStock.js'
import { isRentalPiece, modelOf } from './inventoryPieces.js'
import { MAX_EQUIPMENT_PER_PLAYER } from './packageQuantities.js'

// AI package suggestions for admins. The server gathers the facts (rental inventory by model,
// current packages, recent bookings), asks Google Gemini for new package ideas, then keeps only
// what it can check: items must be real models in stock, prices must be positive whole pesos,
// and names must not repeat an existing package. The admin accepts or dismisses each one.

export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest'
export const MAX_SUGGESTIONS = 3
// Gemini can take a minute when it is busy; past this the admin gets a "try again" message.
const GEMINI_TIMEOUT_MS = 120_000
const BOOKING_LOOKBACK_DAYS = 90
const MAX_PLAYERS = 400

export function geminiConfig(env = process.env) {
  // Same entrance fee setting the booking price uses (ENTRANCE_FEE_PER_PLAYER, ₱150 by default).
  const fee = Number(env.ENTRANCE_FEE_PER_PLAYER)
  return {
    apiKey: String(env.GEMINI_API_KEY || '').trim(),
    model: String(env.GEMINI_MODEL || '').trim() || DEFAULT_GEMINI_MODEL,
    entranceFee: String(env.ENTRANCE_FEE_PER_PLAYER ?? '').trim() !== '' && Number.isFinite(fee) && fee >= 0 ? fee : 150,
  }
}

// Rental pieces grouped by model, with one piece id to store in a package (packages hold one
// piece id per model; bookings then assign each player a free piece of that model).
export function summarizeRentalModels(items) {
  const groups = new Map()
  for (const item of items || []) {
    if (!isRentalPiece(item)) continue
    const model = modelOf(item)
    if (!model) continue
    const id = String(item.id ?? item._id ?? '')
    const group = groups.get(model) || {
      model,
      pieceId: id,
      category: String(item.category || ''),
      price: Math.max(0, Number(item.price) || 0),
      total: 0,
      available: 0,
      grams: 0,
      ammo: isAmmo(item),
    }
    group.total += 1
    group.grams += Math.max(0, Number(item.stockGrams) || 0)
    if (String(item.status || 'available').toLowerCase() === 'available') group.available += 1
    groups.set(model, group)
  }
  return [...groups.values()].sort((a, b) => a.model.localeCompare(b.model))
}

// What players booked recently: how often each package and each custom-rented model was picked,
// and the usual group sizes. Cancelled bookings are left out.
export function summarizeBookings(reservations, { packages, weapons, equipment }) {
  const packageNames = new Map((packages || []).flatMap((pkg) => [[String(pkg.id || ''), pkg.name], [String(pkg._id || ''), pkg.name]]))
  const modelById = new Map([...(weapons || []), ...(equipment || [])].map((item) => [String(item.id ?? item._id ?? ''), modelOf(item)]))
  const packageCounts = new Map()
  const customCounts = new Map()
  const sizes = { solo: 0, '2-4': 0, '5-9': 0, '10+': 0 }
  let total = 0
  let privateGames = 0
  let custom = 0
  let ownGear = 0
  for (const res of reservations || []) {
    if (String(res.reservationStatus || '').toLowerCase() === 'cancelled') continue
    total += 1
    const players = Math.max(1, Number(res.numberOfPlayers) || 1)
    sizes[players === 1 ? 'solo' : players <= 4 ? '2-4' : players <= 9 ? '5-9' : '10+'] += 1
    if (String(res.sessionType || '').toLowerCase() === 'private') privateGames += 1
    if (res.selectionMode === 'package') {
      const name = packageNames.get(String(res.selectedPackageId || '')) || res.packageName || 'Unknown package'
      packageCounts.set(name, (packageCounts.get(name) || 0) + 1)
    } else if (res.selectionMode === 'custom') {
      custom += 1
      for (const id of [...(res.customWeaponIds || []), ...(res.customEquipmentIds || [])]) {
        const model = modelById.get(String(id))
        if (model) customCounts.set(model, (customCounts.get(model) || 0) + 1)
      }
    } else {
      ownGear += 1
    }
  }
  const ranked = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }))
  return { total, privateGames, custom, ownGear, groupSizes: sizes, packages: ranked(packageCounts), customRentals: ranked(customCounts) }
}

const INVENTORY_FIELDS = { id: 1, name: 1, model: 1, category: 1, price: 1, status: 1, source: 1, stockGrams: 1 }

export async function gatherSuggestionContext(db, { now = new Date(), env = process.env } = {}) {
  const since = new Date(now.getTime() - BOOKING_LOOKBACK_DAYS * 86_400_000).toISOString()
  const [packages, weapons, equipment, reservations] = await Promise.all([
    // Only the fields used here, so photos and long histories aren't downloaded.
    db.collection('packages').find({}, { projection: { id: 1, name: 1, status: 1, players: 1, minPlayers: 1, settledAmount: 1, bbReloadGrams: 1, weaponIds: 1, equipmentIds: 1 } }).toArray(),
    db.collection('weapons').find({}, { projection: INVENTORY_FIELDS }).toArray(),
    db.collection('equipments').find({}, { projection: INVENTORY_FIELDS }).toArray(),
    db.collection('reservations').find(
      { createdAtISO: { $gte: since } },
      { projection: { reservationStatus: 1, numberOfPlayers: 1, sessionType: 1, selectionMode: 1, selectedPackageId: 1, packageName: 1, customWeaponIds: 1, customEquipmentIds: 1 } },
    ).limit(5000).toArray(),
  ])
  const weaponModels = summarizeRentalModels(weapons)
  const gearModels = summarizeRentalModels(equipment)
  const modelById = new Map([...weapons, ...equipment].map((item) => [String(item.id ?? item._id ?? ''), modelOf(item)]))
  const currentPackages = packages
    .filter((pkg) => String(pkg.status || 'active').toLowerCase() !== 'archived')
    .map((pkg) => ({
      name: String(pkg.name || ''),
      players: Number(pkg.players) || 0,
      minPlayers: Number(pkg.minPlayers) || 1,
      price: Number(pkg.settledAmount) || null,
      bbReloadGrams: Number(pkg.bbReloadGrams) || 0,
      includes: [...(pkg.weaponIds || []), ...(pkg.equipmentIds || [])].map((id) => modelById.get(String(id))).filter(Boolean),
    }))
  return {
    entranceFee: geminiConfig(env).entranceFee,
    weaponModels,
    gearModels,
    currentPackages,
    bookings: summarizeBookings(reservations, { packages, weapons, equipment }),
    lookbackDays: BOOKING_LOOKBACK_DAYS,
  }
}

export function buildPrompt(context, { focus = '' } = {}) {
  const facts = {
    currency: 'PHP (₱)',
    entranceFeePerPlayer: context.entranceFee,
    weapons: context.weaponModels.map(({ model, category, price, available, total }) => ({ model, category, rentalPricePerPlayer: price, piecesAvailable: available, piecesTotal: total })),
    gear: context.gearModels.map(({ model, category, price, available, total, grams, ammo }) => (ammo
      ? { model, category, pricePerRefill: price, gramsInStock: grams, isAmmo: true }
      : { model, category, rentalPricePerPiece: price, piecesAvailable: available, piecesTotal: total })),
    currentPackages: context.currentPackages,
    [`bookingsLast${context.lookbackDays}Days`]: context.bookings,
  }
  return [
    'You help the admin of an airsoft gaming center in the Philippines design rental packages.',
    'Suggest new packages that are likely to sell, based only on the inventory and booking facts below.',
    'Rules:',
    '- Use only weapon and gear model names exactly as listed. Prefer models with pieces available.',
    '- Do not repeat an existing package (same name or same set of items).',
    '- Each package needs at least one weapon, plus protective gear (a mask, if one is listed).',
    `- "price" is the whole package price in pesos for "players" players and must include the ₱${context.entranceFee} entrance fee per player. Use players = 1 for a per-player package, or a group size (2 or more) for a group deal.`,
    '- Price fairly: usually at or slightly below the sum of entrance + item prices, and in line with the current packages.',
    '- For ammo, perPlayer is the number of refills per player; set bbReloadGrams to grams per refill (0 if no ammo).',
    '- "reason" is one or two plain sentences for the admin, citing the facts that support the package.',
    focus ? `The admin asked you to focus on: ${focus}` : '',
    `Suggest up to ${MAX_SUGGESTIONS} packages.`,
    '',
    'Facts (JSON):',
    JSON.stringify(facts),
  ].filter((line) => line !== '').join('\n')
}

export const SUGGESTION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    suggestions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          description: { type: 'STRING' },
          weapons: { type: 'ARRAY', items: { type: 'STRING' } },
          gear: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: { model: { type: 'STRING' }, perPlayer: { type: 'INTEGER' } },
              required: ['model', 'perPlayer'],
            },
          },
          players: { type: 'INTEGER' },
          minPlayers: { type: 'INTEGER' },
          price: { type: 'INTEGER' },
          bbReloadGrams: { type: 'INTEGER' },
          reason: { type: 'STRING' },
        },
        required: ['name', 'description', 'weapons', 'gear', 'players', 'minPlayers', 'price', 'bbReloadGrams', 'reason'],
      },
    },
  },
  required: ['suggestions'],
}

// How hard Gemini reasons before answering: minimal | low | medium | high (GEMINI_THINKING).
export function thinkingLevel(env = process.env) {
  const level = String(env.GEMINI_THINKING || '').trim().toLowerCase()
  return ['minimal', 'low', 'medium', 'high'].includes(level) ? level : 'minimal'
}

// `signal` cancels the call early (the admin pressed Stop); the timeout still applies.
export async function askGemini(prompt, { env = process.env, http = fetch, signal } = {}) {
  const { apiKey, model } = geminiConfig(env)
  if (!apiKey) throw Object.assign(new Error('AI suggestions are not set up. Add GEMINI_API_KEY to the server environment.'), { statusCode: 503 })
  const call = (thinkingConfig) => http(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(GEMINI_TIMEOUT_MS)]) : AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: SUGGESTION_SCHEMA,
        temperature: 0.7,
        ...(thinkingConfig ? { thinkingConfig } : {}),
      },
    }),
  })
  // Flash models "think" at length by default, which took about a minute here; this task
  // doesn't need it. Models that don't take a thinking level are asked again without one.
  let res
  let body
  try {
    res = await call({ thinkingLevel: thinkingLevel(env) })
    body = await res.json().catch(() => null)
    if (res.status === 400 && /thinking/i.test(String(body?.error?.message || ''))) {
      res = await call(null)
      body = await res.json().catch(() => null)
    }
  } catch (err) {
    if (signal?.aborted) throw Object.assign(new Error('Stopped.'), { statusCode: 499, stopped: true })
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw Object.assign(new Error('Gemini took too long to answer (it may be busy). Try again in a minute.'), { statusCode: 504 })
    }
    throw Object.assign(new Error(`Could not reach Gemini: ${err?.message || err}`), { statusCode: 502 })
  }
  if (!res.ok) {
    const detail = body?.error?.message || `HTTP ${res.status}`
    throw Object.assign(new Error(`Gemini could not make suggestions: ${detail}`), { statusCode: 502 })
  }
  const text = (body?.candidates?.[0]?.content?.parts || []).map((part) => part?.text || '').join('')
  try {
    return JSON.parse(text)
  } catch {
    throw Object.assign(new Error('Gemini sent an answer that could not be read. Try again.'), { statusCode: 502 })
  }
}

const wholeNumber = (value, fallback = 0) => {
  const number = Math.round(Number(value))
  return Number.isFinite(number) ? number : fallback
}
const clean = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
const norm = (value) => String(value || '').trim().toLowerCase()

// Keeps only suggestions the shop can actually offer, mapped to real inventory pieces, and adds
// the item value at list prices so the admin can compare it with the suggested price.
export function checkSuggestions(raw, context) {
  const weaponsByName = new Map(context.weaponModels.map((item) => [norm(item.model), item]))
  const gearByName = new Map(context.gearModels.map((item) => [norm(item.model), item]))
  const taken = new Set(context.currentPackages.map((pkg) => norm(pkg.name)))
  const kept = []
  const dropped = []
  for (const entry of Array.isArray(raw?.suggestions) ? raw.suggestions : []) {
    const name = clean(entry?.name, 60)
    const drop = (why) => dropped.push({ name: name || '(no name)', why })
    if (!name) { drop('It had no name.'); continue }
    if (taken.has(norm(name))) { drop('A package with this name already exists.'); continue }

    const unknown = []
    const weapons = []
    for (const model of Array.isArray(entry.weapons) ? entry.weapons : []) {
      const item = weaponsByName.get(norm(model))
      if (!item) unknown.push(String(model))
      else if (!weapons.includes(item)) weapons.push(item)
    }
    const gear = []
    for (const row of Array.isArray(entry.gear) ? entry.gear : []) {
      const item = gearByName.get(norm(row?.model))
      if (!item) { unknown.push(String(row?.model || '')); continue }
      if (gear.some((g) => g.item === item)) continue
      gear.push({ item, perPlayer: Math.min(MAX_EQUIPMENT_PER_PLAYER, Math.max(1, wholeNumber(row.perPlayer, 1))) })
    }
    if (unknown.length) { drop(`It used items not in inventory: ${unknown.join(', ')}.`); continue }
    if (!weapons.length) { drop('It had no weapon.'); continue }
    const outOfStock = [...weapons, ...gear.map((g) => g.item)].filter((item) => (item.ammo ? item.grams <= 0 : item.available <= 0))
    if (outOfStock.length) { drop(`No pieces available: ${outOfStock.map((item) => item.model).join(', ')}.`); continue }

    const players = Math.min(MAX_PLAYERS, Math.max(1, wholeNumber(entry.players, 1)))
    const minPlayers = players > 1 ? 1 : Math.min(MAX_PLAYERS, Math.max(1, wholeNumber(entry.minPlayers, 1)))
    const price = wholeNumber(entry.price)
    if (price <= 0) { drop('It had no valid price.'); continue }
    const hasAmmo = gear.some((g) => g.item.ammo)
    const bbReloadGrams = hasAmmo ? Math.max(0, wholeNumber(entry.bbReloadGrams)) : 0

    // List-price value: entrance + the average chosen weapon + gear, per player, times players.
    const weaponValue = weapons.reduce((sum, item) => sum + item.price, 0) / weapons.length
    const gearValue = gear.reduce((sum, g) => sum + g.item.price * g.perPlayer, 0)
    const itemValue = Math.round((context.entranceFee + weaponValue + gearValue) * players)

    const sameItems = context.currentPackages.some((pkg) => {
      const models = new Set(pkg.includes.map(norm))
      const mine = [...weapons, ...gear.map((g) => g.item)].map((item) => norm(item.model))
      return models.size === mine.length && mine.every((model) => models.has(model)) && (pkg.players || 1) === players
    })
    if (sameItems) { drop('It has the same items as an existing package.'); continue }

    taken.add(norm(name))
    kept.push({
      name,
      description: clean(entry.description, 300),
      reason: clean(entry.reason, 400),
      players,
      minPlayers,
      price,
      perPlayer: Math.round(price / players),
      itemValue,
      bbReloadGrams,
      weapons: weapons.map((item) => ({ model: item.model, pieceId: item.pieceId, price: item.price })),
      gear: gear.map((g) => ({ model: g.item.model, pieceId: g.item.pieceId, price: g.item.price, perPlayer: g.perPlayer, ammo: g.item.ammo })),
    })
    if (kept.length >= MAX_SUGGESTIONS) break
  }
  return { suggestions: kept, dropped }
}
