import express from 'express'
import nodemailer from 'nodemailer'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
// Routers are dynamically imported after loading environment variables
import { getDb, startDbSession } from './db/mongo.js'
import { ensureDatabaseSetup } from './db/setup.js'
import { requireAuth, requireRole } from './middleware/auth.js'
import { configuredAppUrl, rememberAppOrigin } from './utils/appUrl.js'
import { signFileLinksForSignedIn } from './utils/fileLinks.js'
import { bumpTopics, changeSnapshot, trackChanges } from './utils/changeFeed.js'
import { corsPolicy, errorHandler, hideServerErrors, noStoreForAuthenticated, rateLimit, securityHeaders } from './middleware/security.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.resolve(__dirname, '.env') })
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true })

// Import routers after .env is loaded so modules that read process.env get correct values
const { default: crudRouter } = await import('./routes/crud.js')
const { default: authRouter } = await import('./routes/auth.js')
const { default: uploadRouter } = await import('./routes/uploads.js')
const { default: reservationWorkflowsRouter } = await import('./routes/reservationWorkflows.js')
const { default: paymentsWorkflowsRouter } = await import('./routes/paymentsWorkflows.js')
const { default: operationsRouter } = await import('./routes/operations.js')
const { default: teamBookingsRouter } = await import('./routes/teamBookings.js')
const { default: fieldOpsRouter } = await import('./routes/fieldOps.js')
const { default: guardianApprovalsRouter } = await import('./routes/guardianApprovals.js')
const { default: xenditRouter } = await import('./routes/xendit.js')
const { default: recommendationsRouter } = await import('./routes/recommendations.js')
const { default: weatherRouter } = await import('./routes/weather.js')
const { default: childrenRouter } = await import('./routes/children.js')
const { default: causeDaysRouter } = await import('./routes/causeDays.js')
const { default: myGearRouter } = await import('./routes/myGear.js')
const { expireOverdueReservations, notifyRole, sendSplitPaymentWarnings } = await import('./utils/paymentProgress.js')
const { expireOldIdentities } = await import('./utils/identityValidity.js')
const { sendDueReminders } = await import('./utils/reminders.js')
const { checkAmmoStock } = await import('./utils/ammoStock.js')
const { closePastGames } = await import('./utils/pastGames.js')
const { startDueGames } = await import('./utils/dueGames.js')
const { refreshWeatherOutlook, sendWeatherAlerts } = await import('./utils/weather.js')
const { backfillGameplayLocations } = await import('./utils/reservationGameplay.js')
const { parseAddress } = await import('./services/mailService.js')
const { sendUnpaidReservationEmails } = await import('./services/notificationEmails.js')

const app = express()
// The API runs behind Render's proxy: trust that one hop so req.ip is the visitor's address
// (used by the login and code guessing limits), not the proxy's.
app.set('trust proxy', 1)
// Security: no framework banner, strict headers, only our website's origins, no caching of
// signed-in answers, and no internal error details in production (see middleware/security.js).
app.disable('x-powered-by')
app.use(securityHeaders)
app.use(corsPolicy())
app.use(noStoreForAuthenticated)
app.use(hideServerErrors)
// Flood protection per visitor address: the whole API, plus tighter limits on sign-in/sign-up,
// uploads (which hit paid services) and the public contact form.
app.use('/api', rateLimit({ name: 'api', windowMs: 60_000, max: 1000 }))
app.use('/api/auth', rateLimit({ name: 'auth', windowMs: 15 * 60_000, max: 100, message: 'Too many sign-in requests. Please wait a few minutes and try again.' }))
app.use(['/api/upload-image', '/api/upload-document', '/api/scan-id', '/api/uploads'], rateLimit({ name: 'uploads', windowMs: 10 * 60_000, max: 40, message: 'Too many uploads. Please wait a few minutes and try again.' }))
app.use('/api/contact', rateLimit({ name: 'contact', windowMs: 60 * 60_000, max: 5, message: 'Too many messages sent. Please try again later.' }))
// Email links need the website's address; remember it from the site calling the API.
app.use(rememberAppOrigin)
if (!configuredAppUrl()) {
  console.warn('PUBLIC_APP_URL is not set: email links use the address of the site calling the API, or http://localhost:5173 until one does. Set it to the website address (for example https://your-site.vercel.app).')
}
app.use(express.json({ limit: '10mb' }))
// Links to private uploads (ID photos) are signed and expire; see utils/fileLinks.js.
app.use(signFileLinksForSignedIn)
// Open pages poll this to refresh themselves when data changes (see utils/changeFeed.js).
app.use(trackChanges)
app.get('/api/changes', (_req, res) => {
  res.set('Cache-Control', 'no-store')
  return res.json({ ok: true, data: changeSnapshot() })
})

