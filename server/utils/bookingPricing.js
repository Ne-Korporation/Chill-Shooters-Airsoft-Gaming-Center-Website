import { modelOf } from './inventoryPieces.js'
import { packageEquipmentQty } from './packageQuantities.js'

const DEFAULT_ENTRANCE_FEE = 150
const DEFAULT_STANDARD_DEPOSIT_RATE = 0.5
const DEFAULT_OWN_GEAR_DEPOSIT = 350

function readNonNegativeNumber(value, fallback, name) {
  const parsed = value === undefined || value === '' ? fallback : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number`)
  }
  return parsed
}

function getPricingConfig(env = process.env) {
  const standardDepositRate = readNonNegativeNumber(
    env.STANDARD_DEPOSIT_RATE,
    DEFAULT_STANDARD_DEPOSIT_RATE,
    'STANDARD_DEPOSIT_RATE',
  )
  const cvsuDiscountPercent = readNonNegativeNumber(
    env.CVSU_DISCOUNT_PERCENT,
    10,
    'CVSU_DISCOUNT_PERCENT',
  )
  if (standardDepositRate > 1) throw new Error('STANDARD_DEPOSIT_RATE cannot exceed 1')
  if (cvsuDiscountPercent > 100) throw new Error('CVSU_DISCOUNT_PERCENT cannot exceed 100')

  return {
    entranceFeePerPlayer: readNonNegativeNumber(
      env.ENTRANCE_FEE_PER_PLAYER,
      DEFAULT_ENTRANCE_FEE,
      'ENTRANCE_FEE_PER_PLAYER',
    ),
    standardDepositRate,
    ownGearDeposit: readNonNegativeNumber(
      env.OWN_GEAR_DEPOSIT,
      DEFAULT_OWN_GEAR_DEPOSIT,
      'OWN_GEAR_DEPOSIT',
    ),
    cvsuDiscountPercent,
    privateSessionMultiplier: readNonNegativeNumber(
      env.PRIVATE_SESSION_PRICE_MULTIPLIER,
      1,
      'PRIVATE_SESSION_PRICE_MULTIPLIER',
    ),
  }
}

// Extra BB reloads a player can add when booking, on top of what the package gives.
// Same price as the "Extra ammo reload" charge staff add at the field (AMMO_RELOAD_PRICE).
export const MAX_EXTRA_AMMO_RELOADS = 50
// Every package booking includes this many BB reloads per player at no charge.
export const INCLUDED_RELOADS_PER_PLAYER = 2

export function getAmmoReloadPrice(env = process.env) {
  return readNonNegativeNumber(env.AMMO_RELOAD_PRICE, 50, 'AMMO_RELOAD_PRICE')
}

export function normalizeExtraAmmoReloads(value) {
  const count = Math.round(Number(value) || 0)
  return Math.max(0, Math.min(MAX_EXTRA_AMMO_RELOADS, count))
}

function numberOrZero(value, label) {
  const number = Number(value || 0)
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${label} has an invalid price`)
  }
  return number
}

function applyDiscount(amount, pkg) {
  const mode = pkg.discountMode || (Number(pkg.discountPct) > 0 ? 'percent' : 'none')
  const value = numberOrZero(pkg.discountValue ?? pkg.discountPct, 'Package discount')
  if (mode === 'settled') return Math.max(0, Math.round(value))
  if (mode === 'amount') return Math.max(0, amount - Math.min(amount, Math.round(value)))
  if (mode === 'percent') return Math.max(0, amount - Math.round(amount * Math.min(value, 100) / 100))
  return amount
}

// "M4 Rifle × 2" lines, one per model, for custom piece selections.
function groupByModel(items) {
  const groups = new Map()
  for (const item of items) {
    const model = modelOf(item)
    const current = groups.get(model) || { count: 0, amount: 0 }
    groups.set(model, { count: current.count + 1, amount: current.amount + numberOrZero(item.price, 'Rental') })
  }
  return [...groups].map(([model, { count, amount }]) => [`${model}${count > 1 ? ` × ${count}` : ''}`, Math.round(amount)])
}

export const CVSU_NAME = 'Cavite State University'

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// A partner organization's player discount: its `discountPercent` on the Partnerships page,
// only while the partnership is active. CvSU falls back to CVSU_DISCOUNT_PERCENT when it has
// no partnership record of its own.
export async function partnerDiscountPercent(db, institution, config = getPricingConfig()) {
  const name = String(institution || '').trim()
  if (!name) return 0
  const partner = await db.collection('partnerships').findOne({ name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } })
  if (partner) {
    if (String(partner.status || '').toLowerCase() !== 'active') return 0
    const percent = Number(partner.discountPercent)
    return Number.isFinite(percent) && percent > 0 ? Math.min(percent, 100) : 0
  }
  return name.toLowerCase() === CVSU_NAME.toLowerCase() ? config.cvsuDiscountPercent : 0
}

