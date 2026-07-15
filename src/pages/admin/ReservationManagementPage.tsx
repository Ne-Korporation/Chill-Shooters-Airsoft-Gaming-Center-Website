import React from 'react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'

export function ReservationManagementPage() {
  const reservations = [
    { id: 'R-10241', player: 'John Alvarez', time: 'Sat • 2:00 PM', status: 'Confirmed', note: 'Elite package with extra gear.' },
    { id: 'R-10244', player: 'Mika Santos', time: 'Sat • 4:30 PM', status: 'Pending', note: 'Awaiting payment confirmation.' },
    { id: 'R-10250', player: 'Rafael Cruz', time: 'Sun • 10:00 AM', status: 'Needs review', note: 'Requested a reschedule after a conflict.' },
  ]

  const [showCalendar, setShowCalendar] = React.useState(false)

  const bookedWeekdays = React.useMemo(() => {
    const set = new Set<string>()
    reservations.forEach((r) => {
      const day = r.time.split(' • ')[0]?.trim()
      if (day) set.add(day)
    })
    return set
  }, [reservations])

  const today = new Date()
  const year = today.getFullYear()
  const month = today.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)

  function weekdayShort(y: number, m: number, d: number) {
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(y, m, d).getDay()]
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">Reservation Management</h1>
        <p className="mt-1 text-sm text-muted">Approve, adjust, and track upcoming slot activity without losing the context of each booking.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Scheduled today</div>
          <div className="mt-2 text-2xl font-bold text-accent">11</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Pending approvals</div>
          <div className="mt-2 text-2xl font-bold text-danger">3</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Open reschedules</div>
          <div className="mt-2 text-2xl font-bold text-success">2</div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted">Booking queue</div>
            <div className="mt-2 text-sm text-muted">Each reservation includes the status, timing, and the reason for follow-up.</div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setShowCalendar(true)}>Open calendar</Button>
        </div>

        {showCalendar ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <div className="absolute inset-0 bg-black/60" onClick={() => setShowCalendar(false)} />
            <div className="relative w-full max-w-4xl rounded-2xl border border-white/5 glass p-8 max-h-[80vh] overflow-auto">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xl font-semibold">Booking calendar — {today.toLocaleString(undefined, { month: 'long', year: 'numeric' })}</div>
                  <div className="mt-1 text-sm text-muted">Highlighted days have bookings</div>
                </div>
                <Button variant="ghost" onClick={() => setShowCalendar(false)}>Close</Button>
              </div>

              <div className="mt-6 grid grid-cols-7 gap-3 text-center text-sm text-muted">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                  <div key={d} className="font-semibold">{d}</div>
                ))}
                {days.map((day) => {
                  const short = weekdayShort(year, month, day)
                  const booked = bookedWeekdays.has(short)
                  return (
                    <div key={day} className={`p-3 rounded-lg ${booked ? 'bg-accent/20 border border-accent/30 text-accent font-semibold' : 'bg-transparent border border-white/5'} text-base`}> 
                      {day}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-4 space-y-3">
          {reservations.map((reservation) => (
            <div key={reservation.id} className="rounded-2xl border border-white/5 bg-white/5 px-4 py-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-sm font-semibold">{reservation.id} • {reservation.player}</div>
                  <div className="mt-1 text-xs text-muted">{reservation.time} • {reservation.note}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-accent/30 bg-accent/20 px-3 py-1 text-[11px] font-semibold text-accent">{reservation.status}</span>
                  <Button variant="ghost" size="sm">Review</Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

