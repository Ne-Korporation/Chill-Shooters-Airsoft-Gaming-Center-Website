export const MAX_EQUIPMENT_PER_PLAYER = 10

// How many pieces of a package's equipment item each player gets (default 1).
// Mirrors packageEquipmentQty in src/utils/packagePricing.ts.
export function packageEquipmentQty(pkg, equipmentId) {
  const raw = Math.round(Number(pkg?.equipmentQuantities?.[String(equipmentId)]))
  return Number.isFinite(raw) && raw >= 1 ? Math.min(raw, MAX_EQUIPMENT_PER_PLAYER) : 1
}

// Keeps only whole quantities (1 to MAX) for equipment that is in the package.
export function cleanEquipmentQuantities(equipmentIds, quantities) {
  const cleaned = {}
  for (const id of (Array.isArray(equipmentIds) ? equipmentIds : []).map(String)) {
    cleaned[id] = packageEquipmentQty({ equipmentQuantities: quantities }, id)
  }
  return cleaned
}