// Organizations a player can claim a discount from: active partners with a discount set,
// plus CvSU when it is covered by the CVSU_DISCOUNT_PERCENT fallback.
export async function listDiscountInstitutions(db, config = getPricingConfig()) {
  const partners = await db.collection('partnerships')
    .find({ status: 'active', discountPercent: { $gt: 0 } }, { projection: { name: 1, discountPercent: 1, type: 1 } })
    .toArray()
  const list = partners.map((p) => ({ name: String(p.name), discountPercent: Math.min(Number(p.discountPercent), 100), type: p.type || '' }))
  const hasCvsuRecord = await db.collection('partnerships').countDocuments({ name: { $regex: `^${escapeRegex(CVSU_NAME)}$`, $options: 'i' } })
  if (!hasCvsuRecord && config.cvsuDiscountPercent > 0) {
    list.unshift({ name: CVSU_NAME, discountPercent: config.cvsuDiscountPercent, type: 'school' })
  }
  return list
}

function calculateDeposit(total, isOwnGear, config) {
  if (isOwnGear) return Math.min(total, Math.round(config.ownGearDeposit))
  return Math.min(total, Math.round(total * config.standardDepositRate))
}

export async function calculateBookingPrice({ db, payload, players, findDocumentById, userId }) {
  const config = getPricingConfig()
  const sessionMultiplier = String(payload.sessionType || '').toLowerCase() === 'private'
    ? config.privateSessionMultiplier
    : 1
  const entranceFee = Math.round(config.entranceFeePerPlayer * players * sessionMultiplier)
  const selectionMode = String(payload.selectionMode || '').toLowerCase()
  // Set by the server after checking which players have an approved weapon on file;
  // each one replaces one rental weapon.
  const ownWeaponCount = Math.max(0, Math.round(Number(payload.verifiedOwnWeaponCount) || 0))
  let subtotal = entranceFee
  let packageDiscount = 0
  let isOwnGear = false
  const breakdown = [{ label: 'Player entrance fee', amount: entranceFee }]

  if (selectionMode === 'package') {
    const packageId = String(payload.selectedPackageId || '').trim()
    if (!packageId) throw new Error('Choose a rental package before booking.')
    const pkg = await findDocumentById(db, 'packages', packageId)
    if (!pkg || (pkg.status && String(pkg.status).toLowerCase() !== 'active')) {
      throw new Error('The selected rental package is unavailable.')
    }

    const settledPrice = numberOrZero(pkg.settledAmount, 'Package')
    if (settledPrice > 0) {
      // A set price for 1 player is charged per player; a set price for a group of N (2 or more)
      // only fits exactly N players. Mirrors src/utils/packagePricing.ts.
      const fixedPlayers = Math.round(Number(pkg.players || 0))
      if (fixedPlayers > 1 && fixedPlayers !== players) {
        throw new Error(`The selected package is priced for a group of ${fixedPlayers} players.`)
      }
      subtotal = Math.round(settledPrice) * (fixedPlayers > 1 ? 1 : Math.max(1, players))
      const discountedTotal = applyDiscount(subtotal, {
        ...pkg,
        discountMode: pkg.discountMode === 'settled' ? 'none' : pkg.discountMode,
      })
      packageDiscount = subtotal - discountedTotal
      subtotal = discountedTotal
      breakdown.length = 0
      breakdown.push({ label: pkg.name || 'Rental package', amount: subtotal })
    } else {
      const basePrice = numberOrZero(pkg.basePrice, 'Package')
      const weaponIds = Array.isArray(pkg.weaponIds) ? pkg.weaponIds.map(String) : []
      const equipmentIds = Array.isArray(pkg.equipmentIds) ? pkg.equipmentIds.map(String) : []
      const weapons = await Promise.all(weaponIds.map((id) => findDocumentById(db, 'weapons', id)))
      const equipment = await Promise.all(equipmentIds.map((id) => findDocumentById(db, 'equipments', id)))
      if (weapons.some((item) => !item) || equipment.some((item) => !item)) {
        throw new Error('The selected package references inventory that is no longer available.')
      }
      if (weapons.some((item) => String(item.status || 'available').toLowerCase() !== 'available')) {
        throw new Error('One or more weapons in the selected package are unavailable.')
      }
      // Piece availability for the slot is checked when the booking reserves its pieces.

      // Mirrors packageWeaponRental in src/utils/packagePricing.ts.
      const weaponPrices = weapons.map((item) => numberOrZero(item.price, 'Weapon'))
      const listedWeaponPrice = weaponPrices.reduce((sum, price) => sum + price, 0)
      // Every player gets one of each listed weapon (a rifle and grenades = 2); an approved own
      // gun replaces the first (main) one.
      const packageWeaponCount = weaponPrices.length
      const replaced = packageWeaponCount ? Math.min(ownWeaponCount, players) : 0
      const rentedWeaponCount = packageWeaponCount * players - replaced
      const weaponRentalTotal = packageWeaponCount ? listedWeaponPrice * players - weaponPrices[0] * replaced : 0
      const weaponsTotal = Math.round(weaponRentalTotal * sessionMultiplier)
      const equipmentTotal = Math.round(
        equipment.reduce((sum, item, index) => sum + numberOrZero(item.price, 'Equipment') * packageEquipmentQty(pkg, equipmentIds[index]), 0)
          * players * sessionMultiplier,
      )
      const packageBase = Math.round(basePrice * players * sessionMultiplier)
      const preDiscount = packageBase + weaponsTotal + equipmentTotal + entranceFee
      subtotal = applyDiscount(preDiscount, pkg)
      packageDiscount = preDiscount - subtotal
      breakdown.length = 0
      if (packageBase) breakdown.push({ label: pkg.name || 'Package fee', amount: packageBase })
      const weaponLabel = [...new Set(weapons.map(modelOf))].join(' / ') || 'Rental weapons'
      if (weaponsTotal) breakdown.push({ label: `${weaponLabel} rental (${rentedWeaponCount})`, amount: weaponsTotal })
      if (ownWeaponCount && packageWeaponCount) breakdown.push({ label: `Own weapons (${Math.min(ownWeaponCount, packageWeaponCount * players)}) — no rental charge`, amount: 0 })
      equipment.forEach((item, index) => {
        const pieces = players * packageEquipmentQty(pkg, equipmentIds[index])
        const amount = Math.round(numberOrZero(item.price, 'Equipment') * pieces * sessionMultiplier)
        if (amount) breakdown.push({ label: `${modelOf(item)} rental (${pieces})`, amount })
      })
      breakdown.push({ label: 'Player entrance fee', amount: entranceFee })
      if (packageDiscount) breakdown.push({ label: 'Package discount', amount: -packageDiscount })
    }
  } else if (selectionMode === 'custom') {
    const weaponIds = Array.isArray(payload.customWeaponIds) ? [...new Set(payload.customWeaponIds.map(String))] : []
    const equipmentIds = Array.isArray(payload.customEquipmentIds) ? [...new Set(payload.customEquipmentIds.map(String))] : []
    isOwnGear = weaponIds.length === 0 && equipmentIds.length === 0
    const weapons = await Promise.all(weaponIds.map((id) => findDocumentById(db, 'weapons', id)))
    const equipment = await Promise.all(equipmentIds.map((id) => findDocumentById(db, 'equipments', id)))
    if (weapons.some((item) => !item) || equipment.some((item) => !item)) {
      throw new Error('One or more selected rental items are unavailable.')
    }
    if (weapons.some((item) => String(item.status || 'available').toLowerCase() !== 'available')) {
      throw new Error('One or more selected weapons are unavailable.')
    }
    if (equipment.some((item) => String(item.status || 'available').toLowerCase() !== 'available')) {
      throw new Error('One or more selected gear pieces are unavailable.')
    }

    // Custom rentals are individual pieces: each chosen piece is rented once at its own price.
    const weaponsTotal = weapons.reduce((sum, item) => sum + numberOrZero(item.price, 'Weapon'), 0)
    const equipmentTotal = equipment.reduce((sum, item) => sum + numberOrZero(item.price, 'Equipment'), 0)
    subtotal = Math.round(entranceFee + weaponsTotal + equipmentTotal)
    breakdown.length = 0
    for (const [label, amount] of groupByModel([...weapons, ...equipment])) {
      breakdown.push({ label, amount })
    }
    breakdown.push({ label: 'Player entrance fee', amount: entranceFee })
  } else {
    return { pricingVerified: false, reason: 'Select a package or choose custom/own gear.' }
  }

  if (selectionMode === 'package') {
    breakdown.push({ label: `BB reloads included (${INCLUDED_RELOADS_PER_PLAYER * players}) — free`, amount: 0 })
  }

  const extraAmmoReloads = normalizeExtraAmmoReloads(payload.extraAmmoReloads)
  if (extraAmmoReloads > 0) {
    const ammoTotal = Math.round(getAmmoReloadPrice() * extraAmmoReloads)
    subtotal += ammoTotal
    breakdown.push({ label: `Extra ammo reloads (${extraAmmoReloads})`, amount: ammoTotal })
  }

  if (userId && !isOwnGear) {
    const account = await findDocumentById(db, 'user_accounts', userId)
    const verified = account && String(account.partnershipEligibilityStatus || '').toLowerCase() === 'verified'
    const institution = String(account?.partnershipInstitution || '').trim()
    const percent = verified && institution ? await partnerDiscountPercent(db, institution, config) : 0
    if (percent > 0) {
      const discount = Math.round(subtotal * percent / 100)
      subtotal = Math.max(0, subtotal - discount)
      const label = institution.toLowerCase() === CVSU_NAME.toLowerCase() ? 'CvSU' : institution
      breakdown.push({ label: `Verified ${label} discount (${percent}%)`, amount: -discount })
    }
  }

  const totalAmount = Math.max(0, Math.round(subtotal))
  return {
    pricingVerified: true,
    totalAmount,
    depositAmount: calculateDeposit(totalAmount, isOwnGear, config),
    balanceAmount: Math.max(0, totalAmount - calculateDeposit(totalAmount, isOwnGear, config)),
    pricingBreakdown: breakdown,
    pricingConfigVersion: 1,
    packageDiscountAmount: packageDiscount,
    paymentDepositPolicy: isOwnGear ? 'fixed_350_capped_at_total' : 'percentage',
  }
}
