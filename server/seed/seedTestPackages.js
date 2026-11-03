// Test rental packages so the player's Recommended Packages page has something to recommend.
// Each package points at one available piece per model; the booking/recommendation code rents any
// free piece of that model, so these work as long as the model has free pieces.
//
// Usage (from the project root):
//   node server/seed/seedTestPackages.js            add or refresh the test packages
//   node server/seed/seedTestPackages.js --remove   delete them again
//
// Only documents whose id starts with TEST-PKG- are touched.

import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(here, '..', '.env') })

const { getDb } = await import('../db/mongo.js')

// Package -> the models it rents. One available piece of each model is looked up at run time.
const TEST_PACKAGES = [
  {
    id: 'TEST-PKG-001',
    name: 'TEST Starter Pack',
    description: 'Test data: one pistol and a mask per player. Fits small groups.',
    weaponModels: ['Gun-ther'],
    equipmentModels: ['Masks'],
    minPlayers: 1,
    basePrice: 0,
    discountMode: 'none',
    discountValue: 0,
  },
  {
    id: 'TEST-PKG-002',
    name: 'TEST Squad Pack',
    description: 'Test data: a shotgun or pistol, mask and duster gas per player.',
    weaponModels: ['Shotgun Eagle', 'Gun-ther'],
    equipmentModels: ['Masks', 'Duster Gas'],
    minPlayers: 2,
    basePrice: 50,
    discountMode: 'percent',
    discountValue: 10,
  },
  {
    id: 'TEST-PKG-003',
    name: 'TEST Team Ten',
    description: 'Test data: built for private groups of 10 or more.',
    weaponModels: ['Shotgun Eagle', 'Gun-ther'],
    equipmentModels: ['Masks'],
    minPlayers: 10,
    basePrice: 0,
    discountMode: 'amount',
    discountValue: 300,
  },
]

async function firstAvailablePiece(db, collection, model) {
  const piece = await db.collection(collection).findOne(
    { source: { $ne: 'player' }, status: 'available', $or: [{ model }, { name: model }, { name: { $regex: `^${model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} #\\d+$` } }] },
    { projection: { id: 1 }, sort: { unitNumber: 1 } },
  )
  if (!piece?.id) throw new Error(`No available "${model}" piece in ${collection}. Add one in admin inventory first.`)
  return String(piece.id)
}

async function main() {
  const db = await getDb()
  const packages = db.collection('packages')

  if (process.argv.includes('--remove')) {
    const result = await packages.deleteMany({ id: { $regex: '^TEST-PKG-' } })
    console.log(`Removed ${result.deletedCount} test package(s).`)
    return
  }

  const nowISO = new Date().toISOString()
  for (const spec of TEST_PACKAGES) {
    const weaponIds = []
    for (const model of spec.weaponModels) weaponIds.push(await firstAvailablePiece(db, 'weapons', model))
    const equipmentIds = []
    for (const model of spec.equipmentModels) equipmentIds.push(await firstAvailablePiece(db, 'equipments', model))

    const doc = {
      id: spec.id,
      name: spec.name,
      description: spec.description,
      basePrice: spec.basePrice,
      minPlayers: spec.minPlayers,
      players: 0,
      settledAmount: 0,
      weaponCount: 1,
      weaponIds,
      equipmentIds,
      equipmentCount: equipmentIds.length,
      equipmentQuantities: Object.fromEntries(equipmentIds.map((id) => [id, 1])),
      discountPct: spec.discountMode === 'percent' ? spec.discountValue : 0,
      discountMode: spec.discountMode,
      discountValue: spec.discountValue,
      discountTargets: ['package_total'],
      tier: 'starter',
      status: 'active',
      isTestData: true,
      updatedAtISO: nowISO,
    }
    await packages.updateOne({ id: spec.id }, { $set: doc, $setOnInsert: { createdAtISO: nowISO } }, { upsert: true })
    console.log(`${spec.id}  ${spec.name}  weapons=${weaponIds.join(',')}  equipment=${equipmentIds.join(',')}`)
  }
}

try {
  await main()
  process.exit(0)
} catch (err) {
  console.error(err?.message || err)
  process.exit(1)
}
