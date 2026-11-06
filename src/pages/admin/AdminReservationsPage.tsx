import React from 'react'
import { useSearchParams } from 'react-router-dom'
import { FiCalendar } from 'react-icons/fi'
import { ReservationsByDate } from '../../components/reservations/ReservationsByDate'
import { SlotHoursCard } from '../../components/reservations/SlotHoursCard'
import { FilterTabs } from '../../components/ui/FilterTabs'
import { RegistrarArchivedGamesPage, RegistrarOngoingGamesPage } from '../registrar'

type BookingsTab = 'reservations' | 'games' | 'archived'
const TABS: ReadonlyArray<{ value: BookingsTab; label: string }> = [
  { value: 'reservations', label: 'Reservations' },
  { value: 'games', label: 'Games' },
  { value: 'archived', label: 'Archived' },
]

// One admin page for bookings: dates with bookings and their players (Reservations), confirmed
// bookings as games to start and complete (Games), and finished games (Archived). The tab is kept
// in the address (?tab=games) so it can be linked to and survives a refresh. Bookings confirm
// themselves once their payment is verified (by Xendit, or by staff on the Payments page).
export function AdminReservationsPage() {
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab')
  const tab: BookingsTab = TABS.some((t) => t.value === requested) ? (requested as BookingsTab) : 'reservations'
  const setTab = (next: BookingsTab) => setParams(next === 'reservations' ? {} : { tab: next }, { replace: true })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold"><FiCalendar /> Bookings</h1>
        <p className="mt-1 text-sm text-muted">Reservations, games in progress, and finished games in one place.</p>
      </div>
      <FilterTabs ariaLabel="Bookings view" value={tab} onChange={setTab} options={TABS} />

      {tab === 'reservations' ? (
        <>
          <SlotHoursCard />
          <ReservationsByDate embedded />
        </>
      ) : tab === 'games' ? (
        <RegistrarOngoingGamesPage embedded />
      ) : (
        <RegistrarArchivedGamesPage embedded />
      )}
    </div>
  )
}
