# TODO - Backend + Frontend Functional Completion

## Phase 1 — Backend Foundations
- [ ] Inspect current auth/session usage (token? headers?) and reservation schema expectations.
- [ ] Add Cloudinary upload helper + backend upload route(s).
- [ ] Add reservation confirmation endpoint logic to auto-create gameplay (no duplicates), linked by reservationId + userId.
- [ ] Implement gameplay status/actions defaults + delete behavior.

## Phase 2 — Backend CRUD Validation/Scoping
- [ ] Add reservation list scoping: users see only their own unless admin.
- [ ] Add validations for payments and waivers payloads.
- [ ] Ensure duplicate submissions are prevented (idempotency on reservation-confirm gameplay creation).

## Phase 3 — Frontend Wiring (MongoDB-backed)
- [ ] Update AdminEquipmentPage to use API CRUD and refresh list.
- [ ] Update AdminRentalPackagesPage to use API CRUD and refresh list.
- [ ] Update AdminWeaponsPage to use API CRUD and refresh list.
- [ ] Update AdminPaymentsPage to use API CRUD and refresh list.
- [ ] Update AdminReservationsPage to list/update reservations and trigger gameplay creation.
- [ ] Implement AdminGameplayPage (or wire existing one) with Status/Actions and conditional Delete.

## Phase 4 — User Workflows
- [ ] Update ReservationCalendarPage_FIXED to fetch packages/equipment from DB and save reservation.
- [ ] Update PaymentPage to upload proof to Cloudinary then save payment record to MongoDB.
- [ ] Update WaiverPage to upload waiver image (signature canvas => image blob) to Cloudinary then save waiver record.

## Phase 5 — Final Verification
- [ ] Verify all API routes work for CRUD.
- [ ] Verify MongoDB documents are created with correct links.
- [ ] Verify gameplay auto-creation on reservation confirmation.
- [ ] Verify gameplay delete only shows when Completed.
- [ ] Verify uploaded images are accessible by URL.
- [ ] Verify login works.

