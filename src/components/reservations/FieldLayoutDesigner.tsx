import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FiCopy, FiRotateCw, FiTrash2, FiX } from 'react-icons/fi'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'

// A mock of the field the booker arranges obstacles on. Positions are in field units
// (FIELD_W x FIELD_H, top-left origin) so the layout keeps its shape at any screen size.
const FIELD_W = 600
const FIELD_H = 400

export type ObstacleType = 'wall' | 'bunker' | 'barrel' | 'tires' | 'tower' | 'container' | 'spawnA' | 'spawnB' | 'flag' | 'bomb'

export type LayoutItem = { id: string; type: ObstacleType; x: number; y: number; rot: number }

type Spec = { label: string; w: number; h: number; shape: 'rect' | 'circle'; fill: string; stroke: string; dashed?: boolean; text?: string }

const SPECS: Record<ObstacleType, Spec> = {
  wall: { label: 'Barricade wall', w: 70, h: 12, shape: 'rect', fill: '#8b6b3e', stroke: '#c5a35a' },
  bunker: { label: 'Bunker', w: 40, h: 40, shape: 'rect', fill: '#556b2f', stroke: '#9fb36b' },
  barrel: { label: 'Barrel', w: 18, h: 18, shape: 'circle', fill: '#4a5d6b', stroke: '#9ab0c0' },
  tires: { label: 'Tire stack', w: 26, h: 26, shape: 'circle', fill: '#222222', stroke: '#777777' },
  tower: { label: 'Watch tower', w: 36, h: 36, shape: 'rect', fill: '#6b4a2f', stroke: '#d1a56b', text: 'T' },
  container: { label: 'Container', w: 90, h: 34, shape: 'rect', fill: '#7a2e2e', stroke: '#d07070' },
  spawnA: { label: 'Spawn A', w: 70, h: 50, shape: 'rect', fill: 'rgba(220,60,60,0.25)', stroke: '#e05555', dashed: true, text: 'A' },
  spawnB: { label: 'Spawn B', w: 70, h: 50, shape: 'rect', fill: 'rgba(60,120,230,0.25)', stroke: '#5588ee', dashed: true, text: 'B' },
  flag: { label: 'Flag', w: 20, h: 20, shape: 'circle', fill: '#e8c547', stroke: '#fff3b0', text: 'F' },
  bomb: { label: 'Bomb site', w: 44, h: 44, shape: 'circle', fill: 'rgba(255,140,0,0.25)', stroke: '#ff9a1f', dashed: true, text: 'X' },
}

const PALETTE: ObstacleType[] = ['wall', 'bunker', 'barrel', 'tires', 'tower', 'container', 'spawnA', 'spawnB', 'flag', 'bomb']

const newId = () => Math.random().toString(36).slice(2, 10)
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

// Draws the layout to a PNG, so marshals get it the same way as an uploaded blueprint.
async function renderLayoutPng(items: LayoutItem[], title: string): Promise<File> {
  const scale = 2
  const canvas = document.createElement('canvas')
  canvas.width = FIELD_W * scale
  canvas.height = FIELD_H * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Your browser cannot draw the layout.')
  ctx.scale(scale, scale)

  ctx.fillStyle = '#2f4a22'
  ctx.fillRect(0, 0, FIELD_W, FIELD_H)
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'
  ctx.lineWidth = 1
  for (let x = 50; x < FIELD_W; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, FIELD_H); ctx.stroke() }
  for (let y = 50; y < FIELD_H; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(FIELD_W, y); ctx.stroke() }
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'
  ctx.lineWidth = 3
  ctx.strokeRect(1.5, 1.5, FIELD_W - 3, FIELD_H - 3)

  for (const item of items) {
    const spec = SPECS[item.type]
    ctx.save()
    ctx.translate(item.x, item.y)
    ctx.rotate((item.rot * Math.PI) / 180)
    ctx.fillStyle = spec.fill
    ctx.strokeStyle = spec.stroke
    ctx.lineWidth = 2
    ctx.setLineDash(spec.dashed ? [6, 4] : [])
    ctx.beginPath()
    if (spec.shape === 'circle') ctx.arc(0, 0, spec.w / 2, 0, Math.PI * 2)
    else ctx.rect(-spec.w / 2, -spec.h / 2, spec.w, spec.h)
    ctx.fill()
    ctx.stroke()
    if (spec.text) {
      ctx.setLineDash([])
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 14px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(spec.text, 0, 1)
    }
    ctx.restore()
  }

  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillRect(8, 8, Math.min(FIELD_W - 16, 12 + title.length * 7), 22)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 12px sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(title, 14, 19)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not create the layout image.')
  return new File([blob], 'field-layout.png', { type: 'image/png' })
}

