import { toObjectId } from '../db/mongo.js'

const ROLE_LABELS = { admin: 'Admin', registrar: 'Registrar', marshal: 'Marshal', user: 'Player' }
const NAME_CACHE_MS = 5 * 60 * 1000
const nameCache = new Map()

export function roleLabel(role) {
  return ROLE_LABELS[String(role || '').toLowerCase()] || 'Staff'
}

// The display name of the signed-in account behind a request, so status changes can record
// which admin or registrar made them ("Registrar Ana Cruz approved…"). Cached briefly.
export async function getActorName(db, actor) {
  const id = String(actor?.id || '')
  if (!id) return ''
  const cached = nameCache.get(id)
  if (cached && Date.now() - cached.at < NAME_CACHE_MS) return cached.name
  const objectId = toObjectId(id)
  const account = await db.collection('user_accounts').findOne(
    { $or: [{ id }, ...(objectId ? [{ _id: objectId }] : [])] },
    { projection: { name: 1, email: 1 } },
  )
  const name = String(account?.name || account?.email || '').trim()
  nameCache.set(id, { name, at: Date.now() })
  return name
}

// "Registrar Ana Cruz" — or just "Registrar" when the account has no name on file.
export function actorLabel(actor, name) {
  return [roleLabel(actor?.role), name].filter(Boolean).join(' ')
}
