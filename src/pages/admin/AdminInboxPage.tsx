import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { FiAlertTriangle, FiArchive, FiCheck, FiMail, FiRotateCcw, FiSend } from 'react-icons/fi'
import { apiGet, apiPost, apiPut } from '../../utils/apiClient'
import { useLiveRefresh } from '../../utils/liveUpdates'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { FilterTabs } from '../../components/ui/FilterTabs'
import { Paged } from '../../components/ui/Pagination'

type InboxStatus = 'new' | 'read' | 'replied' | 'archived'

type ContactMessage = {
  id: string
  name: string
  email: string
  message: string
  status: InboxStatus
  // Whether the copy sent to the official email address went out.
  emailStatus?: 'sending' | 'sent' | 'failed'
  // Replies sent from this page (emailed by the server).
  replies?: Array<{ body: string; byEmail?: string; atISO: string }>
  createdAtISO: string
}

type Filter = 'inbox' | InboxStatus

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'inbox', label: 'Inbox' },
  { value: 'new', label: 'Unread' },
  { value: 'replied', label: 'Replied' },
  { value: 'archived', label: 'Archived' },
]

const STATUS_STYLE: Record<InboxStatus, string> = {
  new: 'border-accent/40 bg-accent/15 text-accent',
  read: 'border-white/10 bg-white/5 text-muted',
  replied: 'border-success/30 bg-success/10 text-success',
  archived: 'border-white/10 bg-white/5 text-muted',
}
const STATUS_LABEL: Record<InboxStatus, string> = { new: 'Unread', read: 'Read', replied: 'Replied', archived: 'Archived' }

function formatWhen(iso: string) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })
}

