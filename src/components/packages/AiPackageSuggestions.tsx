import React from 'react'
import toast from 'react-hot-toast'
import { FiCheck, FiEdit2, FiRefreshCw, FiX, FiZap } from 'react-icons/fi'
import { apiPost } from '../../utils/apiClient'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'

// A package idea from Gemini, already checked by the server against current inventory
// (POST /api/admin/package-suggestions). Item ids are real rental pieces, one per model.
export type AiPackageSuggestion = {
  name: string
  description: string
  reason: string
  players: number
  minPlayers: number
  price: number
  perPlayer: number
  itemValue: number
  bbReloadGrams: number
  weapons: Array<{ model: string; pieceId: string; price: number }>
  gear: Array<{ model: string; pieceId: string; price: number; perPlayer: number; ammo: boolean }>
}

type Dropped = { name: string; why: string }

const peso = (value: number) => `₱${Math.round(value).toLocaleString()}`

// The last results are kept for this browser tab, so closing and reopening the panel (or
// leaving the page) doesn't mean waiting for Gemini again.
const SAVED_KEY = 'ai-package-suggestions'
type Saved = { focus: string; suggestions: AiPackageSuggestion[]; dropped: Dropped[]; bookings: number }
function readSaved(): Saved | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SAVED_KEY) || 'null')
    return saved && Array.isArray(saved.suggestions) ? saved : null
  } catch {
    return null
  }
}
function writeSaved(saved: Saved) {
  try {
    sessionStorage.setItem(SAVED_KEY, JSON.stringify(saved))
  } catch {
    // storage unavailable: results just aren't kept
  }
}

