import { MongoClient, ObjectId } from 'mongodb'

// Centralized MongoDB connection
// Uses native MongoDB driver (no mongoose).



// Allow local defaults so development works out-of-the-box.
const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://localhost:27017/chillshootersgamecenter'
const DB_NAME = process.env.DB_NAME || 'chillshootersgamecenter'

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

function getCollectionName(name) {
  return String(name)
}

function toObjectId(id) {
  // Accept either a valid ObjectId string or an ObjectId instance
  if (!id) return null
  if (id instanceof ObjectId) return id
  return new ObjectId(String(id))
}

export { getDb, getCollectionName, toObjectId }

