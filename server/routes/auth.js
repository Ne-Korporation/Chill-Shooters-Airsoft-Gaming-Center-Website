import express from 'express'
import bcrypt from 'bcrypt'
import { createHash, randomBytes } from 'crypto'
import transporter from '../services/mailService.js'
import { getDb, getUserAccountsCollection, startDbSession, USER_ACCOUNTS_COLLECTION } from '../db/mongo.js'
import { closeAccount, previewAccountClosure, summarizePlan } from '../utils/accountClosure.js'
import { SUSPENDED_ACCOUNT_ERROR, createAuthToken, forgetSuspension, isSuspendedAccount, requireAuth, requireRole } from '../middleware/auth.js'
import { nextShortId } from '../utils/shortIds.js'
import { canonicalEmail, normalizeEmail, sameEmailFilter } from '../utils/emails.js'
import { verifyFirebaseIdToken } from '../utils/firebaseTokens.js'
import { cleanMiddleInitial, cleanNamePart, composeFullName, splitFullName } from '../utils/names.js'
import { ageFromBirthDate } from '../utils/age.js'
import { emailWelcome } from '../services/notificationEmails.js'
import { publicAppUrl } from '../utils/appUrl.js'
import {
  ATTEMPTS_COLLECTION, LIMITS, OTP_MAX_ATTEMPTS, clientAddress, codeAddressKey, createAttemptStore, loginKeys,
} from '../utils/attemptLimits.js'

const router = express.Router()

// Games a chosen starting level stands for: the first game of that tier (see getExperienceLevel in utils/teamBalancing.js).
const STARTING_GAMES_PLAYED = { Beginner: 0, Intermediate: 11, Experienced: 26 }

// One-time codes and links are stored only as hashes, so a database leak can't be used to sign in.
const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex')

// Guessing limits, counted in MongoDB (see utils/attemptLimits.js).
const attempts = createAttemptStore(async () => (await getDb()).collection(ATTEMPTS_COLLECTION))

// Answers that read the same whether or not an email has an account, so the forms can't be used
// to find out who is registered.
const LOGIN_FAILED_MESSAGE = 'Wrong email or password. Signed up with Google? Use "Continue with Google". Account made at the counter? Use the link in your welcome email.'
const LOGIN_LIMIT_MESSAGE = 'Too many sign-in attempts. Wait 15 minutes, or use "Forgot password?". If this is your account, check your email: we may have sent you a sign-in link.'
const CODE_LIMIT_MESSAGE = 'Too many wrong codes. Wait 15 minutes, then request a new code.'

// Wrong one-time codes (sign-up and password reset) from one address, across all accounts.
async function codeAddressBlocked(req, res) {
  if (await attempts.count(codeAddressKey(clientAddress(req)), LIMITS.codeAddress) < LIMITS.codeAddress.max) return false
  res.status(429).json({ ok: false, error: CODE_LIMIT_MESSAGE })
  return true
}
// A real bcrypt hash to compare against when there is no password, so every login takes as long.
const DUMMY_HASH = bcrypt.hashSync(randomBytes(16).toString('hex'), 10)

