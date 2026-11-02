import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanMiddleInitial, composeFullName, splitFullName } from '../utils/names.js'

test('composes "First M. Last" from name parts', () => {
  assert.equal(composeFullName({ firstName: 'Juan', middleInitial: 'dizon', lastName: 'Dela Cruz' }), 'Juan D. Dela Cruz')
  assert.equal(composeFullName({ firstName: ' Ana  Marie ', middleInitial: '', lastName: 'Santos' }), 'Ana Marie Santos')
})

test('splits a Google account name into parts', () => {
  assert.deepEqual(splitFullName('Nino Nono'), { firstName: 'Nino', middleInitial: '', lastName: 'Nono' })
  assert.deepEqual(splitFullName('Maria Clara R. Santos'), { firstName: 'Maria Clara', middleInitial: 'R', lastName: 'Santos' })
  assert.deepEqual(splitFullName('Cher'), { firstName: 'Cher', middleInitial: '', lastName: '' })
  assert.deepEqual(splitFullName(''), { firstName: '', middleInitial: '', lastName: '' })
})

test('middle initial keeps one capital letter', () => {
  assert.equal(cleanMiddleInitial('d.'), 'D')
  assert.equal(cleanMiddleInitial('ñ'), 'Ñ')
  assert.equal(cleanMiddleInitial('  '), '')
})
