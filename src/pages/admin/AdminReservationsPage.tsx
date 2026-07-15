import React from 'react'
import { Card } from '../../components/ui/Card'

type Status = 'pending' | 'approved' | 'rejected'

const Pill = ({
  tone,
  children,
}: {
  tone: 'accent' | 'success' | 'danger' | 'muted'
  children: React.ReactNode
}) => {
  const cls =
    tone === 'accent'
      ? 'bg-accent/20 text-accent'
      : tone === 'success'
        ? 'bg-success/20 text-success'
        : tone === 'danger'
          ? 'bg-danger/20 text-danger'
          : 'bg-white/5 text-text'

  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${cls}`}>
      {children}
    </span>
  )
}

export function AdminReservationsPage() {
  const [active, setActive] = React.useState<Status>('pending')

  const filterMeta: Record<Status, { count: number; tone: 'accent' | 'success' | 'danger' }> = {
    pending: { count: 12, tone: 'accent' },
    approved: { count: 96, tone: 'success' },
    rejected: { count: 7, tone: 'danger' },
  }

  const rows = [
    {
      id: 'R-10241',
      player: 'John A.',
      date: '2026-07-18 09:00',
      slot: 'Morning Squad',
      status: 'pending' as Status,
    },
    {
      id: 'R-10242',
      player: 'Mika S.',
      date: '2026-07-18 11:00',
      slot: 'CQB Run',
      status: 'pending' as Status,
    },
    {
      id: 'R-10190',
      player: 'Rafael C.',
      date: '2026-07-17 14:00',
      slot: 'Team Deathmatch',
      status: 'approved' as Status,
    },
    {
      id: 'R-10077',
      player: 'Alyssa K.',
      date: '2026-07-16 18:00',
      slot: 'Night Ops',
      status: 'rejected' as Status,
    },
  ].filter((r) => r.status === active)

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Reservations</h1>
          <p className="text-muted text-sm mt-1">
            Manage reservation approvals, rejections, and rescheduling.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {(Object.keys(filterMeta) as Status[]).map((s) => (
            <button
              key={s}
              onClick={() => setActive(s)}
              className={
                'rounded-xl border px-3 py-2 text-sm transition ' +
                (active === s
                  ? 'bg-white/8 text-text border-accent/30'
                  : 'bg-white/5 text-muted hover:bg-white/6')
              }
            >
              <span className="font-semibold">{s.toUpperCase()}</span>
              <span className="ml-2 text-muted">({filterMeta[s].count})</span>
            </button>
          ))}
        </div>
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted">
              Reservation review queue
            </div>
            <div className="mt-2 text-sm text-muted">
              Showing <span className="font-semibold text-text">{active}</span> reservations.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-white/5 border border-white/5 px-3 py-2">
              <div className="text-[11px] text-muted">Search</div>
              <div className="mt-1 text-sm font-semibold">By player / ID</div>
            </div>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-white/5">
          <div className="grid grid-cols-12 gap-0 bg-white/5 px-3 py-2 text-xs uppercase tracking-widest text-muted">
            <div className="col-span-2">ID</div>
            <div className="col-span-3">Player</div>
            <div className="col-span-3">Date</div>
            <div className="col-span-2">Slot</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>

          <div className="divide-y divide-white/5">
            {rows.length === 0 ? (
              <div className="p-6 text-sm text-muted">No reservations found for this status.</div>
            ) : (
              rows.map((r) => (
                <div key={r.id} className="grid grid-cols-12 items-center px-3 py-3">
                  <div className="col-span-2 text-sm font-semibold">{r.id}</div>
                  <div className="col-span-3 text-sm text-muted">{r.player}</div>
                  <div className="col-span-3 text-sm text-muted">{r.date}</div>
                  <div className="col-span-2">
                    <Pill tone={r.status === 'approved' ? 'success' : r.status === 'rejected' ? 'danger' : 'accent'}>
                      {r.status.toUpperCase()}
                    </Pill>
                  </div>
                  <div className="col-span-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button className="rounded-xl bg-white/5 border border-white/5 px-3 py-2 text-xs text-muted hover:bg-white/6 transition">
                        View
                      </button>
                      {r.status === 'pending' ? (
                        <>
                          <button className="rounded-xl bg-success/20 border border-success/30 px-3 py-2 text-xs font-semibold text-success hover:bg-success/25 transition">
                            Approve
                          </button>
                          <button className="rounded-xl bg-danger/20 border border-danger/30 px-3 py-2 text-xs font-semibold text-danger hover:bg-danger/25 transition">
                            Reject
                          </button>
                        </>
                      ) : (
                        <button className="rounded-xl bg-white/5 border border-white/5 px-3 py-2 text-xs font-semibold text-muted hover:bg-white/6 transition">
                          Reschedule
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-muted">
            Page 1 of 5
          </div>
          <div className="flex items-center gap-2">
            <button className="rounded-xl bg-white/5 border border-white/5 px-4 py-2 text-sm text-muted hover:bg-white/6 transition">
              Previous
            </button>
            <button className="rounded-xl bg-white/5 border border-white/5 px-4 py-2 text-sm text-muted hover:bg-white/6 transition">
              Next
            </button>
          </div>
        </div>
      </Card>
    </div>
  )
}


