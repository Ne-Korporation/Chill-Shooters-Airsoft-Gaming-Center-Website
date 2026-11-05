import express from 'express'
import { getDb } from '../db/mongo.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { CAUSE_DAYS, causeDayView, cleanCauseDay, isDateISO, listActiveCauseDays } from '../utils/causeDays.js'
import { manilaDateISO } from '../utils/reminders.js'

// "Game for a cause" days, set by the admin on the dashboard calendar. Shown on the landing page,
// in Book a game (on hover), and counted in Reports as money reserved for donations.
const router = express.Router()

const actorOf = (req) => ({ id: String(req.user?.id || ''), email: req.user?.email || '', role: req.user?.role || '' })

// GET /api/public/cause-days?from=YYYY-MM-DD&to=YYYY-MM-DD — active cause days (no sign-in needed).
router.get('/public/cause-days', async (req, res) => {
  try {
    const from = isDateISO(req.query.from) ? String(req.query.from) : undefined
    const to = isDateISO(req.query.to) ? String(req.query.to) : undefined
    const db = await getDb()
    return res.json({ ok: true, data: await listActiveCauseDays(db, { from, to }) })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// PUT /api/cause-days/:dateISO { title, description, beneficiary, donationPercent } — makes the date
// a game for a cause, or edits it. Bookings that day are counted toward the donation in Reports.
router.put('/cause-days/:dateISO', requireAuth, requireRole('admin'), async (req, res) => {
  const dateISO = String(req.params.dateISO || '')
  if (!isDateISO(dateISO)) return res.status(400).json({ ok: false, error: 'Choose a valid date.' })
  const cleaned = cleanCauseDay(req.body)
  if (cleaned.error) return res.status(400).json({ ok: false, error: cleaned.error })
  try {
    const db = await getDb()
    const existing = await db.collection(CAUSE_DAYS).findOne({ dateISO })
    const isNew = !existing || existing.active === false
    if (isNew && dateISO < manilaDateISO()) {
      return res.status(400).json({ ok: false, error: 'A past day can’t be made a game for a cause.' })
    }
    const nowISO = new Date().toISOString()
    await db.collection(CAUSE_DAYS).updateOne(
      { dateISO },
      {
        $set: { ...cleaned.value, dateISO, active: true, updatedAtISO: nowISO, updatedBy: actorOf(req) },
        $setOnInsert: { createdAtISO: nowISO, createdBy: actorOf(req) },
        $unset: { removedAtISO: '', removedBy: '' },
        $push: { history: { action: isNew ? 'set' : 'edited', atISO: nowISO, ...cleaned.value, by: actorOf(req) } },
      },
      { upsert: true },
    )
    await db.collection('audit_logs').insertOne({
      action: isNew ? 'cause_day_set' : 'cause_day_edited',
      resourceType: CAUSE_DAYS,
      resourceId: dateISO,
      actorId: String(req.user.id),
      actorRole: req.user.role,
      details: cleaned.value,
      createdAtISO: nowISO,
    }).catch(() => null)
    const saved = await db.collection(CAUSE_DAYS).findOne({ dateISO })
    return res.json({ ok: true, data: causeDayView(saved) })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// POST /api/cause-days/:dateISO/remove — turns the day back into a regular game. The record is
// kept (marked inactive) so its history stays on file.
router.post('/cause-days/:dateISO/remove', requireAuth, requireRole('admin'), async (req, res) => {
  const dateISO = String(req.params.dateISO || '')
  try {
    const db = await getDb()
    const existing = await db.collection(CAUSE_DAYS).findOne({ dateISO, active: { $ne: false } })
    if (!existing) return res.status(404).json({ ok: false, error: 'That day is not a game for a cause.' })
    if (dateISO < manilaDateISO()) {
      return res.status(409).json({ ok: false, error: 'A past game for a cause stays on record for the donation report.' })
    }
    const nowISO = new Date().toISOString()
    await db.collection(CAUSE_DAYS).updateOne(
      { _id: existing._id },
      {
        $set: { active: false, removedAtISO: nowISO, removedBy: actorOf(req), updatedAtISO: nowISO },
        $push: { history: { action: 'removed', atISO: nowISO, by: actorOf(req) } },
      },
    )
    await db.collection('audit_logs').insertOne({
      action: 'cause_day_removed',
      resourceType: CAUSE_DAYS,
      resourceId: dateISO,
      actorId: String(req.user.id),
      actorRole: req.user.role,
      details: { title: existing.title || '' },
      createdAtISO: nowISO,
    }).catch(() => null)
    return res.json({ ok: true, data: { dateISO } })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

export default router
