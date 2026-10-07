import React, { useRef, useState } from 'react'
import { FiAlertTriangle, FiCheck, FiFileText, FiTrash2, FiUpload } from 'react-icons/fi'

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_DIMENSION = 1100 // px, keeps the saved image small enough to store with the waiver

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

// Approximate byte size of a base64 data URL
function dataUrlBytes(dataUrl: string) {
  const base64 = dataUrl.split(',')[1] || ''
  return Math.floor((base64.length * 3) / 4)
}

/**
 * Upload a photo of a valid ID by dragging it onto the drop zone or browsing for it.
 * The image is downscaled to a JPEG data URL so it stays light enough to save inside the waiver record.
 */
export function IdUpload({
  label,
  value,
  onChange,
  disabled,
  error,
  helper = 'Photo of a valid government or school ID. PNG, JPG or WEBP, up to 5 MB.',
}: {
  label: string
  value: string
  onChange: (dataUrl: string) => void
  disabled?: boolean
  error?: string
  helper?: string
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [fileName, setFileName] = useState('')
  const [progress, setProgress] = useState(0)
  const [processing, setProcessing] = useState(false)

  const processFile = (file: File | undefined | null) => {
    if (!file || disabled) return
    setLocalError(null)

    if (!ALLOWED_TYPES.includes(file.type)) {
      setLocalError('Only image files are allowed (PNG, JPG or WEBP).')
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setLocalError('The image must be 5 MB or smaller.')
      return
    }

    setFileName(file.name)
    setProgress(0)
    setProcessing(true)

    const fail = (message: string) => {
      setLocalError(message)
      setProcessing(false)
      setProgress(0)
      setFileName('')
    }

    const reader = new FileReader()
    reader.onprogress = (ev) => {
      if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 70))
    }
    reader.onerror = () => fail('That file could not be read. Please try another image.')
    reader.onload = () => {
      setProgress(80)
      const img = new Image()
      img.onerror = () => fail('That file is not a valid image.')
      img.onload = () => {
        const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          fail('Could not process the image in this browser.')
          return
        }
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, w, h)
        ctx.drawImage(img, 0, 0, w, h)
        onChange(canvas.toDataURL('image/jpeg', 0.82))
        setProgress(100)
        setProcessing(false)
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  }

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow picking the same file again
    processFile(file)
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (disabled) return
    e.dataTransfer.dropEffect = 'copy'
    setDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    if (disabled) return
    processFile(e.dataTransfer.files?.[0])
  }

  const openPicker = () => {
    if (!disabled) inputRef.current?.click()
  }

  const removeFile = () => {
    if (disabled) return
    onChange('')
    setFileName('')
    setProgress(0)
    setProcessing(false)
    setLocalError(null)
  }

  const shownError = localError || error
  const hasFile = Boolean(value) || processing
  const shownName = fileName || (value ? `${label.toLowerCase().replace(/\s+/g, '-')}.jpg` : '')
  const shownProgress = value && !processing ? 100 : progress

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="text-sm font-bold">{label}</div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleInput}
      />

      {/* Drop zone */}
      {!hasFile && !disabled ? (
        <div
          role="button"
          tabIndex={0}
          aria-label={`${label}: drag and drop a file here or browse for a file`}
          onClick={openPicker}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              openPicker()
            }
          }}
          onDragEnter={handleDragOver}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={[
            'mt-3 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 py-8 text-center transition',
            dragging ? 'border-accent bg-accent/10' : 'border-white/20 bg-black/20 hover:bg-white/5',
          ].join(' ')}
        >
          <FiUpload className={['h-10 w-10', dragging ? 'text-accent' : 'text-muted'].join(' ')} />
          <div className="mt-4 text-sm font-bold">{dragging ? 'Drop the file to upload' : 'Drag and drop file here'}</div>
          <div className="my-3 text-xs font-semibold text-muted">or</div>
          <span className="inline-flex items-center rounded-full bg-accent px-5 py-2 text-xs font-semibold text-background transition hover:bg-accent/90">
            Browse for file
          </span>
        </div>
      ) : null}

      {!hasFile && disabled ? (
        <div className="mt-3 rounded-xl border border-dashed border-white/15 bg-black/20 py-8 text-center text-xs text-muted">
          No ID photo selected.
        </div>
      ) : null}

      {/* File row */}
      {hasFile ? (
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-dashed border-white/20 bg-black/20 p-3">
          {value ? (
            <img src={value} alt={label} className="h-12 w-12 flex-none rounded-md bg-white object-cover" />
          ) : (
            <div className="grid h-12 w-12 flex-none place-items-center rounded-md bg-white/10 text-muted">
              <FiFileText className="h-6 w-6" />
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{shownName}</div>
            <div className="text-[11px] text-muted">
              {value ? formatBytes(dataUrlBytes(value)) : 'Processing…'}
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-accent transition-all duration-300"
                style={{ width: `${shownProgress}%` }}
              />
            </div>
          </div>

          {!disabled ? (
            <button
              type="button"
              onClick={removeFile}
              aria-label="Remove file"
              className="flex-none rounded-lg p-2 text-muted transition hover:bg-white/10 hover:text-danger"
            >
              <FiTrash2 />
            </button>
          ) : null}
        </div>
      ) : null}

      {shownError ? (
        <div className="mt-2 flex items-center gap-2 text-xs font-semibold text-danger">
          <FiAlertTriangle /> <span>{shownError}</span>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted">
          {value ? <FiCheck className="text-success" /> : null}
          <span>{value ? 'ID photo attached.' : helper}</span>
        </div>
      )}
    </div>
  )
}