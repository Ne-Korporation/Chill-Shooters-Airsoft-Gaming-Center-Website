import React, { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { FiCheckCircle, FiShield } from 'react-icons/fi'

import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { apiGet, apiPost } from '../../utils/apiClient'

type Confirmation = { childName: string; guardianName: string; confirmed: boolean }

// Public page the parent opens from the email sent when they add a child to their account. They
// confirm, once, that they are the child's parent or guardian.
export function GuardianConfirmPage() {
  const { token = '' } = useParams()
  const [data, setData] = useState<Confirmation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    apiGet<{ ok: boolean; data: Confirmation }>(`/api/guardian-confirmations/${encodeURIComponent(token)}`)
      .then((res) => setData(res.data))
      .catch((e: any) => setError(e?.message || 'This confirmation link is not valid.'))
  }, [token])

  const confirm = async () => {
    setSaving(true)
    try {
      await apiPost(`/api/guardian-confirmations/${encodeURIComponent(token)}`, {})
      setData((current) => (current ? { ...current, confirmed: true } : current))
    } catch (e: any) {
      toast.error(e?.message || 'Could not confirm. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-xl space-y-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-accent"><FiShield /> Chill Shooters Airsoft Gaming Center</div>
          <h1 className="mt-2 text-3xl font-bold">Confirm you are the guardian</h1>
        </div>

        {error ? <Card className="p-5 text-sm text-danger">{error}</Card> : null}
        {!data && !error ? <Card className="p-5 text-sm text-muted">Loading…</Card> : null}

        {data ? (
          data.confirmed ? (
            <Card className="space-y-3 p-5">
              <div className="flex items-center gap-2 text-success"><FiCheckCircle className="text-xl" /> Thank you, you're confirmed as {data.childName}'s guardian.</div>
              <p className="text-sm text-muted">Go back to the waiver page to fill in {data.childName}'s waiver.</p>
              <Link to="/app/waiver" className="inline-block text-sm font-semibold text-accent hover:underline">Open the waiver page</Link>
            </Card>
          ) : (
            <Card className="space-y-4 p-5">
              <p className="text-sm">
                {data.guardianName ? `${data.guardianName}, you` : 'You'} added <span className="font-semibold">{data.childName}</span> as a minor on your
                Chill Shooters account. Players under 18 play under a parent or legal guardian.
              </p>
              <Button disabled={saving} onClick={confirm} className="!h-auto min-h-[3rem] w-full !whitespace-normal py-2 sm:w-auto">
                <FiCheckCircle /> {saving ? 'Confirming…' : `Yes, I am ${data.childName}'s parent or guardian`}
              </Button>
              <p className="text-xs text-muted">If you didn't add this child, you can close this page.</p>
            </Card>
          )
        ) : null}
      </div>
    </div>
  )
}
