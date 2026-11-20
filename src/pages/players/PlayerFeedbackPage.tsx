import React, { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { FiCheckCircle, FiStar } from 'react-icons/fi'
import { apiGet, apiPost } from '../../utils/apiClient'
import { useAuth } from '../../context/AuthContext'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'

type GameplayRecord = {
  id?: string
  _id?: string
  reservationId?: string
  Game?: string
  Schedule?: string
  Location?: string
  Status?: string
  status?: string
}

const ratingFields = [
  { key: 'reservationRating', label: 'Booking the game', hint: 'How easy it was to reserve and pay' },
  { key: 'cleanlinessRating', label: 'Facility cleanliness', hint: 'Restrooms, rest areas and the field' },
  { key: 'equipmentRating', label: 'Gear condition', hint: 'Rental weapons, masks and vests' },
  { key: 'layoutRating', label: 'Field layout', hint: 'Obstacles, cover and objectives' },
  { key: 'staffRating', label: 'Staff and marshals', hint: 'Help, safety and fairness' },
] as const

type RatingKey = typeof ratingFields[number]['key']
type Ratings = Record<RatingKey, number>
type FeedbackRecord = Partial<Ratings> & { gameplayId: string; comment?: string; createdAtISO?: string }

const emptyRatings: Ratings = { reservationRating: 0, cleanlinessRating: 0, equipmentRating: 0, layoutRating: 0, staffRating: 0 }
const SCORE_WORDS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent']

function recordId(game: GameplayRecord) {
  return String(game.id || game._id || '')
}

// "2026-11-08 • morning" → { day: "Sun, Nov 8, 2026", slot: "Morning" }
function scheduleParts(schedule?: string) {
  const [datePart, slotPart] = String(schedule || '').split(/\s*[•·—-]\s*(?=[a-z])/i)
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(datePart || '').trim()) ? new Date(`${datePart.trim()}T12:00:00`) : null
  const day = date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    : String(schedule || '')
  const slot = slotPart ? slotPart.trim().replace(/^./, (c) => c.toUpperCase()) : ''
  return { day, slot }
}

function Stars({ value, onChange, size = 'md', label }: { value: number; onChange?: (score: number) => void; size?: 'sm' | 'md'; label?: string }) {
  const [hover, setHover] = useState(0)
  const shown = hover || value
  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-6 w-6'
  return (
    <div className="flex items-center gap-1" role={onChange ? 'radiogroup' : undefined} aria-label={label} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((score) => {
        const on = score <= shown
        const star = <FiStar className={`${iconSize} ${on ? 'fill-amber-400 text-amber-400' : 'text-muted'}`} />
        return onChange ? (
          <button
            key={score}
            type="button"
            role="radio"
            aria-checked={value === score}
            aria-label={`${score} star${score === 1 ? '' : 's'}: ${SCORE_WORDS[score]}`}
            onMouseEnter={() => setHover(score)}
            onClick={() => onChange(score)}
            className="rounded-md p-0.5 transition hover:scale-110 focus:outline-none focus:ring-2 focus:ring-accent/50"
          >
            {star}
          </button>
        ) : <span key={score}>{star}</span>
      })}
    </div>
  )
}

