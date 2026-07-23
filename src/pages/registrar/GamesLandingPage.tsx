import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { FiActivity, FiArchive } from 'react-icons/fi'

export function GamesLandingPage() {
  const navigate = useNavigate()

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">Games</h1>
        <p className="mt-1 text-sm text-muted">Choose whether you want to view ongoing sessions or archived history.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-accent/15 text-gold">
              <FiActivity className="text-xl" />
            </div>
            <div>
              <div className="text-lg font-semibold">Ongoing Games</div>
              <div className="text-sm text-muted">Track active sessions and update game status.</div>
            </div>
          </div>
          <div className="mt-6">
            <Button variant="ghost" onClick={() => navigate('/app/games/ongoing')}>Go to Ongoing Games</Button>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/10 text-text">
              <FiArchive className="text-xl" />
            </div>
            <div>
              <div className="text-lg font-semibold">Archived Games</div>
              <div className="text-sm text-muted">Review completed matches and previous sessions.</div>
            </div>
          </div>
          <div className="mt-6">
            <Button variant="ghost" onClick={() => navigate('/app/games/archived')}>Go to Archived Games</Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
