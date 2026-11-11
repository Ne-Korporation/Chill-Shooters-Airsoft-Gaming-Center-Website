import React from 'react'
import toast from 'react-hot-toast'
import { FiAlertTriangle, FiUserX } from 'react-icons/fi'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { apiGet, apiPost } from '../../utils/apiClient'

type Row = { id: string; date: string; slot: string; location: string; newCaptain?: string }
type Preview = { status: string; erased: boolean; past: number; transfer: Row[]; cancel: Row[]; leaveTeam: Row[] }
type Result = { past: number; transferred: string[]; cancelled: string[]; keptPaid: string[]; leftTeam: string[]; erased: boolean }

const when = (row: Row) => [row.date, row.slot].filter(Boolean).join(' · ') + (row.location ? ` · ${row.location}` : '')

// Closes a player's account, or also erases their personal data (privacy request). Shows first
// what happens to each of their bookings (see server/utils/accountClosure.js); nothing is deleted.
export function CloseAccountDialog({ player, eraseOnly = false, onClose, onDone }: {
  player: { id: string; name: string }
  // Opened on an already-closed account: only the erase step is left.
  eraseOnly?: boolean
  onClose: () => void
  onDone: () => void
}) {
  const [preview, setPreview] = React.useState<Preview | null>(null)
  const [loadError, setLoadError] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [erase, setErase] = React.useState(eraseOnly)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    apiGet<{ ok: boolean; data: Preview }>(`/api/auth/admin/players/${encodeURIComponent(player.id)}/closure-preview`)
      .then((res) => setPreview(res.data))
      .catch((e: any) => setLoadError(String(e?.message || e)))
  }, [player.id])

  const submit = async () => {
    setSaving(true)
    try {
      const res = await apiPost<{ ok: boolean; data: Result }>(`/api/auth/admin/players/${encodeURIComponent(player.id)}/close`, { reason: reason.trim(), erase })
      const r = res.data
      const parts = [
        r.transferred.length ? `${r.transferred.length} booking${r.transferred.length === 1 ? '' : 's'} passed to a new captain` : '',
        r.cancelled.length ? `${r.cancelled.length} cancelled` : '',
        r.keptPaid.length ? `${r.keptPaid.length} fully paid kept` : '',
        r.leftTeam.length ? `taken off ${r.leftTeam.length} team${r.leftTeam.length === 1 ? '' : 's'}` : '',
      ].filter(Boolean)
      toast.success(`${erase ? 'Account closed and personal data erased' : 'Account closed'}${parts.length ? `: ${parts.join(', ')}` : ''}.`, { duration: 6000 })
      onDone()
      onClose()
    } catch (e: any) {
      toast.error(String(e?.message || e))
      setSaving(false)
    }
  }

  const upcoming = preview ? preview.transfer.length + preview.cancel.length + preview.leaveTeam.length : 0

  return (
    <Modal
      eyebrow={eraseOnly ? 'Erase personal data' : 'Close account'}
      title={player.name}
      size="md"
      // Above the player details overlay it can be opened from (the confirm pop-ups sit higher still).
      zIndex={100050}
      confirmDiscard={false}
      onClose={saving ? () => {} : onClose}
      footer={(
        <>
          <Button variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={saving || !preview || !reason.trim()} onClick={() => void submit()}>
            <FiUserX /> {saving ? 'Working…' : erase ? (eraseOnly ? 'Erase personal data' : 'Close and erase data') : 'Close account'}
          </Button>
        </>
      )}
    >
      <div className="space-y-4 text-sm">
        <p className="text-muted">
          {eraseOnly
            ? 'Their name, email, birthday and ID photos are removed. Bookings and payments stay on record as "Former player". Signed waivers are kept as legal records.'
            : "They won't be able to log in. Their bookings are kept as records of real games and payments; nothing is deleted."}
        </p>

        {loadError ? <div className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-danger">{loadError}</div> : null}
        {!preview && !loadError ? <div className="text-muted">Checking their bookings…</div> : null}

        {preview && !eraseOnly ? (
          <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="font-semibold">What happens to their bookings</div>
            <div className="text-muted">{preview.past} past booking{preview.past === 1 ? '' : 's'} stay as history.</div>
            {upcoming === 0 ? <div className="text-muted">No upcoming bookings.</div> : null}
            {preview.transfer.length ? (
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-muted">A teammate becomes captain</div>
                <ul className="mt-1 space-y-1">
                  {preview.transfer.map((row) => <li key={row.id}>{when(row)} → <span className="font-semibold">{row.newCaptain}</span></li>)}
                </ul>
              </div>
            ) : null}
            {preview.cancel.length ? (
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-danger">Cancelled (no teammate can take over)</div>
                <ul className="mt-1 space-y-1">{preview.cancel.map((row) => <li key={row.id}>{when(row)}</li>)}</ul>
                <div className="mt-1 text-[11px] text-muted">Fully paid bookings stand under the no-cancellation policy. If a cancelled booking has verified payments, admins get a "Refund to review" notice.</div>
              </div>
            ) : null}
            {preview.leaveTeam.length ? (
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-muted">Taken off the team</div>
                <ul className="mt-1 space-y-1">{preview.leaveTeam.map((row) => <li key={row.id}>{when(row)}</li>)}</ul>
                <div className="mt-1 text-[11px] text-muted">Each captain is told; the spot opens and any unpaid share is covered by the rest of the team.</div>
              </div>
            ) : null}
          </div>
        ) : null}

        <label className="block">
          <div className="mb-2 font-semibold">Reason (kept in the audit log)</div>
          <textarea
            rows={2}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={eraseOnly ? 'e.g. Player asked for their data to be erased' : 'e.g. Player asked to close their account'}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/60"
          />
        </label>

        {!eraseOnly ? (
          <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs">
            <input type="checkbox" className="mt-0.5" checked={erase} onChange={(e) => setErase(e.target.checked)} />
            <span>
              <span className="flex items-center gap-1 font-semibold text-warning"><FiAlertTriangle /> Also erase their personal data</span>
              Only when the player asks for it (Data Privacy Act). Name, email, birthday and ID photos are removed for good; bookings and payments stay as "Former player". This can't be undone.
            </span>
          </label>
        ) : null}
      </div>
    </Modal>
  )
}
