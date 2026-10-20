import express from 'express'
import nodemailer from 'nodemailer'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
// Routers are dynamically imported after loading environment variables
import { getDb } from './db/mongo.js'
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

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))

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
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.warn('MongoDB not connected yet:', String(err)))

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
  console.warn('SMTP credentials not provided. /api/contact will fail until configured.')
}

app.use('/api', uploadRouter)
app.use('/api/uploads', uploadRouter)
app.use('/api', reservationWorkflowsRouter)
app.use('/api', paymentsWorkflowsRouter)
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

app.post('/api/contact', async (req, res) => {
  const { name, email, message } = req.body || {}
  if (!message) return res.status(400).json({ error: 'message required' })
  if (!transporter) return res.status(500).json({ error: 'mail transporter not configured' })

  const mailOptions = {
    from: process.env.FROM_EMAIL || process.env.SMTP_USER,
    to: process.env.TO_EMAIL || 'support@chillshooters.com',
    subject: `Website contact${name ? ` - ${name}` : ''}`,
    text: `From: ${name || 'Anonymous'} <${email || 'no-reply'}>\n\n${message}`,
  }

  try {
    const info = await transporter.sendMail(mailOptions)
    return res.json({ ok: true, info })
  } catch (err) {
    console.error('sendMail error', err)
    return res.status(500).json({ error: 'failed to send', details: String(err) })
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
