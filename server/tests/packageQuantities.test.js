import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanEquipmentQuantities, packageEquipmentQty } from '../utils/packageQuantities.js'

test('equipment quantity per player defaults to 1 and is capped', () => {
  assert.equal(packageEquipmentQty({}, 'EQ-1'), 1)
  assert.equal(packageEquipmentQty({ equipmentQuantities: { 'EQ-1': 2 } }, 'EQ-1'), 2)
  assert.equal(packageEquipmentQty({ equipmentQuantities: { 'EQ-1': 0 } }, 'EQ-1'), 1)
  assert.equal(packageEquipmentQty({ equipmentQuantities: { 'EQ-1': 99 } }, 'EQ-1'), 10)
})

test('saved quantities only keep equipment that is in the package', () => {
  assert.deepEqual(cleanEquipmentQuantities(['EQ-1', 'EQ-2'], { 'EQ-1': '3', 'EQ-9': 5 }), { 'EQ-1': 3, 'EQ-2': 1 })
})
