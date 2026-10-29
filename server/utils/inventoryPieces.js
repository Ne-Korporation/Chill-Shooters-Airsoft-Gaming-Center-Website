// Rental inventory is stored one record per physical piece (each mask, vest, and gun has its
// own ID), grouped by `model`. Adding "Mask × 5" creates Mask #1 … Mask #5.

const UNIT_SUFFIX = /\s+#\d+$/
const ID_PREFIX = { weapons: 'W', equipments: 'EQ' }
export const RENTAL_COLLECTIONS = ['weapons', 'equipments']

export function modelOf(item) {
  const model = String(item?.model || String(item?.name || '').replace(UNIT_SUFFIX, '')).trim()
  return model || String(item?.id || '')
}

export function isRentalPiece(item) {
  return Boolean(item) && String(item.source || 'business') !== 'player'
}

// Filter for every rental piece of a model, including older records that only have a name.
export function modelFilter(model) {
  return {
    source: { $ne: 'player' },
    $or: [{ model }, { model: { $exists: false }, name: model }, { model: { $exists: false }, name: { $regex: `^${escapeRegex(model)} #\\d+$` } }],
  }
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function legacyStock(item, collection) {
  const candidates = collection === 'weapons'
    ? [item.quantity, item.qty, item.stock]
    : [item.qty, item.quantity, item.stock]
  const value = candidates.find((candidate) => candidate !== undefined && candidate !== null && candidate !== '')
  const quantity = Number(value ?? 1)
  return Number.isInteger(quantity) && quantity >= 0 ? quantity : 0
}

function initials(model) {
  const words = String(model).trim().split(/\s+/).filter((word) => /[a-z0-9]/i.test(word))
  const letters = words.length >= 2 ? words[0][0] + words[1][0] : (words[0] || 'X')[0]
  return letters.toUpperCase().replace(/[^A-Z0-9]/g, 'X')
}

// Next free IDs like W-MR-007 for this model's initials, never reusing an existing ID.
async function nextPieceIds(db, collection, model, count) {
  const prefix = `${ID_PREFIX[collection]}-${initials(model)}-`
  const existing = await db.collection(collection)
    .find({ id: { $regex: `^${escapeRegex(prefix)}\\d+$` } }, { projection: { id: 1 } })
    .toArray()
  let seq = existing.reduce((max, doc) => Math.max(max, Number(String(doc.id).slice(prefix.length)) || 0), 0)
  return Array.from({ length: count }, () => {
    seq += 1
    return `${prefix}${String(seq).padStart(3, '0')}`
  })
}

async function nextUnitNumbers(db, collection, model, count) {
  const pieces = await db.collection(collection).find(modelFilter(model), { projection: { unitNumber: 1 } }).toArray()
  let next = pieces.reduce((max, piece) => Math.max(max, Number(piece.unitNumber) || 0), 0)
  return Array.from({ length: count }, () => (next += 1))
}

// Creates `count` separate pieces of a model, each with its own ID and unit number.
export async function createPieces(db, collection, { model, count, fields }) {
  const cleanModel = String(model || '').trim().replace(UNIT_SUFFIX, '')
  const [ids, units] = await Promise.all([
    nextPieceIds(db, collection, cleanModel, count),
    nextUnitNumbers(db, collection, cleanModel, count),
  ])
  const nowISO = new Date().toISOString()
  const pieces = ids.map((id, index) => ({
    ...fields,
    id,
    model: cleanModel,
    unitNumber: units[index],
    name: `${cleanModel} #${units[index]}`,
    quantity: 1,
    qty: 1,
    source: 'business',
    approvalStatus: 'approved',
    createdAtISO: nowISO,
  }))
  if (pieces.length) await db.collection(collection).insertMany(pieces)
  return pieces
}

// One-time upgrade for records saved as "one model with a quantity": each extra unit becomes its
// own piece. Safe to run on every start; records that are already pieces are left alone.
export async function splitStockIntoPieces(db) {
  const created = []
  for (const collection of RENTAL_COLLECTIONS) {
    const docs = await db.collection(collection).find({ source: { $ne: 'player' } }).toArray()
    for (const doc of docs) {
      const stock = legacyStock(doc, collection)
      const alreadyPiece = doc.model && Number(doc.unitNumber) > 0 && stock <= 1
      if (alreadyPiece) continue

      const model = modelOf(doc)
      const [unitNumber] = await nextUnitNumbers(db, collection, model, 1)
      await db.collection(collection).updateOne(
        { _id: doc._id },
        { $set: { model, unitNumber, name: `${model} #${unitNumber}`, quantity: 1, qty: 1 } },
      )
      if (stock > 1) {
        const { _id, id, name, unitNumber: _unit, createdAtISO, ...shared } = doc
        const extra = await createPieces(db, collection, { model, count: stock - 1, fields: shared })
        created.push(...extra.map((piece) => piece.id))
      }
    }
  }
  if (created.length) console.log(`Split stock counts into ${created.length} individual rental pieces.`)
  return created
}
