// Optional helper to seed initial collections with basic shape.
// Run manually after Mongo is running.
// Usage:
// node server/seed/seed.js

import { MongoClient } from 'mongodb'

const USER_ACCOUNTS_COLLECTION = process.env.USER_ACCOUNTS_COLLECTION || 'user_accounts'
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/chillshootersgamecenter'
const DB_NAME = process.env.DB_NAME || 'chillshootersgamecenter'

const collections = [
  'equipments',
  'gameplay',
  'packages',
  'payments',
  USER_ACCOUNTS_COLLECTION,
  'waivers',
  'weapons',
]

const ensureDoc = async (col, doc) => {
  // Don’t overwrite existing documents; only insert if empty.
  const count = await col.countDocuments({})
  if (count > 0) return
  await col.insertOne(doc)
}

async function main() {
  const client = new MongoClient(MONGODB_URI)
  await client.connect()
  const db = client.db(DB_NAME)

  // user_accounts: store player-facing fields
  const userAccounts = db.collection(USER_ACCOUNTS_COLLECTION)

  await ensureDoc(userAccounts, {
    id: 'P-00001',
    name: 'Demo Player',
    email: 'player@demo.com',
    password: 'player',
    role: 'user',
    experience: 0,
    identityVerificationStatus: 'verified',
    createdAtISO: new Date().toISOString(),
  })

  await ensureDoc(db.collection('user_accounts'), {
    id: 'P-MARSHAL-0001',
    name: 'Demo Marshal',
    email: 'marshal@demo.com',
    password: 'marshal',
    role: 'marshal',
    experience: 0,
    createdAtISO: new Date().toISOString(),
  })

  await ensureDoc(db.collection('user_accounts'), {
    id: 'P-REGISTRAR-0001',
    name: 'Demo Registrar',
    email: 'registrar@demo.com',
    password: 'registrar',
    role: 'registrar',
    experience: 0,
    createdAtISO: new Date().toISOString(),
  })

  await ensureDoc(db.collection('user_accounts'), {
    id: 'P-ADMIN-0001',
    name: 'Demo Admin',
    email: 'admin@demo.com',
    password: 'admin',
    role: 'admin',
    experience: 0,
    createdAtISO: new Date().toISOString(),
  })


  await ensureDoc(db.collection('equipments'), {
    id: 'EQ-00001',
    name: 'Demo Equipment',
    category: 'gear',
    status: 'available',
    qty: 1,
    note: 'Seeded demo doc',
    createdAtISO: new Date().toISOString(),
  })

  await ensureDoc(db.collection('weapons'), {
    id: 'W-00001',
    name: 'Demo Weapon',
    category: 'rifles',
    status: 'available',
    note: 'Seeded demo doc',
    createdAtISO: new Date().toISOString(),
  })

  await ensureDoc(db.collection('packages'), {
    id: 'PKG-001',
    name: 'Starter Package',
    tier: 'starter',
    discountPct: 10,
    equipmentCount: 0,
    status: 'draft',
    description: 'Seeded demo doc',
    includedItems: [],
    createdAtISO: new Date().toISOString(),
  })

  await ensureDoc(db.collection('waivers'), {
    id: 'WAIV-00001',
    reservationId: '',
    participantSummary: 'Demo Participant',
    isMinor: false,
    status: 'pending',
    reviewerNote: '',
    submittedAtISO: new Date().toISOString(),
    createdAtISO: new Date().toISOString(),
  })

  await ensureDoc(db.collection('gameplay'), {
    id: 'res-00001',
    createdAtISO: new Date().toISOString(),
    dateISO: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    fieldName: 'Upper Ground',
    slotLabel: 'Evening',
    sessionType: 'Public',
    players: 8,
    gameMode: 'Squad Deathmatch',
    packageName: 'Starter Package',
    status: 'pending',
    createdAtISO: new Date().toISOString(),
  })

  await ensureDoc(db.collection('payments'), {
    id: 'PMT-00001',
    reservationId: 'res-00001',
    method: 'GCash',
    refNo: 'SEED-00001',
    submittedAtISO: new Date().toISOString(),
    totalPHP: 1000,
    proofLabel: '',
    status: 'submitted',
    createdAtISO: new Date().toISOString(),
  })

  await client.close()
  console.log('Seed complete')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

