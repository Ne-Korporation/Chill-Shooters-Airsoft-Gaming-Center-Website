import React from 'react'
import { useSearchParams } from 'react-router-dom'
import { FiCalendar } from 'react-icons/fi'
import { SlotHoursCard } from '../../components/reservations/SlotHoursCard'
import { FieldObstaclesCard } from '../../components/reservations/FieldObstaclesCard'
import { FilterTabs } from '../../components/ui/FilterTabs'
import { InfoDropdown, type InfoItem } from '../../components/ui/InfoDropdown'
import { useAuth } from '../../context/AuthContext'
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

// Reservations for admins, registrars and marshals: the same page for all three. Confirmed
// bookings as games to start and complete (Games), and finished games (Archived). Each game's
// details hold everything about its booking. The tab is kept in the address (?tab=archived) so it
// can be linked to and survives a refresh. Only admins see the slot hours and field layout settings.
export function AdminReservationsPage({ defaultTab = 'games' }: { defaultTab?: ReservationsTab } = {}) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [params, setParams] = useSearchParams()
  const asked = params.get('tab')
  const tab: ReservationsTab = asked === 'games' || asked === 'archived'
    ? asked
    : params.get('game') ? 'games' : defaultTab
  const setTab = (next: ReservationsTab) => setParams(next === defaultTab ? {} : { tab: next }, { replace: true })

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
          {isAdmin ? (
            <>
              <SlotHoursCard />
              <FieldObstaclesCard />
            </>
          ) : null}
          <RegistrarOngoingGamesPage embedded />
        </>
      ) : (
        <RegistrarArchivedGamesPage embedded />
      )}
    </div>
  )
}
