import { notifyRole } from './paymentProgress.js'

// BB ammo is tracked in grams (stockGrams on the ammo record). Each booking with reloads takes
// its grams out of stock, so staff are told when an ammo record runs low, before a booking is
// turned away for lack of BBs.
//
// The low-stock level is set per ammo record (lowStockGrams), or AMMO_LOW_STOCK_GRAMS for all,
// 2,000 g by default.

export const DEFAULT_LOW_STOCK_GRAMS = 2000

export function lowStockLevel(item, env = process.env) {
  const own = Number(item?.lowStockGrams)
  if (Number.isFinite(own) && own > 0) return own
  const fromEnv = Number(env.AMMO_LOW_STOCK_GRAMS)
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_LOW_STOCK_GRAMS
}

export const isAmmo = (item) => String(item?.category || '').toLowerCase() === 'ammo'
export const isLowOnAmmo = (item, env) => isAmmo(item) && Math.max(0, Number(item?.stockGrams) || 0) < lowStockLevel(item, env)

// Tells admins and marshals once when an ammo record drops below its level. The mark is cleared
// once it is restocked, so the next drop is reported again.
export async function checkAmmoStock(db, { env = process.env } = {}) {
  const ammo = await db.collection('equipments')
    .find({ category: { $regex: '^ammo$', $options: 'i' }, source: { $ne: 'player' } })
    .toArray()
  let notified = 0
  for (const item of ammo) {
    const low = isLowOnAmmo(item, env)
    if (low && !item.lowStockNotifiedAtISO) {
      const grams = Math.max(0, Number(item.stockGrams) || 0)
      const title = 'BB ammo running low'
      const message = `${item.name || 'BB ammo'} has ${grams.toLocaleString()} g left (below ${lowStockLevel(item, env).toLocaleString()} g). Restock before the next games.`
      for (const role of ['admin', 'marshal']) {
        await notifyRole(db, { role, type: 'inventory_low_stock', title, message, linkedResourceId: item.id })
      }
      await db.collection('equipments').updateOne({ _id: item._id }, { $set: { lowStockNotifiedAtISO: new Date().toISOString() } })
      notified += 1
    } else if (!low && item.lowStockNotifiedAtISO) {
      await db.collection('equipments').updateOne({ _id: item._id }, { $unset: { lowStockNotifiedAtISO: '' } })
    }
  }
  return { checked: ammo.length, notified }
}
