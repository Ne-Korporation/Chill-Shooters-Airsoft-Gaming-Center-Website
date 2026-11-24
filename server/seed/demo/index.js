// Builds the capstone demo database: a separate copy of the business setup with realistic,
// connected demo data (accounts, waivers, bookings, payments, games, inventory activity, finances).
//
// It never writes to the source (production) database: it only reads from it, after backing it up.
// The target must be a database whose name contains "demo", and the run must be confirmed by
// naming the target again.
//
// Usage (from the project root):
//   node server/seed/demo/index.js --plan
//       Show what would be copied, cleared and generated. Writes nothing.
//   node server/seed/demo/index.js --confirm chillshooters_demo [--files-base http://localhost:3001]
//       Back up the source, rebuild chillshooters_demo from scratch, seed it and validate it.
//   node server/seed/demo/index.js --validate-only --target chillshooters_demo
//       Re-run the checks on an existing demo database.
//
// Options:
//   --target <db>       Demo database to rebuild (default chillshooters_demo). Must contain "demo".
//   --source <db>       Database to copy the business setup from (default DB_NAME or
//                       chillshootersgamecenter). Read only.
//   --files-base <url>  Address of the API that will serve the demo uploads (ID photos, GCash
//                       receipts, posters). Default http://localhost:3001 (the local API).
//   --no-backup         Skip the JSON backup of the source (not recommended).

import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { BSON, MongoClient } from 'mongodb'
import dns from 'dns'

const here = path.dirname(fileURLToPath(import.meta.url))
const serverDir = path.join(here, '..', '..')
dotenv.config({ path: path.join(serverDir, '.env') })
dns.setServers(['8.8.8.8', '1.1.1.1'])

// ---------------------------------------------------------------------------
// Arguments and safety checks
// ---------------------------------------------------------------------------
const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
const SOURCE = option('source', process.env.DB_NAME || 'chillshootersgamecenter')
const TARGET = option('target', option('confirm', 'chillshooters_demo'))
const FILES_BASE = option('files-base', process.env.DEMO_FILES_BASE_URL || 'http://localhost:3001')
const PLAN_ONLY = flag('plan')
const VALIDATE_ONLY = flag('validate-only')
const CONFIRMED = option('confirm', '') === TARGET

function productionDbNames() {
  const names = new Set(['chillshootersgamecenter'])
  try {
    const render = fs.readFileSync(path.join(serverDir, '..', 'render.yaml'), 'utf8')
    const match = render.match(/key:\s*DB_NAME\s*\r?\n\s*value:\s*(\S+)/)
    // The deployed API may run on the demo database for a presentation; that one may be reseeded.
    if (match && !/demo/i.test(match[1])) names.add(match[1])
  } catch { /* no render.yaml */ }
  return names
}

function stop(message) {
  console.error(`\n✖ ${message}\n`)
  process.exit(1)
}

if (!process.env.MONGODB_URI) stop('MONGODB_URI is not set (server/.env).')
if (!/demo/i.test(TARGET)) stop(`The target "${TARGET}" does not look like a demo database. Its name must contain "demo".`)
if (TARGET === SOURCE) stop('The target and the source are the same database. Refusing.')
if (productionDbNames().has(TARGET)) stop(`"${TARGET}" is the production database (render.yaml). Refusing.`)

// Data that is kept from the source, cleared, or generated. Shown by --plan.
const KEEP = {
  user_accounts: 'staff accounts only (admin, registrar, marshal); players are replaced by demo players',
  weapons: 'business inventory (player-registered guns are replaced); every piece reset to available',
  equipments: 'business inventory; reset to available; BB stock set to a realistic level',
  packages: 'as is',
  settings: 'slot hours, donation fund rate, penalty rules (locks dropped)',
  site_settings: 'waiver text',
  partnerships: 'as is, plus the Cavite State University partner record',
  cause_days: 'future ones only, plus one past demo cause day',
  closed_days: 'future ones only, plus the holiday closures',
  uploaded_files: 'only files referenced by kept records, plus the generated demo images',
}
const CLEAR = ['auth_attempts', 'slot_holds', 'inventory_holds', 'reservation_slot_locks', 'reservation_status_locks', 'xendit_checkouts', 'payment_deposit_locks', 'payment_reference_locks', 'inventory_item_locks', 'weather_advisories', 'notifications', 'email_log', 'weather_daily', 'weather_outlook']
const REGENERATE = ['reservations', 'guardian_approvals', 'team_assignments', 'field_checkins', 'gameplay', 'payments', 'receipts', 'operating_expenses', 'reach_fund_ledger', 'reach_programs', 'partner_loans', 'rentals', 'damage_reports', 'repairs', 'fps_logs', 'audit_logs', 'waivers', 'dashboard_posts', 'contact_messages', 'feedback', 'notifications', 'weather_advisories']