const PORT = Number(process.env.PORT) || 3001

getDb()
  .then(async (db) => {
    console.log('MongoDB connected')
    try {
      await ensureDatabaseSetup(db)
    } catch (err) {
      console.error('Database setup failed:', err)
    }
    backfillGameplayLocations(db).catch((err) => console.warn('Gameplay location backfill failed:', String(err)))
  })
  .catch((err) => console.warn('MongoDB not connected yet:', String(err)))

// Release slots whose pending payment window has run out, even when nobody is browsing.
setInterval(() => {
  getDb()
    .then(async (db) => {
      const expired = await expireOverdueReservations(db, startDbSession, { force: true })
      if (expired > 0) bumpTopics('reservations', 'slots', 'notifications')
      await sendSplitPaymentWarnings(db, { force: true })
      // One "waiting for payment" email for bookings left unpaid a few minutes.
      await sendUnpaidReservationEmails(db)
      await expireOldIdentities(db)
    })
    .catch((err) => console.warn('Payment window sweep failed:', String(err)))
}, 60_000).unref()

// Slot holds run out on their own (no request to notice), so look for holds that expired since the
// last check and tell open booking pages the slot is free again.
let lastHoldCheck = new Date()
setInterval(() => {
  const now = new Date()
  getDb()
    .then((db) => db.collection('slot_holds').countDocuments({ expiresAt: { $gt: lastHoldCheck, $lte: now } }))
    .then((count) => { if (count > 0) bumpTopics('slots') })
    .catch(() => null)
    .finally(() => { lastHoldCheck = now })
}, 15_000).unref()

// Game-day and waiver reminders; each one is sent once, so a frequent sweep is safe.
setInterval(() => {
  getDb()
    .then(async (db) => {
      await sendDueReminders(db, { force: true })
      // BB ammo low-stock notice, also caught here after a restock or a stock edit.
      await checkAmmoStock(db).catch((err) => console.warn('Ammo stock check failed:', String(err)))
      // Games left Scheduled or Ongoing after their day are closed (Completed, or Cancelled).
      await closePastGames(db).catch((err) => console.warn('Closing past games failed:', String(err)))
    })
    .catch((err) => console.warn('Reminder sweep failed:', String(err)))
}, 30 * 60_000).unref()
// Also right after start-up, so games from earlier days don't wait for the first sweep.
setTimeout(() => {
  getDb().then((db) => closePastGames(db)).catch((err) => console.warn('Closing past games failed:', String(err)))
}, 25_000).unref()

// Games whose slot has begun: started automatically when every gun passed today's FPS check,
// otherwise marked "due to start" and the marshals are told (utils/dueGames.js).
function runDueGames() {
  getDb()
    .then((db) => startDueGames(db))
    .catch((err) => console.warn('Starting due games failed:', String(err)))
}
setInterval(runDueGames, 5 * 60_000).unref()
setTimeout(runDueGames, 30_000).unref()
setTimeout(() => {
  getDb().then((db) => checkAmmoStock(db)).catch((err) => console.warn('Ammo stock check failed:', String(err)))
}, 20_000).unref()

