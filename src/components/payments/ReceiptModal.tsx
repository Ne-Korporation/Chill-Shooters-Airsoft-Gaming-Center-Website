import React, { useEffect, useState } from 'react'
import { FiDownload, FiExternalLink, FiPrinter } from 'react-icons/fi'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import {
  buildReceiptHtml,
  downloadReceiptHtml,
  fetchReceiptNo,
  isVerifiedPayment,
  printReceiptHtml,
  type ReceiptPayment,
  type ReceiptReservation,
} from '../../utils/receiptPrint'

// A receipt on screen, ready to download or print. A verified payment (including demo payments,
// which are recorded the same way) gets the official receipt for its reservation, with the OR
// number the server issues. A payment that isn't verified yet gets a payment record that says it
// isn't an official receipt. `proofUrl`: a proof of payment the player uploaded, if any.
export function ReceiptModal({
  payment,
  reservation,
  reservationPayments,
  payerName,
  proofUrl,
  onClose,
}: {
  payment: ReceiptPayment & { reservationId?: string }
  reservation?: ReceiptReservation | null
  reservationPayments: ReceiptPayment[]
  payerName: string
  proofUrl?: string
  onClose: () => void
}) {
  const [state, setState] = useState<{ html: string; receiptNo: string; official: boolean } | null>(null)

  useEffect(() => {
    let alive = true
    const booking: ReceiptReservation = reservation || { id: payment.reservationId }
    const asRecord = () => {
      const receiptNo = String(payment.id || payment._id || 'payment')
      return { html: buildReceiptHtml(booking, [payment], payerName, receiptNo, { record: true }), receiptNo, official: false }
    }
    if (!isVerifiedPayment(payment) || !reservation) {
      setState(asRecord())
      return
    }
    setState(null)
    fetchReceiptNo(reservation)
      .then((receiptNo) => {
        if (alive) setState({ html: buildReceiptHtml(reservation, reservationPayments, payerName, receiptNo), receiptNo, official: true })
      })
      // No receipt number (e.g. the booking was removed): still show what was paid.
      .catch(() => { if (alive) setState(asRecord()) })
    return () => { alive = false }
  }, [payment, reservation, reservationPayments, payerName])

  const fileName = state ? `${state.official ? 'Receipt' : 'Payment-record'}-${state.receiptNo}` : ''

  return (
    <Modal
      eyebrow={state?.official ? 'Official receipt' : 'Payment record'}
      title={state ? state.receiptNo : 'Preparing receipt…'}
      onClose={onClose}
      footer={
        <>
          {proofUrl ? (
            <a
              href={proofUrl}
              target="_blank"
              rel="noreferrer"
              className="surface hover-row mr-auto inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-text"
            >
              <FiExternalLink /> Uploaded proof
            </a>
          ) : null}
          <Button variant="ghost" disabled={!state} onClick={() => state && printReceiptHtml(state.html)} title="Print, or choose “Save as PDF” to download a PDF">
            <FiPrinter /> Print / Save as PDF
          </Button>
          <Button variant="primary" disabled={!state} onClick={() => state && downloadReceiptHtml(state.html, fileName)}>
            <FiDownload /> Download
          </Button>
        </>
      }
    >
      {state ? (
        <>
          {!state.official ? (
            <p className="mb-3 text-xs text-muted">This payment isn't verified yet, so this is a payment record, not an official receipt.</p>
          ) : null}
          <iframe title={`Receipt ${state.receiptNo}`} srcDoc={state.html} className="h-[60vh] w-full rounded-2xl border border-white/10 bg-white" />
        </>
      ) : (
        <div className="py-10 text-center text-sm text-muted">Preparing receipt…</div>
      )}
    </Modal>
  )
}