function printPlan() {
  console.log(`\nSource (read only): ${SOURCE}`)
  console.log(`Target (rebuilt):   ${TARGET}`)
  console.log(`Demo uploads served from: ${FILES_BASE}/api/files/…\n`)
  console.log('Kept from the source:')
  for (const [name, how] of Object.entries(KEEP)) console.log(`  ${name.padEnd(26)} ${how}`)
  console.log('\nCleared (temporary records):')
  console.log(`  ${CLEAR.join(', ')}`)
  console.log('\nGenerated (connected demo history and current activity):')
  console.log(`  ${[...new Set(REGENERATE)].join(', ')}\n`)
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------
async function backup(db, label) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = path.join(serverDir, 'backups', `${stamp}-${label}`)
  fs.mkdirSync(dir, { recursive: true })
  const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).sort()
  let total = 0
  for (const name of names) {
    const docs = await db.collection(name).find({}).toArray()
    fs.writeFileSync(path.join(dir, `${name}.json`), BSON.EJSON.stringify(docs, { relaxed: false }))
    total += docs.length
  }
  console.log(`Backed up ${label}: ${names.length} collections, ${total} documents → ${path.relative(process.cwd(), dir)}`)
  return dir
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (PLAN_ONLY) return printPlan()

  const client = new MongoClient(process.env.MONGODB_URI)
  await client.connect()
  const source = client.db(SOURCE)
  const target = client.db(TARGET)
  const { validateDemo } = await import('./validate.js')
  const { getSlotHours } = await import('../../utils/slotHours.js')
  const { manilaDay } = await import('./lib.js')

  if (VALIDATE_ONLY) {
    const now = Date.now()
    const report = await validateDemo(target, { now, todayISO: manilaDay(now), slotHours: (await getSlotHours(target)).hours })
    printReport(report)
    await client.close()
    process.exit(report.errors.length ? 1 : 0)
  }

  if (!CONFIRMED) {
    printPlan()
    stop(`Nothing was changed. To rebuild "${TARGET}", run again with --confirm ${TARGET}`)
  }

  const sourceCollections = (await source.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name)
  if (!sourceCollections.includes('packages')) stop(`The source "${SOURCE}" has no packages collection. Is it the right database?`)

  printPlan()
  if (!flag('no-backup')) {
    await backup(source, SOURCE)
    const targetCollections = await target.listCollections({}, { nameOnly: true }).toArray()
    if (targetCollections.length) await backup(target, TARGET)
  }

  const started = Date.now()
  await target.dropDatabase()
  console.log(`Cleared ${TARGET}.`)

  const lib = await import('./lib.js')
  const { ensureDatabaseSetup } = await import('../../db/setup.js')
  await ensureDatabaseSetup(target)

  const now = Date.now()
  const todayISO = lib.manilaDay(now)
  const rng = lib.createRng(20261124)
  const historyStart = `${todayISO.slice(0, 4)}-08-01` < todayISO ? `${todayISO.slice(0, 4)}-08-01` : lib.addDays(todayISO, -110)
  const files = lib.createFileStore(FILES_BASE)

  // ----- kept business setup ----------------------------------------------------------------
  const copy = async (name, filter = {}, transform = (d) => d) => {
    const docs = (await source.collection(name).find(filter).toArray()).map(transform).filter(Boolean)
    if (docs.length) await target.collection(name).insertMany(docs)
    return docs
  }
  const keptStaff = await copy('user_accounts', { role: { $in: ['admin', 'registrar', 'marshal'] } })
  const resetPiece = (d) => {
    const { maintenanceReason, ...rest } = d
    void maintenanceReason
    return String(rest.category || '').toLowerCase() === 'ammo' ? rest : { ...rest, status: 'available' }
  }
  await copy('weapons', { source: { $ne: 'player' } }, resetPiece)
  await copy('equipments', { source: { $ne: 'player' } }, resetPiece)
  await copy('packages')
  await copy('settings', { _id: { $nin: ['reach_fund_lock'] } })
  const siteSettings = await copy('site_settings')
  const partners = await copy('partnerships')
  await copy('cause_days', { dateISO: { $gte: todayISO } })
  await copy('closed_days', { dateISO: { $gte: todayISO } })
  const reach = await target.collection('settings').findOne({ _id: 'reach_fund' })
  const ratePercent = Number(reach?.ratePercent) > 0 ? Number(reach.ratePercent) : 10
  if (!(Number(reach?.ratePercent) > 0)) await target.collection('settings').updateOne({ _id: 'reach_fund' }, { $set: { ratePercent, updatedAtISO: new Date(now - 120 * lib.DAY).toISOString() } }, { upsert: true })

  // Files referenced by kept records (e.g. staff profile photos).
  const keptText = JSON.stringify(await Promise.all(['user_accounts', 'packages', 'settings', 'site_settings', 'partnerships', 'weapons', 'equipments'].map((n) => target.collection(n).find({}).toArray())))
  const keptFileIds = [...new Set([...keptText.matchAll(/\/api\/files\/([0-9a-f-]{36})/gi)].map((m) => m[1]))]
  if (keptFileIds.length) {
    const keptFiles = await source.collection('uploaded_files').find({ _id: { $in: keptFileIds } }).toArray()
    if (keptFiles.length) await target.collection('uploaded_files').insertMany(keptFiles)
    console.log(`Copied ${keptFiles.length} uploaded file(s) used by kept records.`)
  }

  // ----- people -----------------------------------------------------------------------------
  const { buildPeople } = await import('./people.js')
  const waiverText = siteSettings.find((s) => s.key === 'waiver_text')?.text
  const people = await buildPeople({ now, todayISO, rng, files, keptStaff, waiverText })
  await target.collection('user_accounts').insertMany(people.accounts)
  await target.collection('waivers').insertMany(people.waivers)
  await target.collection('weapons').insertMany(people.ownWeapons)
  const staff = people.staff

  // ----- calendar and partners (before bookings, which read them) ---------------------------------
  const extras = await import('./extras.js')
  const cal = extras.calendarAndPartners({ now, todayISO, staff, historyStart })
  if (cal.causeDays.length) await target.collection('cause_days').insertMany(cal.causeDays)
  if (cal.closedDays.length) {
    for (const c of cal.closedDays) await target.collection('closed_days').updateOne({ dateISO: c.dateISO }, { $setOnInsert: c }, { upsert: true })
  }
  if (!partners.some((p) => /cavite state university/i.test(p.name))) await target.collection('partnerships').insertMany(cal.partnerships)

  // BB stock: plenty while the history is played out, then set to what's left today.
  await target.collection('equipments').updateMany({ category: 'ammo' }, { $set: { stockGrams: 1_000_000 } })

  // ----- bookings and everything that follows from them --------------------------------------------
  const { seedBookings } = await import('./bookings.js')
  const slotHours = (await getSlotHours(target)).hours
  const b = await seedBookings({ db: target, rng, now, todayISO, slotHours, people, staff, files, historyStart })
  const insert = async (name, docs) => { if (docs.length) await target.collection(name).insertMany(docs) }
  await insert('reservations', b.reservations)
  await insert('payments', b.payments)
  await insert('gameplay', b.gameplay)
  await insert('receipts', b.receipts)
  await insert('rentals', b.rentals)
  await insert('fps_logs', b.fpsLogs)
  await insert('damage_reports', b.damageReports)
  await insert('repairs', b.repairs)
  await insert('feedback', b.feedback)
  await insert('guardian_approvals', b.guardianApprovals)
  await insert('field_checkins', b.checkins)
  await insert('team_assignments', b.teamAssignments)
  await target.collection('receipts').createIndex({ reservationId: 1, paymentKey: 1 }, { unique: true })
  await target.collection('receipts').createIndex({ receiptNo: 1 }, { unique: true })
  await target.collection('reach_fund_ledger').createIndex({ periodKey: 1 }, { unique: true, partialFilterExpression: { type: 'allocation', periodKey: { $exists: true } } })

  // Public games share grounds by headcount: recompute each public slot's fields like the server does.
  const { syncPublicGrounds } = await import('../../utils/bookingSlots.js')
  const publicSlots = new Set(b.reservations.filter((r) => r.sessionType === 'public').map((r) => `${r.locationId}|${r.reservationDate}|${r.reservationTime}`))
  for (const key of publicSlots) {
    const [locationId, reservationDate, reservationTime] = key.split('|')
    await syncPublicGrounds(target, { locationId, reservationDate, reservationTime })
  }
  await target.collection('equipments').updateMany({ category: 'ammo' }, { $set: { stockGrams: 18_500, updatedAtISO: new Date(now - 2 * lib.DAY).toISOString() } })

  // ----- money, communication, logs ---------------------------------------------------------------------
  const expenses = extras.buildExpenses({ payments: b.payments, expenseHints: b.expenseHints, historyStart, todayISO, staff, rng })
  await insert('operating_expenses', expenses)
  const reachData = await extras.buildReachFund({ db: target, ratePercent, historyStart, todayISO, staff })
  await insert('reach_fund_ledger', reachData.entries)
  await insert('reach_programs', reachData.programs)
  await insert('partner_loans', extras.buildPartnerLoans({ partner: partners.find((p) => p.type === 'equipment_partner') || partners[0], historyStart, todayISO, staff }))
  const comms = extras.buildComms({ now, todayISO, staff, files, people, reservations: b.reservations, gameplay: b.gameplay, payments: b.payments, rng })
  await insert('dashboard_posts', comms.posts)
  await insert('contact_messages', comms.messages)
  await insert('notifications', comms.notifications)
  await insert('weather_advisories', comms.advisories)
  await insert('audit_logs', [...cal.auditLogs, ...b.auditLogs, ...extras.staffAuditLogs({ people, staff, now })])
  await insert('uploaded_files', files.files)

  // ----- validate and report ------------------------------------------------------------------------------
  const report = await validateDemo(target, { now, todayISO, slotHours })
  const counts = {}
  for (const c of (await target.listCollections({}, { nameOnly: true }).toArray()).map((x) => x.name).sort()) counts[c] = await target.collection(c).countDocuments()
  console.log('\nRecords per collection:')
  for (const [name, n] of Object.entries(counts)) console.log(`  ${name.padEnd(26)} ${n}`)
  summarize(b, todayISO)
  if (b.notes.length) console.log(`\nNotes:\n  ${b.notes.join('\n  ')}`)
  printReport(report)
  console.log(`\nDone in ${Math.round((Date.now() - started) / 1000)} s. Today in the demo: ${todayISO}.`)
  console.log(`Run the app on it with DB_NAME=${TARGET}.`)
  await client.close()
  process.exit(report.errors.length ? 1 : 0)
}

