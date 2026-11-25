import React from 'react'
import { FiAlertTriangle, FiTool } from 'react-icons/fi'

import { FilterTabs } from '../ui/FilterTabs'
import { InfoDropdown } from '../ui/InfoDropdown'
import { apiGet } from '../../utils/apiClient'
import { SafetyLogPage } from '../../pages/marshal/SafetyLogPage'
import { RepairsPage } from '../../pages/operations/RepairsPage'

// "Damage & repairs" for one kind of item (weapons or gear): damage/loss reports, the repair log
// and what repairs cost, as sub-tabs. A report sends the item to maintenance and its repair cost
// is what gets billed.
export function DamageRepairsPanel({ kind }: { kind: 'weapon' | 'equipment' }) {
  const collection = kind === 'weapon' ? 'weapons' : 'equipments'
  const [repairsVersion, setRepairsVersion] = React.useState(0)
  // The sub-tab, and the counts on it: reports waiting for a fee decision, repairs still open.
  const [section, setSection] = React.useState<'reports' | 'repairs' | 'costs'>('reports')
  const [counts, setCounts] = React.useState({ reports: 0, open: 0 })

  React.useEffect(() => {
    let alive = true
    Promise.all([
      apiGet<{ data: any[] }>('/api/damage-reports?limit=200').catch(() => ({ data: [] as any[] })),
      apiGet<{ data: any[] }>(`/api/repairs?collection=${collection}`).catch(() => ({ data: [] as any[] })),
    ]).then(([reports, repairs]) => {
      if (!alive) return
      const mine = (reports.data || []).filter((r: any) => (kind === 'weapon' ? r?.itemType === 'weapon' : r?.itemType !== 'weapon'))
      setCounts({
        reports: mine.filter((r: any) => r?.status === 'reported').length,
        open: (repairs.data || []).filter((r: any) => r?.status === 'in_progress').length,
      })
    })
    return () => { alive = false }
  }, [kind, collection, repairsVersion, section])

  const noun = kind === 'weapon' ? 'weapon' : 'piece of gear'
  return (
    <div className="space-y-4">
      {/* How a broken or lost item moves through this tab, folded away until needed. */}
      <InfoDropdown
        title="How damage and repairs work"
        items={[
          { label: '1. File a report', text: `A damaged ${noun} opens a repair automatically. A lost one gets a loss report only.` },
          { label: '2. Repair it', text: 'Mark the repair done with the parts and labor cost.' },
          { label: '3. Bill or waive', text: "Set the damage fee on the report (it goes on the player's booking for the registrar), or waive it." },
        ]}
      />
      {/* One part at a time: the reports, the repairs, or what repairs cost. */}
      <FilterTabs
        ariaLabel="Damage and repairs"
        value={section}
        onChange={setSection}
        options={[
          { value: 'reports', label: <><FiAlertTriangle /> Damage reports{counts.reports ? <span className="ml-1 rounded-full bg-danger px-1.5 text-[10px] font-bold text-white">{counts.reports}</span> : null}</> },
          { value: 'repairs', label: <><FiTool /> Repairs{counts.open ? <span className="ml-1 rounded-full bg-accent/20 px-1.5 text-[10px] font-bold text-accent">{counts.open} open</span> : null}</> },
          { value: 'costs', label: 'Repair costs' },
        ]}
      />
      {section === 'reports' ? (
        <SafetyLogPage embedded tab="damage" itemType={kind} onRepairOpened={() => { setRepairsVersion((v) => v + 1) }} />
      ) : (
        // Remounted when a damage report opens a repair, so the new one shows up.
        <RepairsPage key={`${repairsVersion}-${section}`} embedded collection={collection} section={section === 'costs' ? 'costs' : 'repairs'} />
      )}
    </div>
  )
}
