import express from 'express'
import bcrypt from 'bcrypt'
import transporter from '../services/mailService.js'
import { getDb, getUserAccountsCollection, USER_ACCOUNTS_COLLECTION } from '../db/mongo.js'
import { createAuthToken, requireAuth, requireRole } from '../middleware/auth.js'
import { nextShortId } from '../utils/shortIds.js'

const router = express.Router()


function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

export function validatePasswordRequirements(password) {
  const value = typeof password === 'string' ? password : ''
  const checks = {
    hasMinLength: value.length >= 8,
    hasUppercase: /[A-Z]/.test(value),
    hasLowercase: /[a-z]/.test(value),
    hasSpecial: /[!@#$%^&*(),.?":{}|<>_\-\[\]`~;'\/]/.test(value),
  }

  const errors = []
  if (!checks.hasMinLength) errors.push('At least 8 characters')
  if (!checks.hasUppercase) errors.push('At least 1 uppercase letter')
  if (!checks.hasLowercase) errors.push('At least 1 lowercase letter')
  if (!checks.hasSpecial) errors.push('At least 1 special symbol')

  return {
    checks,
    errors,
    valid: Object.values(checks).every(Boolean),
  }
}

export function validateGoogleLoginEligibility(user) {
  if (!user) {
    return {
      allowed: false,
      error: 'This email is not registered. Please sign in with a registered account or contact support.',
    }
  }

  const hasPassword = typeof user.password === 'string' && user.password.length > 0

  if (user.authProvider === 'google' || user.password === null || user.password === undefined) {
    return { allowed: true }
  }

  if (hasPassword) {
    return {
      allowed: false,
      error: 'This email is registered with a password. Please use the email/password sign-in option.',
    }
  }

  return {
    allowed: false,
    error: 'This email is not registered for Google sign-in. Please use a registered account or contact support.',
  }
}

// The Firebase web API key is public (it ships in the client bundle); it only
// identifies the project when asking Firebase to look up a sign-in token.
const FIREBASE_WEB_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyAWZ97DTTBq6FZSorJbn-NtzCzKCIxWf9E'

// Confirms a Firebase ID token with Google and returns the verified email/name,
// so the social endpoints never trust an email address typed by the client.
async function verifyGoogleIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') return null
  try {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_WEB_API_KEY}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idToken }),
        signal: AbortSignal.timeout(10000),
      },
    )
    if (!response.ok) return null
    const payload = await response.json()
    const account = payload?.users?.[0]
    if (!account?.email || account.emailVerified === false) return null
    return { email: normalizeEmail(account.email), name: account.displayName || '' }
  } catch (err) {
    console.error('Google token verification failed', err && (err.message || err))
    return null
  }
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