const recordWrongCode = (req) => attempts.record([{ key: codeAddressKey(clientAddress(req)), limit: LIMITS.codeAddress }]).catch(() => null)

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
async function createAndSignInWithGoogle(req, res, userAccounts, email, name, body) {
  const { newDoc, insertedId } = await createGoogleAccount(userAccounts, email, name)
  await userAccounts.updateOne({ _id: insertedId }, { $set: { lastLoginAtISO: new Date().toISOString() } }).catch(() => {})
  // Google already verified the address, so the welcome goes out straight away (never fails the sign-in).
  await emailWelcome(await getDb(), { account: newDoc, req })
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

// Players make their own accounts (sign-up or Google). Staff can't create player accounts;
// they only add staff, from Players & staff.
router.post('/admin/add-player', requireAuth, (_req, res) => {
  return res.status(403).json({ ok: false, error: 'Staff cannot add players. Players create their own accounts.' })
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
    if (player.erasedAtISO) {
      return res.status(400).json({ ok: false, error: "This player's data was erased, so the account can't be reinstated." })
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

// --- Admin: close a player's account (or erase their personal data) ---
// Accounts on any booking are never deleted (bookings are game and payment records). Closing stops
// the account and settles its upcoming bookings: a teammate takes over as captain, or the booking is
// cancelled under the normal rules; on teammates' bookings the player is taken off the team.
// See utils/accountClosure.js.
async function findPlayerForClosure(req, res) {
  const userAccounts = await getUserAccountsCollection()
  const player = await userAccounts.findOne({ id: String(req.params.id) })
  if (!player) {
    res.status(404).json({ ok: false, error: 'Player not found' })
    return null
  }
  if (String(player.role || 'user').toLowerCase() !== 'user') {
    res.status(400).json({ ok: false, error: 'Only player accounts can be closed here.' })
    return null
  }
  return player
}

// GET /api/auth/admin/players/:id/closure-preview → what closing would do to their bookings.
router.get('/admin/players/:id/closure-preview', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const player = await findPlayerForClosure(req, res)
    if (!player) return undefined
    const db = await getDb()
    const { plan } = await previewAccountClosure(db, player.id)
    return res.json({ ok: true, data: { status: player.status || 'active', erased: Boolean(player.erasedAtISO), ...summarizePlan(plan) } })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// POST /api/auth/admin/players/:id/close { reason, erase }
router.post('/admin/players/:id/close', requireAuth, requireRole('admin'), async (req, res) => {
  const reason = String(req.body?.reason || '').trim().slice(0, 300)
  const erase = req.body?.erase === true
  if (!reason) return res.status(400).json({ ok: false, error: 'Give a reason for closing the account.' })
  try {
    const player = await findPlayerForClosure(req, res)
    if (!player) return undefined
    if (player.erasedAtISO) return res.status(409).json({ ok: false, error: "This player's data was already erased." })
    if (String(player.status || '').toLowerCase() === 'closed' && !erase) {
      return res.status(409).json({ ok: false, error: 'This account is already closed.' })
    }
    const db = await getDb()
    const result = await closeAccount(db, player, {
      actor: { id: String(req.user.id), role: req.user.role },
      reason,
      erase,
      startSession: startDbSession,
    })
    forgetSuspension(player.id)
    await db.collection('audit_logs').insertOne({
      action: erase ? 'player_data_erased' : 'player_account_closed',
      resourceType: 'user_accounts',
      resourceId: String(player.id),
      actorId: String(req.user.id),
      actorRole: req.user.role,
      // After an erase the log keeps only the account id, not the name or email.
      details: { reason, ...(erase ? {} : { playerName: player.name || '', playerEmail: player.email || '' }), ...result },
      createdAtISO: new Date().toISOString(),
    }).catch((err) => console.error('Failed to write account closure audit log', err))
    return res.json({ ok: true, data: result })
  } catch (err) {
    return res.status(err?.statusCode || 500).json({ ok: false, error: err?.message || String(err) })
  }
})

// Someone tried to sign up with an email that already has an account. Tell the owner how to get
// in (at most once an hour), instead of telling whoever filled in the form.
async function sendAccountExistsNotice(req, user) {
  const lastSent = user.signupNoticeSentAtISO ? new Date(user.signupNoticeSentAtISO).getTime() : 0
  if (Date.now() - lastSent < 60 * 60 * 1000 || !transporter) return
  const userAccounts = await getUserAccountsCollection()
  await userAccounts.updateOne({ _id: user._id }, { $set: { signupNoticeSentAtISO: new Date().toISOString() } })
  const appUrl = publicAppUrl(req)
  const how = isGoogleOnlyAccount(user)
    ? 'Your account uses Google: on the login page, tap <b>Continue with Google</b>.'
    : user.passwordSetupRequired
      ? 'Your account was made at our counter. Use the "Set your password" link in your welcome email, or ask the counter for a new one.'
      : `Log in with your email and password. Forgot it? Use <a href="${appUrl}/forgot-password">Forgot password</a>.`
  const from = process.env.EMAIL_USER ? `Chill Shooters <${process.env.EMAIL_USER}>` : 'Chill Shooters <no-reply@chillshooters.local>'
  await transporter.sendMail({
    from,
    to: user.email,
    subject: 'You already have a Chill Shooters account',
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
        <h2 style="margin-bottom: 8px;">You already have an account</h2>
        <p>Hello ${String(user.firstName || user.name || 'there').replace(/[<>&"']/g, '')},</p>
        <p>Someone just tried to sign up for Chill Shooters with this email, but it already has an account, so no new account was made.</p>
        <p>${how}</p>
        <p style="color:#6b7280;font-size:13px;">If this wasn't you, you can ignore this email. Nothing about your account has changed.</p>
      </div>
    `,
  }).catch((err) => console.error('Failed to send account-exists notice', err?.message || err))
}

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

    const shouldHash = process.env.PASSWORD_HASHING_ENABLED === 'true' || true
    const hashedPassword = shouldHash ? await bcrypt.hash(password, 10) : password

    // An email that already has an account gets the same answer as a new sign-up ("check your
    // email for a code"), so this form can't be used to find out who is registered. The owner
    // is told by email instead.
    const existing = await userAccounts.findOne(sameEmailFilter(normalizedEmail))
    if (existing) {
      const unfinished = existing.emailVerified === false && !existing.passwordSetupRequired && !isGoogleOnlyAccount(existing)
      if (unfinished) {
        // Signed up before but never entered the code: take the new details and send a fresh code.
        const lastSent = existing.otpSentAtISO ? new Date(existing.otpSentAtISO).getTime() : 0
        if (Date.now() - lastSent >= 60 * 1000) {
          const otpCode = generateOtp()
          await userAccounts.updateOne(
            { _id: existing._id },
            {
              $set: {
                name, ...nameParts, birthDate, age, password: hashedPassword,
                otpCode, otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), otpSentAtISO: new Date().toISOString(),
                welcomePending: true, updatedAtISO: new Date().toISOString(),
              },
              $unset: { otpAttempts: '' },
            },
          )
          await sendOtpEmail(existing.email, otpCode, name.trim()).catch((err) => console.error('Sign-up code resend failed', err?.message || err))
        }
      } else {
        await sendAccountExistsNotice(req, existing)
      }
      return res.status(201).json({ ok: true, needsOtp: true })
    }

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
      otpSentAtISO: new Date().toISOString(),
      // The welcome email goes out once the email is verified (see /verify-otp).
      welcomePending: true,
      createdAtISO: new Date().toISOString(),
    }

    const result = await userAccounts.insertOne(newDoc)

    try {
      await sendOtpEmail(normalizedEmail, otpCode, name.trim())
    } catch (mailErr) {
      await userAccounts.deleteOne({ _id: result.insertedId })
      return res.status(500).json({ ok: false, error: 'failed to send verification email', details: String(mailErr) })
    }

    // Exactly the same answer as for an email that already has an account (see above).
    return res.status(201).json({ ok: true, needsOtp: true })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// Resend the sign-up code. Always the same answer, whether or not the email has an account or
// still needs verifying, so it can't be used to find out who is registered.
const SIGNUP_CODE_SENT_MESSAGE = 'If this email is waiting to be verified, we sent it a new code. Codes can be resent once a minute.'
const SIGNUP_CODE_INVALID_MESSAGE = 'That code is wrong or has expired. Each code allows 5 tries; tap "Resend" for a new one.'

router.post('/send-otp', async (req, res) => {
  const email = normalizeEmail(req.body?.email)
  if (!email) return res.status(400).json({ ok: false, error: 'email is required' })

  try {
    const userAccounts = await getUserAccountsCollection()
    const user = await userAccounts.findOne({ email })
    // Only for finishing sign-up (a verified account is never marked unverified again); at most
    // one new code a minute, so its 5 tries can't be renewed endlessly.
    const lastSent = user?.otpSentAtISO ? new Date(user.otpSentAtISO).getTime() : 0
    if (user && user.emailVerified === false && Date.now() - lastSent >= 60 * 1000) {
      const otpCode = generateOtp()
      await userAccounts.updateOne(
        { _id: user._id },
        { $set: { otpCode, otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), otpSentAtISO: new Date().toISOString() }, $unset: { otpAttempts: '' } },
      )
      await sendOtpEmail(email, otpCode, user.name || 'there').catch((err) => console.error('Sign-up code resend failed', err?.message || err))
    }
    return res.json({ ok: true, message: SIGNUP_CODE_SENT_MESSAGE })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// --- Forgot password ---
// 1. POST /forgot-password { email } emails a 6-digit code (only its hash is stored).
// 2. POST /verify-reset-code { email, otp } checks it (5 tries, 10 minutes) and returns a
//    one-time reset pass, good for 15 minutes.
// 3. POST /reset-password { email, resetToken, password } sets the new password with that pass.
// The server never changes a password without proof the person can read the account's email.
const RESET_CODE_TTL_MS = 10 * 60 * 1000
const RESET_PASS_TTL_MS = 15 * 60 * 1000
const RESET_CODE_MAX_ATTEMPTS = 5
const RESET_CODE_RESEND_MS = 60 * 1000
const RESET_SENT_MESSAGE = 'If an account uses this email, we sent it a 6-digit code. It expires in 10 minutes.'
const RESET_INVALID_MESSAGE = 'That code is wrong or has expired. Each code allows 5 tries; request a new code if you need one.'

async function sendResetCodeEmail(email, code, name = 'there') {
  if (!transporter) throw new Error('mail transporter not configured')
  const from = process.env.EMAIL_USER ? `Chill Shooters <${process.env.EMAIL_USER}>` : 'Chill Shooters <no-reply@chillshooters.local>'
  return transporter.sendMail({
    from,
    to: email,
    subject: 'Your Chill Shooters password reset code',
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
        <h2 style="margin-bottom: 8px;">Reset your password</h2>
        <p>Hello ${String(name).replace(/[<>&"']/g, '')},</p>
        <p>Enter this code to choose a new password for your Chill Shooters account:</p>
        <div style="margin: 20px 0; padding: 16px 20px; display: inline-block; border-radius: 8px; background: #f3f4f6; font-size: 24px; letter-spacing: 4px; font-weight: 700;">${code}</div>
        <p>This code expires in 10 minutes. If you didn't ask to reset your password, ignore this email; your password stays the same.</p>
      </div>
    `,
  })
}

// The same answer whether or not the email has an account, so the form can't be used to find out
// who is registered.
router.post('/forgot-password', async (req, res) => {
  const email = normalizeEmail(req.body?.email)
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: 'Enter a valid email address.' })
  }
  try {
    const userAccounts = await getUserAccountsCollection()
    const user = await userAccounts.findOne(sameEmailFilter(email))
    // A code sent less than a minute ago is still on its way: don't flood the inbox.
    const lastSent = user?.resetCodeSentAtISO ? new Date(user.resetCodeSentAtISO).getTime() : 0
    if (user && Date.now() - lastSent >= RESET_CODE_RESEND_MS) {
      const code = generateOtp()
      const nowISO = new Date().toISOString()
      await userAccounts.updateOne(
        { _id: user._id },
        {
          $set: { resetCodeHash: hashToken(`${user.id}:${code}`), resetCodeExpiresAt: new Date(Date.now() + RESET_CODE_TTL_MS).toISOString(), resetCodeAttempts: 0, resetCodeSentAtISO: nowISO },
          $unset: { resetTokenHash: '', resetTokenExpiresAt: '' },
        },
      )
      // A failed send is logged, not shown: an error only for real accounts would give them away.
      await sendResetCodeEmail(user.email, code, user.firstName || user.name || 'there')
        .catch((mailErr) => console.error('Failed to send password reset code', mailErr?.message || mailErr))
    }
    return res.json({ ok: true, message: RESET_SENT_MESSAGE })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

router.post('/verify-reset-code', async (req, res) => {
  const email = normalizeEmail(req.body?.email)
  const otp = String(req.body?.otp || '').trim()
  if (!email || !otp) return res.status(400).json({ ok: false, error: 'Enter the 6-digit code.' })
  if (await codeAddressBlocked(req, res)) return
  try {
    const userAccounts = await getUserAccountsCollection()
    const user = await userAccounts.findOne(sameEmailFilter(email))
    const expiresAt = user?.resetCodeExpiresAt ? new Date(user.resetCodeExpiresAt).getTime() : 0
    // Every failure gets the same answer (no "tries left"), whether or not the email has an account.
    if (!user || !user.resetCodeHash || Date.now() > expiresAt) {
      await recordWrongCode(req)
      return res.status(400).json({ ok: false, error: RESET_INVALID_MESSAGE })
    }
    // Claim a try before comparing (same as the sign-up code), so a burst can't get past 5.
    const claim = await userAccounts.updateOne(
      { _id: user._id, resetCodeHash: user.resetCodeHash, $or: [{ resetCodeAttempts: { $exists: false } }, { resetCodeAttempts: { $lt: RESET_CODE_MAX_ATTEMPTS } }] },
      { $inc: { resetCodeAttempts: 1 } },
    )
    if (!claim.modifiedCount) {
      await userAccounts.updateOne({ _id: user._id }, { $unset: { resetCodeHash: '', resetCodeExpiresAt: '', resetCodeAttempts: '' } })
      await recordWrongCode(req)
      return res.status(400).json({ ok: false, error: RESET_INVALID_MESSAGE })
    }
    if (hashToken(`${user.id}:${otp}`) !== user.resetCodeHash) {
      await recordWrongCode(req)
      if (Number(user.resetCodeAttempts || 0) + 1 >= RESET_CODE_MAX_ATTEMPTS) {
        await userAccounts.updateOne({ _id: user._id }, { $unset: { resetCodeHash: '', resetCodeExpiresAt: '', resetCodeAttempts: '' } })
      }
      return res.status(400).json({ ok: false, error: RESET_INVALID_MESSAGE })
    }
    const resetToken = randomBytes(32).toString('base64url')
    await userAccounts.updateOne(
      { _id: user._id },
      {
        $set: { resetTokenHash: hashToken(resetToken), resetTokenExpiresAt: new Date(Date.now() + RESET_PASS_TTL_MS).toISOString() },
        $unset: { resetCodeHash: '', resetCodeExpiresAt: '', resetCodeAttempts: '' },
      },
    )
    return res.json({ ok: true, resetToken, message: 'Code accepted. Choose a new password.' })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

router.post('/reset-password', async (req, res) => {
  const body = req.body || {}
  const email = normalizeEmail(body.email)
  const resetToken = String(body.resetToken || '')
  const password = String(body.password || '')

  if (!email || !resetToken) {
    return res.status(400).json({ ok: false, error: 'Verify the code sent to your email first.' })
  }
  const passwordValidation = validatePasswordRequirements(password)
  if (!passwordValidation.valid) {
    return res.status(400).json({ ok: false, error: passwordValidation.errors[0] })
  }

  try {
    const userAccounts = await getUserAccountsCollection()
    const user = await userAccounts.findOne(sameEmailFilter(email))
    const expiresAt = user?.resetTokenExpiresAt ? new Date(user.resetTokenExpiresAt).getTime() : 0
    if (!user || !user.resetTokenHash || user.resetTokenHash !== hashToken(resetToken) || Date.now() > expiresAt) {
      return res.status(400).json({ ok: false, error: 'This reset has expired. Request a new code and try again.' })
    }

    // Reading the code proved they own the address, so a pending verification or a walk-in's
    // first password is settled too.
    await userAccounts.updateOne(
      { _id: user._id },
      {
        $set: { password: await bcrypt.hash(password, 10), emailVerified: true, updatedAtISO: new Date().toISOString() },
        $unset: {
          resetTokenHash: '', resetTokenExpiresAt: '',
          otpCode: '', otpExpiresAt: '',
          passwordSetupRequired: '', passwordSetupTokenHash: '', passwordSetupExpiresAt: '',
          welcomePending: '',
        },
      },
    )
    // Signed up but never entered the sign-up code: this finishes the sign-up, so welcome them.
    if (user.welcomePending) await emailWelcome(await getDb(), { account: user, req })

    return res.json({ ok: true, email: user.email, message: 'Password updated. You can log in now.' })
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
  if (await codeAddressBlocked(req, res)) {
    return
  }

  try {
    const userAccounts = await getUserAccountsCollection()
    const user = await userAccounts.findOne({ email })

    // No account, already verified, no code or an expired one: the same answer as a wrong code,
    // so this can't be used to find out who is registered.
    const expiresAt = user?.otpExpiresAt ? new Date(user.otpExpiresAt).getTime() : 0
    if (!user || !user.otpCode || Date.now() > expiresAt) {
      await recordWrongCode(req)
      return res.status(400).json({ ok: false, error: SIGNUP_CODE_INVALID_MESSAGE })
    }

    // 5 tries per code. Each try is claimed before the code is compared, so guesses sent all at
    // once can't get past the limit; when the tries run out the code is thrown away.
    const claim = await userAccounts.updateOne(
      { _id: user._id, otpCode: user.otpCode, $or: [{ otpAttempts: { $exists: false } }, { otpAttempts: { $lt: OTP_MAX_ATTEMPTS } }] },
      { $inc: { otpAttempts: 1 } },
    )
    if (!claim.modifiedCount) {
      await userAccounts.updateOne({ _id: user._id }, { $unset: { otpCode: '', otpExpiresAt: '', otpAttempts: '' } })
      await recordWrongCode(req)
      return res.status(400).json({ ok: false, error: SIGNUP_CODE_INVALID_MESSAGE })
    }

    if (String(user.otpCode) !== otp) {
      await recordWrongCode(req)
      if (Number(user.otpAttempts || 0) + 1 >= OTP_MAX_ATTEMPTS) {
        await userAccounts.updateOne({ _id: user._id }, { $unset: { otpCode: '', otpExpiresAt: '', otpAttempts: '' } })
      }
      return res.status(400).json({ ok: false, error: SIGNUP_CODE_INVALID_MESSAGE })
    }

    await userAccounts.updateOne(
      { _id: user._id },
      { $set: { emailVerified: true }, $unset: { otpCode: '', otpExpiresAt: '', otpAttempts: '', welcomePending: '' } },
    )

    // A new self-registered account: welcome them now that the address is confirmed.
    if (user.welcomePending) await emailWelcome(await getDb(), { account: user, req })

    return res.json({ ok: true, message: 'Email verified successfully.' })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// --- Login ---
// Guessing limits (utils/attemptLimits.js) are checked and the attempt is counted before anything
// else, for known and unknown emails alike, so the answers never show whether an email has an
// account: a wrong password, an unknown email, a Google-only account and a counter-made account
// without a password all get the same "wrong email or password".
const UNLOCK_LINK_TTL_MS = 30 * 60 * 1000

// Reaching the account-wide cap emails the owner a one-time sign-in link (at most every 30
// minutes), so guessing from many addresses can never lock the real player out.
async function sendUnlockLink(req, user) {
  const lastSent = user.unlockEmailSentAtISO ? new Date(user.unlockEmailSentAtISO).getTime() : 0
  if (Date.now() - lastSent < UNLOCK_LINK_TTL_MS || !transporter) return
  const token = randomBytes(32).toString('base64url')
  const userAccounts = await getUserAccountsCollection()
  await userAccounts.updateOne(
    { _id: user._id },
    { $set: { unlockTokenHash: hashToken(token), unlockExpiresAt: new Date(Date.now() + UNLOCK_LINK_TTL_MS).toISOString(), unlockEmailSentAtISO: new Date().toISOString() } },
  )
  const link = `${publicAppUrl(req)}/unlock?token=${encodeURIComponent(token)}`
  const from = process.env.EMAIL_USER ? `Chill Shooters <${process.env.EMAIL_USER}>` : 'Chill Shooters <no-reply@chillshooters.local>'
  await transporter.sendMail({
    from,
    to: user.email,
    subject: 'Sign-in attempts on your Chill Shooters account',
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
        <h2 style="margin-bottom: 8px;">Many sign-in attempts on your account</h2>
        <p>Hello ${String(user.firstName || user.name || 'there').replace(/[<>&"']/g, '')},</p>
        <p>There have been many wrong-password attempts on your Chill Shooters account, so password sign-in is paused for a while to keep it safe.</p>
        <p>If you're trying to sign in, use this one-time link. It signs you straight in and clears the pause:</p>
        <p><a href="${link}" style="display:inline-block;padding:10px 18px;border-radius:10px;background:#c5a35a;color:#111827;font-weight:700;text-decoration:none;">Sign me in</a></p>
        <p style="color:#6b7280;font-size:13px;">The link works once and expires in 30 minutes. If it wasn't you, nothing has changed and nobody got in; you can ignore this email, or change your password to be safe.</p>
      </div>
    `,
  }).catch((err) => console.error('Failed to send unlock link', err?.message || err))
}

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
  const keys = loginKeys(normalizedEmail, clientAddress(req))

  try {
    const userAccounts = await getUserAccountsCollection()
    const user = await userAccounts.findOne({ email: normalizedEmail })

    // Count this attempt first (so a burst sent at once is counted), then check the limits.
    const attemptIds = await attempts.record([
      { key: keys.pair, limit: LIMITS.loginPair, account: normalizedEmail },
      { key: keys.address, limit: LIMITS.loginAddress },
      { key: keys.account, limit: LIMITS.loginAccount, account: normalizedEmail },
    ])
    const [pairCount, addressCount, accountCount] = await Promise.all([
      attempts.count(keys.pair, LIMITS.loginPair),
      attempts.count(keys.address, LIMITS.loginAddress),
      attempts.count(keys.account, LIMITS.loginAccount),
    ])
    if (accountCount > LIMITS.loginAccount.max && user) await sendUnlockLink(req, user)
    if (pairCount > LIMITS.loginPair.max || addressCount > LIMITS.loginAddress.max || accountCount > LIMITS.loginAccount.max) {
      return res.status(429).json({ ok: false, error: LOGIN_LIMIT_MESSAGE })
    }

    // No password to check (unknown email, Google-only, or counter-made without a password yet).
    const stored = user && !user.passwordSetupRequired && !isGoogleOnlyAccount(user) ? user.password : null
    const looksLikeBcrypt = typeof stored === 'string' && stored.startsWith('$2')
    let passwordOk = false
    if (looksLikeBcrypt) {
      passwordOk = await bcrypt.compare(password, stored)
    } else {
      // Unknown emails still pay for a hash check, so the response time doesn't give them away.
      await bcrypt.compare(password, DUMMY_HASH)
      // Old accounts whose password was stored before hashing was switched on.
      passwordOk = typeof stored === 'string' && stored.length > 0 && stored === password
    }
    if (!passwordOk) return res.status(401).json({ ok: false, error: LOGIN_FAILED_MESSAGE })

    // The right password: this attempt doesn't count, and the owner's earlier failures are cleared.
    await attempts.forgive(attemptIds)
    await attempts.clearAccount(normalizedEmail)

    // Only someone with the password learns these.
    if (user.emailVerified === false) return res.status(403).json({ ok: false, error: 'email not verified' })
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

// POST /api/auth/unlock { token, remember } — the one-time link from the "many sign-in attempts"
// email: signs the owner in and clears the counts. Opening it proves they own the email.
router.post('/unlock', async (req, res) => {
  const token = String(req.body?.token || '')
  if (!token) return res.status(400).json({ ok: false, error: 'This link is missing its code. Open it again from the email.' })
  try {
    const userAccounts = await getUserAccountsCollection()
    const user = await userAccounts.findOne({ unlockTokenHash: hashToken(token) })
    if (!user || !user.unlockExpiresAt || Date.now() > new Date(user.unlockExpiresAt).getTime()) {
      return res.status(400).json({ ok: false, error: 'This sign-in link has expired or was already used. Log in with your password, or use "Forgot password?".' })
    }
    await userAccounts.updateOne(
      { _id: user._id },
      { $set: { emailVerified: true }, $unset: { unlockTokenHash: '', unlockExpiresAt: '' } },
    )
    await attempts.clearAccount(normalizeEmail(user.email))
    if (isSuspendedAccount(user)) return res.status(403).json({ ok: false, error: SUSPENDED_ACCOUNT_ERROR })
    const authUser = toAuthUser(user, await recordSignIn(userAccounts, user))
    return res.json({ ok: true, user: authUser, token: createAuthToken(authUser, { remember: req.body?.remember === true }) })
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
    if (!user) return createAndSignInWithGoogle(req, res, userAccounts, normalizedEmail, name, body)

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

// ---------------------------------------------------------------------------
// Accounts made at the counter for walk-ins
// ---------------------------------------------------------------------------

const SET_PASSWORD_TTL_MS = 14 * 24 * 60 * 60 * 1000

// A one-time "set your password" link. Only its hash is stored, so a database leak can't be used
// to take over the account.
function newSetPasswordLink(req) {
  const token = randomBytes(32).toString('base64url')
  return {
    url: `${publicAppUrl(req)}/reset-password?token=${encodeURIComponent(token)}`,
    fields: { passwordSetupTokenHash: hashToken(token), passwordSetupExpiresAt: new Date(Date.now() + SET_PASSWORD_TTL_MS).toISOString() },
  }
}

// Makes a player account for a walk-in (staff confirm the player is 18 or older) and emails the
// welcome with a "set your password" link. An email that already has an account is not changed,
// except that an account still waiting for its password gets a fresh link.
// Returns { status: 'created' | 'exists' | 'resent', account: { id, name, email } }.
export async function createWalkInAccount(req, { name, email }) {
  const db = await getDb()
  const userAccounts = await getUserAccountsCollection()
  const normalizedEmail = normalizeEmail(email)
  const existing = await userAccounts.findOne(sameEmailFilter(normalizedEmail))

  if (existing) {
    const account = { id: existing.id, name: existing.name, email: existing.email }
    if (!existing.passwordSetupRequired) return { status: 'exists', account }
    const link = newSetPasswordLink(req)
    await userAccounts.updateOne({ _id: existing._id }, { $set: link.fields })
    await emailWelcome(db, { account: existing, req, setPasswordUrl: link.url, sendKey: `welcome:${existing.id}:${link.fields.passwordSetupExpiresAt}` })
    return { status: 'resent', account }
  }

  const nameParts = splitFullName(name)
  const link = newSetPasswordLink(req)
  const newDoc = {
    id: await nextShortId(db, 'user_accounts', 'P'),
    name: composeFullName(nameParts) || normalizedEmail.split('@')[0],
    ...nameParts,
    email: normalizedEmail,
    emailCanonical: canonicalEmail(normalizedEmail),
    // Nobody knows this password; the player chooses their own from the welcome email.
    password: await bcrypt.hash(randomBytes(32).toString('hex'), 10),
    passwordSetupRequired: true,
    ...link.fields,
    role: 'user',
    experience: 0,
    // Confirmed when the player opens the link sent to this address.
    emailVerified: false,
    identityVerificationStatus: 'not_submitted',
    createdVia: 'walk_in',
    createdBy: { id: String(req.user?.id || ''), role: req.user?.role || '' },
    createdAtISO: new Date().toISOString(),
  }
  await userAccounts.insertOne(newDoc)
  await emailWelcome(db, { account: newDoc, req, setPasswordUrl: link.url })
  return { status: 'created', account: { id: newDoc.id, name: newDoc.name, email: newDoc.email } }
}

// POST /api/auth/set-password { token, password } — a walk-in sets their first password from the
// link in their welcome email. Opening the link also proves they own the email address.
router.post('/set-password', async (req, res) => {
  const token = String(req.body?.token || '')
  const password = String(req.body?.password || '')
  if (!token) return res.status(400).json({ ok: false, error: 'This link is missing its code. Open it again from the welcome email.' })
  const passwordValidation = validatePasswordRequirements(password)
  if (!passwordValidation.valid) return res.status(400).json({ ok: false, error: passwordValidation.errors[0] })

  try {
    const userAccounts = await getUserAccountsCollection()
    const user = await userAccounts.findOne({ passwordSetupTokenHash: hashToken(token) })
    if (!user || !user.passwordSetupExpiresAt || Date.now() > new Date(user.passwordSetupExpiresAt).getTime()) {
      return res.status(400).json({ ok: false, error: 'This link has expired or was already used. Ask the counter on your next visit to send a new one.' })
    }
    await userAccounts.updateOne(
      { _id: user._id },
      {
        $set: { password: await bcrypt.hash(password, 10), emailVerified: true, updatedAtISO: new Date().toISOString() },
        $unset: { passwordSetupRequired: '', passwordSetupTokenHash: '', passwordSetupExpiresAt: '' },
      },
    )
    return res.json({ ok: true, email: user.email, message: 'Password set. You can sign in now.' })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

export default router
