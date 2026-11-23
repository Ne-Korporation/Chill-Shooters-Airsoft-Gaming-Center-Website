function isActivePayment(payment) {
  return !['failed', 'rejected', 'cancelled'].includes(String(payment.paymentStatus || payment.status || '').toLowerCase())
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
  const paidByUser = new Map()
  for (const payment of active) {
    const id = String(payment.userId || '')
    paidByUser.set(id, (paidByUser.get(id) || 0) + Number(payment.amount || 0))
  }
  // A payer has paid once they've covered their recorded share (it can go up, e.g. a parent who
  // also pays for their child); without recorded shares, any payment counts.
  const paidUserIds = new Set([...paidByUser.keys()].filter((id) => {
    const share = Number(reservation?.splitShares?.[id])
    return !Number.isFinite(share) || paidByUser.get(id) >= share - 0.01
  }))
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

// Spots a teammate left (see utils/teamInvites.js). An open one waits on the captain, so nobody pays
// its share online yet; one the captain chose to pay for is added to what the captain pays now.
export function openSlotHold(reservation) {
  return (reservation?.openSlots || []).filter((slot) => slot?.status === 'open')
    .reduce((sum, slot) => sum + (Number(slot.amount) || 0), 0)
}
export function captainCoverTotal(reservation) {
  return (reservation?.openSlots || []).filter((slot) => slot?.status === 'covering')
    .reduce((sum, slot) => sum + (Number(slot.amount) || 0), 0)
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

  const remainingDeposit = Math.max(0, Math.round((depositAmount - submittedAmount - openSlotHold(reservation)) * 100) / 100)
  if (String(reservation.paymentMode || 'self').toLowerCase() !== 'split') {
    return remainingDeposit
  }

  // A team can be down to the captain alone when every teammate's spot was left open.
  const teamSize = Number(reservation.teamSize)
  if (!Number.isInteger(teamSize) || teamSize < 1 || teamSize > Number(reservation.numberOfPlayers || 0)) {
    const invalidSplit = new Error('Reservation split-payment settings are invalid.')
    invalidSplit.statusCode = 400
    throw invalidSplit
  }
  // Uneven shares (players who get different things, see utils/splitShares.js), else an even split.
  const recorded = reservation.splitShares && payerId != null ? Number(reservation.splitShares[String(payerId)]) : NaN
  const share = Number.isFinite(recorded) ? recorded : Math.round((depositAmount / teamSize) * 100) / 100
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
  const paidBy = (id) => active.filter((payment) => String(payment.userId || '') === id).reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
  const unpaid = getSplitPayerIds(reservation).filter((id) => paidBy(id) <= 0)
  const captainId = String(reservation.userId || '')
  const cover = captainCoverTotal(reservation)
  const captainShare = Number.isFinite(Number(reservation.splitShares?.[captainId])) ? Number(reservation.splitShares[captainId]) : share
  if (payer === captainId && cover > 0) {
    // The captain also pays for the spots they chose to cover, on top of (or after) their own share.
    const mine = paidBy(payer)
    if (unpaid.filter((id) => id !== payer).length === 0) return remainingDeposit
    return Math.max(0, Math.min(Math.round((captainShare + cover - mine) * 100) / 100, remainingDeposit))
  }
  // A recorded share: whatever of it this payer hasn't paid yet (a top-up when it went up).
  if (Number.isFinite(recorded)) return Math.max(0, Math.min(Math.round((recorded - paidBy(payer)) * 100) / 100, remainingDeposit))
  if (paidBy(payer) > 0) return 0
  // The last teammate to pay covers rounding, but never a spot the captain is paying for.
  const captainStillOwes = cover > 0 ? Math.max(0, captainShare + cover - paidBy(captainId)) : 0
  return unpaid.length <= 1 ? Math.max(0, Math.round((remainingDeposit - captainStillOwes) * 100) / 100) : Math.min(share, remainingDeposit)
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

export function buildPaymentStatusUpdate({ payment, nextStatus, actorId, actorRole, actorName = '', reason, changedAtISO }) {
  const currentStatus = String(payment.paymentStatus || payment.status || 'pending').toLowerCase()
  // A gateway payment held for review (wrong amount, cancelled booking) is the one staff can decide.
  // paymongoCheckoutId: payments recorded before Xendit replaced PayMongo.
  const gatewayCheckoutId = payment.xenditInvoiceId || payment.paymongoCheckoutId
  const heldForReview = gatewayCheckoutId && currentStatus === 'review'
  if ((payment.stripePaymentIntentId || gatewayCheckoutId) && !heldForReview && nextStatus !== currentStatus) {
    const immutable = new Error('Payments verified by the payment gateway can only be changed by the gateway itself.')
    immutable.statusCode = 409
    throw immutable
  }
  if (['paid', 'confirmed'].includes(currentStatus) && nextStatus !== currentStatus) {
    const verified = new Error('Verified payments cannot be moved to another status.')
    verified.statusCode = 409
    throw verified
  }
  if (currentStatus === 'cancelled' && nextStatus !== currentStatus) {
    const cancelled = new Error('This payment belongs to a cancelled reservation and can no longer be reviewed.')
    cancelled.statusCode = 409
    throw cancelled
  }

  const auditEvent = {
    previousStatus: currentStatus,
    status: nextStatus,
    changedBy: String(actorId),
    changedByRole: actorRole,
    ...(actorName ? { changedByName: actorName } : {}),
    ...(reason ? { reason: String(reason).trim().slice(0, 500) } : {}),
    changedAtISO,
  }
  return {
    $set: {
      paymentStatus: nextStatus,
      updatedAtISO: changedAtISO,
      verifiedBy: String(actorId),
      verifiedByRole: actorRole,
      verifiedByName: actorName,
      verifiedAtISO: changedAtISO,
    },
    $push: { auditTrail: auditEvent },
  }
}
