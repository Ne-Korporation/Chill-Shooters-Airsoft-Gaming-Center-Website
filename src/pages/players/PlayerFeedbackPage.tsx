import React, { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
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
  Status?: string
  status?: string
}

type FeedbackRecord = {
  gameplayId: string
}

const ratingFields = [
  { key: 'reservationRating', label: 'Reservation convenience' },
  { key: 'cleanlinessRating', label: 'Facility cleanliness' },
  { key: 'equipmentRating', label: 'Equipment condition' },
  { key: 'layoutRating', label: 'Field layout' },
  { key: 'staffRating', label: 'Staff and marshal performance' },
] as const

type RatingKey = typeof ratingFields[number]['key']
type Ratings = Record<RatingKey, number>

const initialRatings: Ratings = {
  reservationRating: 5,
  cleanlinessRating: 5,
  equipmentRating: 5,
  layoutRating: 5,
  staffRating: 5,
}

function recordId(game: GameplayRecord) {
  return String(game.id || game._id || '')
}

export function PlayerFeedbackPage() {
  const { user } = useAuth()
  const [games, setGames] = useState<GameplayRecord[]>([])
  const [submitted, setSubmitted] = useState<FeedbackRecord[]>([])
  const [gameplayId, setGameplayId] = useState('')
  const [ratings, setRatings] = useState<Ratings>(initialRatings)
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const eligibleGames = useMemo(() => games.filter((game) => {
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
        if (active) toast.error(error instanceof Error ? error.message : 'Unable to load feedback form')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [])

  const availableGames = eligibleGames.filter((game) => !submitted.some((entry) => entry.gameplayId === recordId(game)))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!user?.id || !gameplayId) {
      toast.error('Choose a completed game first.')
      return
    }
    setSaving(true)
    try {
      const response = await apiPost<{ ok: boolean; data: FeedbackRecord }>('/api/feedback', {
        gameplayId,
        ...ratings,
        comment,
      })
      setSubmitted((current) => [...current, response.data])
      setGameplayId('')
      setRatings(initialRatings)
      setComment('')
      toast.success('Thank you for your feedback.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to submit feedback')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">Game Evaluation</h1>
        <p className="mt-1 text-sm text-muted">Rate your experience after a completed game: reservation, cleanliness, equipment, field layout, and staff.</p>
      </div>

      <Card className="p-4 md:p-6">
        {loading ? <p className="text-sm text-muted">Loading completed games…</p> : null}
        {!loading && availableGames.length === 0 ? (
          <p className="text-sm text-muted">There are no completed games awaiting your feedback.</p>
        ) : null}
        {!loading && availableGames.length > 0 ? (
          <form className="space-y-4" onSubmit={submit}>
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-widest text-muted">Completed game</span>
              <select
                value={gameplayId}
                onChange={(event) => setGameplayId(event.target.value)}
                required
                className="w-full rounded-xl border border-white/10 bg-background px-3 py-3 text-sm text-text [&>option]:bg-background"
              >
                <option value="">Choose a game</option>
                {availableGames.map((game) => (
                  <option key={recordId(game)} value={recordId(game)}>
                    {[game.Game || 'Game', game.Schedule].filter(Boolean).join(' — ')}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              {ratingFields.map(({ key, label }) => (
                <label key={key} className="block">
                  <span className="mb-1 block text-xs font-semibold text-muted">{label}</span>
                  <select
                    value={ratings[key]}
                    onChange={(event) => setRatings((current) => ({ ...current, [key]: Number(event.target.value) }))}
                    className="w-full rounded-xl border border-white/10 bg-background px-3 py-2 text-sm text-text [&>option]:bg-background"
                  >
                    {[5, 4, 3, 2, 1].map((score) => <option key={score} value={score}>{score} / 5</option>)}
                  </select>
                </label>
              ))}
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted">Additional comments (optional)</span>
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value.slice(0, 2000))}
                maxLength={2000}
                rows={4}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-text"
              />
            </label>
            <Button type="submit" disabled={saving || !gameplayId}>{saving ? 'Submitting…' : 'Submit feedback'}</Button>
          </form>
        ) : null}
      </Card>
    </div>
  )
}
