import express from 'express'
import bcrypt from 'bcrypt'
import transporter from '../services/mailService.js'
import { getDb, getUserAccountsCollection, USER_ACCOUNTS_COLLECTION } from '../db/mongo.js'
import { SUSPENDED_ACCOUNT_ERROR, createAuthToken, forgetSuspension, isSuspendedAccount, requireAuth, requireRole } from '../middleware/auth.js'
import { nextShortId } from '../utils/shortIds.js'
import { canonicalEmail, normalizeEmail, sameEmailFilter } from '../utils/emails.js'
import { verifyFirebaseIdToken } from '../utils/firebaseTokens.js'
import { cleanMiddleInitial, cleanNamePart, composeFullName, splitFullName } from '../utils/names.js'
import { ageFromBirthDate } from '../utils/age.js'

const router = express.Router()

// Games a chosen starting level stands for: the first game of that tier (see getExperienceLevel in utils/teamBalancing.js).
const STARTING_GAMES_PLAYED = { Beginner: 0, Intermediate: 11, Experienced: 26 }

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

  // Google has verified the address, so a password account with the same email may sign in
  // with Google too, once the player confirms it's theirs (see confirmExisting below).
  const hasPassword = typeof user.password === 'string' && user.password.length > 0
  return { allowed: true, linksPasswordAccount: hasPassword && user.authProvider !== 'google' }
}

// Records that a password account has also signed in with Google; the password keeps working.
async function linkGoogleToAccount(userAccounts, user) {
  if (user.authProvider === 'google' || user.googleLinkedAtISO) return
  await userAccounts.updateOne({ _id: user._id }, { $set: { googleLinkedAtISO: new Date().toISOString() } })
}

// An account made with Google has no password, so it can't use the email + password form.
function isGoogleOnlyAccount(user) {
  return !(typeof user?.password === 'string' && user.password.length > 0)
}

// How the account was made, so the "this email already exists" pop-up can point to the right sign-in.
function accountProvider(user) {
  return isGoogleOnlyAccount(user) ? 'google' : 'password'
}

// Stamps the sign-in and reports whether it is the account's first, so the app can greet a new
// player with "Welcome" rather than "Welcome back".
async function recordSignIn(userAccounts, user) {
  const firstLogin = !user.lastLoginAtISO
  await userAccounts.updateOne({ _id: user._id }, { $set: { lastLoginAtISO: new Date().toISOString() } }).catch(() => {})
  return firstLogin
}

function toAuthUser(user, firstLogin, fallbackName = '') {
  return {
    id: user.id ?? (user._id ? String(user._id) : undefined),
    name: user.name ?? fallbackName,
    email: user.email,
    role: user.role ?? 'user',
    ...(firstLogin ? { firstLogin: true } : {}),
  }
}

// Google sign-in for an existing account. A password account is linked to Google only after the
// player confirms the "this account already exists" pop-up; a Google account just signs in.
async function signInExistingWithGoogle(res, userAccounts, user, body) {
  if (isSuspendedAccount(user)) return res.status(403).json({ ok: false, error: SUSPENDED_ACCOUNT_ERROR })
  const needsLink = !isGoogleOnlyAccount(user) && user.authProvider !== 'google' && !user.googleLinkedAtISO
  if (needsLink && body.confirmExisting !== true) {
    return res.json({ ok: true, needsConfirm: true, account: { name: user.name || '', email: user.email } })
  }
  if (needsLink) await linkGoogleToAccount(userAccounts, user)
  // Google has verified the address.
  if (user.emailVerified === false) {
    await userAccounts.updateOne({ _id: user._id }, { $set: { emailVerified: true }, $unset: { otpCode: '', otpExpiresAt: '' } })
  }
  const authUser = toAuthUser(user, await recordSignIn(userAccounts, user))
  return res.json({ ok: true, user: authUser, token: createAuthToken(authUser, { remember: body.remember === true }) })
}

// First Google sign-in for this email: make the account and sign straight in.
async function createAndSignInWithGoogle(res, userAccounts, email, name, body) {
  const { newDoc, insertedId } = await createGoogleAccount(userAccounts, email, name)
  await userAccounts.updateOne({ _id: insertedId }, { $set: { lastLoginAtISO: new Date().toISOString() } }).catch(() => {})
  const authUser = toAuthUser(newDoc, true)
  return res.status(201).json({
    ok: true,
    insertedId,
    user: authUser,
    token: createAuthToken(authUser, { remember: body.remember === true }),
    created: true,
  })
}

// Confirms a Firebase ID token and returns the verified email/name, so the
// social endpoints never trust an email address typed by the client.
async function verifyGoogleIdToken(idToken) {
  const verified = await verifyFirebaseIdToken(idToken)
  return verified ? { email: normalizeEmail(verified.email), name: verified.name } : null
}

