import express from 'express'
import multer from 'multer'
import { Readable } from 'stream'
import { requireCloudinary } from './cloudinary.js'


const router = express.Router()

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

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

router.post('/upload-image', upload.single('file'), async (req, res) => {
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

export default router

