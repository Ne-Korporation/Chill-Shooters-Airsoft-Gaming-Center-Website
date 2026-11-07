import React from 'react'
import { useSearchParams } from 'react-router-dom'
import { FiCalendar } from 'react-icons/fi'
import { SlotHoursCard } from '../../components/reservations/SlotHoursCard'
import { FilterTabs } from '../../components/ui/FilterTabs'
import { InfoDropdown, type InfoItem } from '../../components/ui/InfoDropdown'
import { RegistrarArchivedGamesPage, RegistrarOngoingGamesPage } from '../registrar'

type ReservationsTab = 'games' | 'archived'
const TABS: ReadonlyArray<{ value: ReservationsTab; label: string }> = [
  { value: 'games', label: 'Games' },
  { value: 'archived', label: 'Archived' },
]

const INFO: InfoItem[] = [
  { label: 'Games tab', text: 'Confirmed bookings waiting to start, and games in progress. Start a game when the squad arrives and complete it when they finish.' },
  { label: 'Archived tab', text: 'Finished games, kept for reference.' },
  { label: 'Game details', text: 'Open a game to see its full reservation: players, rentals, charges, and payments.' },
  { label: 'Confirmation', text: 'A booking confirms itself once its payment is verified, by Xendit or by staff on the Payments page.' },
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
        <p className="mt-1 text-sm text-muted">Every booked, ongoing, and finished game.</p>
      </div>
      <InfoDropdown items={INFO} />
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
