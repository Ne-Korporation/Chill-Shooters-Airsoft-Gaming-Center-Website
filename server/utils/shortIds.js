export function formatShortId(prefix, value) {
  return `${prefix}-${String(value).padStart(6, '0')}`
}

// Uses the highest existing numeric id rather than the document count, so deleting
// a document can't cause the next insert to reuse an id that is still taken.
export async function nextShortId(db, collectionName, prefix) {
  const collection = db.collection(collectionName)
  const [latest] = await collection
    .find({ id: { $regex: `^${prefix}-\\d+$` } }, { projection: { id: 1 } })
    .sort({ id: -1 })
    .limit(1)
    .toArray()
  const lastNumber = latest ? Number(String(latest.id).slice(prefix.length + 1)) : 0
  const count = await collection.countDocuments({})
  return formatShortId(prefix, Math.max(lastNumber, count) + 1)
}
