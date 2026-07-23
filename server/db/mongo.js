import { MongoClient, ObjectId } from 'mongodb'

// Centralized MongoDB connection
// Uses native MongoDB driver (no mongoose).



// Allow local defaults so development works out-of-the-box.
const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://localhost:27017/chillshootersgamecenter'
const DB_NAME = process.env.DB_NAME || 'chillshootersgamecenter'
export const USER_ACCOUNTS_COLLECTION = process.env.USER_ACCOUNTS_COLLECTION || 'user_accounts'

if (!process.env.MONGODB_URI) {
  console.warn('MONGODB_URI not set; using default:', MONGODB_URI)
}


let client
let dbPromise

async function getDb() {
  if (!MONGODB_URI) throw new Error('MONGODB_URI missing')

  if (!dbPromise) {
    client = new MongoClient(MONGODB_URI)
    dbPromise = client
      .connect()
      .then(() => client.db(DB_NAME))
      .catch((err) => {
        dbPromise = null
        throw err
      })
  }

  return dbPromise
}

async function getUserAccountsCollection() {
  const db = await getDb()
  return db.collection(USER_ACCOUNTS_COLLECTION)
}

function getCollectionName(name) {
  return String(name)
}

function toObjectId(id) {
  // Accept either a valid ObjectId string or an ObjectId instance.
  // Invalid values should safely fall back to string-based lookups instead of throwing.
  if (!id) return null
  if (id instanceof ObjectId) return id

  const value = String(id).trim()
  if (!value) return null

  try {
    if (ObjectId.isValid(value)) return new ObjectId(value)
  } catch {
    return null
  }

  return null
}

function isObjectIdLike(value) {
  if (!value) return false
  if (value instanceof ObjectId) return true
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length === 24 && /^[0-9a-fA-F]+$/.test(trimmed)
  }
  return false
}

export { getDb, getCollectionName, toObjectId, isObjectIdLike, getUserAccountsCollection }

