import test from 'node:test'
import assert from 'node:assert/strict'
import { updateReservationStatusAtomically } from '../utils/reservationStatus.js'

function createFakeDatabase(initialReservation, payments = []) {
  const state = {
    reservation: { ...initialReservation, statusHistory: initialReservation.statusHistory || [] },
    inventoryHolds: [{ reservationId: initialReservation.id, status: 'held', quantity: 2 }],
    operations: [],
    sessionEnded: false,
  }
  const db = {
    collection(name) {
      if (name === 'reservation_status_locks') {
        return {
          updateOne: async (_filter, _update, options) => {
            state.operations.push({ name, session: options.session })
          },
        }
      }
      if (name === 'reservations') {
        return {
          findOne: async (_filter, options) => {
            state.operations.push({ name: 'findOne', session: options.session })
            return {
              ...state.reservation,
              statusHistory: [...state.reservation.statusHistory],
            }
          },
          updateOne: async (_filter, update, options) => {
            state.operations.push({ name: 'updateReservation', session: options.session })
            Object.assign(state.reservation, update.$set)
            state.reservation.statusHistory.push(update.$push.statusHistory)
          },
        }
      }
      if (name === 'payments') {
        return {
          find: (_filter, options) => {
            state.operations.push({ name: 'readPayments', session: options.session })
            return { toArray: async () => payments }
          },
        }
      }
      if (name === 'inventory_holds') {
        return {
          updateMany: async (_filter, update, options) => {
            state.operations.push({ name: 'releaseHolds', session: options.session })
            state.inventoryHolds.forEach((hold) => Object.assign(hold, update.$set))
          },
        }
      }
      throw new Error(`Unexpected collection: ${name}`)
    },
  }
  const startSession = () => ({
    withTransaction: (callback) => callback(),
    endSession: async () => { state.sessionEnded = true },
  })
  return { db, startSession, state }
}

test('cancellation atomically audits status and releases inventory using the same transaction', async () => {
  const fake = createFakeDatabase({ id: 'R-1', reservationStatus: 'pending' })
  const result = await updateReservationStatusAtomically({
    db: fake.db,
    startSession: fake.startSession,
    reservationFilter: { id: 'R-1' },
    reservationId: 'R-1',
    nextStatus: 'cancelled',
    actor: { id: 'registrar-1', role: 'registrar' },
  })

  assert.equal(result.reservationStatus, 'cancelled')
  assert.equal(result.statusHistory.length, 1)
  assert.equal(result.statusHistory[0].changedBy, 'registrar-1')
  assert.equal(fake.state.inventoryHolds[0].status, 'released')
  assert.equal(fake.state.operations.some((operation) => operation.name === 'releaseHolds'), true)
  assert.ok(fake.state.operations.every((operation) => operation.session === fake.state.operations[0].session))
  assert.equal(fake.state.sessionEnded, true)
})

test('repeating a cancellation does not duplicate audit entries or release writes', async () => {
  const fake = createFakeDatabase({
    id: 'R-2',
    reservationStatus: 'cancelled',
    statusHistory: [{ status: 'cancelled' }],
  })
  const result = await updateReservationStatusAtomically({
    db: fake.db,
    startSession: fake.startSession,
    reservationFilter: { id: 'R-2' },
    reservationId: 'R-2',
    nextStatus: 'cancelled',
    actor: { id: 'admin-1', role: 'admin' },
  })

  assert.equal(result.statusHistory.length, 1)
  assert.equal(fake.state.operations.some((operation) => operation.name === 'releaseHolds'), false)
})

test('cancelled reservations cannot be reopened', async () => {
  const fake = createFakeDatabase({ id: 'R-3', reservationStatus: 'cancelled' })
  await assert.rejects(
    updateReservationStatusAtomically({
      db: fake.db,
      startSession: fake.startSession,
      reservationFilter: { id: 'R-3' },
      reservationId: 'R-3',
      nextStatus: 'confirmed',
      actor: { id: 'admin-1', role: 'admin' },
    }),
    { statusCode: 409 },
  )
  assert.equal(fake.state.reservation.reservationStatus, 'cancelled')
  assert.equal(fake.state.operations.some((operation) => operation.name === 'updateReservation'), false)
})

test('fully paid reservations cannot be cancelled', async () => {
  const fake = createFakeDatabase(
    { id: 'R-9', reservationStatus: 'pending', depositAmount: 500, userId: 'captain' },
    [{ reservationId: 'R-9', userId: 'captain', amount: 500, paymentStatus: 'pending' }],
  )
  await assert.rejects(
    updateReservationStatusAtomically({
      db: fake.db,
      startSession: fake.startSession,
      reservationFilter: { id: 'R-9' },
      reservationId: 'R-9',
      nextStatus: 'cancelled',
      actor: { id: 'captain', role: 'user' },
    }),
    { statusCode: 409 },
  )
  assert.equal(fake.state.reservation.reservationStatus, 'pending')
  assert.equal(fake.state.inventoryHolds[0].status, 'held')
})