// Messages from players. Replies are written here and emailed by the server, so they always come
// from the center (never an admin's personal account); the player's answer goes to the official address.
export function AdminInboxPage() {
  const [filter, setFilter] = useState<Filter>('inbox')
  const [messages, setMessages] = useState<ContactMessage[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const status = filter === 'inbox' ? '' : `?status=${filter}`
      const res = await apiGet<{ ok: boolean; data: ContactMessage[]; unread: number }>(`/api/admin/inbox${status}`)
      setMessages(Array.isArray(res.data) ? res.data : [])
      setUnread(Number(res.unread) || 0)
    } catch (err: any) {
      if (!quiet) toast.error(err?.message || 'Could not load the inbox')
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [filter])

  useEffect(() => { void load() }, [load])
  useLiveRefresh(['inbox'], () => load(true))

  const setStatus = async (message: ContactMessage, status: InboxStatus, quiet = false) => {
    setBusyId(message.id)
    try {
      await apiPut(`/api/admin/inbox/${encodeURIComponent(message.id)}`, { status })
      if (!quiet) toast.success(status === 'archived' ? 'Message archived.' : status === 'replied' ? 'Marked as replied.' : status === 'new' ? 'Marked as unread.' : 'Moved back to the inbox.')
      await load(true)
    } catch (err: any) {
      toast.error(err?.message || 'Could not update the message')
    } finally {
      setBusyId(null)
    }
  }

  const changeFilter = (value: Filter) => {
    setFilter(value)
    setOpenId(null)
    setDraft('')
  }

  const sendReply = async (message: ContactMessage) => {
    const body = draft.trim()
    if (!body) return
    setSending(true)
    try {
      await apiPost(`/api/admin/inbox/${encodeURIComponent(message.id)}/reply`, { body })
      toast.success(`Reply emailed to ${message.email}.`)
      setDraft('')
      await load(true)
    } catch (err: any) {
      toast.error(err?.message || 'The reply could not be sent')
    } finally {
      setSending(false)
    }
  }

  // Opening an unread message marks it read.
  const toggleOpen = (message: ContactMessage) => {
    const opening = openId !== message.id
    setOpenId(opening ? message.id : null)
    setDraft('')
    if (opening && message.status === 'new') void setStatus(message, 'read', true)
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">Inbox</h1>
        <p className="mt-1 text-sm text-muted">
          Messages from players. Replies you send here are emailed to the player from Chill Shooters.
        </p>
      </div>

      {/* One toolbar row: the views on the left, Archived set apart on the right. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FilterTabs
          ariaLabel="Inbox view"
          options={FILTERS.filter((option) => option.value !== 'archived').map((option) => ({
            ...option,
            count: option.value === 'new' && unread > 0 ? unread : undefined,
          }))}
          value={filter}
          onChange={changeFilter}
        />
        <FilterTabs
          ariaLabel="Archived messages"
          options={FILTERS.filter((option) => option.value === 'archived').map((option) => ({ ...option, label: <><FiArchive className="h-3.5 w-3.5" /> {option.label}</> }))}
          value={filter}
          onChange={changeFilter}
        />
      </div>

      <Card className="divide-y divide-white/5 p-0">
        {loading ? <p className="p-4 text-sm text-muted">Loading messages…</p> : null}
        {!loading && messages.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted">
            <FiMail className="h-6 w-6" />
            {filter === 'archived' ? 'No archived messages.' : filter === 'new' ? 'No unread messages.' : filter === 'replied' ? 'No replied messages yet.' : 'No messages from players yet.'}
          </div>
        ) : null}
        {!loading ? (
          <Paged items={messages}>{(pageItems) => pageItems.map((message) => {
            const open = openId === message.id
            const unreadRow = message.status === 'new'
            return (
              <article key={message.id} className="p-4">
                <button type="button" onClick={() => toggleOpen(message)} aria-expanded={open} className="flex w-full items-start gap-3 text-left">
                  <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${unreadRow ? 'bg-accent' : 'bg-transparent'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <div className={`truncate text-sm ${unreadRow ? 'font-bold' : 'font-semibold'}`}>
                        {message.name} <span className="font-normal text-muted">· {message.email}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {message.emailStatus === 'failed' ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-[10px] font-semibold text-danger" title="The copy to the official email address could not be sent. The message is only here.">
                            <FiAlertTriangle className="h-3 w-3" /> Not emailed
                          </span>
                        ) : null}
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STATUS_STYLE[message.status]}`}>{STATUS_LABEL[message.status]}</span>
                        <span className="text-xs text-muted">{formatWhen(message.createdAtISO)}</span>
                      </div>
                    </div>
                    <p className={`mt-1 text-sm text-muted ${open ? 'whitespace-pre-wrap break-words' : 'line-clamp-2'}`}>{message.message}</p>
                  </div>
                </button>

                {open ? (
                  <div className="mt-3 space-y-3 pl-5">
                    {(message.replies || []).map((reply) => (
                      <div key={reply.atISO} className="rounded-xl border border-accent/20 bg-accent/5 px-3 py-2">
                        <div className="text-xs text-muted">Your reply · {formatWhen(reply.atISO)}</div>
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm">{reply.body}</p>
                      </div>
                    ))}
                    <div>
                      <textarea
                        value={draft}
                        onChange={(event) => setDraft(event.target.value.slice(0, 5000))}
                        rows={4}
                        aria-label={`Reply to ${message.name}`}
                        placeholder={`Write a reply to ${message.name}…`}
                        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text placeholder:text-muted"
                      />
                      <p className="mt-1 text-xs text-muted">Emailed to {message.email} from Chill Shooters. Their answer comes back to the official email.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" disabled={sending || !draft.trim()} onClick={() => sendReply(message)}>
                        <FiSend /> {sending ? 'Sending…' : 'Send reply'}
                      </Button>
                      {message.status !== 'replied' ? (
                        <Button size="sm" variant="success-soft" disabled={busyId === message.id} onClick={() => setStatus(message, 'replied')}>
                          <FiCheck /> Mark replied
                        </Button>
                      ) : null}
                      {message.status !== 'new' ? (
                        <Button size="sm" variant="ghost" disabled={busyId === message.id} onClick={() => setStatus(message, 'new')}>
                          <FiMail /> Mark unread
                        </Button>
                      ) : null}
                      {message.status === 'archived' ? (
                        <Button size="sm" variant="ghost" disabled={busyId === message.id} onClick={() => setStatus(message, 'read')}>
                          <FiRotateCcw /> Move to inbox
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" disabled={busyId === message.id} onClick={() => setStatus(message, 'archived')}>
                          <FiArchive /> Archive
                        </Button>
                      )}
                    </div>
                  </div>
                ) : null}
              </article>
            )
          })}</Paged>
        ) : null}
      </Card>
    </div>
  )
}
