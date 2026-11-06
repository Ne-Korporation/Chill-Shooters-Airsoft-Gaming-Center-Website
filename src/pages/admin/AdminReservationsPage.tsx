import React from 'react'
import { useSearchParams } from 'react-router-dom'
import { FiCalendar } from 'react-icons/fi'
import { SlotHoursCard } from '../../components/reservations/SlotHoursCard'
import { FilterTabs } from '../../components/ui/FilterTabs'
import { RegistrarArchivedGamesPage, RegistrarOngoingGamesPage } from '../registrar'

type ReservationsTab = 'games' | 'archived'
const TABS: ReadonlyArray<{ value: ReservationsTab; label: string }> = [
  { value: 'games', label: 'Games' },
  { value: 'archived', label: 'Archived' },
]

// One admin page for reservations: confirmed bookings as games to start and complete (Games), and
// finished games (Archived). Each game's details hold everything about its booking (players,
// rentals, charges and payments), so there is no separate list of reservations. The tab is kept in
// the address (?tab=archived) so it can be linked to and survives a refresh. Bookings confirm
// themselves once their payment is verified (by Xendit, or by staff on the Payments page).
export function AdminReservationsPage() {
  const [params, setParams] = useSearchParams()
  const tab: ReservationsTab = params.get('tab') === 'archived' ? 'archived' : 'games'
  const setTab = (next: ReservationsTab) => setParams(next === 'games' ? {} : { tab: next }, { replace: true })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold"><FiCalendar /> Reservations</h1>
        <p className="mt-1 text-sm text-muted">Booked games, games in progress, and finished games in one place. Open a game's details to see its full reservation.</p>
      </div>
      <FilterTabs ariaLabel="Reservations view" value={tab} onChange={setTab} options={TABS} />

      {tab === 'games' ? (
        <>
          <SlotHoursCard />
          <RegistrarOngoingGamesPage embedded />
        </>
      ) : (
        <RegistrarArchivedGamesPage embedded />
      )}
    </div>
  )
}