// Weather from the OpenWeather API, hourly and once shortly after start-up:
// - the 5-day outlook every account sees on the dashboard weather widget, and
// - the day-before advisory to booked players (sent once per reservation and day).
function runWeatherChecks() {
  getDb()
    .then(async (db) => {
      await refreshWeatherOutlook(db).catch((err) => console.warn('Weather outlook failed:', String(err)))
      await sendWeatherAlerts(db).catch((err) => console.warn('Weather check failed:', String(err)))
    })
    .catch((err) => console.warn('Weather check failed:', String(err)))
}
setTimeout(runWeatherChecks, 15_000).unref()
setInterval(runWeatherChecks, 60 * 60_000).unref()

let transporter
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })
} else {
  if (!process.env.BREVO_API_KEY) console.warn('No BREVO_API_KEY or SMTP credentials set. /api/contact will fail until configured.')
}

// Public: must be registered before the /api routers, which require auth.
const CONTACT_TO = process.env.TO_EMAIL || 'chillshooters.agc@gmail.com'
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Render's free tier blocks outbound SMTP, so prefer Brevo's HTTPS API when
// BREVO_API_KEY is set and fall back to the SMTP transporter for local dev.
async function sendContactEmail({ name, email, message }) {
  const subject = `Website contact - ${name}`
  const text = `From: ${name} <${email}>

${message}`

  if (process.env.BREVO_API_KEY) {
    const sender = process.env.EMAIL_FROM || process.env.FROM_EMAIL
    if (!sender) throw new Error('EMAIL_FROM is not configured')
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        // EMAIL_FROM may be "Name <email>"; Brevo needs the bare address.
        sender: { email: parseAddress(sender).email, name: 'Chill Shooters Website' },
        to: [{ email: CONTACT_TO }],
        replyTo: { email, name },
        subject,
        textContent: text,
      }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) throw new Error(`Brevo responded ${res.status}: ${await res.text()}`)
    return
  }

  if (!transporter) throw new Error('mail transporter not configured')
  await transporter.sendMail({
    from: process.env.FROM_EMAIL || process.env.SMTP_USER,
    to: CONTACT_TO,
    replyTo: `${name} <${email}>`,
    subject,
    text,
  })
}

