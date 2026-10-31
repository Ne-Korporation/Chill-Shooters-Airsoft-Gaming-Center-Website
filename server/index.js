import express from 'express'
import nodemailer from 'nodemailer'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
// Routers are dynamically imported after loading environment variables
import { getDb, startDbSession } from './db/mongo.js'
import { ensureDatabaseSetup } from './db/setup.js'
import { requireAuth, requireRole } from './middleware/auth.js'

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
const { default: paymongoRouter } = await import('./routes/paymongo.js')
const { expireOverdueReservations } = await import('./utils/paymentProgress.js')
const { sendDueReminders } = await import('./utils/reminders.js')
const { parseAddress } = await import('./services/mailService.js')

const app = express()
app.use(cors())
// The raw body is kept for checking PayMongo's webhook signature, which is computed over the exact bytes sent.
app.use(express.json({ limit: '10mb', verify: (req, _res, buf) => { if (req.url.startsWith('/api/paymongo/webhook')) req.rawBody = buf.toString('utf8') } }))

const PORT = Number(process.env.PORT) || 3001

app.get('/api/public/metrics', async (_req, res) => {
  try {
    const db = await getDb()
    const [reservations, pendingReservations, pendingPayments, pendingWaivers, activeGames] = await Promise.all([
      db.collection('reservations').countDocuments({}),
      db.collection('reservations').countDocuments({ reservationStatus: { $in: ['pending', 'needs review', 'review'] } }),
      db.collection('payments').countDocuments({ paymentStatus: { $in: ['pending', 'submitted', 'review'] } }),
      db.collection('waivers').countDocuments({ status: { $in: ['pending', 'review', 'submitted'] } }),
      db.collection('gameplay').countDocuments({ Status: { $in: ['Scheduled', 'Ongoing', 'Completed'] } }),
    ])
    return res.json({ ok: true, data: { reservations, pendingReservations, pendingPayments, pendingWaivers, activeGames } })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

getDb()
  .then(async (db) => {
    console.log('MongoDB connected')
    try {
      await ensureDatabaseSetup(db)
    } catch (err) {
      console.error('Database setup failed:', err)
    }
  })
  .catch((err) => console.warn('MongoDB not connected yet:', String(err)))

// Release slots whose pending payment window has run out, even when nobody is browsing.
setInterval(() => {
  getDb()
    .then((db) => expireOverdueReservations(db, startDbSession, { force: true }))
    .catch((err) => console.warn('Payment window sweep failed:', String(err)))
}, 5 * 60_000).unref()

// Game-day and waiver reminders; each one is sent once, so a frequent sweep is safe.
setInterval(() => {
  getDb()
    .then((db) => sendDueReminders(db, { force: true }))
    .catch((err) => console.warn('Reminder sweep failed:', String(err)))
}, 30 * 60_000).unref()

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
const CONTACT_TO = process.env.TO_EMAIL || 'support@chillshooters.com'
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

  try {
    await sendContactEmail({ name, email, message })
    return res.json({ ok: true })
  } catch (err) {
    console.error('contact email error', err)
    return res.status(502).json({ ok: false, error: 'Could not send your message right now.' })
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
app.use('/api', paymongoRouter)
app.use('/api/auth', authRouter)
app.use('/api', crudRouter)

app.delete('/api/notifications', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const db = await getDb()
    const result = await db.collection('notifications').deleteMany({})
    return res.json({ ok: true, deletedCount: result.deletedCount || 0 })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

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
