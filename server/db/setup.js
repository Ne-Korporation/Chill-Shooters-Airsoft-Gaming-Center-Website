import { canonicalEmail } from '../utils/emails.js'
import { USER_ACCOUNTS_COLLECTION } from './mongo.js'
import { splitStockIntoPieces } from '../utils/inventoryPieces.js'

// MongoDB only creates a collection on its first insert, so admin pages such as
// the REACH fund look empty in Atlas until something is written. Create every
// collection the app uses up front.
const REQUIRED_COLLECTIONS = [
  'audit_logs',
  'damage_reports',
  'dashboard_posts',
  'equipments',
  'feedback',
  'fps_logs',
  'gameplay',
  'inventory_holds',
  'inventory_item_locks',
  'notifications',
  'operating_expenses',
  'packages',
  'partner_loans',
  'partnerships',
  'payment_deposit_locks',
  'payment_reference_locks',
  'payments',
  'reach_fund_ledger',
  'reach_programs',
  'receipts',
  'reservation_slot_locks',
  'reservation_status_locks',
  'rentals',
  'repairs',
  'reservations',
  'settings',
  'site_settings',
  'slot_holds',
  'team_assignments',
  'uploaded_files',
  USER_ACCOUNTS_COLLECTION,
  'waivers',
  'weather_advisories',
  'weapons',
]

async function ensureCollections(db) {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name))
  const created = []
  for (const name of REQUIRED_COLLECTIONS) {
    if (existing.has(name)) continue
    try {
      await db.createCollection(name)
      created.push(name)
    } catch (err) {
      // 48 = NamespaceExists: another instance created it first.
      if (err?.code !== 48) throw err
    }
  }
  if (created.length) console.log('Created MongoDB collections:', created.join(', '))
}

// One account per inbox: store the canonical email on every account and back
// it with a unique index so even concurrent sign-ups cannot create a duplicate.
async function ensureUniqueEmails(db) {
  const accounts = db.collection(USER_ACCOUNTS_COLLECTION)
  const missing = await accounts
    .find({ email: { $type: 'string' }, emailCanonical: { $exists: false } }, { projection: { email: 1 } })
    .toArray()
  for (const account of missing) {
    await accounts.updateOne({ _id: account._id }, { $set: { emailCanonical: canonicalEmail(account.email) } })
  }

  const duplicates = await accounts.aggregate([
    { $match: { emailCanonical: { $type: 'string' } } },
    { $group: { _id: '$emailCanonical', ids: { $push: '$id' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]).toArray()
  if (duplicates.length) {
    console.warn(
      `Cannot add the unique email index: ${duplicates.length} email(s) are shared by several accounts. ` +
      'Merge or delete the extra accounts, then restart. New sign-ups are still blocked from reusing an email.',
      duplicates.map((d) => ({ email: d._id, accountIds: d.ids })),
    )
    return
  }
  await accounts.createIndex(
    { emailCanonical: 1 },
    { unique: true, name: 'unique_email_canonical', partialFilterExpression: { emailCanonical: { $type: 'string' } } },
  )
}

async function ensureInventoryIndexes(db) {
  await db.collection('inventory_holds').createIndex({ status: 1, reservationDate: 1, reservationTime: 1 })
  await db.collection('inventory_holds').createIndex({ reservationId: 1 })
}

export async function ensureDatabaseSetup(db) {
  await ensureCollections(db)
  await ensureUniqueEmails(db)
  await ensureInventoryIndexes(db)
  // Rental gear is tracked one piece per record; convert any stock counts left from before.
  await splitStockIntoPieces(db)
}
