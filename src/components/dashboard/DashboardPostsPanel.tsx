import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { FiEdit2, FiImage, FiPlus, FiTrash2, FiUpload, FiX } from 'react-icons/fi'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { apiBase, apiDelete, apiGet, apiPost, apiPut } from '../../utils/apiClient'

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
}

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
  subtitle = 'Admin updates and field notices visible across every dashboard.',
  canManage = false,
}: Props) {
  const [posts, setPosts] = useState<DashboardPost[]>([])
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

  return (
    <Card className="p-5 md:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="mt-0.5 text-sm text-muted">{subtitle}</p>
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

      {error ? (
        <div className="mt-4 rounded-xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <div className="divider mt-4 divide-y">
        {loading ? (
          <div className="space-y-3 py-2">
            <div className="skeleton h-4 w-32" />
            <div className="skeleton h-16 w-full" />
          </div>
        ) : posts.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No announcements yet.</p>
        ) : (
          posts.map((post) => (
            <div key={post.id || `${post.postedAtISO || post.createdAtISO || post.updatedAtISO || post.message}-${post.imageUrl || 'no-image'}`} className="divider py-4 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-muted">
                    Posted {formatPostedDate(post.postedAtISO || post.createdAtISO || post.updatedAtISO)}
                  </div>
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
          ))
        )}
      </div>

      {canManage && isComposerOpen ? (
        <div className="fixed inset-0 z-[99999] grid place-items-center bg-black/70 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="dashboard-post-composer-title">
          <div className="w-full max-w-3xl rounded-[1.75rem] border border-white/10 bg-background p-4 shadow-2xl md:p-6">
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
          className="max-h-[92vh] max-w-[96vw] object-contain"
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