export function AiPackageSuggestions({ onAccept, onEdit, onClose }: {
  // Creates the package; resolves once it is saved.
  onAccept: (suggestion: AiPackageSuggestion) => Promise<void>
  // Opens the suggestion in the package editor to change before creating.
  onEdit: (suggestion: AiPackageSuggestion) => void
  onClose: () => void
}) {
  const [saved] = React.useState(readSaved)
  const [focus, setFocus] = React.useState(saved?.focus || '')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')
  const [suggestions, setSuggestions] = React.useState<AiPackageSuggestion[] | null>(saved?.suggestions || null)
  const [dropped, setDropped] = React.useState<Dropped[]>(saved?.dropped || [])
  const [bookings, setBookings] = React.useState(saved?.bookings || 0)
  const [accepting, setAccepting] = React.useState<string | null>(null)
  const [elapsed, setElapsed] = React.useState(0)

  React.useEffect(() => {
    if (suggestions) writeSaved({ focus, suggestions, dropped, bookings })
  }, [suggestions, dropped, bookings])

  // Seconds waited, shown while Gemini works (it can take up to a minute when busy).
  React.useEffect(() => {
    if (!loading) return
    setElapsed(0)
    const started = Date.now()
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [loading])

  const generate = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiPost<{ ok: boolean; data?: AiPackageSuggestion[]; dropped?: Dropped[]; bookingsConsidered?: number; error?: string }>(
        '/api/admin/package-suggestions',
        { focus },
      )
      if (!res?.ok) throw new Error(res?.error || 'Could not get suggestions')
      setSuggestions(res.data || [])
      setDropped(res.dropped || [])
      setBookings(res.bookingsConsidered || 0)
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  const remove = (name: string) => setSuggestions((list) => (list || []).filter((s) => s.name !== name))

  const accept = async (suggestion: AiPackageSuggestion) => {
    setAccepting(suggestion.name)
    try {
      await onAccept(suggestion)
      remove(suggestion.name)
    } catch (e: any) {
      toast.error(String(e?.message || e))
    } finally {
      setAccepting(null)
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted"><FiZap className="text-accent" /> AI package suggestions</div>
          <div className="mt-2 text-sm text-muted">
            Gemini suggests new packages from your rental inventory and the last 90 days of bookings. Check each one, then accept it to add it as an active package, or edit it first.
          </div>
        </div>
        <Button size="xs" variant="ghost" className="-mr-1 -mt-1 shrink-0" onClick={onClose} aria-label="Close AI suggestions" title="Close"><FiX /></Button>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          value={focus}
          maxLength={200}
          onChange={(e) => setFocus(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !loading) void generate() }}
          placeholder="Optional focus, e.g. barkada groups of 5, budget players, students"
          className="w-full flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-text"
        />
        <Button size="sm" variant="primary" disabled={loading} onClick={generate}>
          {suggestions ? <FiRefreshCw /> : <FiZap />} {loading ? 'Thinking…' : suggestions ? 'Suggest again' : 'Get suggestions'}
        </Button>
      </div>

      {error ? <div className="mt-3 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div> : null}

      {loading ? (
        <div className="mt-3 text-xs text-muted">
          Gemini is looking at your inventory and bookings… {elapsed}s
          {elapsed >= 15 ? ' · this can take up to a minute when Gemini is busy. You can close this panel and keep working on this page; the results will be here when you reopen it.' : ''}
        </div>
      ) : null}

      {loading ? (
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {[0, 1, 2].map((key) => <div key={key} className="h-56 animate-pulse rounded-2xl bg-white/5" />)}
        </div>
      ) : suggestions ? (
        <>
          <div className="mt-3 text-[11px] text-muted">
            Based on {bookings} booking{bookings === 1 ? '' : 's'} from the last 90 days. AI suggestions can be wrong: check prices before accepting.
          </div>
          {suggestions.length === 0 ? (
            <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-muted">
              No new suggestions this time{dropped.length ? ' (the ones Gemini gave did not pass the inventory checks)' : ''}. Try again or give it a focus.
            </div>
          ) : (
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {suggestions.map((s) => {
                const diff = s.itemValue - s.price
                return (
                  <div key={s.name} className="flex flex-col rounded-2xl border border-accent/25 bg-accent/5 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-base font-bold">{s.name}</div>
                      <span className="shrink-0 rounded-full border border-accent/30 bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">AI</span>
                    </div>
                    {s.description ? <div className="mt-1 text-xs text-muted">{s.description}</div> : null}

                    <div className="mt-3">
                      <div className="text-xl font-bold text-accent">{peso(s.price)}</div>
                      <div className="text-[11px] text-muted">
                        {s.players > 1 ? `for ${s.players} players · ${peso(s.perPlayer)} each` : 'per player'} · entrance included
                      </div>
                      <div className={`mt-1 text-[11px] ${diff >= 0 ? 'text-muted' : 'text-warning'}`}>
                        Items at list price: {peso(s.itemValue)}
                        {diff > 0 ? ` (${peso(diff)} off)` : diff < 0 ? ` (${peso(-diff)} above list price)` : ''}
                      </div>
                    </div>

                    <ul className="mt-3 space-y-1 text-sm">
                      {s.weapons.map((w) => <li key={w.pieceId}>• {w.model}</li>)}
                      {s.gear.map((g) => (
                        <li key={g.pieceId}>• {g.perPlayer > 1 ? `${g.perPlayer} × ` : ''}{g.model}{g.ammo ? (g.perPlayer > 1 ? ' refills' : ' refill') : ''}</li>
                      ))}
                      {s.bbReloadGrams > 0 ? <li className="text-xs text-muted">{s.bbReloadGrams.toLocaleString()} g of BBs per refill</li> : null}
                    </ul>

                    {s.reason ? <div className="mt-3 rounded-xl bg-white/5 px-3 py-2 text-xs text-muted"><span className="font-semibold text-text">Why: </span>{s.reason}</div> : null}

                    <div className="mt-auto flex flex-wrap gap-2 pt-4">
                      <Button size="xs" variant="success-soft" disabled={accepting !== null} onClick={() => accept(s)}>
                        <FiCheck /> {accepting === s.name ? 'Adding…' : 'Accept'}
                      </Button>
                      <Button size="xs" variant="ghost" disabled={accepting !== null} onClick={() => { onEdit(s); remove(s.name) }}>
                        <FiEdit2 /> Edit first
                      </Button>
                      <Button size="xs" variant="ghost" disabled={accepting !== null} onClick={() => remove(s.name)}>
                        <FiX /> Dismiss
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {dropped.length ? (
            <details className="mt-3 text-[11px] text-muted">
              <summary className="cursor-pointer">{dropped.length} suggestion{dropped.length === 1 ? ' was' : 's were'} left out by the inventory checks</summary>
              <ul className="mt-1 space-y-0.5 pl-4">
                {dropped.map((d, i) => <li key={i}>{d.name}: {d.why}</li>)}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}
    </Card>
  )
}
