export function getGcashAmountDue(reservation, payments) {
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
  return Math.min(Math.round((depositAmount / teamSize) * 100) / 100, remainingDeposit)
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
  return payments.some((payment) =>
    !['failed', 'rejected'].includes(String(payment.paymentStatus || payment.status || '').toLowerCase()),
  )
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
