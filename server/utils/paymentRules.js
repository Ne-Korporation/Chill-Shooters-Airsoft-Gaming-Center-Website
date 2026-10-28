function isActivePayment(payment) {
  return !['failed', 'rejected'].includes(String(payment.paymentStatus || payment.status || '').toLowerCase())
}

// Captain first, then the registered teammates who share a split payment.
export function getSplitPayerIds(reservation) {
  const ids = [reservation?.userId, ...(Array.isArray(reservation?.splitPayerIds) ? reservation.splitPayerIds : [])]
  return [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))]
}

// Submitted (not failed/rejected) amount against the online amount due (the deposit).
// A reservation is finalized once every share is in; staff still verify each proof.
export function getPaymentProgress(reservation, payments) {
  const target = Math.max(0, Number(reservation?.depositAmount) || 0)
  const active = payments.filter(isActivePayment)
  const submitted = Math.round(active.reduce((sum, payment) => sum + Number(payment.amount || 0), 0) * 100) / 100
  const verified = Math.round(active
    .filter((payment) => ['paid', 'confirmed', 'verified', 'approved'].includes(String(payment.paymentStatus || payment.status || '').toLowerCase()))
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0) * 100) / 100
  const paidUserIds = new Set(active.map((payment) => String(payment.userId || '')))
  const payerIds = String(reservation?.paymentMode || 'self').toLowerCase() === 'split'
    ? getSplitPayerIds(reservation)
    : [String(reservation?.userId || '')]
  const finalized = target > 0 && submitted >= target - 0.01
  return {
    target,
    submitted,
    verified,
    remaining: Math.max(0, Math.round((target - submitted) * 100) / 100),
    paidPayerIds: payerIds.filter((id) => paidUserIds.has(id)),
    pendingPayerIds: payerIds.filter((id) => !paidUserIds.has(id)),
    state: finalized ? 'finalized' : submitted > 0 ? 'partial' : 'awaiting',
  }
}

export function getGcashAmountDue(reservation, payments, payerId) {
  const depositAmount = Number(reservation?.depositAmount)
  if (!Number.isFinite(depositAmount) || depositAmount <= 0) {
    const invalidDeposit = new Error('Reservation has no valid deposit due.')
    invalidDeposit.statusCode = 400
    throw invalidDeposit
  }

  const submittedAmount = payments
    .filter((payment) => !['failed', 'rejected'].includes(String(payment.paymentStatus || payment.status || '').toLowerCase()))
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
  if (!Number.isFinite(submittedAmount) || submittedAmount < 0) {
    const invalidPayments = new Error('Existing payment records contain an invalid amount.')
    invalidPayments.statusCode = 409
    throw invalidPayments
  }

  const remainingDeposit = Math.max(0, depositAmount - submittedAmount)
  if (String(reservation.paymentMode || 'self').toLowerCase() !== 'split') {
    return remainingDeposit
  }

  const teamSize = Number(reservation.teamSize)
  if (!Number.isInteger(teamSize) || teamSize < 2 || teamSize > Number(reservation.numberOfPlayers || 0)) {
    const invalidSplit = new Error('Reservation split-payment settings are invalid.')
    invalidSplit.statusCode = 400
    throw invalidSplit
  }
  const share = Math.round((depositAmount / teamSize) * 100) / 100
  // Older reservations have no recorded payer list; keep their one-share-at-a-time rule.
  if (!payerId || !Array.isArray(reservation.splitPayerIds)) return Math.min(share, remainingDeposit)

  // Each payer settles one share; whoever pays last covers the rounding remainder.
  const payer = String(payerId)
  if (!getSplitPayerIds(reservation).includes(payer)) {
    const notPayer = new Error('You are not part of this split payment.')
    notPayer.statusCode = 403
    throw notPayer
  }
  const active = payments.filter(isActivePayment)
  if (active.some((payment) => String(payment.userId || '') === payer)) return 0
  const unpaid = getSplitPayerIds(reservation).filter((id) => !active.some((payment) => String(payment.userId || '') === id))
  return unpaid.length <= 1 ? remainingDeposit : Math.min(share, remainingDeposit)
}

export function normalizeGcashReference(value) {
  const reference = String(value || '').trim()
  if (reference.length < 4 || reference.length > 120) {
    const invalidReference = new Error('GCash transaction reference must be between 4 and 120 characters.')
    invalidReference.statusCode = 400
    throw invalidReference
  }
  return reference.toLowerCase()
}

export function paymentAmountMatchesDue(amount, due) {
  return Number.isFinite(Number(amount)) && due > 0 && Math.abs(Number(amount) - due) <= 0.01
}

export function hasActivePayment(payments) {
  return payments.some(isActivePayment)
}

export function stripeIntentMatchesReservation(intent, reservation, reservationId) {
  return intent.status === 'succeeded' &&
    intent.currency === 'php' &&
    intent.amount === Math.round(Number(reservation.depositAmount) * 100) &&
    intent.metadata?.reservationId === reservationId &&
    intent.metadata?.userId === String(reservation.userId || '')
}

export function buildPaymentStatusUpdate({ payment, nextStatus, actorId, actorRole, reason, changedAtISO }) {
  const currentStatus = String(payment.paymentStatus || payment.status || 'pending').toLowerCase()
  if (payment.stripePaymentIntentId && nextStatus !== currentStatus) {
    const immutable = new Error('Stripe payment status can only be changed by server-side provider verification.')
    immutable.statusCode = 409
    throw immutable
  }
  if (['paid', 'confirmed'].includes(currentStatus) && nextStatus !== currentStatus) {
    const verified = new Error('Verified payments cannot be moved to another status.')
    verified.statusCode = 409
    throw verified
  }

  const auditEvent = {
    previousStatus: currentStatus,
    status: nextStatus,
    changedBy: String(actorId),
    changedByRole: actorRole,
    ...(reason ? { reason: String(reason).trim().slice(0, 500) } : {}),
    changedAtISO,
  }
  return {
    $set: {
      paymentStatus: nextStatus,
      updatedAtISO: changedAtISO,
      verifiedBy: String(actorId),
      verifiedByRole: actorRole,
      verifiedAtISO: changedAtISO,
    },
    $push: { auditTrail: auditEvent },
  }
}
