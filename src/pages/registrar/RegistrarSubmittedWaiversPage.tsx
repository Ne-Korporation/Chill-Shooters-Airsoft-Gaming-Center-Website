import React, { useMemo, useState } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { FiCheck, FiShield, FiClock, FiAlertTriangle, FiX, FiSearch } from 'react-icons/fi'

type WaiverStatus = 'pending' | 'accepted' | 'flagged'

type WaiverRow = {
  id: string
  submittedAtISO: string
  reservationId: string
  participantSummary: string
  isMinor: boolean
  status: WaiverStatus
  reviewerNote: string
}

function dateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export function RegistrarSubmittedWaiversPage() {
  const [query, setQuery] = useState('')

  const [rows, setRows] = useState<WaiverRow[]>(() => [
    {
      id: 'waiv-15001',
      submittedAtISO: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
      reservationId: 'res-12001',
      participantSummary: 'Ramil Santos (Age 16)',
      isMinor: true,
      status: 'pending',
      reviewerNote: '',
    },
    {
      id: 'waiv-15002',
      submittedAtISO: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      reservationId: 'res-12002',
      participantSummary: 'Lina Cruz (Age 21)',
      isMinor: false,
      status: 'accepted',
      reviewerNote: 'Guardian consent verified.',
    },
    {
      id: 'waiv-15003',
      submittedAtISO: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      reservationId: 'res-12004',
      participantSummary: 'Mark Rivera (Age 15)',
      isMinor: true,
      status: 'flagged',
      reviewerNote: 'Signature looks short; needs recheck.',
    },
  ])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => {
      return (
        r.id.toLowerCase().includes(q) ||
        r.reservationId.toLowerCase().includes(q) ||
        r.participantSummary.toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q)
      )
    })
  }, [query, rows])

  const pendingCount = useMemo(() => rows.filter((r) => r.status === 'pending').length, [rows])
  const flaggedCount = useMemo(() => rows.filter((r) => r.status === 'flagged').length, [rows])

  const accept = (id: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'accepted', reviewerNote: 'Waiver accepted by registrar (prototype).' } : r)))
  }

  const clearFlag = (id: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'accepted', reviewerNote: 'Flag cleared after verification (prototype).' } : r)))
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-xs text-muted border border-white/5">
          <span className="h-2.5 w-2.5 rounded-full bg-accent" />
          <span className="uppercase tracking-[0.18em]">Registrar</span>
        </div>
        <h1 className="text-3xl font-bold">Submitted Online Waivers</h1>
        <p className="text-muted text-sm">Review waiver submissions and accept/flag (prototype state-only).</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Pending</div>
          <div className="mt-2 text-2xl font-bold text-accent">{pendingCount}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Flagged</div>
          <div className="mt-2 text-2xl font-bold text-danger">{flaggedCount}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-widest text-muted">Accepted</div>
          <div className="mt-2 text-2xl font-bold text-success">{rows.filter((r) => r.status === 'accepted').length}</div>
        </Card>
      </div>

      <Card className="p-4 md:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2 text-sm font-bold">
            <FiShield /> <span>Waiver queue</span>
          </div>

          <div className="md:w-[420px]">
            <Input
              label="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="waiver id / reservation id / participant / status"
            />
          </div>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-widest text-muted">
                <th className="py-2 pr-3">Waiver</th>
                <th className="py-2 pr-3">Submitted</th>
                <th className="py-2 pr-3">Reservation</th>
                <th className="py-2 pr-3">Participant</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="py-3 pr-3">
                    <div className="font-bold">{r.id}</div>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="font-bold">{dateTime(r.submittedAtISO)}</div>
                    <div className="mt-1 text-xs text-muted flex items-center gap-2">
                      <FiClock /> {r.isMinor ? 'Minor consent included' : 'Adult waiver'}
                    </div>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="font-bold">{r.reservationId}</div>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="font-bold">{r.participantSummary}</div>
                    {r.reviewerNote ? <div className="mt-1 text-xs text-muted">{r.reviewerNote}</div> : null}
                  </td>
                  <td className="py-3 pr-3">
                    <span
                      className={[
                        'inline-flex items-center rounded-xl border px-3 py-1 text-[11px] font-bold',
                        r.status === 'accepted'
                          ? 'bg-success/15 text-success border-success/30'
                          : r.status === 'flagged'
                            ? 'bg-danger/15 text-danger border-danger/30'
                            : 'bg-accent/15 text-gold border-accent/30',
                      ].join(' ')}
                    >
                      {r.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      {r.status === 'pending' ? (
                        <Button variant="primary" className="w-full sm:w-auto" onClick={() => accept(r.id)}>
                          <FiCheck /> Accept
                        </Button>
                      ) : null}
                      {r.status === 'flagged' ? (
                        <Button variant="ghost" className="w-full sm:w-auto" onClick={() => clearFlag(r.id)}>
                          <FiAlertTriangle /> Re-verify
                        </Button>
                      ) : null}
                      {r.status === 'accepted' ? <div className="text-xs text-muted">No action</div> : null}
                    </div>
                  </td>
                </tr>
              ))}

              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-xs text-muted">
                    No waivers match your search.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

