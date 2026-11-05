import express from 'express'
import multer from 'multer'
import { Readable } from 'stream'
import axios from 'axios'
import { randomUUID } from 'crypto'
import { Binary } from 'mongodb'
import { isCloudinaryConfigured, requireCloudinary } from './cloudinary.js'
import { getDb, getUserAccountsCollection } from '../db/mongo.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { findIdentityIdType } from '../utils/idTypes.js'
import { hasValidIdentity } from '../utils/identityValidity.js'

const router = express.Router()

// Staff paperwork (partner borrowing agreements, return slips, expense receipts): images or PDFs.
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const type = String(file?.mimetype || '')
    if (!type.startsWith('image/') && type !== 'application/pdf') {
      return cb(new Error('Only images and PDF files are allowed.'))
    }
    cb(null, true)
  },
})

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const isImage = file && file.mimetype && file.mimetype.startsWith('image/')
    if (!isImage) {
      return cb(new Error('Only image files are allowed for GCash proof uploads.'))
    }
    cb(null, true)
  },
})

function publicBaseUrl(req) {
  const proto = String(req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim()
  return `${proto}://${req.get('host')}`
}

// Without Cloudinary credentials, keep the image in MongoDB and serve it from
// GET /api/files/:id so uploads still work on a fresh deployment.
async function storeInDatabase(req, fileBuffer, filename, mimetype) {
  const db = await getDb()
  const id = randomUUID()
  await db.collection('uploaded_files').insertOne({
    _id: id,
    filename: String(filename || 'upload').slice(0, 200),
    contentType: mimetype || 'application/octet-stream',
    size: fileBuffer.length,
    data: new Binary(fileBuffer),
    uploadedBy: String(req.user?.id || ''),
    createdAtISO: new Date().toISOString(),
  })
  return `${publicBaseUrl(req)}/api/files/${id}`
}

async function storeUpload(req, fileBuffer, filename, mimetype) {
  if (!isCloudinaryConfigured()) return storeInDatabase(req, fileBuffer, filename, mimetype)
  return uploadToCloudinary(fileBuffer, filename)
}

router.get('/files/:id', async (req, res) => {
  try {
    const db = await getDb()
    const file = await db.collection('uploaded_files').findOne({ _id: String(req.params.id) })
    if (!file) return res.status(404).json({ ok: false, error: 'file not found' })
    res.set('Content-Type', file.contentType)
    res.set('Cache-Control', 'public, max-age=31536000, immutable')
    res.set('X-Content-Type-Options', 'nosniff')
    return res.send(Buffer.from(file.data.buffer))
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

async function uploadToCloudinary(fileBuffer, filename) {
  // Use shared initializer which throws a clear error if env is missing.
  const cl = requireCloudinary()

  const stream = Readable.from(fileBuffer)

  return new Promise((resolve, reject) => {
    const uploadStream = cl.uploader.upload_stream(
      {
        resource_type: 'auto',
        // Cloudinary appends the format itself, so drop the extension to avoid "receipt.png.png".
        public_id: `cs-${Date.now()}-${String(filename).replace(/\.[^.]+$/, '')}`,
      },
      (err, result) => {
        if (err) return reject(err)
        if (!result?.secure_url) return reject(new Error('Cloudinary did not return secure_url'))
        return resolve(result.secure_url)
      },
    )

    stream.on('error', reject)
    stream.pipe(uploadStream)
  })
}

router.post('/upload-document', requireAuth, requireRole('admin', 'registrar', 'marshal'), (req, res, next) => {
  documentUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, error: err.message || 'Only images and PDF files are allowed.' })
    next()
  })
}, async (req, res) => {
  if (!req.file?.buffer) return res.status(400).json({ ok: false, error: 'file is required' })
  try {
    const url = await storeUpload(req, req.file.buffer, req.file.originalname || 'document', req.file.mimetype)
    return res.json({ ok: true, url, name: String(req.file.originalname || 'document').slice(0, 120) })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

router.post('/upload-image', requireAuth, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ ok: false, error: err.message || 'Only image files are allowed for upload.' })
    }
    next()
  })
}, async (req, res) => {
  if (!req.file?.buffer) {
    return res.status(400).json({ ok: false, error: 'file is required' })
  }

  try {
    const url = await storeUpload(req, req.file.buffer, req.file.originalname || 'upload', req.file.mimetype)
    return res.json({ ok: true, url })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

// Reads the text on an ID photo with Azure OCR when it is configured. The result only helps the
// reviewer: staff still verify every ID.
async function scanIdImage(imageUrl) {
  const endpoint = process.env.AZURE_VISION_ENDPOINT
  const key = process.env.AZURE_VISION_KEY
  if (!endpoint || !key) {
    return {
      provider: 'not-configured',
      extractedText: '',
      summary: 'ID scan API not configured. Set AZURE_VISION_ENDPOINT and AZURE_VISION_KEY to enable OCR.',
      cardDetected: false,
    }
  }
  const ocrUrl = new URL(`${endpoint.replace(/\/$/, '')}/vision/v3.2/ocr`).toString()
  try {
    const response = await axios.post(ocrUrl, { url: imageUrl }, {
      headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/json' },
      timeout: 60000,
    })
    const extractedText = (response.data?.regions || [])
      .flatMap((region) => region.lines || [])
      .flatMap((line) => line.words || [])
      .map((word) => word.text)
      .filter(Boolean)
      .join('\n')
      .trim()
    return {
      provider: 'azure-vision',
      extractedText,
      summary: extractedText ? extractedText.slice(0, 120) : 'No readable text detected in the uploaded ID.',
      cardDetected: Boolean(extractedText),
    }
  } catch (ocrErr) {
    const message = ocrErr?.response?.data?.error?.message || ocrErr?.message || String(ocrErr)
    return { provider: 'azure-vision', extractedText: '', summary: `Azure OCR failed: ${message}`, cardDetected: false }
  }
}

const idScanUpload = upload.fields([{ name: 'front', maxCount: 1 }, { name: 'back', maxCount: 1 }, { name: 'file', maxCount: 1 }])

// POST /api/scan-id (multipart): idType, front, and back when that ID type has one.
// Identity verification is for player accounts, after their birthday is on the profile; the
// submission waits for staff review (Players & staff page).
router.post('/scan-id', requireAuth, (req, res, next) => {
  idScanUpload(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, error: err.message || 'Only image files are allowed.' })
    next()
  })
}, async (req, res) => {
  const front = req.files?.front?.[0] || req.files?.file?.[0]
  const back = req.files?.back?.[0]
  if (!front?.buffer) {
    return res.status(400).json({ ok: false, error: 'Attach a photo of the front of your ID.' })
  }

  const requestedUserId = String(req.body?.userId || '').trim()
  if (req.user.role === 'user' && requestedUserId && requestedUserId !== String(req.user.id)) {
    return res.status(403).json({ ok: false, error: 'You can only submit your own identity document.' })
  }
  if (!['user', 'admin', 'registrar'].includes(req.user.role)) {
    return res.status(403).json({ ok: false, error: 'Forbidden: insufficient role permissions' })
  }
  const userId = req.user.role === 'user' ? String(req.user.id) : requestedUserId
  if (!userId) return res.status(400).json({ ok: false, error: 'userId is required' })

  const idType = findIdentityIdType(String(req.body?.idType || '').trim())
  if (!idType) return res.status(400).json({ ok: false, error: 'Choose which ID you are submitting.' })
  if (idType.sides === 'front_back' && !back?.buffer) {
    return res.status(400).json({ ok: false, error: `A ${idType.name} needs photos of both the front and the back.` })
  }

  try {
    const collection = await getUserAccountsCollection()
    const account = await collection.findOne({ id: userId })
    if (!account) return res.status(404).json({ ok: false, error: 'Player not found' })
    if (String(account.role || 'user').toLowerCase() !== 'user') {
      return res.status(400).json({ ok: false, error: 'Staff accounts do not need identity verification.' })
    }
    if (!account.birthDate) {
      return res.status(400).json({ ok: false, error: 'Add your birthday to your profile before verifying your ID.' })
    }
    // A verified ID stays until it expires after a year (with the yearly waiver); it can't be swapped before then.
    if (account.identityVerificationStatus === 'verified' && hasValidIdentity(account)) {
      return res.status(409).json({ ok: false, error: 'Your ID is already verified. You can submit it again once it expires after a year.' })
    }
    // Updating a still-valid ID: the current verification keeps counting until it would expire,
    // so the player can keep booking and joining teams while the new one is reviewed.
    const replacingVerified = account.identityVerificationStatus === 'verified' && hasValidIdentity(account)
    const keepPrevious = replacingVerified
      ? account.identityValidUntilISO || null
      : account.identityPreviousValidUntilISO || null
    // Keep the verified ID's photos: waivers signed meanwhile show the ID that was actually checked.
    const previousDocument = replacingVerified
      ? {
          identityPreviousIdType: account.identityIdType || '',
          identityPreviousDocumentUrl: account.identityDocumentUrl || '',
          identityPreviousDocumentBackUrl: account.identityDocumentBackUrl || '',
        }
      : {}

    const frontUrl = await storeUpload(req, front.buffer, front.originalname || 'id-front', front.mimetype)
    const backUrl = idType.sides === 'front_back'
      ? await storeUpload(req, back.buffer, back.originalname || 'id-back', back.mimetype)
      : ''
    const scanResult = await scanIdImage(frontUrl)

    const updateResult = await collection.findOneAndUpdate(
      { _id: account._id },
      {
        $set: {
          identityVerificationStatus: 'pending_review',
          identityIdType: idType.name,
          identityDocumentUrl: frontUrl,
          identityDocumentBackUrl: backUrl,
          identityScanStatus: scanResult.cardDetected ? 'detected' : 'not_detected',
          identityScanProvider: scanResult.provider,
          identityScanSummary: scanResult.summary,
          identityScanText: scanResult.extractedText,
          identityScanDetected: scanResult.cardDetected,
          identityVerificationUpdatedAt: new Date().toISOString(),
          ...(keepPrevious ? { identityPreviousValidUntilISO: keepPrevious } : {}),
          ...(keepPrevious ? previousDocument : {}),
        },
        $unset: { identityReviewReason: '' },
      },
      { returnDocument: 'after', projection: { password: 0, otpCode: 0, otpExpiresAt: 0, pendingEmailOtp: 0 } },
    )
    const updatedUser = updateResult?.value ?? updateResult ?? null

    return res.json({ ok: true, url: frontUrl, backUrl, scan: scanResult, user: updatedUser })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

export default router
