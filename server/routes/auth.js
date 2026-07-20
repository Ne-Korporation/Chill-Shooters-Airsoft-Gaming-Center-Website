import express from 'express'
import bcrypt from 'bcrypt'
import { getDb } from '../db/mongo.js'

const router = express.Router()

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

router.post('/register', async (req, res) => {
  const body = req.body || {}
  const { name, email, password } = body

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ ok: false, error: 'name is required' })
  }

  if (!email || typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ ok: false, error: 'email is required' })
  }

  if (!password || typeof password !== 'string' || password.length < 4) {
    return res.status(400).json({ ok: false, error: 'password must be at least 4 characters' })
  }

  const normalizedEmail = normalizeEmail(email)

  try {
    const db = await getDb()

    const existing = await db.collection('user_accounts').findOne({ email: normalizedEmail })
    if (existing) {
      return res.status(409).json({ ok: false, error: 'email already registered' })
    }

    // If bcrypt is enabled via env, hash; otherwise fall back to plaintext (for existing seeded data).
    const shouldHash = process.env.PASSWORD_HASHING_ENABLED === 'true' || true
    const hashedPassword = shouldHash ? await bcrypt.hash(password, 10) : password

    const newDoc = {
      id: `P_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      role: 'user',
      status: 'pending',
      experience: 0,
      createdAtISO: new Date().toISOString(),
    }

    const result = await db.collection('user_accounts').insertOne(newDoc)

    return res.status(201).json({ ok: true, insertedId: result.insertedId, data: newDoc })
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
    const db = await getDb()
    const user = await db.collection('user_accounts').findOne({ email: normalizedEmail })
    if (!user) return res.status(401).json({ ok: false, error: 'invalid credentials' })

    const stored = user.password

    // Support bcrypt hashes AND legacy plaintext.
    const looksLikeBcrypt = typeof stored === 'string' && stored.startsWith('$2')
    const passwordOk = looksLikeBcrypt ? await bcrypt.compare(password, stored) : stored === password

    if (!passwordOk) return res.status(401).json({ ok: false, error: 'invalid credentials' })

    const payload = {
      user: {
        id: user.id ?? (user._id ? String(user._id) : undefined),
        name: user.name ?? '',
        email: user.email,
        role: user.role ?? 'user',
      },
      // No token/session system exists in the current frontend architecture yet.
      // Return ok + user; frontend will persist user in localStorage.
      token: null,
    }

    return res.json({ ok: true, ...payload })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

export default router

