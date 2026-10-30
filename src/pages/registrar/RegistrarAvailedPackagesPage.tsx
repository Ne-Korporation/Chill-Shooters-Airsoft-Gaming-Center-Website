import React, { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { FiPackage, FiFilter, FiCheck, FiInfo, FiX } from 'react-icons/fi'
import { apiGet } from '../../utils/apiClient'

type AvailStatus = 'in_use' | 'ready_for_queue' | 'inspection_required'

type PackageRow = {
  id: string
  packageName: string
  gameMode: string
  availedAtISO: string
  qtyAvailed: number
  status: AvailStatus
  notes: string
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString()
  } catch {
    return iso
  }
}

const statusConfig: Record<AvailStatus, { label: string; cls: string }> = {
  in_use: { label: 'IN USE', cls: 'bg-accent/15 text-gold border-accent/30' },
  ready_for_queue: { label: 'READY', cls: 'bg-success/15 text-success border-success/30' },
  inspection_required: { label: 'INSPECTION', cls: 'bg-danger/15 text-danger border-danger/30' },
}

export function RegistrarAvailedPackagesPage() {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<AvailStatus | 'all'>('all')
  const [rows, setRows] = useState<PackageRow[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    setLoading(true)
    try {
      const res = await apiGet<{ ok: boolean; data: any[] }>('/api/reservations?limit=200')
      const data = Array.isArray(res?.data) ? res.data : []
      const mapped = data
        .filter((item) => String(item.reservationStatus || '').toLowerCase() === 'confirmed' || String(item.reservationStatus || '').toLowerCase() === 'pending')
        .map((item): PackageRow => ({
          id: String(item.id || item._id || ''),
          packageName: item.packageName || item.selectedGameplayName || '—',
          gameMode: item.gameMode || item.mode || '—',
          availedAtISO: item.createdAtISO || item.updatedAtISO || new Date().toISOString(),
          qtyAvailed: Number(item.numberOfPlayers || item.players || 0),
          status: String(item.reservationStatus || '').toLowerCase() === 'confirmed' ? 'in_use' : 'inspection_required',
          notes: [item.locationName, item.fieldName, item.reservationTime].filter(Boolean).join(' • ') || 'Assigned from reservation queue',
        }))
      setRows(mapped)
    } catch (e: any) {
      toast.error(String(e?.message || e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      const matchesQuery = !q
        ? true
        : r.packageName.toLowerCase().includes(q) || r.gameMode.toLowerCase().includes(q) || r.id.toLowerCase().includes(q)
      const matchesStatus = status === 'all' ? true : r.status === status
      return matchesQuery && matchesStatus
    })
  }, [query, rows, status])

  const canMarkReady = (r: PackageRow) => r.status === 'inspection_required'

  const markReady = (id: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'ready_for_queue' } : r)))
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="text-sm font-medium text-accent">Registrar</div>
        <h1 className="text-3xl font-bold">Availed Packages</h1>
        <p className="text-muted text-sm">View packages that have been used/assigned, with gear readiness status.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-bold">
              <FiPackage /> <span>Package ledger</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted">
              <FiInfo /> <span>{loading ? 'Loading…' : `${filtered.length} records`}</span>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Input label="Search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="package / mode / id" />

            <div>
              <div className="text-xs uppercase tracking-widest text-muted">Status filter</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(['all', 'in_use', 'ready_for_queue', 'inspection_required'] as const).map((s) => {
                  const active = s === status
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setStatus(s)}
                      className={[
                        'rounded-2xl border px-3 py-2 text-xs transition',
                        active ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25' : 'border-white/10 bg-white/5 hover:bg-white/8 text-muted',
                      ].join(' ')}
                    >
                      {s === 'all' ? 'All' : statusConfig[s].label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-widest text-muted">
                  <th className="py-2 pr-3">Availed</th>
                  <th className="py-2 pr-3">Package</th>
                  <th className="py-2 pr-3">Game Mode</th>
                  <th className="py-2 pr-3">Qty</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-xs text-muted">
                      Loading availed packages…
                    </td>
                  </tr>
                ) : null}

                {!loading && filtered.map((r) => (
                  <tr key={r.id} className="border-t border-white/5">
                    <td className="py-3 pr-3">
                      <div className="font-bold">{r.id}</div>
                      <div className="mt-1 text-xs text-muted">{formatDate(r.availedAtISO)}</div>
                    </td>
                    <td className="py-3 pr-3">
                      <div className="font-bold">{r.packageName}</div>
                      <div className="mt-1 text-xs text-muted">{r.notes}</div>
                    </td>
                    <td className="py-3 pr-3">
                      <div className="font-bold">{r.gameMode}</div>
                    </td>
                    <td className="py-3 pr-3">
                      <div className="font-bold">{r.qtyAvailed}</div>
                    </td>
                    <td className="py-3 pr-3">
                      <span className={[
                        'inline-flex items-center rounded-xl border px-3 py-1 text-[11px] font-bold',
                        statusConfig[r.status].cls,
                      ].join(' ')}>
                        {statusConfig[r.status].label}
                      </span>
                    </td>
                    <td className="py-3 pr-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        {canMarkReady(r) ? (
                          <Button variant="primary" className="w-full sm:w-auto" onClick={() => markReady(r.id)}>
                            Mark Ready
                            <FiCheck />
                          </Button>
                        ) : (
                          <div className="text-xs text-muted">No action</div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}

                {!loading && filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-xs text-muted">
                      No availed packages match your filter.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm font-bold">
            <FiFilter /> <span>Registrar notes</span>
          </div>
          <div className="mt-3 space-y-2 text-xs text-muted">
            <div>• This view is now generated from approved and pending reservations.</div>
            <div>• Mark Ready updates the local queue state so the registrar can move a package into the next-ready stage.</div>
            <div className="pt-2">A full backend queue can be added later if the inventory flow needs persistence.</div>
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-black/15 p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 grid h-10 w-10 place-items-center rounded-2xl bg-danger/10 ring-1 ring-danger/25">
                <FiX className="text-danger" />
              </div>
              <div>
                <div className="text-sm font-bold">Queue status</div>
                <div className="mt-1 text-xs text-muted">Mark Ready updates the package to the next queue stage in this registrar view.</div>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
