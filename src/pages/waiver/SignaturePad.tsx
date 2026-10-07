import React, { useEffect, useRef, useState } from 'react'
import { FiAlertTriangle, FiCheck, FiFileText, FiTrash2, FiUpload } from 'react-icons/fi'

type Point = { x: number; y: number }

const OUT_W = 600
const OUT_H = 200
const STROKE_SCREEN = 'rgba(197,163,90,0.95)' // on-screen pad
const STROKE_EXPORT = '#111111' // exported image (prints well)
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MAX_FILE_BYTES = 2 * 1024 * 1024

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function dataUrlBytes(dataUrl: string) {
  const base64 = dataUrl.split(',')[1] || ''
  return Math.floor((base64.length * 3) / 4)
}

function drawLine(ctx: CanvasRenderingContext2D, pts: Point[]) {
  if (pts.length < 2) return
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  ctx.stroke()
}

function paintStroke(ctx: CanvasRenderingContext2D, pts: Point[], color: string) {
  if (pts.length === 1) {
    ctx.beginPath()
    ctx.arc(pts[0].x, pts[0].y, 1.2, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    return
  }
  drawLine(ctx, pts)
}

/**
 * Signature input: draw on a pad, or upload / drag and drop an image of a signature.
 * Both end up as an image data URL passed to onChange.
 * Drawn signatures are PNG, uploaded signatures are JPEG (the parent uses this to tell them apart).
 */
export function SignaturePad({
  title,
  value,
  onChange,
  disabled,
  error,
}: {
  title: string
  value: string
  onChange: (dataUrl: string) => void
  disabled?: boolean
  error?: string
}) {
  const [mode, setMode] = useState<'draw' | 'upload'>('draw')
  const [localError, setLocalError] = useState<string | null>(null)

  // Draw state
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const strokesRef = useRef<Point[][]>([])
  const currentRef = useRef<Point[]>([])
  const drawingRef = useRef(false)
  const sizeRef = useRef({ w: 320, h: 192 })

  // Upload state
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [dragging, setDragging] = useState(false)
  const [fileName, setFileName] = useState('')
  const [progress, setProgress] = useState(0)
  const [processing, setProcessing] = useState(false)

  // ------------------------------------------------------------------
  // Drawing
  // ------------------------------------------------------------------
  const setupCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    const w = rect.width || 320
    const h = rect.height || 192
    sizeRef.current = { w, h }
    canvas.width = Math.floor(w * dpr)
    canvas.height = Math.floor(h * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = 'rgba(255,255,255,0.03)'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = STROKE_SCREEN
    ctx.lineWidth = 2.4
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    return ctx
  }

  const redraw = () => {
    const ctx = setupCanvas()
    if (!ctx) return
    strokesRef.current.forEach((pts) => paintStroke(ctx, pts, STROKE_SCREEN))
  }

  const exportDrawn = (): string => {
    const strokes = strokesRef.current
    if (!strokes.length) return ''
    const { w, h } = sizeRef.current
    const scale = Math.min(OUT_W / w, OUT_H / h)
    const out = document.createElement('canvas')
    out.width = OUT_W
    out.height = OUT_H
    const ctx = out.getContext('2d')
    if (!ctx) return ''
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, OUT_W, OUT_H)
    ctx.translate((OUT_W - w * scale) / 2, (OUT_H - h * scale) / 2)
    ctx.scale(scale, scale)
    ctx.strokeStyle = STROKE_EXPORT
    ctx.lineWidth = 2.4
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    strokes.forEach((pts) => paintStroke(ctx, pts, STROKE_EXPORT))
    return out.toDataURL('image/png')
  }

  const commit = () => {
    const hasReal = strokesRef.current.some((pts) => pts.length >= 2)
    onChange(hasReal ? exportDrawn() : '')
  }

  const pointFromEvent = (e: React.PointerEvent<HTMLCanvasElement>): Point | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return {
      x: clamp(e.clientX - rect.left, 0, rect.width),
      y: clamp(e.clientY - rect.top, 0, rect.height),
    }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return
    const p = pointFromEvent(e)
    const ctx = canvasRef.current?.getContext('2d')
    if (!p || !ctx) return
    try {
      canvasRef.current?.setPointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    drawingRef.current = true
    currentRef.current = [p]
    paintStroke(ctx, currentRef.current, STROKE_SCREEN)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    const p = pointFromEvent(e)
    const ctx = canvasRef.current?.getContext('2d')
    if (!p || !ctx) return
    currentRef.current.push(p)
    const pts = currentRef.current
    if (pts.length >= 2) drawLine(ctx, pts.slice(-2))
  }

  const onPointerUp = () => {
    if (!drawingRef.current) return
    drawingRef.current = false
    if (currentRef.current.length > 0) strokesRef.current.push(currentRef.current)
    currentRef.current = []
    commit()
  }

  const undo = () => {
    if (disabled) return
    strokesRef.current.pop()
    redraw()
    commit()
  }

  const clearAll = () => {
    strokesRef.current = []
    currentRef.current = []
    setFileName('')
    setProgress(0)
    setProcessing(false)
    setLocalError(null)
    if (mode === 'draw') redraw()
    onChange('')
  }

  const switchMode = (next: 'draw' | 'upload') => {
    if (next === mode || disabled) return
    // Switching method starts fresh so the saved image always matches what's on screen
    clearAll()
    setMode(next)
  }

  // Repaint the pad whenever it (re)appears, and on window resize
  useEffect(() => {
    if (disabled || mode !== 'draw') return
    redraw()
    const onResize = () => redraw()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, disabled])

  // If the parent clears the value (e.g. form reset), clear local strokes too
  useEffect(() => {
    if (value) return
    if (strokesRef.current.length) {
      strokesRef.current = []
      if (mode === 'draw') redraw()
    }
    setFileName('')
    setProgress(0)
    setProcessing(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  // ------------------------------------------------------------------
  // Upload (drag and drop / browse)
  // ------------------------------------------------------------------
  const processFile = (file: File | undefined | null) => {
    if (!file || disabled) return
    setLocalError(null)

    if (!ALLOWED_TYPES.includes(file.type)) {
      setLocalError('Only image files are allowed (PNG, JPG or WEBP).')
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setLocalError('The image must be 2 MB or smaller.')
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
        // Normalize to a small white-background JPEG (keeps the upload payload light)
        const out = document.createElement('canvas')
        out.width = OUT_W
        out.height = OUT_H
        const ctx = out.getContext('2d')
        if (!ctx) {
          fail('Could not process the image in this browser.')
          return
        }
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, OUT_W, OUT_H)
        const scale = Math.min(OUT_W / img.width, OUT_H / img.height)
        const dw = img.width * scale
        const dh = img.height * scale
        ctx.drawImage(img, (OUT_W - dw) / 2, (OUT_H - dh) / 2, dw, dh)
        strokesRef.current = []
        onChange(out.toDataURL('image/jpeg', 0.9))
        setProgress(100)
        setProcessing(false)
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  }

  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow picking the same file again
    processFile(file)
  }

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (disabled) return
    e.dataTransfer.dropEffect = 'copy'
    setDragging(true)
  }

  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
  }

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    if (disabled) return
    processFile(e.dataTransfer.files?.[0])
  }

  const openPicker = () => {
    if (!disabled) inputRef.current?.click()
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  const shownError = localError || error
  const hasUpload = mode === 'upload' && (Boolean(value) || processing)
  const uploadName = fileName || 'signature.jpg'
  const uploadProgress = value && !processing ? 100 : progress

  const tabClass = (active: boolean) =>
    [
      'rounded-xl border px-3 py-1.5 text-xs font-bold transition',
      active ? 'border-accent/40 bg-accent/10 text-accent' : 'border-white/10 bg-white/5 text-muted hover:bg-white/10',
    ].join(' ')

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-bold">{title}</div>
        {!disabled ? (
          <div className="flex items-center gap-2">
            <button type="button" className={tabClass(mode === 'draw')} onClick={() => switchMode('draw')}>
              Draw
            </button>
            <button type="button" className={tabClass(mode === 'upload')} onClick={() => switchMode('upload')}>
              Upload
            </button>
          </div>
        ) : null}
      </div>

      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onInput} />

      {/* Read-only: show the saved signature */}
      {disabled ? (
        value ? (
          <div className="mt-3 rounded-xl bg-white p-2">
            <img src={value} alt={title} className="mx-auto h-28 w-full object-contain" />
          </div>
        ) : (
          <div className="mt-3 rounded-xl border border-dashed border-white/15 bg-black/20 py-8 text-center text-xs text-muted">
            No signature submitted.
          </div>
        )
      ) : null}

      {/* Draw tab */}
      {!disabled && mode === 'draw' ? (
        <>
          <div className="relative mt-3 overflow-hidden rounded-xl border border-dashed border-white/20 bg-black/20">
            <canvas
              ref={canvasRef}
              className="block h-48 w-full cursor-crosshair touch-none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              aria-label={`${title} drawing pad`}
            />
            {!value ? (
              <div className="pointer-events-none absolute inset-0 grid place-items-center text-xs text-muted">
                Sign here using your mouse, finger or stylus
              </div>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={undo}
              disabled={!strokesRef.current.length}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-muted transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Undo
            </button>
            <button
              type="button"
              onClick={clearAll}
              disabled={!value}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-muted transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        </>
      ) : null}

      {/* Upload tab: drop zone */}
      {!disabled && mode === 'upload' && !hasUpload ? (
        <div
          role="button"
          tabIndex={0}
          aria-label={`${title}: drag and drop a file here or browse for a file`}
          onClick={openPicker}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              openPicker()
            }
          }}
          onDragEnter={onDragOver}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
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

      {/* Upload tab: file row */}
      {!disabled && hasUpload ? (
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-dashed border-white/20 bg-black/20 p-3">
          {value ? (
            <img src={value} alt={title} className="h-12 w-16 flex-none rounded-md bg-white object-contain" />
          ) : (
            <div className="grid h-12 w-16 flex-none place-items-center rounded-md bg-white/10 text-muted">
              <FiFileText className="h-6 w-6" />
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{uploadName}</div>
            <div className="text-[11px] text-muted">{value ? formatBytes(dataUrlBytes(value)) : 'Processing…'}</div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-accent transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={clearAll}
            aria-label="Remove file"
            className="flex-none rounded-lg p-2 text-muted transition hover:bg-white/10 hover:text-danger"
          >
            <FiTrash2 />
          </button>
        </div>
      ) : null}

      {shownError ? (
        <div className="mt-2 flex items-center gap-2 text-xs font-semibold text-danger">
          <FiAlertTriangle /> <span>{shownError}</span>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted">
          {value ? <FiCheck className="text-success" /> : null}
          <span>
            {value
              ? 'Signature captured.'
              : mode === 'upload'
                ? 'Upload a clear image of your signature. PNG, JPG or WEBP, up to 2 MB.'
                : 'Draw your signature in the box above.'}
          </span>
        </div>
      )}
    </div>
  )
}