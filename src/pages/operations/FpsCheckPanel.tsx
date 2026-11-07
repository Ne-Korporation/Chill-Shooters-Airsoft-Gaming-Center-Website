import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { FiAlertTriangle, FiCheck, FiCrosshair, FiX } from 'react-icons/fi'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { apiGet, apiPost } from '../../utils/apiClient'
import { useAuth } from '../../context/AuthContext'

export type FpsGun = {
  weaponId: string
  name: string
  source: 'rental' | 'own'
  playerName: string
  status: 'pass' | 'fail' | 'pending'
  fps: number | null
  limit: number | null
  testedAtISO: string | null
}
export type FpsStatus = { items: FpsGun[]; allPassed: boolean; pending: number; failed: number; blockReason: string }

export const loadFpsStatus = (reservationId: string) =>
  apiGet<{ data: FpsStatus }>(`/api/reservations/${encodeURIComponent(reservationId)}/fps-checks`).then((r) => r.data)

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }) : '')

// The chronograph check before a game: every gun in it (rental guns handed out and players' own
// guns) gets a reading today. A rental gun that fails is pulled from rentals by the server and
// has to be swapped on the Rentals tab; an own gun that fails can't be used. Marshals (and
// admins) take the readings; everyone else sees the results.
export function FpsCheckPanel({ reservationId, gameplayId, active = true, onChange, onGoToRentals }: {
  reservationId: string
  gameplayId?: string
  active?: boolean
  onChange?: (status: FpsStatus) => void
  onGoToRentals?: () => void
}) {
  const { user } = useAuth()
  const canTest = user?.role === 'admin' || user?.role === 'marshal'
  const [status, setStatus] = useState<FpsStatus | null>(null)
  const [readings, setReadings] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState('')

  const load = useCallback(() => {
    loadFpsStatus(reservationId)
      .then((data) => {
        setStatus(data)
        onChange?.(data)
      })
      .catch(() => setStatus({ items: [], allPassed: true, pending: 0, failed: 0, blockReason: '' }))
  }, [reservationId, onChange])
  useEffect(() => { if (active) load() }, [active, load])

  const save = async (gun: FpsGun) => {
    const fps = Number(readings[gun.weaponId])
    if (!Number.isFinite(fps) || fps <= 0) return toast.error('Enter the chronograph reading in FPS.')
    setSaving(gun.weaponId)
    try {
      const res = await apiPost<{ data: { result: string; limit: number }; weaponPulled?: boolean }>('/api/fps-logs', {
        weaponId: gun.weaponId,
        fps,
        playerName: gun.playerName,
        gameplayId: gameplayId || '',
      })
      if (res.data.result === 'pass') {
        toast.success(`${gun.name}: ${fps} FPS, passed (limit ${res.data.limit}).`)
      } else {
        toast.error(gun.source === 'rental'
          ? `${gun.name}: ${fps} FPS is over the ${res.data.limit} limit. It's been pulled from rentals; swap it on the Rentals tab.`
          : `${gun.name}: ${fps} FPS is over the ${res.data.limit} limit. This player's gun can't be used today.`)
      }
      setReadings((r) => ({ ...r, [gun.weaponId]: '' }))
      load()
    } catch (e: any) {
      toast.error(e?.message || 'Could not save the reading')
    } finally {
      setSaving('')
    }
  }

  if (!status) return <div className="text-sm text-muted">Loading guns…</div>

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-bold"><FiCrosshair /> FPS check before the game</div>
        {status.items.length ? (
          status.allPassed
            ? <span className="flex items-center gap-1 text-xs font-semibold text-success"><FiCheck /> All {status.items.length} guns passed</span>
            : <span className="text-xs text-muted">{status.items.length - status.pending - status.failed} of {status.items.length} passed</span>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-muted">
        Every gun in this game needs a passing chronograph reading today before the game can start.
        {canTest ? '' : ' Marshals take the readings.'}
      </p>

      {status.items.length === 0 ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-muted">
          No guns in this game yet. Hand out rental guns on the Rentals tab; players' own guns show here once they're on the booking.
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-white/5">
          {status.items.map((gun) => (
            <li key={gun.weaponId} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">{gun.name}</span>
                  <span className="rounded-full border border-white/15 px-1.5 py-0.5 text-[10px] uppercase text-muted">{gun.source === 'own' ? 'Own gun' : 'Rental'}</span>
                </div>
                <div className="text-xs text-muted">
                  {gun.playerName || '—'}
                  {gun.status !== 'pending' ? ` · ${gun.fps} FPS (limit ${gun.limit}) at ${time(gun.testedAtISO)}` : ''}
                </div>
              </div>
              <div className="flex flex-none items-center gap-2">
                {gun.status === 'pass' ? (
                  <span className="flex items-center gap-1 rounded-full border border-success/30 bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success"><FiCheck /> Pass</span>
                ) : gun.status === 'fail' ? (
                  <span className="flex items-center gap-1 rounded-full border border-danger/30 bg-danger/15 px-2 py-0.5 text-[11px] font-semibold text-danger"><FiX /> Fail</span>
                ) : (
                  <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">Not tested</span>
                )}
                {canTest && gun.status !== 'pass' ? (
                  <>
                    <input
                      type="number"
                      min={1}
                      inputMode="numeric"
                      value={readings[gun.weaponId] || ''}
                      onChange={(e) => setReadings((r) => ({ ...r, [gun.weaponId]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save(gun) } }}
                      placeholder="FPS"
                      aria-label={`FPS reading for ${gun.name}`}
                      className="h-9 w-20 rounded-xl border border-white/10 bg-white/5 px-2 text-sm outline-none focus:border-accent/40"
                    />
                    <Button size="sm" disabled={saving === gun.weaponId || !readings[gun.weaponId]} onClick={() => void save(gun)}>
                      {gun.status === 'fail' ? 'Retest' : 'Save'}
                    </Button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {status.failed > 0 && onGoToRentals ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs">
          <FiAlertTriangle className="mt-0.5 shrink-0 text-danger" />
          <span>
            A failed rental gun is pulled from rentals. Check it in and hand the player another gun, then test the new one.{' '}
            <button type="button" onClick={onGoToRentals} className="font-semibold text-accent hover:underline">Go to Rentals →</button>
          </span>
        </div>
      ) : null}
    </Card>
  )
}