app.post('/api/contact', async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 100)
  const email = String(req.body?.email || '').trim().slice(0, 200)
  const message = String(req.body?.message || '').trim().slice(0, 5000)

  if (!name) return res.status(400).json({ ok: false, error: 'Please enter your name.' })
  if (!EMAIL_PATTERN.test(email)) return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' })
  if (!message) return res.status(400).json({ ok: false, error: 'Please write a message.' })

  // Every message is saved to the admin Inbox first, then emailed to the official address. A
  // failed email doesn't lose the message: it stays in the Inbox, marked as not emailed.
  let db
  let saved
  try {
    db = await getDb()
    saved = {
      id: `MSG-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      name,
      email,
      message,
      status: 'new',
      emailStatus: 'sending',
      createdAtISO: new Date().toISOString(),
    }
    await db.collection('contact_messages').insertOne(saved)
  } catch (err) {
    console.error('contact message save error', err)
  }

  let emailed = false
  try {
    await sendContactEmail({ name, email, message })
    emailed = true
  } catch (err) {
    console.error('contact email error', err)
  }
  if (saved) {
    await db.collection('contact_messages').updateOne({ id: saved.id }, { $set: { emailStatus: emailed ? 'sent' : 'failed' } }).catch(() => null)
    await notifyRole(db, {
      role: 'admin',
      type: 'contact_message',
      title: `New message from ${name}`,
      message: `${name} (${email}): ${message.slice(0, 140)}${message.length > 140 ? '…' : ''}`,
      linkedResourceId: saved.id,
    })
  }
  if (!saved && !emailed) return res.status(502).json({ ok: false, error: 'Could not send your message right now.' })
  return res.json({ ok: true })
})

// Admin Inbox: messages players send from the website's message form.
const INBOX_STATUSES = ['new', 'read', 'replied', 'archived']

app.get('/api/admin/inbox', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const db = await getDb()
    const status = String(req.query.status || '')
    const filter = INBOX_STATUSES.includes(status) ? { status } : { status: { $ne: 'archived' } }
    const [data, unread] = await Promise.all([
      db.collection('contact_messages').find(filter, { projection: { _id: 0 } }).sort({ createdAtISO: -1 }).limit(500).toArray(),
      db.collection('contact_messages').countDocuments({ status: 'new' }),
    ])
    return res.json({ ok: true, data, unread })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

app.put('/api/admin/inbox/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const status = String(req.body?.status || '')
  if (!INBOX_STATUSES.includes(status)) return res.status(400).json({ ok: false, error: 'Choose new, read, replied or archived.' })
  try {
    const db = await getDb()
    const nowISO = new Date().toISOString()
    const result = await db.collection('contact_messages').findOneAndUpdate(
      { id: String(req.params.id) },
      { $set: { status, updatedAtISO: nowISO, updatedBy: { id: String(req.user.id), role: req.user.role } } },
      { returnDocument: 'after', projection: { _id: 0 } },
    )
    if (!result) return res.status(404).json({ ok: false, error: 'Message not found' })
    return res.json({ ok: true, data: result })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// POST /api/admin/inbox/:id/reply { body } — the server emails the reply, so it always goes out
// from the center's sender (never an admin's personal account). The player's answer goes to the
// official address (reply-to), which also gets a hidden copy of every reply.
app.post('/api/admin/inbox/:id/reply', requireAuth, requireRole('admin'), async (req, res) => {
  const body = String(req.body?.body || '').replace(/\r\n/g, '\n').trim().slice(0, 5000)
  if (!body) return res.status(400).json({ ok: false, error: 'Write your reply.' })
  try {
    const db = await getDb()
    const original = await db.collection('contact_messages').findOne({ id: String(req.params.id) })
    if (!original) return res.status(404).json({ ok: false, error: 'Message not found' })

    const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
    const paragraphs = (text) => escape(text).split(/\n{2,}/).map((part) => `<p>${part.replace(/\n/g, '<br>')}</p>`).join('')
    const sentOn = new Date(original.createdAtISO).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })
    // Reads as a message from the center: a branded header and intro, the reply, then the sign-off.
    const center = 'Chill Shooters Airsoft Game Center'
    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
        <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;">Message from ${center}</div>
        <p>Hi ${escape(original.name || 'there')}, this is ${center} replying to your message.</p>
        ${paragraphs(body)}
        <p>Thank you,<br><strong>${center}</strong></p>
        <div style="margin-top:16px;padding-left:12px;border-left:3px solid #e5e7eb;color:#6b7280;font-size:13px;">
          <p style="margin:0 0 4px;">On ${escape(sentOn)}, you wrote:</p>
          ${paragraphs(original.message)}
        </div>
      </div>`
    const text = `Message from ${center}\n\nHi ${original.name || 'there'}, this is ${center} replying to your message.\n\n${body}\n\nThank you,\n${center}\n\n---\nOn ${sentOn}, you wrote:\n${original.message}`

    const { default: mailer } = await import('./services/mailService.js')
    try {
      await mailer.sendMail({
        from: `Chill Shooters <${process.env.EMAIL_USER || CONTACT_TO}>`,
        to: original.email,
        replyTo: `Chill Shooters <${CONTACT_TO}>`,
        bcc: CONTACT_TO,
        subject: `${center} replied to your message`,
        html,
        text,
      })
    } catch (err) {
      console.error('inbox reply email error', err)
      return res.status(502).json({ ok: false, error: 'The reply could not be sent. Please try again.' })
    }

    const nowISO = new Date().toISOString()
    const reply = { body, byId: String(req.user.id), byEmail: req.user.email || '', atISO: nowISO }
    const updated = await db.collection('contact_messages').findOneAndUpdate(
      { id: original.id },
      { $push: { replies: reply }, $set: { status: 'replied', updatedAtISO: nowISO, updatedBy: { id: String(req.user.id), role: req.user.role } } },
      { returnDocument: 'after', projection: { _id: 0 } },
    )
    return res.json({ ok: true, data: updated })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

app.use('/api', uploadRouter)
app.use('/api/uploads', uploadRouter)
app.use('/api', reservationWorkflowsRouter)
app.use('/api', paymentsWorkflowsRouter)
app.use('/api', operationsRouter)
app.use('/api', teamBookingsRouter)
app.use('/api', fieldOpsRouter)
// Before crudRouter: the guardian link is public and must not hit its auth-required /:collection/:id.
app.use('/api', guardianApprovalsRouter)
app.use('/api', xenditRouter)
app.use('/api', recommendationsRouter)
app.use('/api', weatherRouter)
app.use('/api', childrenRouter)
app.use('/api', causeDaysRouter)
app.use('/api', myGearRouter)
app.use('/api/auth', authRouter)
// Admin notification log: notifications are archived, never cleared. Archiving only takes them off
// the admin's Sent notifications list (they stay on record and can be restored); the players and
// staff who received them keep theirs.
// POST /api/notifications/archive { ids?: string[] } — no ids archives every notification.
app.post('/api/notifications/archive', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).filter(Boolean).slice(0, 1000) : null
    if (ids && ids.length === 0) return res.status(400).json({ ok: false, error: 'Choose notifications to archive.' })
    const db = await getDb()
    const result = await db.collection('notifications').updateMany(
      { ...(ids ? { id: { $in: ids } } : {}), archivedAtISO: { $exists: false } },
      { $set: { archivedAtISO: new Date().toISOString(), archivedBy: String(req.user.id) } },
    )
    return res.json({ ok: true, archived: result.modifiedCount || 0 })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// GET /api/notifications/sent?archived=1 — every notification the system has sent, to anyone
// (newest 1000), for the admin's Sent notifications log. Personal ones carry the recipient's name.
// Separate from GET /api/notifications, which returns only the admin's own (their bell).
app.get('/api/notifications/sent', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const db = await getDb()
    const archived = req.query.archived === '1'
    const data = await db.collection('notifications')
      .find({ archivedAtISO: { $exists: archived } }, { projection: { _id: 0 } })
      .sort({ createdAtISO: -1 })
      .limit(1000)
      .toArray()
    const personIds = [...new Set(data.map((n) => String(n.userId || '')).filter((id) => id && id !== 'broadcast'))]
    const accounts = personIds.length
      ? await db.collection('user_accounts').find({ id: { $in: personIds } }, { projection: { _id: 0, id: 1, name: 1, role: 1 } }).toArray()
      : []
    const byId = new Map(accounts.map((a) => [String(a.id), a]))
    const [activeCount, archivedCount] = await Promise.all([
      db.collection('notifications').countDocuments({ archivedAtISO: { $exists: false } }),
      db.collection('notifications').countDocuments({ archivedAtISO: { $exists: true } }),
    ])
    return res.json({
      ok: true,
      data: data.map((n) => {
        const person = byId.get(String(n.userId))
        return person ? { ...n, recipientName: person.name || '', recipientRole: person.role || 'user' } : n
      }),
      activeCount,
      archivedCount,
    })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// POST /api/notifications/unarchive { ids: string[] } — puts archived notifications back on the list.
app.post('/api/notifications/unarchive', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).filter(Boolean).slice(0, 1000) : []
    if (ids.length === 0) return res.status(400).json({ ok: false, error: 'Choose notifications to restore.' })
    const db = await getDb()
    const result = await db.collection('notifications').updateMany({ id: { $in: ids } }, { $unset: { archivedAtISO: '', archivedBy: '' } })
    return res.json({ ok: true, restored: result.modifiedCount || 0 })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

app.use('/api', crudRouter)

// Unknown API paths and anything thrown past a route.
app.use('/api', (_req, res) => res.status(404).json({ ok: false, error: 'Not found' }))
app.use(errorHandler)

const server = app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`)
})

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} is already in use. Stop the process using that port or set PORT to another value before running npm run dev:all.`,
    )
    process.exit(1)
  }

  throw err
})