async function sendOtpEmail(email, code, name = 'there') {
  if (!transporter) {
    throw new Error('mail transporter not configured')
  }

  const from = process.env.EMAIL_USER ? `Chill Shooters <${process.env.EMAIL_USER}>` : 'Chill Shooters <no-reply@chillshooters.local>'

  try {
    const info = await transporter.sendMail({
      from,
      to: email,
      subject: 'Your Chill Shooters account verification code',
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
          <h2 style="margin-bottom: 8px;">Verify your Chill Shooters account</h2>
          <p>Hello ${name},</p>
          <p>Use the code below to verify your new account:</p>
          <div style="margin: 20px 0; padding: 16px 20px; display: inline-block; border-radius: 8px; background: #f3f4f6; font-size: 24px; letter-spacing: 4px; font-weight: 700;">${code}</div>
          <p>This code expires in 10 minutes.</p>
        </div>
      `,
    })

    console.log('OTP email sent', { to: email, messageId: info?.messageId })
    return info
  } catch (err) {
    console.error('Failed to send OTP email', err && (err.stack || err.message || err))
    throw err
  }
}

// --- Default password generation ---
// Generates: first letter of each name part (firstname, M.I., lastname) + 4 random digits
// e.g. "Juan M. Santos" -> "jms8273"
function generateDefaultPassword(name) {
  const parts = (name || '').trim().split(/\s+/)
  const initials = parts
    .map(p => p.replace(/[^a-zA-Z]/g, ''))
    .filter(p => p.length > 0)
    .map(p => p[0].toLowerCase())
    .join('')
  const randomDigits = String(Math.floor(1000 + Math.random() * 9000))
  return initials + randomDigits
}

router.get('/me', requireAuth, async (req, res) => {
  return res.json({
    ok: true,
    user: {
      id: req.user?.id,
      email: req.user?.email,
      role: req.user?.role,
    },
  })
})

// --- Admin: Add Player (User) ---
// POST /api/auth/admin/add-player
router.post('/admin/add-player', requireAuth, requireRole('admin', 'marshal', 'registrar'), async (req, res) => {
  const body = req.body || {}
  const { name, email, skillLevel } = body

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ ok: false, error: 'name is required' })
  }

  if (!email || typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ ok: false, error: 'email is required' })
  }

  const normalizedEmail = normalizeEmail(email)
  const defaultPassword = generateDefaultPassword(name)

  try {
    const db = await getDb()
    const userAccounts = await getUserAccountsCollection()

    const existing = await userAccounts.findOne({ email: normalizedEmail })
    if (existing) {
      return res.status(409).json({ ok: false, error: 'email already registered' })
    }

    const hashedPassword = await bcrypt.hash(defaultPassword, 10)
    const nextId = await nextShortId(db, 'user_accounts', 'P')

    const newDoc = {
      id: nextId,
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      role: 'user',
      experience: skillLevel || 'Beginner',
      emailVerified: true,
      identityVerificationStatus: 'not_submitted',
      createdAtISO: new Date().toISOString(),
    }

    const result = await userAccounts.insertOne(newDoc)

    // Send email with password
    try {
      const from = process.env.EMAIL_USER ? `Chill Shooters <${process.env.EMAIL_USER}>` : 'Chill Shooters <no-reply@chillshooters.local>'
      await transporter.sendMail({
        from,
        to: normalizedEmail,
        subject: 'Your Chill Shooters player account has been created',
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
            <h2 style="margin-bottom: 8px;">Welcome to Chill Shooters!</h2>
            <p>Hello ${name.trim()},</p>
            <p>Your player account has been created by an administrator.</p>
            <p><strong>Your login credentials:</strong></p>
            <div style="margin: 20px 0; padding: 16px 20px; border-radius: 8px; background: #f3f4f6;">
              <p style="margin: 4px 0;"><strong>Email:</strong> ${normalizedEmail}</p>
              <p style="margin: 4px 0;"><strong>Password:</strong> ${defaultPassword}</p>
            </div>
            <p>Please log in and change your password as soon as possible.</p>
          </div>
        `,
      })
    } catch (mailErr) {
      console.error('Failed to send welcome email', mailErr)
      // Don't rollback - account was created, just log the error
    }

    return res.status(201).json({
      ok: true,
      insertedId: result.insertedId,
      data: { ...newDoc, defaultPassword },
    })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// --- Admin: Add Staff ---
// POST /api/auth/admin/add-staff
router.post('/admin/add-staff', requireAuth, requireRole('admin'), async (req, res) => {
  const body = req.body || {}
  const { name, email, role } = body

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ ok: false, error: 'name is required' })
  }

  if (!email || typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ ok: false, error: 'email is required' })
  }

  const allowedRoles = ['admin', 'marshal', 'registrar']
  const normalizedRole = String(role || '').toLowerCase()
  if (!allowedRoles.includes(normalizedRole)) {
    return res.status(400).json({ ok: false, error: 'role must be admin, marshal, or registrar' })
  }

  const normalizedEmail = normalizeEmail(email)
  const defaultPassword = generateDefaultPassword(name)

  try {
    const db = await getDb()
    const userAccounts = await getUserAccountsCollection()

    const existing = await userAccounts.findOne({ email: normalizedEmail })
    if (existing) {
      return res.status(409).json({ ok: false, error: 'email already registered' })
    }

    const hashedPassword = await bcrypt.hash(defaultPassword, 10)
    const nextId = await nextShortId(db, 'user_accounts', 'P')

    const newDoc = {
      id: nextId,
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      role: normalizedRole,
      experience: 0,
      emailVerified: true,
      createdAtISO: new Date().toISOString(),
    }

    const result = await userAccounts.insertOne(newDoc)

    // Send email with password
    try {
      const from = process.env.EMAIL_USER ? `Chill Shooters <${process.env.EMAIL_USER}>` : 'Chill Shooters <no-reply@chillshooters.local>'
      await transporter.sendMail({
        from,
        to: normalizedEmail,
        subject: `Your Chill Shooters ${normalizedRole} account has been created`,
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
            <h2 style="margin-bottom: 8px;">Welcome to Chill Shooters Staff!</h2>
            <p>Hello ${name.trim()},</p>
            <p>Your staff account has been created with <strong>${normalizedRole}</strong> role.</p>
            <p><strong>Your login credentials:</strong></p>
            <div style="margin: 20px 0; padding: 16px 20px; border-radius: 8px; background: #f3f4f6;">
              <p style="margin: 4px 0;"><strong>Email:</strong> ${normalizedEmail}</p>
              <p style="margin: 4px 0;"><strong>Password:</strong> ${defaultPassword}</p>
            </div>
            <p>Please log in and change your password as soon as possible.</p>
          </div>
        `,
      })
    } catch (mailErr) {
      console.error('Failed to send welcome email', mailErr)
    }

    return res.status(201).json({
      ok: true,
      insertedId: result.insertedId,
      data: { ...newDoc, defaultPassword },
    })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// --- Admin: Reset Staff Password to Default ---
// POST /api/auth/admin/reset-password
router.post('/admin/reset-password', requireAuth, requireRole('admin', 'marshal', 'registrar'), async (req, res) => {
  const body = req.body || {}
  const { userId, email } = body

  if (!userId && !email) {
    return res.status(400).json({ ok: false, error: 'userId or email is required' })
  }

  try {
    const userAccounts = await getUserAccountsCollection()

    let user = null
    if (userId) {
      user = await userAccounts.findOne({ id: String(userId) })
    }
    if (!user && email) {
      user = await userAccounts.findOne({ email: normalizeEmail(email) })
    }
    if (!user) {
      return res.status(404).json({ ok: false, error: 'user not found' })
    }

    // Only admins may reset staff accounts; marshals and registrars can reset players.
    const targetRole = String(user.role || 'user').toLowerCase()
    if (req.user?.role !== 'admin' && targetRole !== 'user') {
      return res.status(403).json({ ok: false, error: 'only an admin can reset a staff password' })
    }

    const defaultPassword = generateDefaultPassword(user.name || 'User')
    const hashedPassword = await bcrypt.hash(defaultPassword, 10)

    await userAccounts.updateOne(
      { _id: user._id },
      { $set: { password: hashedPassword, updatedAtISO: new Date().toISOString() } },
    )

    // Send email with new password
    try {
      const from = process.env.EMAIL_USER ? `Chill Shooters <${process.env.EMAIL_USER}>` : 'Chill Shooters <no-reply@chillshooters.local>'
      await transporter.sendMail({
        from,
        to: user.email,
        subject: 'Your Chill Shooters account password has been reset',
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
            <h2 style="margin-bottom: 8px;">Password Reset</h2>
            <p>Hello ${user.name || 'User'},</p>
            <p>Your account password has been reset by an administrator.</p>
            <p><strong>Your new login credentials:</strong></p>
            <div style="margin: 20px 0; padding: 16px 20px; border-radius: 8px; background: #f3f4f6;">
              <p style="margin: 4px 0;"><strong>Email:</strong> ${user.email}</p>
              <p style="margin: 4px 0;"><strong>New Password:</strong> ${defaultPassword}</p>
            </div>
            <p>Please log in and change your password as soon as possible.</p>
          </div>
        `,
      })
    } catch (mailErr) {
      console.error('Failed to send password reset email', mailErr)
    }

    return res.json({
      ok: true,
      defaultPassword,
      userId: user.id,
    })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// --- Self-Registration ---
router.post('/register', async (req, res) => {
  const body = req.body || {}
  const { name, email, password } = body

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ ok: false, error: 'name is required' })
  }

  if (!email || typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ ok: false, error: 'email is required' })
  }

  if (!password || typeof password !== 'string') {
    return res.status(400).json({ ok: false, error: 'password is required' })
  }

  const passwordValidation = validatePasswordRequirements(password)
  if (!passwordValidation.valid) {
    return res.status(400).json({ ok: false, error: passwordValidation.errors[0] })
  }

  const normalizedEmail = normalizeEmail(email)

  try {
    const db = await getDb()
    const userAccounts = await getUserAccountsCollection()

    const existing = await userAccounts.findOne({ email: normalizedEmail })
    if (existing) {
      return res.status(409).json({ ok: false, error: 'email already registered' })
    }

    const shouldHash = process.env.PASSWORD_HASHING_ENABLED === 'true' || true
    const hashedPassword = shouldHash ? await bcrypt.hash(password, 10) : password

    const nextId = await nextShortId(db, 'user_accounts', 'P')
    const otpCode = generateOtp()
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

    const newDoc = {
      id: nextId,
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      role: 'user',
      experience: 0,
      emailVerified: false,
      identityVerificationStatus: 'not_submitted',
      otpCode,
      otpExpiresAt,
      createdAtISO: new Date().toISOString(),
    }

    const result = await userAccounts.insertOne(newDoc)

    try {
      await sendOtpEmail(normalizedEmail, otpCode, name.trim())
    } catch (mailErr) {
      await userAccounts.deleteOne({ _id: result.insertedId })
      return res.status(500).json({ ok: false, error: 'failed to send verification email', details: String(mailErr) })
    }

    const { password: _password, otpCode: _otpCode, ...publicDoc } = newDoc
    return res.status(201).json({ ok: true, insertedId: result.insertedId, data: publicDoc, needsOtp: true })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

router.post('/send-otp', async (req, res) => {
  const body = req.body || {}
  const email = normalizeEmail(body.email)

  if (!email) {
    return res.status(400).json({ ok: false, error: 'email is required' })
  }

  try {
    const userAccounts = await getUserAccountsCollection()
    const user = await userAccounts.findOne({ email })

    if (!user) {
      return res.status(404).json({ ok: false, error: 'account not found' })
    }

    const otpCode = generateOtp()
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

    await userAccounts.updateOne(
      { _id: user._id },
      { $set: { otpCode, otpExpiresAt, emailVerified: false } },
    )

    await sendOtpEmail(email, otpCode, user.name || 'there')

    return res.json({ ok: true, message: 'Verification code sent.' })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

router.post('/reset-password', async (req, res) => {
  const body = req.body || {}
  const email = normalizeEmail(body.email)
  const password = String(body.password || '').trim()

  if (!email) {
    return res.status(400).json({ ok: false, error: 'email is required' })
  }

  const passwordValidation = validatePasswordRequirements(password)
  if (!passwordValidation.valid) {
    return res.status(400).json({ ok: false, error: passwordValidation.errors[0] })
  }

  try {
    const userAccounts = await getUserAccountsCollection()
    const user = await userAccounts.findOne({ email })
    if (!user) {
      return res.status(404).json({ ok: false, error: 'account not found' })
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    await userAccounts.updateOne(
      { _id: user._id },
      { $set: { password: hashedPassword, updatedAtISO: new Date().toISOString() } },
    )

    return res.json({ ok: true, message: 'Password updated successfully.' })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

router.post('/verify-otp', async (req, res) => {
  const body = req.body || {}
  const email = normalizeEmail(body.email)
  const otp = String(body.otp || '').trim()

  if (!email) {
    return res.status(400).json({ ok: false, error: 'email is required' })
  }

  if (!otp) {
    return res.status(400).json({ ok: false, error: 'otp is required' })
  }

  try {
    const userAccounts = await getUserAccountsCollection()
    const user = await userAccounts.findOne({ email })

    if (!user) {
      return res.status(404).json({ ok: false, error: 'account not found' })
    }

    if (user.emailVerified && !user.otpCode) {
      return res.json({ ok: true, alreadyVerified: true, message: 'This account is already verified.' })
    }

    const now = Date.now()
    const expiresAt = user.otpExpiresAt ? new Date(user.otpExpiresAt).getTime() : 0

    if (!user.otpCode || !user.otpExpiresAt || now > expiresAt) {
      return res.status(400).json({ ok: false, error: 'OTP expired. Please request a new code.' })
    }

    if (String(user.otpCode) !== otp) {
      return res.status(400).json({ ok: false, error: 'Invalid OTP.' })
    }

    await userAccounts.updateOne(
      { _id: user._id },
      { $set: { emailVerified: true }, $unset: { otpCode: '', otpExpiresAt: '' } },
    )

    return res.json({ ok: true, message: 'Email verified successfully.' })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

router.post('/login', async (req, res) => {
  const body = req.body || {}
  const { email, password } = body

  if (!email || typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ ok: false, error: 'email is required' })
  }
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ ok: false, error: 'password is required' })
  }

  const normalizedEmail = normalizeEmail(email)

  try {
    const userAccounts = await getUserAccountsCollection()
    const user = await userAccounts.findOne({ email: normalizedEmail })
    if (!user) return res.status(401).json({ ok: false, error: 'invalid credentials' })

    if (user.emailVerified === false) {
      return res.status(403).json({ ok: false, error: 'email not verified' })
    }

    if (user.password === null || user.password === undefined) {
      return res.status(409).json({ ok: false, error: 'This account uses Google sign-in. Please use the Google sign-in button.' })
    }

    const stored = user.password

    const looksLikeBcrypt = typeof stored === 'string' && stored.startsWith('$2')
    const passwordOk = looksLikeBcrypt ? await bcrypt.compare(password, stored) : stored === password

    if (!passwordOk) return res.status(401).json({ ok: false, error: 'invalid credentials' })

    const authUser = {
      id: user.id ?? (user._id ? String(user._id) : undefined),
      name: user.name ?? '',
      email: user.email,
      role: user.role ?? 'user',
    }

    return res.json({
      ok: true,
      user: authUser,
      token: createAuthToken(authUser),
    })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

router.post('/social-login', async (req, res) => {
  const body = req.body || {}
  const { name } = body

  const verified = await verifyGoogleIdToken(body.idToken)
  if (!verified) {
    return res.status(401).json({ ok: false, error: 'Google sign-in could not be verified. Please try again.' })
  }

  const normalizedEmail = verified.email

  try {
    const userAccounts = await getUserAccountsCollection()
    const user = await userAccounts.findOne({ email: normalizedEmail })

    if (!user) {
      return res.status(403).json({
        ok: false,
        error: 'This email is not registered. Please sign in with a registered account or contact support.',
      })
    }

    const eligibility = validateGoogleLoginEligibility(user)
    if (!eligibility.allowed) {
      return res.status(403).json({ ok: false, error: eligibility.error })
    }

    const authUser = {
      id: user.id ?? (user._id ? String(user._id) : undefined),
      name: user.name ?? (name && typeof name === 'string' ? name.trim() : ''),
      email: user.email,
      role: user.role ?? 'user',
    }

    return res.json({
      ok: true,
      user: authUser,
      token: createAuthToken(authUser),
    })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

router.post('/social-register', async (req, res) => {
  const body = req.body || {}
  const { name } = body

  const verified = await verifyGoogleIdToken(body.idToken)
  if (!verified) {
    return res.status(401).json({ ok: false, error: 'Google sign-up could not be verified. Please try again.' })
  }

  const normalizedEmail = verified.email
  const trimmedName = verified.name || (typeof name === 'string' ? name.trim() : '')

  try {
    const userAccounts = await getUserAccountsCollection()
    const existing = await userAccounts.findOne({ email: normalizedEmail })

    if (existing) {
      if (existing.password !== null && existing.password !== undefined && existing.authProvider !== 'google') {
        return res.status(409).json({ ok: false, error: 'This email is registered with a password. Please use the email/password sign-in option.' })
      }

      const eligibility = validateGoogleLoginEligibility(existing)
      if (!eligibility.allowed) {
        return res.status(409).json({ ok: false, error: eligibility.error })
      }

      const authUser = {
        id: existing.id ?? (existing._id ? String(existing._id) : undefined),
        name: existing.name ?? trimmedName,
        email: existing.email,
        role: existing.role ?? 'user',
      }

      return res.json({
        ok: true,
        user: authUser,
        token: createAuthToken(authUser),
        existing: true,
      })
    }

    const db = await getDb()
    const nextId = await nextShortId(db, 'user_accounts', 'P')

    const newDoc = {
      id: nextId,
      name: trimmedName || normalizedEmail.split('@')[0],
      email: normalizedEmail,
      password: null,
      authProvider: 'google',
      role: 'user',
      experience: 0,
      emailVerified: true,
      identityVerificationStatus: 'not_submitted',
      createdAtISO: new Date().toISOString(),
    }

    const result = await userAccounts.insertOne(newDoc)
    const authUser = {
      id: newDoc.id,
      name: newDoc.name,
      email: newDoc.email,
      role: newDoc.role,
    }

    return res.status(201).json({
      ok: true,
      insertedId: result.insertedId,
      user: authUser,
      token: createAuthToken(authUser),
      created: true,
    })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// POST /api/auth/test-email { to: 'recipient@example.com', subject?: '...', html?: '...' }
router.post('/test-email', async (req, res) => {
  const body = req.body || {}
  const to = String(body.to || body.email || '').trim()
  const subject = String(body.subject || 'Test email from Chill Shooters')
  const html = String(body.html || `<p>This is a test email from Chill Shooters at ${new Date().toISOString()}</p>`)

  if (!to) return res.status(400).json({ ok: false, error: 'to is required' })

  try {
    if (!transporter) return res.status(500).json({ ok: false, error: 'mail transporter not configured' })

    const from = process.env.EMAIL_USER ? `Chill Shooters <${process.env.EMAIL_USER}>` : 'Chill Shooters <no-reply@chillshooters.local>'
    const info = await transporter.sendMail({ from, to, subject, html })
    console.log('Test email sent', { to, messageId: info?.messageId })
    return res.json({ ok: true, info })
  } catch (err) {
    console.error('Test email failed', err && (err.stack || err.message || err))
    return res.status(500).json({ ok: false, error: String(err && (err.message || err)) })
  }
})

export default router
