import { MongoClient, ObjectId } from 'mongodb'
import dns from 'dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
// Centralized MongoDB connection
// Uses native MongoDB driver (no mongoose).

const DB_NAME = process.env.DB_NAME || 'chillshootersgamecenter'
export const USER_ACCOUNTS_COLLECTION = process.env.USER_ACCOUNTS_COLLECTION || 'user_accounts'

let client
let dbPromise

function getMongoUri() {
  return process.env.MONGODB_URI
}

async function getDb() {
  const mongoUri = getMongoUri()
  if (!mongoUri) throw new Error('MONGODB_URI missing')

  if (!dbPromise) {
    client = new MongoClient(mongoUri)
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

