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

// Create a transporter using Gmail and app password. Ensure EMAIL_USER and
// EMAIL_PASS are set in server/.env (app password, not your normal account password).
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user,
    pass,
  },
})

// Log presence (not value) of credentials to aid debugging without leaking secrets
console.log('mailService: EMAIL_USER set?', Boolean(user), 'EMAIL_PASS length:', pass ? pass.length : 0)

export default transporter
