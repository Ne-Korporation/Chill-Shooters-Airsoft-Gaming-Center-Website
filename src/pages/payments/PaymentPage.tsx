import React, { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { FiCheck, FiChevronRight, FiFileText, FiInfo, FiLock, FiUpload, FiX } from 'react-icons/fi'

class PaymentPageErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-xs text-muted border border-white/5">
              <span className="h-2.5 w-2.5 rounded-full bg-accent" />
              <span className="uppercase tracking-[0.18em]">Payment</span>
            </div>
            <h1 className="text-3xl font-bold">Reservation Payment</h1>
            <p className="text-muted text-sm">UI error fallback (prototype).</p>
          </div>

          <div className="rounded-2xl border border-danger/25 bg-danger/10 p-4">
            <div className="text-sm font-bold text-danger">Something went wrong while rendering Payment.</div>
            <div className="mt-2 text-xs text-muted">Check browser Console for the exact runtime error.</div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}


import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'

type PaymentMethod = 'gcash' | 'bank'

type UploadState = {
  fileName: string | null
  fileSize: number | null
}

function formatPHP(n: number) {
  return `₱${n.toLocaleString()}`
}

export function PaymentPage() {
  const [method, setMethod] = useState<PaymentMethod>('gcash')
  const [refNo, setRefNo] = useState('ABP-7F21-93')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [cardNumber, setCardNumber] = useState('')
  const [cvv, setCvv] = useState('')
  const [expiry, setExpiry] = useState('')
  const [upload, setUpload] = useState<UploadState>({ fileName: null, fileSize: null })
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  // Prototype reservation breakdown
  const breakdown = useMemo(() => {
    // These match typical flow from the capstone pages (placeholder, no backend yet)
    const field = 1500
    const equipment = 800
    const service = 120
    const total = field + equipment + service
    return { field, equipment, service, total }
  }, [])

  const canSubmit = useMemo(() => {
    if (submitting) return false

    if (method === 'gcash') {
      if (!refNo.trim()) return false
      if (!upload.fileName) return false
      return true
    }

    return Boolean(cardNumber.trim() && cvv.trim() && expiry.trim())
  }, [cardNumber, cvv, expiry, method, refNo, submitting, upload.fileName])

  const onPickFile = (f: File | null) => {
    if (!f) return
    setUpload({ fileName: f.name, fileSize: f.size })
  }

  const submit = async () => {
    setSubmitting(true)
    try {
      await new Promise((r) => setTimeout(r, 900))
      setSuccess(true)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div id="payment-section" className="space-y-4">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-xs text-muted border border-white/5">
          <span className="h-2.5 w-2.5 rounded-full bg-accent" />
          <span className="uppercase tracking-[0.18em]">Payment</span>
        </div>
        <h1 className="text-3xl font-bold">Reservation Payment</h1>
        <p className="text-muted text-sm">GCash & bank transfer flows with proof upload + receipt preview (prototype).</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_0.9fr]">
        <Card className="p-4 md:p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs uppercase tracking-widest text-muted">Payment method</div>
            <div className="hidden md:flex items-center gap-2 text-[11px] text-muted">
              <FiLock />
              <span>Secured submission (UI-only)</span>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMethod('gcash')}
              className={[
                'w-full text-left rounded-2xl border px-4 py-3 transition',
                method === 'gcash'
                  ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25'
                  : 'border-white/10 bg-white/5 hover:bg-white/8',
              ].join(' ')}
            >
              <div className="text-sm font-bold">GCash</div>
              <div className="mt-1 text-xs text-muted">Scan → confirm → upload proof</div>
            </button>

            <button
              type="button"
              onClick={() => setMethod('bank')}
              className={[
                'w-full text-left rounded-2xl border px-4 py-3 transition',
                method === 'bank'
                  ? 'border-accent/40 bg-accent/10 ring-2 ring-accent/25'
                  : 'border-white/10 bg-white/5 hover:bg-white/8',
              ].join(' ')}
            >
              <div className="text-sm font-bold">Bank Transfer</div>
              <div className="mt-1 text-xs text-muted">Ref no required → fill out card details</div>
            </button>
          </div>
          <div className="mt-6 rounded-2xl border border-white/10 bg-black/15 p-4">
            <div className="flex items-center gap-2 text-sm font-bold">
              <FiInfo className="text-gold" />
              <span>Submission rules</span>
            </div>
            <ul className="mt-2 space-y-1 text-xs text-muted list-disc pl-5">
              <li>Reference number is required.</li>
              <li>Upload proof is required before submission.</li>
              <li>This is a frontend-only prototype—no real transactions.</li>
            </ul>
          </div>
          <div className="mt-5 space-y-5">
            <div className="space-y-4">
              {method === 'gcash' ? (
                <>
                  <Input
                    label="Phone Number"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="e.g., 0917 123 4567"
                  />

                  <div className="rounded-2xl border border-dashed border-accent/30 bg-accent/5 p-4">
                    <div className="text-xs uppercase tracking-widest text-muted">GCash details</div>
                    <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-4 text-center">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-muted">QR placeholder</div>
                      <div className="mx-auto mt-3 flex h-24 w-24 items-center justify-center rounded-2xl border border-dashed border-accent/30 bg-white/5 text-[10px] text-muted">
                        QR code
                      </div>
                      <div className="mt-3 text-[11px] text-muted">Scan QR or enter phone number above</div>
                    </div>
                  </div>

                                    <Input
                    label="Reference Number"
                    value={refNo}
                    onChange={(e) => setRefNo(e.target.value)}
                    placeholder="e.g., ABP-7F21-93"
                  />
                </>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-xs uppercase tracking-widest text-muted">Bank details</div>
                  <div className="mt-3 space-y-3">
                    <Input
                      label="Card Number"
                      value={cardNumber}
                      onChange={(e) => setCardNumber(e.target.value.replace(/\D/g, ''))}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder="1234 5678 9012 3456"
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        label="CVV"
                        value={cvv}
                        onChange={(e) => setCvv(e.target.value.replace(/\D/g, ''))}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="123"
                      />
                      <Input
                        label="Expiration Date"
                        value={expiry}
                        onChange={(e) => {
                          const digits = e.target.value.replace(/\D/g, '').slice(0, 4)
                          const formatted = digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits
                          setExpiry(formatted)
                        }}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="MM/YY"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          {method === 'gcash' ? (
            <div className="mt-6">
              <div className="text-xs uppercase tracking-widest text-muted">Upload proof</div>
              <div className="mt-2">
                <label className="block">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center gap-3">
                      <div className="grid h-10 w-10 place-items-center rounded-2xl bg-accent/10 ring-1 ring-accent/25">
                        <FiUpload className="text-gold" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-bold">Attach payment screenshot / receipt</div>
                        <div className="mt-1 text-xs text-muted truncate">
                          {upload.fileName ? upload.fileName : 'No file selected'}
                        </div>
                      </div>
                    </div>

                    <input
                      type="file"
                      accept="image/*,.pdf"
                      className="hidden"
                      onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
                    />

                    <div className="mt-4 flex items-center justify-between gap-3">
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={submitting}
                        onClick={() => {
                          // Programmatically open file picker (label-click can be unreliable with custom button components)
                          const input = document.getElementById('payment-proof-upload') as HTMLInputElement | null
                          input?.click()
                        }}
                      >
                        Choose file
                      </Button>
                      <div className="text-[11px] text-muted">Accepted: images or PDF</div>

                      <input
                        id="payment-proof-upload"
                        type="file"
                        accept="image/*,.pdf"
                        className="hidden"
                        onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
                      />
                    </div>
                  </div>
                </label>
              </div>
            </div>
          ) : null}
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
              <div className="text-xs uppercase tracking-widest text-muted">Receipt Preview</div>
              <div className="mt-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-muted">Method</div>
                  <div className="text-xs font-bold">{method === 'gcash' ? 'GCash' : 'Bank'}</div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="text-xs text-muted">Reference</div>
                  <div className="text-xs font-bold">{refNo || '—'}</div>
                </div>
                {method === 'gcash' ? (
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <div className="text-xs text-muted">Phone</div>
                    <div className="text-xs font-bold">{phoneNumber || '—'}</div>
                  </div>
                ) : (
                  <>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <div className="text-xs text-muted">Card</div>
                      <div className="text-xs font-bold">{cardNumber || '—'}</div>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <div className="text-xs text-muted">CVV</div>
                      <div className="text-xs font-bold">{cvv || '—'}</div>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <div className="text-xs text-muted">Expiry</div>
                      <div className="text-xs font-bold">{expiry || '—'}</div>
                    </div>
                  </>
                )}
                <div className="mt-3 h-px bg-white/10" />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="text-xs text-muted">Total</div>
                  <div className="text-sm font-black text-gold">{formatPHP(breakdown.total)}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button variant="primary" disabled={!canSubmit} onClick={submit}>
              {submitting ? 'Submitting…' : success ? 'Submitted' : 'Submit Payment'}
              <FiChevronRight />
            </Button>

          </div>

          {success ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="mt-4 rounded-2xl border border-success/25 bg-success/10 p-4"
            >
              <div className="flex items-center gap-2 text-sm font-bold text-success">
                <FiCheck /> Payment Successful (Prototype)
              </div>
              <div className="mt-2 text-xs text-muted">
                A receipt record would be created and registrar/admin would verify it.
              </div>

              <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted">Receipt</span>
                  <span className="text-xs font-bold">ABP-RCPT-{refNo ? refNo.replace(/\W/g, '').slice(-6) : '000000'}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-xs text-muted">Total paid</span>
                  <span className="text-xs font-bold text-gold">{formatPHP(breakdown.total)}</span>
                </div>
              </div>
            </motion.div>
          ) : null}
        </Card>

        <Card className="p-4 md:p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs uppercase tracking-widest text-muted">Breakdown</div>
            <FiFileText className="text-gold" />
          </div>

          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted">Field</span>
              <span className="font-semibold">{formatPHP(breakdown.field)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Equipment</span>
              <span className="font-semibold">{formatPHP(breakdown.equipment)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Service</span>
              <span className="font-semibold">{formatPHP(breakdown.service)}</span>
            </div>
            <div className="h-px bg-white/10" />
            <div className="flex items-center justify-between">
              <span className="text-muted">Total</span>
              <span className="font-bold text-accent">{formatPHP(breakdown.total)}</span>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-xs uppercase tracking-widest text-muted">Invoice</div>
            <div className="mt-2 text-xs text-muted">
              Invoice would include: reservation ID, payer info, payment method, and uploaded proof.
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}


