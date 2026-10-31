import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { FiClock } from 'react-icons/fi'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { apiPut } from '../../utils/apiClient'
import { DEFAULT_SLOT_HOURS, formatSlotRange, loadSlotHours, type SlotHours, type SlotName } from '../../utils/slotHours'

const SLOTS: SlotName[] = ['morning', 'afternoon', 'evening']

// Admin editor for the game slot hours that players see when booking and that the
// weather check uses.
export function SlotHoursCard() {
  const [hours, setHours] = useState<SlotHours>(DEFAULT_SLOT_HOURS)
  const [saved, setSaved] = useState<SlotHours>(DEFAULT_SLOT_HOURS)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void loadSlotHours().then((next) => {
      setHours(next)
      setSaved(next)
    })
  }, [])

  const setTime = (slot: SlotName, key: 'start' | 'end', value: string) =>
    setHours((current) => ({ ...current, [slot]: { ...current[slot], [key]: value } }))

  const save = async () => {
    setSaving(true)
    try {
      const res = await apiPut<{ ok: boolean; data: { hours: SlotHours } }>('/api/slot-hours', hours)
      setSaved(res.data.hours)
      setHours(res.data.hours)
      void loadSlotHours(true)
      setOpen(false)
      toast.success('Slot hours saved.')
    } catch (err: any) {
      toast.error(err?.message || 'Unable to save the slot hours')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="mb-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted"><FiClock /> Game time slots</div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {SLOTS.map((slot) => (
              <span key={slot}><span className="font-semibold capitalize">{slot}</span> <span className="text-muted">{formatSlotRange(saved, slot)}</span></span>
            ))}
          </div>
        </div>
        {!open ? <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Edit hours</Button> : null}
      </div>
      {open ? (
        <div className="mt-3 space-y-2">
          {SLOTS.map((slot) => (
            <div key={slot} className="grid grid-cols-[100px,1fr,1fr] items-center gap-2 text-sm">
              <span className="font-semibold capitalize">{slot}</span>
              <input type="time" value={hours[slot].start} onChange={(e) => setTime(slot, 'start', e.target.value)} className="rounded-xl border border-white/10 bg-background px-3 py-2 text-sm" aria-label={`${slot} start`} />
              <input type="time" value={hours[slot].end} onChange={(e) => setTime(slot, 'end', e.target.value)} className="rounded-xl border border-white/10 bg-background px-3 py-2 text-sm" aria-label={`${slot} end`} />
            </div>
          ))}
          <p className="text-xs text-muted">Players see these times when they book, and the weather check reads the forecast for these hours.</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save hours'}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setHours(saved); setOpen(false) }}>Cancel</Button>
          </div>
        </div>
      ) : null}
    </Card>
  )
}
