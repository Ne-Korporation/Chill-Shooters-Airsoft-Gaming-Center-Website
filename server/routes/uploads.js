import express from 'express'
import multer from 'multer'
import { Readable } from 'stream'
import axios from 'axios'
import { randomUUID } from 'crypto'
import { Binary } from 'mongodb'
import { isCloudinaryConfigured, requireCloudinary } from './cloudinary.js'
import { getDb, getUserAccountsCollection } from '../db/mongo.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

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

router.post('/scan-id', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file?.buffer) {
    return res.status(400).json({ ok: false, error: 'file is required' })
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

  try {
    const imageUrl = await storeUpload(req, req.file.buffer, req.file.originalname || 'id-scan', req.file.mimetype)

    let scanResult = null
    const endpoint = process.env.AZURE_VISION_ENDPOINT
    const key = process.env.AZURE_VISION_KEY

    if (endpoint && key) {
      const ocrUrl = new URL(`${endpoint.replace(/\/$/, '')}/vision/v3.2/ocr`).toString()
      try {
        const response = await axios.post(ocrUrl, { url: imageUrl }, {
          headers: {
            'Ocp-Apim-Subscription-Key': key,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        })

        const lines = (response.data?.regions || [])
          .flatMap((region) => region.lines || [])
          .flatMap((line) => line.words || [])
          .map((word) => word.text)
          .filter(Boolean)

        const extractedText = lines.join('\n').trim()
        scanResult = {
          provider: 'azure-vision',
          extractedText,
          summary: extractedText ? extractedText.slice(0, 120) : 'No readable text detected in the uploaded ID.',
          cardDetected: Boolean(extractedText),
        }
      } catch (ocrErr) {
        const message = ocrErr?.response?.data?.error?.message || ocrErr?.message || String(ocrErr)
        scanResult = {
          provider: 'azure-vision',
          extractedText: '',
          summary: `Azure OCR failed: ${message}`,
          cardDetected: false,
        }
      }
    } else {
      scanResult = {
        provider: 'not-configured',
        extractedText: '',
        summary: 'ID scan API not configured. Set AZURE_VISION_ENDPOINT and AZURE_VISION_KEY to enable OCR.',
        cardDetected: false,
      }
    }

    if (!scanResult) {
      scanResult = {
        provider: 'azure-vision',
        extractedText: '',
        summary: 'Azure OCR returned no result.',
        cardDetected: false,
      }
    }

    let updatedUser = null
    if (userId) {
      const collection = await getUserAccountsCollection()
      const updateResult = await collection.findOneAndUpdate(
        { id: userId },
        {
          $set: {
            identityVerificationStatus: 'pending_review',
            identityDocumentUrl: imageUrl,
            identityScanStatus: scanResult.cardDetected ? 'detected' : 'not_detected',
            identityScanProvider: scanResult.provider,
            identityScanSummary: scanResult.summary,
            identityScanText: scanResult.extractedText,
            identityScanDetected: scanResult.cardDetected,
            identityVerificationUpdatedAt: new Date().toISOString(),
          },
        },
        { returnDocument: 'after' },
      )
      updatedUser = updateResult?.value ?? updateResult ?? null
    }

    return res.json({ ok: true, url: imageUrl, scan: scanResult, user: updatedUser })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

export default router
