// Damage and loss penalty rules:
//   loss   = the item's replacement value (replacementValue on its inventory record)
//   damage = the gunsmith repair cost (parts + labor) plus a handling fee of
//            handlingFeePercent, set by the admin (0% until the owner sets it)
// Staff can bill a different amount only with a written reason, which is kept
// on the record next to the computed amount.

export const PENALTY_RULES_ID = 'penalty_rules'
export const DEFAULT_PENALTY_RULES = { handlingFeePercent: 0 }

function round2(value) {
  return Math.round(Number(value) * 100) / 100
}

export async function getPenaltyRules(db) {
  const saved = await db.collection('settings').findOne({ _id: PENALTY_RULES_ID })
  const percent = Number(saved?.handlingFeePercent)
  return {
    handlingFeePercent: Number.isFinite(percent) && percent >= 0 ? Math.min(percent, 100) : DEFAULT_PENALTY_RULES.handlingFeePercent,
    updatedAtISO: saved?.updatedAtISO || null,
    updatedBy: saved?.updatedBy || null,
  }
}

export function replacementValueOf(item) {
  const value = Number(item?.replacementValue)
  return Number.isFinite(value) && value > 0 ? round2(value) : null
}

// Returns { amount, basis, lines } or { amount: null, missing } when the rule lacks data.
export function computePenalty({ kind, item, repairCost, rules = DEFAULT_PENALTY_RULES }) {
  if (kind === 'loss') {
    const value = replacementValueOf(item)
    if (value === null) {
      return { amount: null, basis: 'loss', missing: 'Set the replacement value on this item’s inventory record to compute a loss penalty.' }
    }
    return { amount: value, basis: 'loss', lines: [{ label: 'Replacement value', amount: value }] }
  }

  const cost = Number(repairCost)
  if (!Number.isFinite(cost) || cost < 0) {
    return { amount: null, basis: 'damage', missing: 'Complete the gunsmith repair with its parts and labor cost to compute a damage penalty.' }
  }
  const percent = Number(rules.handlingFeePercent) || 0
  const fee = round2(cost * percent / 100)
  const lines = [{ label: 'Repair cost (parts + labor)', amount: round2(cost) }]
  if (fee > 0) lines.push({ label: `Handling fee (${percent}%)`, amount: fee })
  return { amount: round2(cost + fee), basis: 'damage', lines }
}

// Decides the amount to bill. The staff member's amount is billed as entered (marking it as
// overridden when it isn't the rule's amount); a reason is optional and kept when given. With no
// amount entered, the rule's amount is used, if the rule could compute one.
export function resolvePenaltyCharge(computed, { requestedAmount, overrideReason }) {
  const requested = requestedAmount === undefined || requestedAmount === null || requestedAmount === ''
    ? null
    : round2(requestedAmount)
  const reason = String(overrideReason || '').trim()
  if (requested !== null && (!Number.isFinite(requested) || requested <= 0)) {
    return { error: 'Enter a positive charge amount.' }
  }
  if (requested === null) {
    if (computed.amount === null) return { error: `${computed.missing} Or enter the fee yourself.` }
    return { amount: computed.amount, overridden: false }
  }
  if (computed.amount !== null && Math.abs(requested - computed.amount) < 0.005) {
    return { amount: computed.amount, overridden: false }
  }
  return { amount: requested, overridden: true, overrideReason: reason }
}
