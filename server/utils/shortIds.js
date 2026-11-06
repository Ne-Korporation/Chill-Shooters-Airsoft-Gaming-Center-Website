import { randomInt } from 'crypto'

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

// Reservation ids: "R-" and 8 random characters, e.g. "R-7KQ2M9XD". Random rather than counted,
// because the id is set before the booking is saved and bookings for different slots are saved
// at the same time. Letters and digits that read alike (0/O, 1/I/L) are left out so the id can be
// read out over the phone. 31^8 ≈ 850 billion ids, so a repeat is practically impossible.
const RESERVATION_ID_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export function newReservationId() {
  let suffix = ''
  for (let i = 0; i < 8; i += 1) suffix += RESERVATION_ID_ALPHABET[randomInt(RESERVATION_ID_ALPHABET.length)]
  return `R-${suffix}`
}
