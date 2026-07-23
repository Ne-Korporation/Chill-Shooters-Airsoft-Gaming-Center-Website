import React from 'react'
import { Button } from '../../components/ui/Button'
import { useAuth } from '../../context/AuthContext'

type NotifChannel = 'system' | 'email' | 'sms'

type NotifTone = 'accent' | 'success' | 'danger'

type NotificationDraft = {
  id: string
  title: string
  body: string
  channel: NotifChannel
  tone: NotifTone
  audience: 'all' | 'admins' | 'registrars'
}

const tonePill = (tone: NotifTone) => {
  switch (tone) {
    case 'success':
      return 'bg-success/20 text-success border-success/30'
    case 'danger':
      return 'bg-danger/20 text-danger border-danger/30'
    default:
      return 'bg-accent/20 text-accent border-accent/30'
  }
}

const TonePill = ({ tone }: { tone: NotifTone }) => (
  <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${tonePill(tone)}`}>
    {tone.toUpperCase()}
  </span>
)

export function AdminNotificationsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [audience, setAudience] = React.useState<NotificationDraft['audience']>('all')
  const [channel, setChannel] = React.useState<NotifChannel>('system')
  const [title, setTitle] = React.useState('Weekend package reminder')
  const [body, setBody] = React.useState('Please confirm the equipment checklist for the Saturday booking before 5:00 PM.')
  const [drafts, setDrafts] = React.useState<NotificationDraft[]>([
    {
      id: 'N-1001',
      title: 'Equipment check required',
      body: 'One item needs review in the inventory queue before the next session.',
      channel: 'system',
      tone: 'danger',
      audience: 'admins',
    },
    {
      id: 'N-1002',
      title: 'Maintenance window',
      body: 'The firing range will be unavailable tomorrow from 1:00 AM to 2:00 AM for routine maintenance.',
      channel: 'email',
      tone: 'accent',
      audience: 'all',
    },
    {
      id: 'N-1003',
      title: 'Payment verified',
      body: 'A pending payment has been verified successfully and is ready for booking confirmation.',
      channel: 'sms',
      tone: 'success',
      audience: 'registrars',
    },
  ])

  const visible = drafts.filter((draft) => draft.audience === audience || audience === 'all')

  const handleSend = () => {
    const newDraft: NotificationDraft = {
      id: `N-${String(drafts.length + 1000)}`,
      title: title.trim() || 'Untitled notification',
      body: body.trim() || 'No message entered.',
      channel,
      tone: channel === 'sms' ? 'success' : channel === 'email' ? 'accent' : 'danger',
      audience,
    }

    setDrafts((prev) => [newDraft, ...prev])
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Notifications</h1>
          <p className="mt-1 text-sm text-muted">Compose alert messages and review delivery history for the admin team.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {(['all', 'admins', 'registrars'] as const).map((item) => (
            <button
              key={item}
              onClick={() => setAudience(item)}
              className={
                'rounded-xl border px-3 py-2 text-sm transition ' +
                (audience === item
                  ? 'bg-white/8 text-text border-accent/30'
                  : 'bg-white/5 text-muted hover:bg-white/6')
              }
            >
              {item === 'all' ? 'ALL' : item.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-3xl border border-white/5 bg-white/5 p-4">
        <div className={isAdmin ? 'grid gap-4 lg:grid-cols-[1.1fr_0.9fr]' : 'grid gap-4'}>
          {isAdmin ? (
            <div className="rounded-2xl border border-white/5 bg-background/70 p-4">
              <div className="text-xs uppercase tracking-widest text-muted">Compose notification</div>
              <div className="mt-2 text-sm text-muted">Use this panel to prepare operating alerts for staff or players.</div>

              <div className="mt-4 space-y-3">
                <label className="block">
                  <div className="mb-2 text-sm font-semibold text-text">Title</div>
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text placeholder:text-muted"
                    placeholder="Brief notification title"
                  />
                </label>

                <label className="block">
                  <div className="mb-2 text-sm font-semibold text-text">Message body</div>
                  <textarea
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    rows={4}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text placeholder:text-muted"
                    placeholder="Describe the update or instruction"
                  />
                </label>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {(['system', 'email', 'sms'] as const).map((item) => (
                  <button
                    key={item}
                    onClick={() => setChannel(item)}
                    className={
                      'rounded-xl border px-3 py-2 text-sm transition ' +
                      (channel === item
                        ? 'bg-white/8 text-text border-accent/30'
                        : 'bg-white/5 text-muted hover:bg-white/6')
                    }
                  >
                    {item.toUpperCase()}
                  </button>
                ))}
              </div>

              <div className="mt-4 rounded-xl border border-white/5 bg-white/5 p-3">
                <div className="text-xs text-muted">Audience</div>
                <div className="mt-1 text-sm font-semibold">{audience.toUpperCase()}</div>
                <div className="mt-3 text-xs text-muted">Delivery channel</div>
                <div className="mt-1 text-sm font-semibold">{channel.toUpperCase()}</div>
              </div>

              <div className="mt-4">
                <Button onClick={handleSend}>Send notification</Button>
              </div>
            </div>
          ) : null}

          <div className="rounded-2xl border border-white/5 bg-background/70 p-4">
            <div className="text-xs uppercase tracking-widest text-muted">Delivery feed</div>
            <div className="mt-2 text-sm text-muted">Recent communications prepared for staff and scheduled groups.</div>

            <div className="mt-4 space-y-2">
              {visible.map((draft) => (
                <div key={draft.id} className="rounded-xl border border-white/5 bg-white/5/60 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{draft.title}</div>
                      <div className="mt-1 text-xs text-muted">{draft.channel.toUpperCase()} • {draft.audience.toUpperCase()}</div>
                    </div>
                    <TonePill tone={draft.tone} />
                  </div>
                  <div className="mt-2 text-sm text-muted">{draft.body}</div>
                  <div className="mt-2 flex justify-end">
                    <button className="rounded-xl border border-white/5 bg-white/5 px-3 py-2 text-xs text-muted transition hover:bg-white/6">
                      View details
                    </button>
                  </div>
                </div>
              ))}
              {visible.length === 0 && <div className="p-6 text-sm text-muted">No notifications for this audience.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

