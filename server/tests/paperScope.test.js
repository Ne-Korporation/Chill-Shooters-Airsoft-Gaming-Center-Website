import test from 'node:test'
import assert from 'node:assert/strict'
import { groundCountForPlayers, groundIdsForPlayers, syncPublicGrounds } from '../utils/bookingSlots.js'
import { getBookingInventoryRequirements, pieceAtBranch } from '../utils/inventoryHolds.js'
import { billingSummaryHtml } from '../services/notificationEmails.js'

// Grounds are assigned from the headcount: below 20 players Upper Ground, 20-49 Upper + Lower
// Ground, 50 or more all three.
test('grounds are assigned from the number of players', () => {
  assert.equal(groundCountForPlayers(1), 1)
  assert.equal(groundCountForPlayers(19), 1)
  assert.equal(groundCountForPlayers(20), 2)
  assert.equal(groundCountForPlayers(49), 2)
  assert.equal(groundCountForPlayers(50), 3)
  assert.equal(groundCountForPlayers(400), 3)
  assert.deepEqual(groundIdsForPlayers('binan', 25), ['binan-field-1', 'binan-field-2'])
})

// A tiny in-memory stand-in for the reservations collection.
function fakeDb(reservations) {
  return {
    collection: () => ({
      find: () => ({ toArray: async () => reservations }),
      updateMany: async (filter, update) => {
        const ids = new Set(filter._id.$in)
        for (const reservation of reservations) if (ids.has(reservation._id)) Object.assign(reservation, update.$set)
        return { modifiedCount: ids.size }
      },
    }),
  }
}

test('public grounds follow the whole slot headcount, not each booking', async () => {
  const slot = { reservationDate: '2026-11-21', reservationTime: 'morning' }
  const reservations = [
    { _id: 1, locationId: 'salawag', sessionType: 'public', reservationStatus: 'confirmed', numberOfPlayers: 15, fieldIds: ['salawag-field-1'], ...slot },
    { _id: 2, locationId: 'salawag', sessionType: 'public', reservationStatus: 'pending', numberOfPlayers: 10, fieldIds: ['salawag-field-1'], ...slot },
    { _id: 3, locationId: 'salawag', sessionType: 'public', reservationStatus: 'cancelled', numberOfPlayers: 40, fieldIds: ['salawag-field-1'], ...slot },
    { _id: 4, locationId: 'langkaan', sessionType: 'public', reservationStatus: 'confirmed', numberOfPlayers: 30, fieldIds: ['langkaan-field-1'], ...slot },
  ]
  await syncPublicGrounds(fakeDb(reservations), { locationId: 'salawag', ...slot })
  // 15 + 10 = 25 players at Salawag: Upper + Lower Ground for both groups.
  assert.deepEqual(reservations[0].fieldIds, ['salawag-field-1', 'salawag-field-2'])
  assert.deepEqual(reservations[1].fieldIds, ['salawag-field-1', 'salawag-field-2'])
  // Cancelled bookings and other branches are left alone.
  assert.deepEqual(reservations[2].fieldIds, ['salawag-field-1'])
  assert.deepEqual(reservations[3].fieldIds, ['langkaan-field-1'])
})

// Each branch rents out only its own pieces; unassigned pieces can go anywhere.
const records = {
  packages: [{ id: 'pkg', weaponIds: ['RF-1'], equipmentIds: [] }],
  weapons: [
    { id: 'RF-1', name: 'Rifle #1', model: 'Rifle', unitNumber: 1, quantity: 1, status: 'available', locationId: 'langkaan' },
    { id: 'RF-2', name: 'Rifle #2', model: 'Rifle', unitNumber: 2, quantity: 1, status: 'available', locationId: 'salawag' },
    { id: 'RF-3', name: 'Rifle #3', model: 'Rifle', unitNumber: 3, quantity: 1, status: 'available' },
  ],
  equipments: [],
}
const findDocumentById = async (_db, collection, id) => records[collection]?.find((record) => record.id === id) || null
const listPieces = async (_db, collection, model) => records[collection].filter((record) => record.model === model)

test('pieceAtBranch: own branch or unassigned only', () => {
  assert.equal(pieceAtBranch({ locationId: 'salawag' }, 'salawag'), true)
  assert.equal(pieceAtBranch({ locationId: 'salawag' }, 'binan'), false)
  assert.equal(pieceAtBranch({}, 'binan'), true)
  assert.equal(pieceAtBranch({ locationId: 'salawag' }, ''), true)
})

test('package bookings only take pieces from the booking branch', async () => {
  const requirements = await getBookingInventoryRequirements({
    db: {}, payload: { selectionMode: 'package', selectedPackageId: 'pkg', locationId: 'salawag' }, players: 2, findDocumentById, listPieces,
  })
  // RF-1 is at Langkaan, so Salawag gets its own RF-2 and the unassigned RF-3.
  assert.deepEqual(requirements.map((r) => r.itemId), ['RF-2', 'RF-3'])

  await assert.rejects(
    getBookingInventoryRequirements({
      db: {}, payload: { selectionMode: 'package', selectedPackageId: 'pkg', locationId: 'binan' }, players: 2, findDocumentById, listPieces,
    }),
    /not enough Rifle stock/,
  )
})

test('custom picks from another branch are refused', async () => {
  await assert.rejects(
    getBookingInventoryRequirements({
      db: {}, payload: { selectionMode: 'custom', customWeaponIds: ['RF-1'], locationId: 'salawag' }, players: 1, findDocumentById, listPieces,
    }),
    /belongs to another branch/,
  )
})

test('billing summary lists every price line, the total, the online payment and the balance', () => {
  const html = billingSummaryHtml({
    totalAmount: 1350,
    depositAmount: 675,
    pricingBreakdown: [
      { label: 'Full rental package', amount: 1500 },
      { label: 'Verified CvSU discount (10%)', amount: -150 },
    ],
  })
  assert.match(html, /Billing summary/)
  assert.match(html, /Full rental package/)
  assert.match(html, /- PHP 150/)
  assert.match(html, /Total.*PHP 1,350/)
  assert.match(html, /To pay online now.*PHP 675/)
  assert.match(html, /Balance at the field.*PHP 675/)
})

test('players get one reschedule; staff moves and sent-back new dates do not count', async () => {
  const { playerRescheduleCount } = await import('../routes/crud.js')
  assert.equal(playerRescheduleCount({}), 0)
  assert.equal(playerRescheduleCount({ rescheduleHistory: [{ actorRole: 'admin' }, { actorRole: 'registrar' }] }), 0)
  assert.equal(playerRescheduleCount({ rescheduleHistory: [{ actorRole: 'user', sentBack: true }] }), 0)
  assert.equal(playerRescheduleCount({ rescheduleHistory: [{ actorRole: 'user', reason: 'New date chosen after staff sent it back: fields closed' }] }), 0)
  assert.equal(playerRescheduleCount({ rescheduleHistory: [{ actorRole: 'user', reason: '' }] }), 1)
})
