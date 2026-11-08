import React from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiGet } from '../utils/apiClient'

// Profile pages (/app/players/:playerId and its gear page) belong to one account. Opening someone
// else's link sends you to your own profile instead, whatever your role:
// - staff look players up in Player Management, never by pasting a profile link;
// - a parent may still open a child profile on their own account (the server confirms that).
export function RequireOwnProfile({ children, suffix = '' }: { children: React.ReactElement; suffix?: string }) {
  const { user } = useAuth()
  const { playerId } = useParams()
  const isOwn = !playerId || String(playerId) === String(user?.id)
  const mayBeChild = !isOwn && user?.role === 'user'
  const [childCheck, setChildCheck] = React.useState<'pending' | 'allowed' | 'denied'>(mayBeChild ? 'pending' : 'denied')

  React.useEffect(() => {
    if (!mayBeChild || !playerId) return
    let alive = true
    setChildCheck('pending')
    // The server returns 404 unless this is a child profile on the signed-in parent's account.
    apiGet<{ ok: boolean; data?: { isChildProfile?: boolean; guardianId?: string } }>(`/api/user_accounts/${encodeURIComponent(playerId)}`)
      .then((res) => {
        if (!alive) return
        const doc = res?.data
        setChildCheck(doc?.isChildProfile && String(doc.guardianId) === String(user?.id) ? 'allowed' : 'denied')
      })
      .catch(() => {
        if (alive) setChildCheck('denied')
      })
    return () => {
      alive = false
    }
  }, [mayBeChild, playerId, user?.id])

  if (!user?.id) return <Navigate to="/login" replace />
  if (isOwn) return children
  if (mayBeChild && childCheck === 'pending') return <div className="p-6 text-sm text-muted">Loading profile…</div>
  if (mayBeChild && childCheck === 'allowed') return children
  return <Navigate to={`/app/players/${encodeURIComponent(String(user.id))}${suffix}`} replace />
}
