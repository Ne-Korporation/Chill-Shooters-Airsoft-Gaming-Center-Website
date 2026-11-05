import React from 'react'
import { FiImage, FiZoomIn, FiZoomOut } from 'react-icons/fi'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'

const VIEWPORT = 260 // px, the square the photo is cropped to
const OUTPUT = 512 // px, size of the saved photo
const MAX_ZOOM = 4

type Offset = { x: number; y: number }

// Lets the player drag and zoom a photo inside a square frame before it is saved as their profile photo.
// It opens on `initialFile` if given, otherwise on the current photo (`currentUrl`), and the player can
// pick another photo from inside the pop-up.
export function ProfilePhotoCropModal({
  initialFile,
  currentUrl,
  saving,
  onClose,
  onSave,
}: {
  initialFile?: File | null
  currentUrl?: string
  saving: boolean
  onClose: () => void
  onSave: (file: File) => void
}) {
  const [src, setSrc] = React.useState<string>('')
  const [image, setImage] = React.useState<HTMLImageElement | null>(null)
  const [loadError, setLoadError] = React.useState('')
  const [zoom, setZoom] = React.useState(1)
  const [offset, setOffset] = React.useState<Offset>({ x: 0, y: 0 })
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const drag = React.useRef<{ pointerId: number; startX: number; startY: number; from: Offset } | null>(null)
  const objectUrl = React.useRef<string>('')

  const openFile = React.useCallback((file: File) => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    objectUrl.current = URL.createObjectURL(file)
    setLoadError('')
    setSrc(objectUrl.current)
  }, [])

  React.useEffect(() => {
    if (initialFile) openFile(initialFile)
    else if (currentUrl) setSrc(currentUrl)
    return () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    }
  }, [initialFile, currentUrl, openFile])

  // Load the photo. crossOrigin lets the current (already uploaded) photo be drawn onto the canvas.
  React.useEffect(() => {
    if (!src) return
    let alive = true
    const img = new Image()
    if (!src.startsWith('blob:')) img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (!alive) return
      setImage(img)
      setZoom(1)
      const scale = baseScale(img)
      setOffset({ x: (VIEWPORT - img.naturalWidth * scale) / 2, y: (VIEWPORT - img.naturalHeight * scale) / 2 })
    }
    img.onerror = () => {
      if (!alive) return
      setImage(null)
      setLoadError('Could not open this photo. Choose a photo to crop.')
    }
    img.src = src
    return () => {
      alive = false
    }
  }, [src])

  const scale = image ? baseScale(image) * zoom : 1

  const clamp = React.useCallback((next: Offset, atScale: number): Offset => {
    if (!image) return next
    const width = image.naturalWidth * atScale
    const height = image.naturalHeight * atScale
    return {
      x: Math.min(0, Math.max(VIEWPORT - width, next.x)),
      y: Math.min(0, Math.max(VIEWPORT - height, next.y)),
    }
  }, [image])

  // Zoom around the middle of the frame so the part being looked at stays in view.
  const changeZoom = (nextZoom: number) => {
    if (!image) return
    const z = Math.min(MAX_ZOOM, Math.max(1, nextZoom))
    const nextScale = baseScale(image) * z
    const centerX = (VIEWPORT / 2 - offset.x) / scale
    const centerY = (VIEWPORT / 2 - offset.y) / scale
    setZoom(z)
    setOffset(clamp({ x: VIEWPORT / 2 - centerX * nextScale, y: VIEWPORT / 2 - centerY * nextScale }, nextScale))
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!image) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, from: offset }
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    setOffset(clamp({ x: current.from.x + event.clientX - current.startX, y: current.from.y + event.clientY - current.startY }, scale))
  }
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null
  }

  const save = () => {
    if (!image) return
    const canvas = document.createElement('canvas')
    canvas.width = OUTPUT
    canvas.height = OUTPUT
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const size = VIEWPORT / scale
    try {
      ctx.drawImage(image, -offset.x / scale, -offset.y / scale, size, size, 0, 0, OUTPUT, OUTPUT)
      canvas.toBlob((blob) => {
        if (!blob) {
          setLoadError('Could not crop this photo. Choose a photo to crop.')
          return
        }
        onSave(new File([blob], 'profile-photo.jpg', { type: 'image/jpeg' }))
      }, 'image/jpeg', 0.9)
    } catch {
      // The current photo's host didn't allow it to be read back: ask for the file instead.
      setLoadError('This photo canâ€™t be re-cropped. Choose the photo from your device.')
      setImage(null)
    }
  }

  return (
    <Modal
      zIndex={100001}
      title="Crop profile photo"
      eyebrow="Profile photo"
      size="md"
      onClose={saving ? () => {} : onClose}
      footer={(
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={save} disabled={!image || saving}>{saving ? 'Savingâ€¦' : 'Save photo'}</Button>
        </>
      )}
    >
      <div className="flex flex-col items-center gap-4">
        <div
          className="relative touch-none select-none overflow-hidden rounded-2xl border border-white/10 bg-black/40"
          style={{ width: VIEWPORT, height: VIEWPORT, cursor: image ? 'grab' : 'default' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={(event) => changeZoom(zoom - event.deltaY * 0.002)}
        >
          {image ? (
            <img
              src={src}
              alt="Photo to crop"
              draggable={false}
              className="pointer-events-none absolute left-0 top-0 max-w-none"
              style={{ width: image.naturalWidth * scale, height: image.naturalHeight * scale, transform: `translate(${offset.x}px, ${offset.y}px)` }}
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted">
              <FiImage className="text-2xl" />
              {loadError || (src ? 'Loadingâ€¦' : 'Choose a photo to crop.')}
            </div>
          )}
          {/* Round guide: how the photo looks in round avatars. */}
          {image ? <div className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] ring-2 ring-white/70" /> : null}
        </div>

        <div className="flex w-full max-w-[260px] items-center gap-2">
          <button type="button" aria-label="Zoom out" className="text-muted hover:text-text disabled:opacity-40" disabled={!image || zoom <= 1} onClick={() => changeZoom(zoom - 0.2)}>
            <FiZoomOut />
          </button>
          <input
            type="range"
            aria-label="Zoom"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            disabled={!image}
            onChange={(event) => changeZoom(Number(event.target.value))}
            className="flex-1 accent-[rgb(var(--accent))]"
          />
          <button type="button" aria-label="Zoom in" className="text-muted hover:text-text disabled:opacity-40" disabled={!image || zoom >= MAX_ZOOM} onClick={() => changeZoom(zoom + 0.2)}>
            <FiZoomIn />
          </button>
        </div>
        <p className="text-center text-xs text-muted">Drag the photo to move it, and use the slider to zoom.</p>

        <Button type="button" variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()} disabled={saving}>
          <FiImage /> Choose another photo
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) openFile(file)
            event.target.value = ''
          }}
        />
      </div>
    </Modal>
  )
}

// Smallest scale at which the photo still covers the whole frame.
function baseScale(img: HTMLImageElement) {
  return VIEWPORT / Math.min(img.naturalWidth, img.naturalHeight)
}
