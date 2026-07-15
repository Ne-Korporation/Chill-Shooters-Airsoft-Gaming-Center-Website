import React from 'react'
import { useParams } from 'react-router-dom'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'

export function PlayerProfilePage() {
  const { playerId } = useParams()

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-xs text-muted border border-white/5">
          <span className="h-2.5 w-2.5 rounded-full bg-accent" />
          <span className="uppercase tracking-[0.18em]">Player</span>
        </div>
        <h1 className="text-3xl font-bold">Player Profile</h1>
        <p className="text-muted text-sm">Profile details for ID: {playerId ?? '—'}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-muted">IMG</div>
            <div>
              <div className="text-lg font-bold">Sgt. Ramirez</div>
              <div className="text-sm text-muted">Experience Level: Advanced</div>
              <div className="text-sm text-muted">Games Played: 34</div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl bg-white/5 border border-white/10 p-4">
            <div className="text-xs uppercase tracking-widest text-muted">Equipment Owned</div>
            <div className="mt-2 text-sm text-muted">Rifle • Mask • Vest (placeholder)</div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Actions</div>
          <div className="mt-3 space-y-2">
            <Button className="w-full" onClick={() => {}}>View Reservation History</Button>
            <Button
              variant="ghost"
              className="w-full bg-white/5 border border-white/10"
              onClick={() => {}}
            >
              Edit Profile
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}

