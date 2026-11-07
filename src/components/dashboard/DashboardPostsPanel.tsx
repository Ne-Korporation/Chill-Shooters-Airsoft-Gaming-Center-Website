import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { FiEdit2, FiImage, FiPlus, FiTrash2, FiUpload, FiX } from 'react-icons/fi'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { FilterTabs } from '../ui/FilterTabs'
import { apiBase, apiDelete, apiGet, apiPost, apiPut, getApiAuthHeaders } from '../../utils/apiClient'

type DashboardPost = {
  id?: string
  message?: string
  imageUrl?: string
  postedAtISO?: string
  createdAtISO?: string
  updatedAtISO?: string
  createdByRole?: string
}

type Props = {
  title?: string
  subtitle?: string
  canManage?: boolean
  // Shown under the panel title, above the list of posts.
  beforePosts?: React.ReactNode
  // Show only the newest few posts until the reader asks for more. Omit to show them all.
  initialCount?: number
  // Split the list into Recent (last RECENT_POST_DAYS days) and Past tabs. Used on the admin page.
  groupByAge?: boolean
  // Show posts as picture cards; click one to open the full post (and Edit / Delete).
  collapsible?: boolean
}

const RECENT_POST_DAYS = 7

function formatPostedDate(value?: string) {
  if (!value) return 'recently posted'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'recently posted'

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function parsePostDate(post: DashboardPost) {
  const value = post.postedAtISO || post.createdAtISO || post.updatedAtISO || ''
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? 0 : timestamp
}

export function DashboardPostsPanel({
  title = 'Dashboard posts',
  subtitle = '',
  canManage = false,
  beforePosts,
  initialCount,
  groupByAge = false,
  collapsible = false,
}: Props) {
  const [posts, setPosts] = useState<DashboardPost[]>([])
  const [ageTab, setAgeTab] = useState<'recent' | 'past'>('recent')
  // The post opened from the card grid.
  const [viewing, setViewing] = useState<DashboardPost | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isComposerOpen, setIsComposerOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const loadPosts = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await apiGet<{ ok: boolean; data: DashboardPost[] }>('/api/dashboard_posts?limit=50')
      const nextPosts = Array.isArray(response?.data) ? response.data : []
      setPosts(nextPosts.sort((a, b) => parsePostDate(b) - parsePostDate(a)))
    } catch (err: any) {
      setError(err?.message || 'Unable to load dashboard posts')
      setPosts([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadPosts()
  }, [])

  const resetForm = () => {
    setMessage('')
    setImageUrl('')
    setEditingId(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

// Close the full-size view with Esc, and stop the page behind it from scrolling
useEffect(() => {
  if (!lightboxUrl) return
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') setLightboxUrl(null)
  }
  const previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  window.addEventListener('keydown', onKeyDown)
  return () => {
    window.removeEventListener('keydown', onKeyDown)
    document.body.style.overflow = previousOverflow
  }
}, [lightboxUrl])

  const openComposer = () => {
    resetForm()
    setError(null)
    setIsComposerOpen(true)
  }

  const closeComposer = () => {
    setIsComposerOpen(false)
    resetForm()
    setError(null)
  }

  const startEdit = (post: DashboardPost) => {
    setEditingId(post.id || null)
    setMessage(post.message || '')
    setImageUrl(post.imageUrl || '')
    setError(null)
    setIsComposerOpen(true)
  }

  const handleUploadImage = async (file: File) => {
    setUploading(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch(`${apiBase}/api/uploads/upload-image`, {
        method: 'POST',
        headers: getApiAuthHeaders(),
        body: formData,
      })
      const json = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(json?.error || 'Failed to upload image')
      }

      setImageUrl(String(json?.url || '').trim())
      toast.success('Image uploaded')
    } catch (err: any) {
      setError(err?.message || 'Unable to upload image')
      toast.error(err?.message || 'Unable to upload image')
    } finally {
      setUploading(false)
    }
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) return
    await handleUploadImage(file)
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!canManage) return

    const trimmedMessage = message.trim()
    if (!trimmedMessage) {
      setError('Post text is required')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const payload = {
        message: trimmedMessage,
        imageUrl: imageUrl.trim() || undefined,
      }

      if (editingId) {
        await apiPut(`/api/dashboard_posts/${editingId}`, payload)
        toast.success('Post updated')
      } else {
        await apiPost('/api/dashboard_posts', payload)
        toast.success('Post published')
      }

      closeComposer()
      await loadPosts()
    } catch (err: any) {
      setError(err?.message || 'Unable to save post')
      toast.error(err?.message || 'Unable to save post')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (post: DashboardPost) => {
    if (!post.id) return
    if (!window.confirm('Delete this dashboard post?')) return

    setError(null)

    try {
      await apiDelete(`/api/dashboard_posts/${post.id}`)
      toast.success('Post deleted')
      if (editingId === post.id) {
        resetForm()
      }
      await loadPosts()
    } catch (err: any) {
      setError(err?.message || 'Unable to delete post')
      toast.error(err?.message || 'Unable to delete post')
    }
  }

  // Newest first already; Recent is the last RECENT_POST_DAYS days, Past is everything older.
  const recentCutoff = Date.now() - RECENT_POST_DAYS * 86_400_000
  const recentPosts = posts.filter((post) => parsePostDate(post) >= recentCutoff)
  const pastPosts = posts.filter((post) => parsePostDate(post) < recentCutoff)
  const visiblePosts = !groupByAge ? posts : ageTab === 'recent' ? recentPosts : pastPosts

  return (
    <Card className="p-5 md:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-sm text-muted">{subtitle}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          {canManage ? (
            <Button type="button" size="sm" onClick={openComposer}>
              <FiPlus />
              Create post
            </Button>
          ) : null}
        </div>
      </div>

      {beforePosts ? <div className="divider mt-4 border-b pb-4">{beforePosts}</div> : null}

      {error ? (
        <div className="mt-4 rounded-xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      ) : null}

      {groupByAge ? (
        <div className="mt-4">
          <FilterTabs
            ariaLabel="Show announcements"
            value={ageTab}
            onChange={setAgeTab}
            options={[
              { value: 'recent', label: 'Recent', count: recentPosts.length },
              { value: 'past', label: 'Past', count: pastPosts.length },
            ]}
          />
          <p className="mt-2 text-xs text-muted">
            {ageTab === 'recent' ? `Posted in the last ${RECENT_POST_DAYS} days.` : `Posted more than ${RECENT_POST_DAYS} days ago.`}
          </p>
        </div>
      ) : null}

      <div className={collapsible ? 'mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3' : 'divider mt-4 divide-y'}>
        {loading ? (
          <div className="col-span-full space-y-3 py-2">
            <div className="skeleton h-4 w-32" />
            <div className="skeleton h-16 w-full" />
          </div>
        ) : visiblePosts.length === 0 ? (
          <p className="col-span-full py-6 text-center text-sm text-muted">
            {!groupByAge || posts.length === 0
              ? 'No announcements yet.'
              : ageTab === 'recent'
                ? `Nothing posted in the last ${RECENT_POST_DAYS} days.`
                : `No announcements older than ${RECENT_POST_DAYS} days.`}
          </p>
        ) : (
          (showAll || !initialCount ? visiblePosts : visiblePosts.slice(0, initialCount)).map((post) => {
            const key = post.id || `${post.postedAtISO || post.createdAtISO || post.updatedAtISO || post.message}-${post.imageUrl || 'no-image'}`
            const postedOn = formatPostedDate(post.postedAtISO || post.createdAtISO || post.updatedAtISO)
            if (collapsible) {
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setViewing(post)}
                  className="group flex flex-col overflow-hidden rounded-2xl border border-[rgba(var(--text),0.1)] bg-[rgba(var(--text),0.03)] text-left transition hover:border-accent/50 hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                >
                  <div className="aspect-[16/10] w-full overflow-hidden bg-[rgba(var(--text),0.05)]">
                    {post.imageUrl ? (
                      <img src={post.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
                    ) : (
                      <div className="grid h-full place-items-center text-muted"><FiImage className="h-8 w-8 opacity-40" aria-hidden /></div>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col p-3">
                    <div className="text-[11px] text-muted">{postedOn}</div>
                    <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm text-text">{post.message || 'No text'}</p>
                    <span className="mt-auto pt-2 text-xs font-semibold text-accent">View & edit</span>
                  </div>
                </button>
              )
            }
            return (
            <div key={key} className="divider py-4 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-muted">Posted {postedOn}</div>
                  <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text">
                    {post.message}
                  </div>
                </div>

                {canManage ? (
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => startEdit(post)}>
                      <FiEdit2 />
                      Edit
                    </Button>
                    <Button type="button" variant="danger" size="sm" onClick={() => handleDelete(post)}>
                      <FiTrash2 />
                      Delete
                    </Button>
                  </div>
                ) : null}
              </div>

              {post.imageUrl ? (
                <button
  type="button"
  onClick={() => setLightboxUrl(post.imageUrl || null)}
  aria-label="View image full size"
  className="mt-3 block w-full max-w-2xl cursor-zoom-in overflow-hidden rounded-xl bg-[rgba(var(--text),0.04)]"
>
  <img src={post.imageUrl} alt="Dashboard post attachment" className="block max-h-[420px] w-full object-contain transition hover:opacity-95" />
</button>
              ) : null}

              {canManage && editingId === post.id ? (
                <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-accent">
                  <FiImage />
                  Editing this post
                </div>
              ) : null}
            </div>
            )
          })
        )}
      </div>
      {!loading && initialCount && visiblePosts.length > initialCount ? (
        <div className="mt-3 text-center">
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowAll((value) => !value)}>
            {showAll ? 'Show fewer' : `Show ${visiblePosts.length - initialCount} more`}
          </Button>
        </div>
      ) : null}

      {viewing ? (
        <Modal
          title="Announcement"
          eyebrow={`Posted ${formatPostedDate(viewing.postedAtISO || viewing.createdAtISO || viewing.updatedAtISO)}`}
          size="lg"
          onClose={() => setViewing(null)}
          footer={canManage ? (
            <>
              <Button type="button" variant="danger" onClick={() => { const post = viewing; setViewing(null); void handleDelete(post) }}>
                <FiTrash2 /> Delete
              </Button>
              <Button type="button" variant="primary" onClick={() => { const post = viewing; setViewing(null); startEdit(post) }}>
                <FiEdit2 /> Edit
              </Button>
            </>
          ) : undefined}
        >
          {viewing.imageUrl ? (
            <button
              type="button"
              onClick={() => setLightboxUrl(viewing.imageUrl || null)}
              aria-label="View image full size"
              className="block w-full cursor-zoom-in overflow-hidden rounded-xl bg-[rgba(var(--text),0.04)]"
            >
              <img src={viewing.imageUrl} alt="Announcement attachment" className="block max-h-[420px] w-full object-contain" />
            </button>
          ) : null}
          <div className={`${viewing.imageUrl ? 'mt-4 ' : ''}whitespace-pre-wrap text-sm leading-6 text-text`}>{viewing.message || 'No text'}</div>
        </Modal>
      ) : null}

      {canManage && isComposerOpen ? (
        <div className="fixed inset-0 z-[99999] grid place-items-center bg-black/70 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="dashboard-post-composer-title">
          <div className="max-h-[90dvh] overflow-y-auto overscroll-contain w-full max-w-3xl rounded-[1.75rem] border border-white/10 bg-background p-4 shadow-2xl md:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div id="dashboard-post-composer-title" className="text-lg font-semibold text-text">
                  {editingId ? 'Edit dashboard post' : 'Create dashboard post'}
                </div>
                <div className="mt-1 text-sm text-muted">Publish an update for admins, marshals, registrars, and players.</div>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={closeComposer}>
                <FiX />
                Close
              </Button>
            </div>

            {error ? (
              <div className="mt-4 rounded-xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
                {error}
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <label className="block">
                <div className="mb-2 text-sm font-semibold text-text">Post text</div>
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  rows={5}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-text outline-none placeholder:text-muted focus:border-accent/40"
                  placeholder="Share a booking update, schedule reminder, or field notice..."
                />
              </label>

              <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                <Input
                  label="Image"
                  hint="Optional. Upload a picture to attach to the post."
                  value={imageUrl}
                  onChange={(event) => setImageUrl(event.target.value)}
                  placeholder="Uploaded image URL"
                />
                <div className="flex flex-col gap-2 md:items-end">
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
                  <Button type="button" variant="ghost" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="min-w-44">
                    <FiUpload />
                    {uploading ? 'Uploading…' : 'Upload image'}
                  </Button>
                  {imageUrl ? (
                    <Button type="button" variant="ghost" onClick={() => setImageUrl('')} className="min-w-44">
                      <FiX />
                      Remove image
                    </Button>
                  ) : null}
                </div>
              </div>

              {imageUrl ? (
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                  <img src={imageUrl} alt="Dashboard post preview" className="mx-auto block h-auto max-h-80 w-full object-contain" />
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
                <Button type="button" variant="ghost" onClick={closeComposer}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting || uploading}>
                  {editingId ? 'Save changes' : 'Publish post'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      {lightboxUrl
  ? createPortal(
      <div
        className="fixed inset-0 z-[100000] grid place-items-center bg-black/90 p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Full size image"
        onClick={() => setLightboxUrl(null)}
      >
        <button
          type="button"
          onClick={() => setLightboxUrl(null)}
          aria-label="Close full size image"
          className="absolute right-4 top-4 inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/60 px-3 py-2 text-sm font-semibold text-white transition hover:bg-black/80"
        >
          <FiX /> Close
        </button>
        <img
          src={lightboxUrl}
          alt="Dashboard post full size"
          className="max-h-[92dvh] max-w-[96vw] object-contain"
          onClick={(event) => event.stopPropagation()}
        />
      </div>,
      document.body,
    )
  : null}
    </Card>
  )
}

export default DashboardPostsPanel
