import test from 'node:test'
import assert from 'node:assert/strict'
import { canAddChargeType, canRemoveChargeType } from '../routes/fieldOps.js'

// Registrars handle the bill and payments; marshals hand out ammo and guns; admins do both.
test('marshals add ammo and guns, registrars add the other charges', () => {
  assert.equal(canAddChargeType('marshal', 'ammo_reload'), true)
  assert.equal(canAddChargeType('marshal', 'gun_rental'), true)
  assert.equal(canAddChargeType('marshal', 'field_modification'), false)
  assert.equal(canAddChargeType('registrar', 'ammo_reload'), false)
  assert.equal(canAddChargeType('registrar', 'field_modification'), true)
  assert.equal(canAddChargeType('registrar', 'other'), true)
  assert.equal(canAddChargeType('admin', 'ammo_reload'), true)
  assert.equal(canAddChargeType('admin', 'other'), true)
  assert.equal(canAddChargeType('user', 'ammo_reload'), false)
})

test('registrars can take any charge off; marshals only ammo and gun lines', () => {
  assert.equal(canRemoveChargeType('registrar', 'ammo_reload'), true)
  assert.equal(canRemoveChargeType('registrar', 'field_modification'), true)
  assert.equal(canRemoveChargeType('marshal', 'ammo_reload'), true)
  assert.equal(canRemoveChargeType('marshal', 'gun_rental'), true)
  assert.equal(canRemoveChargeType('marshal', 'field_modification'), false)
  assert.equal(canRemoveChargeType('user', 'ammo_reload'), false)
})