// Post-game evaluation: pick a completed game, rate five parts of the visit with stars, add an
// optional comment. Games already rated are listed underneath with the player's average.
export function PlayerFeedbackPage() {
  const { user } = useAuth()
  const [games, setGames] = useState<GameplayRecord[]>([])
  const [submitted, setSubmitted] = useState<FeedbackRecord[]>([])
  const [gameplayId, setGameplayId] = useState('')
  const [ratings, setRatings] = useState<Ratings>(emptyRatings)
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const completedGames = useMemo(() => games.filter((game) => {
    const status = String(game.Status || game.status || '').toLowerCase()
    return ['completed', 'archived'].includes(status) && recordId(game)
  }), [games])

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const [gamesResponse, feedbackResponse] = await Promise.all([
          apiGet<{ ok: boolean; data: GameplayRecord[] }>('/api/gameplay?limit=200'),
          apiGet<{ ok: boolean; data: FeedbackRecord[] }>('/api/feedback?limit=200'),
        ])
        if (!active) return
        setGames(Array.isArray(gamesResponse.data) ? gamesResponse.data : [])
        setSubmitted(Array.isArray(feedbackResponse.data) ? feedbackResponse.data : [])
      } catch (error) {
        if (active) toast.error(error instanceof Error ? error.message : 'Unable to load your games')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [])

  const toRate = completedGames.filter((game) => !submitted.some((entry) => entry.gameplayId === recordId(game)))
  const rated = completedGames
    .map((game) => ({ game, feedback: submitted.find((entry) => entry.gameplayId === recordId(game)) }))
    .filter((row): row is { game: GameplayRecord; feedback: FeedbackRecord } => Boolean(row.feedback))
  const selected = toRate.find((game) => recordId(game) === gameplayId) || null
  const allRated = ratingFields.every(({ key }) => ratings[key] > 0)

  const pick = (id: string) => {
    setGameplayId(id)
    setRatings(emptyRatings)
    setComment('')
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!user?.id || !selected || !allRated) return
    setSaving(true)
    try {
      const response = await apiPost<{ ok: boolean; data: FeedbackRecord }>('/api/feedback', { gameplayId, ...ratings, comment })
      setSubmitted((current) => [...current, { ...ratings, comment, ...response.data }])
      setGameplayId('')
      setRatings(emptyRatings)
      setComment('')
      toast.success('Thanks for rating your game!')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to submit your rating')
    } finally {
      setSaving(false)
    }
  }

  const gameTitle = (game: GameplayRecord) => {
    const { day, slot } = scheduleParts(game.Schedule)
    return { day, detail: [slot, game.Location, game.Game].filter(Boolean).join(' · ') }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">Game Evaluation</h1>
        <p className="mt-1 text-sm text-muted">Tell us how your game went. It takes less than a minute.</p>
      </div>

      {loading ? <Card className="p-4 text-sm text-muted">Loading your games…</Card> : null}

      {!loading ? (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          {/* Games waiting for a rating */}
          <Card className="p-4 md:p-5">
            <h2 className="text-lg font-bold">Games to rate</h2>
            {toRate.length === 0 ? (
              <p className="mt-3 text-sm text-muted">You're all caught up. Games you play show up here once they're completed.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {toRate.map((game) => {
                  const id = recordId(game)
                  const { day, detail } = gameTitle(game)
                  const active = id === gameplayId
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => pick(id)}
                        aria-pressed={active}
                        className={`w-full rounded-xl border px-3 py-3 text-left transition ${active ? 'border-accent/50 bg-accent/10' : 'border-white/10 bg-white/5 hover:border-accent/30'}`}
                      >
                        <div className="text-sm font-semibold">{day}</div>
                        {detail ? <div className="mt-0.5 text-xs text-muted">{detail}</div> : null}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}

            {rated.length ? (
              <div className="mt-5 border-t border-white/10 pt-4">
                <div className="text-xs uppercase tracking-widest text-muted">Already rated</div>
                <ul className="mt-2 space-y-2">
                  {rated.map(({ game, feedback }) => {
                    const scores = ratingFields.map(({ key }) => Number(feedback[key] || 0)).filter((n) => n > 0)
                    const average = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
                    const { day, detail } = gameTitle(game)
                    return (
                      <li key={recordId(game)} className="flex items-center justify-between gap-3 rounded-xl px-1 py-1.5">
                        <div className="min-w-0">
                          <div className="truncate text-sm">{day}</div>
                          {detail ? <div className="truncate text-xs text-muted">{detail}</div> : null}
                        </div>
                        {average ? <Stars value={Math.round(average)} size="sm" label={`Average ${average.toFixed(1)} of 5`} /> : <FiCheckCircle className="text-success" />}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : null}
          </Card>

          {/* Rating form for the picked game */}
          <Card className="p-4 md:p-5">
            {!selected ? (
              <div className="py-10 text-center text-sm text-muted">
                {toRate.length ? 'Pick a game on the left to rate it.' : 'Nothing to rate right now.'}
              </div>
            ) : (
              <form className="space-y-5" onSubmit={submit}>
                <div>
                  <div className="text-xs uppercase tracking-widest text-muted">Rating</div>
                  <h2 className="mt-1 text-lg font-bold">{gameTitle(selected).day}</h2>
                  {gameTitle(selected).detail ? <div className="text-sm text-muted">{gameTitle(selected).detail}</div> : null}
                </div>

                <div className="divide-y divide-white/5 rounded-xl border border-white/10">
                  {ratingFields.map(({ key, label, hint }) => (
                    <div key={key} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">{label}</div>
                        <div className="text-xs text-muted">{hint}</div>
                      </div>
                      <div className="flex items-center gap-3 sm:justify-end">
                        <span className="w-20 text-right text-xs font-semibold text-muted">{SCORE_WORDS[ratings[key]] || ''}</span>
                        <Stars value={ratings[key]} label={label} onChange={(score) => setRatings((current) => ({ ...current, [key]: score }))} />
                      </div>
                    </div>
                  ))}
                </div>

                <label className="block">
                  <span className="mb-1 block text-sm font-semibold">Anything else? <span className="font-normal text-muted">(optional)</span></span>
                  <textarea
                    value={comment}
                    onChange={(event) => setComment(event.target.value.slice(0, 2000))}
                    maxLength={2000}
                    rows={3}
                    placeholder="What did you enjoy, and what could be better?"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-text placeholder:text-muted"
                  />
                </label>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-muted">{allRated ? 'Ready to send.' : 'Rate all five to send.'}</span>
                  <Button type="submit" disabled={saving || !allRated}>{saving ? 'Sending…' : 'Send rating'}</Button>
                </div>
              </form>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  )
}
