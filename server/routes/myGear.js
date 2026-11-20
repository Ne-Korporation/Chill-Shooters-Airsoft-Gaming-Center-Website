import express from 'express'
import { getDb } from '../db/mongo.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { manilaDateISO } from '../utils/reminders.js'

// A player's own weapons and gear (source 'player'), managed from My Weapons and Gear.
// Players can change the type, category, notes and status (available / damaged) of their own
// items, and their children's, and delete them. Items picked for an upcoming booking can't be
// deleted or switched to the other type, so the booking keeps pointing at a real item.
const router = express.Router()

const COLLECTION_OF = { weapon: 'weapons', gear: 'equipments' }
const WEAPON_CATEGORIES = ['rifles', 'gel_blasters', 'pistols', 'snipers', 'mg', 'shotguns']
const GEAR_CATEGORIES = ['gear', 'masks', 'vests', 'gloves']
// A weapon is named after its category (as when it's added).
const WEAPON_NAMES = { rifles: 'Rifle', gel_blasters: 'Gel blaster', pistols: 'Pistol', snipers: 'Sniper', mg: 'Machine gun', shotguns: 'Shotgun' }
const STATUSES = ['available', 'damaged']
const UPCOMING = ['pending', 'confirmed', 'needs review', 'approved']

async function ownerIds(db, userId) {
  const children = await db.collection('user_accounts')
    .find({ isChildProfile: true, guardianId: String(userId), removedByGuardianAtISO: { $exists: false } }, { projection: { id: 1 } })
    .toArray()
  return [String(userId), ...children.map((child) => String(child.id || child._id))]
}

// The player's own item, or an error to send back.
async function findOwnItem(db, req) {
  const collection = String(req.params.collection)
  if (!Object.values(COLLECTION_OF).includes(collection)) return { error: [400, 'Choose a weapon or gear item.'] }
  const item = await db.collection(collection).findOne({ id: String(req.params.id) })
  const owners = await ownerIds(db, req.user.id)
  if (!item || item.source !== 'player' || !owners.includes(String(item.submittedBy))) return { error: [404, 'Item not found'] }
  return { item, collection }
}

// An upcoming booking that uses this item as the player's own weapon or gear.
async function upcomingUse(db, collection, id) {
  const field = collection === 'weapons' ? 'selectedOwnWeaponIds' : 'selectedOwnEquipmentIds'
  return db.collection('reservations').findOne(
    { [field]: String(id), reservationDate: { $gte: manilaDateISO() }, reservationStatus: { $in: UPCOMING } },
    { projection: { reservationDate: 1, reservationTime: 1 } },
  )
}

// PUT /api/my-gear/:collection/:id { type: 'weapon'|'gear', category, notes, status, name? }
router.put('/my-gear/:collection/:id', requireAuth, requireRole('user'), async (req, res) => {
  const body = req.body || {}
  const type = body.type === 'gear' ? 'gear' : 'weapon'
  const category = String(body.category || '')
  const notes = String(body.notes || '').trim().slice(0, 300)
  const status = String(body.status || 'available')
  if (!(type === 'weapon' ? WEAPON_CATEGORIES : GEAR_CATEGORIES).includes(category)) {
    return res.status(400).json({ ok: false, error: 'Choose a category from the list.' })
  }
  if (!STATUSES.includes(status)) return res.status(400).json({ ok: false, error: 'Status must be available or damaged.' })
  try {
    const db = await getDb()
    const { item, collection, error } = await findOwnItem(db, req)
    if (error) return res.status(error[0]).json({ ok: false, error: error[1] })

    const nowISO = new Date().toISOString()
    const name = type === 'weapon'
      ? WEAPON_NAMES[category] || 'Weapon'
      : String(body.name || item.name || '').trim().slice(0, 80) || 'Gear'
    const changes = { name, category, description: notes, note: notes, status, updatedAtISO: nowISO }
    const target = COLLECTION_OF[type]

    if (target === collection) {
      await db.collection(collection).updateOne({ _id: item._id }, { $set: changes })
      return res.json({ ok: true, data: { ...item, ...changes, _id: undefined } })
    }

    // Switching between weapon and gear moves the item to the other list with a new id.
    const booked = await upcomingUse(db, collection, item.id)
    if (booked) {
      return res.status(409).json({ ok: false, error: `This item is picked for your game on ${booked.reservationDate} (${booked.reservationTime}), so it can't change type now.` })
    }
    const { _id, ...rest } = item
    const moved = {
      ...rest,
      ...changes,
      id: `${type === 'weapon' ? 'W' : 'EQ'}-PLAYER-${Date.now()}`,
      kind: type === 'weapon' ? 'weapon' : 'equipment',
      movedFromId: item.id,
    }
    await db.collection(target).insertOne(moved)
    await db.collection(collection).deleteOne({ _id: item._id })
    const { _id: _newId, ...data } = moved
    return res.json({ ok: true, data })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// DELETE /api/my-gear/:collection/:id
router.delete('/my-gear/:collection/:id', requireAuth, requireRole('user'), async (req, res) => {
  try {
    const db = await getDb()
    const { item, collection, error } = await findOwnItem(db, req)
    if (error) return res.status(error[0]).json({ ok: false, error: error[1] })
    const booked = await upcomingUse(db, collection, item.id)
    if (booked) {
      return res.status(409).json({ ok: false, error: `This item is picked for your game on ${booked.reservationDate} (${booked.reservationTime}). Remove it after the game.` })
    }
    await db.collection(collection).deleteOne({ _id: item._id })
    return res.json({ ok: true })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

export default router
