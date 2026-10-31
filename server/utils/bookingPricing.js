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
      const fixedPlayers = Math.round(Number(pkg.players || 0))
      if (fixedPlayers > 0 && fixedPlayers !== players) {
        throw new Error('The selected package is not priced for this group size.')
      }
      subtotal = Math.round(settledPrice)
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

      const listedWeaponPrice = weapons.reduce((sum, item) => sum + numberOrZero(item.price, 'Weapon'), 0)
      const averageWeaponPrice = weapons.length ? listedWeaponPrice / weapons.length : 0
      const packageWeaponCount = Math.max(
        0,
        Math.round(Number(pkg.weaponCount || weaponIds.length)),
      )
      const rentedWeaponCount = Math.max(0, packageWeaponCount * players - ownWeaponCount)
      const weaponsTotal = Math.round(averageWeaponPrice * rentedWeaponCount * sessionMultiplier)
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
      throw new Error('One or more selected equipment pieces are unavailable.')
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