function summarize(b, todayISO) {
  const by = (list, f) => list.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m }, {})
  const when = (r) => (r.reservationDate < todayISO ? 'past' : r.reservationDate === todayISO ? 'today' : 'upcoming')
  console.log('\nReservations by time and status:')
  for (const [k, n] of Object.entries(by(b.reservations, (r) => `${when(r)} / ${r.reservationStatus}${r.cancellationReason === 'payment_window_expired' ? ' (expired unpaid)' : ''}`)).sort()) console.log(`  ${k.padEnd(40)} ${n}`)
  console.log('Games by status:')
  for (const [k, n] of Object.entries(by(b.gameplay, (g) => g.Status))) console.log(`  ${k.padEnd(40)} ${n}`)
  console.log('Payments by status and kind:')
  for (const [k, n] of Object.entries(by(b.payments, (p) => `${p.paymentStatus} / ${p.kind || 'online'}${p.demo ? ' (demo gateway)' : p.paymentMethod === 'GCash' && p.kind !== 'onsite' ? ' (GCash proof)' : ''}`)).sort()) console.log(`  ${k.padEnd(40)} ${n}`)
}

function printReport(report) {
  console.log(`\nValidation: ${report.errors.length} error(s), ${report.warnings.length} warning(s).`)
  for (const e of report.errors.slice(0, 60)) console.log(`  ✖ ${e}`)
  if (report.errors.length > 60) console.log(`  … and ${report.errors.length - 60} more`)
  for (const w of report.warnings.slice(0, 20)) console.log(`  ! ${w}`)
  if (report.stats?.reachBalance !== undefined) console.log(`  Donation fund balance: ₱${Math.round(report.stats.reachBalance).toLocaleString()}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
