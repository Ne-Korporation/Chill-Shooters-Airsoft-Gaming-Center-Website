import express from 'express'
import nodemailer from 'nodemailer'
import cors from 'cors'
import dotenv from 'dotenv'

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json())

const PORT = process.env.PORT || 3001

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

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Contact API server listening on http://localhost:${PORT}`)
})
