import nodemailer from 'nodemailer'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

// Load server/.env early so this module reads the configured EMAIL_USER/PASS
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.resolve(__dirname, '..', '.env') })
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true })

const user = process.env.EMAIL_USER || ''
const pass = process.env.EMAIL_PASS || ''
const brevoApiKey = process.env.BREVO_API_KEY || ''

// Parses "Name <email@x.com>" or a bare address into Brevo's { name, email } shape.
function parseAddress(value) {
  const match = String(value || '').match(/^\s*(.*?)\s*<([^>]+)>\s*$/)
  if (match) return { name: match[1] || undefined, email: match[2].trim() }
  return { email: String(value || '').trim() }
}

// Brevo's HTTP API goes over HTTPS (port 443), so it works on hosts like Render's
// free tier that block outbound SMTP ports. Mirrors nodemailer's sendMail() shape
// so callers don't care which transport is active.
function createBrevoTransport(apiKey) {
  return {
    async sendMail({ from, to, subject, html, text }) {
      const sender = parseAddress(process.env.EMAIL_FROM || from)
      const recipients = (Array.isArray(to) ? to : String(to).split(','))
        .map(parseAddress)
        .filter((r) => r.email)

      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender,
          to: recipients,
          subject,
          ...(html ? { htmlContent: html } : {}),
          ...(text ? { textContent: text } : {}),
        }),
        signal: AbortSignal.timeout(15000),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(`Brevo send failed (${response.status}): ${payload.message || payload.code || 'unknown error'}`)
      }
      return { messageId: payload.messageId }
    },
  }
}

// Gmail SMTP fallback for local development. EMAIL_PASS must be an app password.
function createSmtpTransport() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user,
      pass,
    },
    // Fail fast instead of nodemailer's 2-minute default, so a blocked SMTP port
    // surfaces as a JSON error rather than the host dropping the hung request.
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  })
}

const transporter = brevoApiKey ? createBrevoTransport(brevoApiKey) : createSmtpTransport()

// Log presence (not value) of credentials to aid debugging without leaking secrets
if (brevoApiKey) {
  console.log('mailService: using Brevo HTTP API; EMAIL_FROM set?', Boolean(process.env.EMAIL_FROM), 'EMAIL_USER set?', Boolean(user))
} else {
  console.log('mailService: using Gmail SMTP; EMAIL_USER set?', Boolean(user), 'EMAIL_PASS length:', pass ? pass.length : 0)
}

export default transporter