function ObstacleShape({ type, className = '' }: { type: ObstacleType; className?: string }) {
  const spec = SPECS[type]
  return (
    <div
      className={['grid h-full w-full place-items-center text-[11px] font-bold text-white', className].join(' ')}
      style={{
        background: spec.fill,
        border: `2px ${spec.dashed ? 'dashed' : 'solid'} ${spec.stroke}`,
        borderRadius: spec.shape === 'circle' ? '9999px' : '4px',
      }}
    >
      {spec.text}
    </div>
  )
}

export function FieldLayoutDesigner({
  open,
  fieldName,
  initialItems,
  saving,
  onClose,
  onSave,
}: {
  open: boolean
  fieldName: string
  initialItems: LayoutItem[]
  saving?: boolean
  onClose: () => void
  onSave: (items: LayoutItem[], image: File) => void | Promise<void>
}) {
  const [items, setItems] = useState<LayoutItem[]>(initialItems)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const fieldRef = useRef<HTMLDivElement>(null)
  // The piece being dragged and where in it the pointer grabbed it.
  const dragRef = useRef<{ id: string; dx: number; dy: number; fresh: boolean; moved: boolean } | null>(null)

  useEffect(() => {
    if (open) {
      setItems(initialItems)
      setSelectedId(null)
    }
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const toField = useCallback((clientX: number, clientY: number) => {
    const rect = fieldRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0, inside: false }
    const x = ((clientX - rect.left) / rect.width) * FIELD_W
    const y = ((clientY - rect.top) / rect.height) * FIELD_H
    return { x, y, inside: x >= 0 && x <= FIELD_W && y >= 0 && y <= FIELD_H }
  }, [])

  useEffect(() => {
    if (!open) return
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      drag.moved = true
      const { x, y } = toField(event.clientX, event.clientY)
      setItems((current) => current.map((item) => (item.id === drag.id
        ? { ...item, x: clamp(x - drag.dx, -40, FIELD_W + 40), y: clamp(y - drag.dy, -40, FIELD_H + 40) }
        : item)))
    }
    const onUp = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      const { inside } = toField(event.clientX, event.clientY)
      if (!inside && drag.fresh && !drag.moved) {
        // A tap on the palette without dragging: put the piece in the middle of the field.
        setItems((current) => current.map((item) => (item.id === drag.id
          ? { ...item, x: FIELD_W / 2 + (Math.random() - 0.5) * 60, y: FIELD_H / 2 + (Math.random() - 0.5) * 60 }
          : item)))
        return
      }
      if (!inside) {
        // Dropped off the field: a new piece is discarded, a placed one is removed.
        setItems((current) => current.filter((item) => item.id !== drag.id))
        setSelectedId(null)
        return
      }
      setItems((current) => current.map((item) => (item.id === drag.id
        ? { ...item, x: clamp(item.x, 0, FIELD_W), y: clamp(item.y, 0, FIELD_H) }
        : item)))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [open, toField])

  const rotateSelected = useCallback(() => {
    setItems((current) => current.map((item) => (item.id === selectedId ? { ...item, rot: (item.rot + 45) % 360 } : item)))
  }, [selectedId])

  const deleteSelected = useCallback(() => {
    setItems((current) => current.filter((item) => item.id !== selectedId))
    setSelectedId(null)
  }, [selectedId])

  const duplicateSelected = () => {
    const source = items.find((item) => item.id === selectedId)
    if (!source) return
    const copy = { ...source, id: newId(), x: clamp(source.x + 20, 0, FIELD_W), y: clamp(source.y + 20, 0, FIELD_H) }
    setItems((current) => [...current, copy])
    setSelectedId(copy.id)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (event.key === 'Escape') onClose()
      if (!selectedId) return
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelected() }
      if (event.key === 'r' || event.key === 'R') rotateSelected()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, selectedId, deleteSelected, rotateSelected, onClose])

  const startNew = (type: ObstacleType) => (event: React.PointerEvent) => {
    event.preventDefault()
    const { x, y } = toField(event.clientX, event.clientY)
    const item: LayoutItem = { id: newId(), type, x, y, rot: 0 }
    setItems((current) => [...current, item])
    setSelectedId(item.id)
    dragRef.current = { id: item.id, dx: 0, dy: 0, fresh: true, moved: false }
  }

  // Keyboard / tap fallback: a click without dragging drops the piece in the middle of the field.
  const addCentered = (type: ObstacleType) => {
    const item: LayoutItem = { id: newId(), type, x: FIELD_W / 2 + (Math.random() - 0.5) * 60, y: FIELD_H / 2 + (Math.random() - 0.5) * 60, rot: 0 }
    setItems((current) => [...current, item])
    setSelectedId(item.id)
  }

  const startMove = (item: LayoutItem) => (event: React.PointerEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const { x, y } = toField(event.clientX, event.clientY)
    setSelectedId(item.id)
    dragRef.current = { id: item.id, dx: x - item.x, dy: y - item.y, fresh: false, moved: false }
  }

  const save = async () => {
    try {
      const image = await renderLayoutPng(items, `${fieldName} · custom layout`)
      await onSave(items, image)
    } catch {
      // onSave reports upload errors itself
    }
  }

  if (!open) return null

  const selected = items.find((item) => item.id === selectedId)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3" role="dialog" aria-modal="true" aria-labelledby="layout-designer-title">
      <Card className="flex max-h-[95dvh] w-full max-w-5xl flex-col overflow-hidden p-4 md:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div id="layout-designer-title" className="text-base font-bold">Design your field layout · {fieldName}</div>
            <p className="mt-0.5 text-xs text-muted">
              Drag obstacles from the left onto the field, then drag them around. Select one to rotate (R) or delete it (Del). Drag a piece off the field to remove it.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-muted hover:bg-white/10 hover:text-text" aria-label="Close layout designer">
            <FiX />
          </button>
        </div>

        <div className="mt-4 grid min-h-0 flex-1 gap-4 overflow-auto md:grid-cols-[180px_1fr]">
          <div className="grid grid-cols-2 gap-2 self-start md:grid-cols-1">
            {PALETTE.map((type) => (
              <button
                key={type}
                type="button"
                onPointerDown={startNew(type)}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); addCentered(type) } }}
                className="flex cursor-grab touch-none select-none items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-2 py-1.5 text-left text-xs font-semibold hover:bg-white/10 active:cursor-grabbing"
                title={`Drag a ${SPECS[type].label.toLowerCase()} onto the field`}
              >
                <span className="h-5 w-5 shrink-0"><ObstacleShape type={type} className="text-[9px]" /></span>
                {SPECS[type].label}
              </button>
            ))}
          </div>

          <div className="min-w-0">
            <div
              ref={fieldRef}
              onPointerDown={() => setSelectedId(null)}
              className="relative w-full touch-none select-none overflow-hidden rounded-xl border-2 border-white/40"
              style={{
                aspectRatio: `${FIELD_W} / ${FIELD_H}`,
                backgroundColor: '#2f4a22',
                backgroundImage: 'linear-gradient(rgba(255,255,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px)',
                backgroundSize: `${(50 / FIELD_W) * 100}% ${(50 / FIELD_H) * 100}%`,
              }}
            >
              {items.length === 0 ? (
                <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-white/50">Drag obstacles here</div>
              ) : null}
              {items.map((item) => {
                const spec = SPECS[item.type]
                const active = item.id === selectedId
                return (
                  <div
                    key={item.id}
                    onPointerDown={startMove(item)}
                    className={['absolute cursor-move', active ? 'z-10 outline outline-2 outline-offset-2 outline-white' : ''].join(' ')}
                    style={{
                      left: `${(item.x / FIELD_W) * 100}%`,
                      top: `${(item.y / FIELD_H) * 100}%`,
                      width: `${(spec.w / FIELD_W) * 100}%`,
                      height: `${(spec.h / FIELD_H) * 100}%`,
                      transform: `translate(-50%, -50%) rotate(${item.rot}deg)`,
                      borderRadius: spec.shape === 'circle' ? '9999px' : undefined,
                    }}
                    title={spec.label}
                  >
                    <ObstacleShape type={item.type} />
                  </div>
                )
              })}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">{items.length} piece{items.length === 1 ? '' : 's'}{selected ? ` · ${SPECS[selected.type].label} selected` : ''}</span>
              <div className="ml-auto flex flex-wrap gap-2">
                <Button variant="ghost" size="xs" disabled={!selected} onClick={rotateSelected}><FiRotateCw /> Rotate</Button>
                <Button variant="ghost" size="xs" disabled={!selected} onClick={duplicateSelected}><FiCopy /> Duplicate</Button>
                <Button variant="ghost" size="xs" disabled={!selected} onClick={deleteSelected}><FiTrash2 /> Delete</Button>
                <Button variant="ghost" size="xs" disabled={items.length === 0} onClick={() => { setItems([]); setSelectedId(null) }}>Clear all</Button>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-col-reverse gap-2 border-t border-white/10 pt-4 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={saving || items.length === 0} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save layout'}
          </Button>
        </div>
      </Card>
    </div>
  )
}