// Creates the player account for a first-time Google sign-in.
async function createGoogleAccount(userAccounts, normalizedEmail, name) {
  const db = await getDb()
  const newDoc = {
    id: await nextShortId(db, 'user_accounts', 'P'),
    name: name || normalizedEmail.split('@')[0],
    // Split from the Google account name; the player can correct the parts in their profile
    // (until their waiver is approved), since a Google name isn't always their legal name.
    ...splitFullName(name || ''),
    email: normalizedEmail,
    emailCanonical: canonicalEmail(normalizedEmail),
    password: null,
    authProvider: 'google',
    role: 'user',
    experience: 0,
    emailVerified: true,
    identityVerificationStatus: 'not_submitted',
    createdAtISO: new Date().toISOString(),
  }
  const result = await userAccounts.insertOne(newDoc)
  return { newDoc, insertedId: result.insertedId }
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

// --- Change email ---
// The new address only replaces the old one after the player enters the code sent to it, so an
// account can't be moved to an email its owner doesn't control.
const CHANGE_EMAIL_MAX_ATTEMPTS = 5

async function sendChangeEmailOtp(email, code, name = 'there') {
  if (!transporter) throw new Error('mail transporter not configured')
  const from = process.env.EMAIL_USER ? `Chill Shooters <${process.env.EMAIL_USER}>` : 'Chill Shooters <no-reply@chillshooters.local>'
  return transporter.sendMail({
    from,
    to: email,
    subject: 'Confirm your new Chill Shooters email',
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
        <h2 style="margin-bottom: 8px;">Confirm your new email</h2>
        <p>Hello ${name},</p>
        <p>Enter this code on your profile to use this address for your Chill Shooters account:</p>
        <div style="margin: 20px 0; padding: 16px 20px; display: inline-block; border-radius: 8px; background: #f3f4f6; font-size: 24px; letter-spacing: 4px; font-weight: 700;">${code}</div>
        <p>This code expires in 10 minutes. If you didn't ask to change your email, ignore this message.</p>
      </div>
    `,
  })
}

// POST /api/auth/change-email/request { newEmail }
router.post('/change-email/request', requireAuth, async (req, res) => {
  const newEmail = normalizeEmail(req.body?.newEmail)
  if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    return res.status(400).json({ ok: false, error: 'Enter a valid email address.' })
  }
  try {
    const userAccounts = await getUserAccountsCollection()
    const user = await userAccounts.findOne({ id: String(req.user.id) })
    if (!user) return res.status(404).json({ ok: false, error: 'account not found' })
    if (canonicalEmail(newEmail) === canonicalEmail(user.email || '')) {
      return res.status(400).json({ ok: false, error: 'That is already your email.' })
    }
    const taken = await userAccounts.findOne({ $and: [sameEmailFilter(newEmail), { _id: { $ne: user._id } }] }, { projection: { _id: 1 } })
    if (taken) return res.status(409).json({ ok: false, error: 'That email is already used by another account.' })

    const code = generateOtp()
    await userAccounts.updateOne({ _id: user._id }, {
      $set: {
        pendingEmail: newEmail,
        pendingEmailOtp: code,
        pendingEmailExpiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        pendingEmailAttempts: 0,
      },
    })
    try {
      await sendChangeEmailOtp(newEmail, code, user.name || 'there')
    } catch (mailErr) {
      await userAccounts.updateOne({ _id: user._id }, { $unset: { pendingEmail: '', pendingEmailOtp: '', pendingEmailExpiresAt: '', pendingEmailAttempts: '' } })
      return res.status(500).json({ ok: false, error: 'Could not send the code to that email. Please try again.' })
    }
    return res.json({ ok: true, message: `We sent a 6-digit code to ${newEmail}.` })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// POST /api/auth/change-email/verify { otp, remember }
// Answers with a new session token, since the token carries the email.
router.post('/change-email/verify', requireAuth, async (req, res) => {
  const otp = String(req.body?.otp || '').trim()
  if (!otp) return res.status(400).json({ ok: false, error: 'Enter the code we emailed you.' })
  try {
    const userAccounts = await getUserAccountsCollection()
    const user = await userAccounts.findOne({ id: String(req.user.id) })
    if (!user) return res.status(404).json({ ok: false, error: 'account not found' })
    const expiresAt = user.pendingEmailExpiresAt ? new Date(user.pendingEmailExpiresAt).getTime() : 0
    if (!user.pendingEmail || !user.pendingEmailOtp || Date.now() > expiresAt) {
      return res.status(400).json({ ok: false, error: 'The code expired. Send a new one.' })
    }
    if ((user.pendingEmailAttempts || 0) >= CHANGE_EMAIL_MAX_ATTEMPTS) {
      return res.status(429).json({ ok: false, error: 'Too many wrong codes. Send a new one.' })
    }
    if (String(user.pendingEmailOtp) !== otp) {
      await userAccounts.updateOne({ _id: user._id }, { $inc: { pendingEmailAttempts: 1 } })
      return res.status(400).json({ ok: false, error: 'That code is not correct.' })
    }
    const newEmail = user.pendingEmail
    const taken = await userAccounts.findOne({ $and: [sameEmailFilter(newEmail), { _id: { $ne: user._id } }] }, { projection: { _id: 1 } })
    if (taken) return res.status(409).json({ ok: false, error: 'That email is already used by another account.' })

    const nowISO = new Date().toISOString()
    await userAccounts.updateOne({ _id: user._id }, {
      $set: { email: newEmail, emailCanonical: canonicalEmail(newEmail), emailVerified: true, emailChangedAtISO: nowISO, updatedAtISO: nowISO },
      $unset: { pendingEmail: '', pendingEmailOtp: '', pendingEmailExpiresAt: '', pendingEmailAttempts: '' },
      $push: { emailHistory: { from: user.email || '', to: newEmail, atISO: nowISO } },
    })
    const authUser = toAuthUser({ ...user, email: newEmail }, false)
    return res.json({
      ok: true,
      user: authUser,
      token: createAuthToken(authUser, { remember: req.body?.remember === true }),
      message: 'Your email was changed.',
    })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

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

    const existing = await userAccounts.findOne(sameEmailFilter(normalizedEmail))
    if (existing) {
      return res.status(409).json({ ok: false, error: 'email already registered' })
    }

    const hashedPassword = await bcrypt.hash(defaultPassword, 10)
    const nextId = await nextShortId(db, 'user_accounts', 'P')

    const newDoc = {
      id: nextId,
      name: name.trim(),
      ...splitFullName(name),
      email: normalizedEmail,
      emailCanonical: canonicalEmail(normalizedEmail),
      password: hashedPassword,
      role: 'user',
      experience: 0,
      // Counted as games from before the system, so games completed at the field add to it.
      experienceAdjustment: STARTING_GAMES_PLAYED[skillLevel] || 0,
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

    const existing = await userAccounts.findOne(sameEmailFilter(normalizedEmail))
    if (existing) {
      return res.status(409).json({ ok: false, error: 'email already registered' })
    }

    const hashedPassword = await bcrypt.hash(defaultPassword, 10)
    const nextId = await nextShortId(db, 'user_accounts', 'P')

    const newDoc = {
      id: nextId,
      name: name.trim(),
      email: normalizedEmail,
      emailCanonical: canonicalEmail(normalizedEmail),
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

// --- Admin: Suspend / reinstate a player ---
// PUT /api/auth/admin/players/:id/status { status: 'suspended' | 'active', reason }
// A suspended player cannot log in and their open sessions stop working (see requireAuth).
router.put('/admin/players/:id/status', requireAuth, requireRole('admin'), async (req, res) => {
  const nextStatus = String(req.body?.status || '').toLowerCase()
  if (!['suspended', 'active'].includes(nextStatus)) {
    return res.status(400).json({ ok: false, error: "status must be 'suspended' or 'active'" })
  }
  const reason = String(req.body?.reason || '').trim().slice(0, 300)
  if (nextStatus === 'suspended' && !reason) {
    return res.status(400).json({ ok: false, error: 'Give a reason for the suspension.' })
  }

  try {
    const db = await getDb()
    const userAccounts = await getUserAccountsCollection()
    const player = await userAccounts.findOne({ id: String(req.params.id) })
    if (!player) return res.status(404).json({ ok: false, error: 'Player not found' })
    if (String(player.role || 'user').toLowerCase() !== 'user') {
      return res.status(400).json({ ok: false, error: 'Only player accounts can be suspended here.' })
    }

    const nowISO = new Date().toISOString()
    const event = { status: nextStatus, reason, actorId: String(req.user.id), atISO: nowISO }
    await userAccounts.updateOne(
      { _id: player._id },
      {
        $set: {
          status: nextStatus,
          ...(nextStatus === 'suspended' ? { suspendedAtISO: nowISO, suspensionReason: reason } : {}),
          updatedAtISO: nowISO,
        },
        ...(nextStatus === 'active' ? { $unset: { suspendedAtISO: '', suspensionReason: '' } } : {}),
        $push: { statusHistory: event },
      },
    )
    forgetSuspension(player.id)
    await db.collection('audit_logs').insertOne({
      action: nextStatus === 'suspended' ? 'player_suspended' : 'player_reinstated',
      resourceType: 'user_accounts',
      resourceId: String(player.id),
      actorId: String(req.user.id),
      actorRole: req.user.role,
      details: { reason, playerName: player.name || '', playerEmail: player.email || '' },
      createdAtISO: nowISO,
    }).catch((err) => console.error('Failed to write suspension audit log', err))

    return res.json({ ok: true, data: { id: player.id, status: nextStatus, suspensionReason: nextStatus === 'suspended' ? reason : '' } })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// --- Self-Registration ---
router.post('/register', async (req, res) => {
  const body = req.body || {}
  const { email, password } = body

  // The form sends first name / middle initial / last name; an older client may still send `name`.
  const nameParts = body.firstName !== undefined || body.lastName !== undefined
    ? {
      firstName: cleanNamePart(body.firstName),
      middleInitial: cleanMiddleInitial(body.middleInitial),
      lastName: cleanNamePart(body.lastName),
    }
    : splitFullName(typeof body.name === 'string' ? body.name : '')
  if (!nameParts.firstName || !nameParts.lastName) {
    return res.status(400).json({ ok: false, error: 'Enter your first and last name.' })
  }
  const name = composeFullName(nameParts)

  // Only adults have accounts; a parent adds their children as minors on their own account.
  const birthDate = String(body.birthDate || '').trim()
  const age = ageFromBirthDate(birthDate)
  if (age === null || age > 120) {
    return res.status(400).json({ ok: false, error: 'Enter your birthday.' })
  }
  if (age < 18) {
    return res.status(400).json({ ok: false, error: 'You must be 18 or older to create an account. A parent or guardian can add you as a minor on their account.' })
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

    const existing = await userAccounts.findOne(sameEmailFilter(normalizedEmail))
    if (existing) {
      const provider = accountProvider(existing)
      return res.status(409).json({
        ok: false,
        emailExists: true,
        provider,
        error: provider === 'google'
          ? 'This email already exists. It was registered with Google, so use "Continue with Google" to sign in.'
          : 'This email already exists. Log in with your email and password instead.',
      })
    }

    const shouldHash = process.env.PASSWORD_HASHING_ENABLED === 'true' || true
    const hashedPassword = shouldHash ? await bcrypt.hash(password, 10) : password

    const nextId = await nextShortId(db, 'user_accounts', 'P')
    const otpCode = generateOtp()
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

    const newDoc = {
      id: nextId,
      name,
      ...nameParts,
      email: normalizedEmail,
      emailCanonical: canonicalEmail(normalizedEmail),
      password: hashedPassword,
      role: 'user',
      birthDate,
      age,
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

    // Made with "Continue with Google": there is no password to check.
    if (isGoogleOnlyAccount(user)) {
      return res.status(409).json({
        ok: false,
        emailExists: true,
        provider: 'google',
        account: { name: user.name || '', email: user.email },
        error: 'This email already exists. It was registered with Google, so use "Continue with Google" to sign in.',
      })
    }

    if (user.emailVerified === false) {
      return res.status(403).json({ ok: false, error: 'email not verified' })
    }

    const stored = user.password

    const looksLikeBcrypt = typeof stored === 'string' && stored.startsWith('$2')
    const passwordOk = looksLikeBcrypt ? await bcrypt.compare(password, stored) : stored === password

    if (!passwordOk) return res.status(401).json({ ok: false, error: 'invalid credentials' })
    if (isSuspendedAccount(user)) return res.status(403).json({ ok: false, error: SUSPENDED_ACCOUNT_ERROR })

    const authUser = toAuthUser(user, await recordSignIn(userAccounts, user))

    return res.json({
      ok: true,
      user: authUser,
      token: createAuthToken(authUser, { remember: body.remember === true }),
    })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// "Continue with Google" (login page) and "Sign up with Google" (register page) work the same way:
// a new email gets an account and is signed straight in; an account made with Google just signs
// in; an account made with the email + password form shows the "this account already exists"
// pop-up first, and is linked to Google once the player confirms.
async function handleGoogleAuth(req, res, unverifiedMessage) {
  const body = req.body || {}
  const verified = await verifyGoogleIdToken(body.idToken)
  if (!verified) {
    return res.status(401).json({ ok: false, error: unverifiedMessage })
  }

  const normalizedEmail = verified.email
  const name = verified.name || (typeof body.name === 'string' ? body.name.trim() : '')

  try {
    const userAccounts = await getUserAccountsCollection()
    const user = await userAccounts.findOne(sameEmailFilter(normalizedEmail))
    if (!user) return createAndSignInWithGoogle(res, userAccounts, normalizedEmail, name, body)

    const eligibility = validateGoogleLoginEligibility(user)
    if (!eligibility.allowed) return res.status(403).json({ ok: false, error: eligibility.error })
    return signInExistingWithGoogle(res, userAccounts, user, body)
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
}

router.post('/social-login', (req, res) => handleGoogleAuth(req, res, 'Google sign-in could not be verified. Please try again.'))

router.post('/social-register', (req, res) => handleGoogleAuth(req, res, 'Google sign-up could not be verified. Please try again.'))

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
