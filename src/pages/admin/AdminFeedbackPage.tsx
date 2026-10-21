import React, { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { apiGet } from '../../utils/apiClient'
import { Card } from '../../components/ui/Card'

type FeedbackRecord = {
  id?: string
  gameplayId?: string
  userId?: string
  reservationRating?: number
  cleanlinessRating?: number
  equipmentRating?: number
  layoutRating?: number
  staffRating?: number
  comment?: string
  createdAtISO?: string
}

const categories = [
  { key: 'reservationRating', label: 'Reservation' },
  { key: 'cleanlinessRating', label: 'Cleanliness' },
  { key: 'equipmentRating', label: 'Equipment' },
  { key: 'layoutRating', label: 'Field layout' },
  { key: 'staffRating', label: 'Staff / marshals' },
] as const

export function AdminFeedbackPage() {
  const [items, setItems] = useState<FeedbackRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    apiGet<{ ok: boolean; data: FeedbackRecord[] }>('/api/feedback?limit=200')
      .then((response) => {
        if (active) setItems(Array.isArray(response.data) ? response.data : [])
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load feedback')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [])

  const averages = useMemo(() => categories.map(({ key, label }) => {
    const scores = items.map((item) => Number(item[key])).filter((score) => Number.isFinite(score) && score >= 1 && score <= 5)
    return { label, average: scores.length ? (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1) : '—', count: scores.length }
  }), [items])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">Player Feedback</h1>
        <p className="mt-1 text-sm text-muted">Submitted post-game evaluations and category averages.</p>
      </div>
      {error ? <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {averages.map((item) => (
          <Card key={item.label} className="p-4">
            <div className="text-xs uppercase tracking-widest text-muted">{item.label}</div>
            <div className="mt-2 text-2xl font-bold">{loading ? '…' : `${item.average} / 5`}</div>
            <div className="text-xs text-muted">{item.count} ratings</div>
          </Card>
        ))}
      </div>
      <Card className="divide-y divide-white/5 p-4">
        <div className="pb-3 text-xs uppercase tracking-widest text-muted">Recent submissions</div>
        {loading ? <p className="py-4 text-sm text-muted">Loading feedback…</p> : null}
        {!loading && items.length === 0 ? <p className="py-4 text-sm text-muted">No player feedback submitted yet.</p> : null}
        {items.map((item) => (
          <article key={String(item.id || `${item.gameplayId}-${item.userId}`)} className="py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold">Gameplay {item.gameplayId || '—'}</div>
              <div className="text-xs text-muted">{item.createdAtISO ? new Date(item.createdAtISO).toLocaleString() : 'Date unavailable'}</div>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              {categories.map(({ key, label }) => <span key={key}>{label}: {item[key] ?? '—'}/5</span>)}
            </div>
            {item.comment ? <p className="mt-2 whitespace-pre-wrap text-sm">{item.comment}</p> : null}
          </article>
        ))}
      </Card>
    </div>
  )
}
