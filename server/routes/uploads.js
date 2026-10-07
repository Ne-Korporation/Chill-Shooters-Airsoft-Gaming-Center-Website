import express from 'express'
import multer from 'multer'
import { Readable } from 'stream'
import axios from 'axios'
import { requireCloudinary } from './cloudinary.js'
import { getUserAccountsCollection } from '../db/mongo.js'

const router = express.Router()

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

async function uploadToCloudinary(fileBuffer, filename) {
  // Use shared initializer which throws a clear error if env is missing.
  const cl = requireCloudinary()

  const stream = Readable.from(fileBuffer)

  return new Promise((resolve, reject) => {
    const uploadStream = cl.uploader.upload_stream(
      {
        resource_type: 'auto',
        public_id: `cs-${Date.now()}-${filename}`,
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

router.post('/upload-image', (req, res, next) => {
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
    const url = await uploadToCloudinary(req.file.buffer, req.file.originalname || 'upload')
    return res.json({ ok: true, url })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

router.post('/scan-id', upload.single('file'), async (req, res) => {
  if (!req.file?.buffer) {
    return res.status(400).json({ ok: false, error: 'file is required' })
  }

  const userId = String(req.body?.userId || '').trim()

  try {
    const imageUrl = await uploadToCloudinary(req.file.buffer, req.file.originalname || 'id-scan')

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
      updatedUser = await collection.findOneAndUpdate(
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
      updatedUser = updatedUser?.value || null
    }

    return res.json({ ok: true, url: imageUrl, scan: scanResult, user: updatedUser })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) })
  }
})

export default router


