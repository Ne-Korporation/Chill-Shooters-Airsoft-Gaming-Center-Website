# Chill Shooters System — Core Features TODO

This checklist tracks the requested scope and what remains to make each workflow usable end-to-end. A screen or placeholder does not count as implemented. Keep items unchecked until their backend behavior, authorization, persistence, and tests are verified.

## Business rules and owner decisions

- [x] Reservation deposits: standard/package and custom rental bookings use 50% of the server-calculated total; own-gear bookings use a fixed ₱350 deposit, capped at the booking total.
- [x] Approved full rental package price: ₱750 total (₱150 entrance, ₱500 rifle rental, ₱50 vest, ₱50 mask, two magazines / 600 BBs), pending validation that the live package and inventory records match.
- [x] Approved entrance fee: ₱150 per player.
- [x] Approved field capacity settings are configurable: Salawag and Langkaan at 200/190/180, Biñan at 400/380/360 for morning/afternoon/evening. Confirm these remain current operating limits before launch.
- [x] Private booking minimum: 10 players.
- [x] Approved FPS ceilings: AEG 450 FPS; sniper/VSR 550 FPS.
- [x] Cancellation penalty: none. Do not charge a cancellation fee unless the owner changes this policy.
- [ ] Owner: confirm physical counts, serial/asset identifiers, and categories for center-owned and partner equipment. The supplied approximate counts are planning data, not verified inventory.
- [ ] Owner: set reload, field-modification, damage/loss, and any future cancellation fee amounts before enabling those charges.
- [ ] Owner: define CvSU/partner discount eligibility evidence, review authority, rate, and audit policy. The current configured 10% CvSU rate requires owner confirmation and eligibility must be verified by staff.
- [ ] Owner: approve the REACH allocation percentage, qualifying net-revenue definition, and whether allocations are calculated before or after refunds/fees.
- [ ] Owner: confirm partner-equipment 50/50 income-sharing calculation and settlement/reporting rules.
- [ ] Owner: define waiver renewal/expiry rules, minimum player age policy, and retention period for identity and liability records.
- [ ] Owner: confirm payment-provider deployment settings, supported currencies/payment methods, and receipt/legal invoice fields.

## 1. Interactive time-slot reservation and conflict validation

**Goal:** Players book Salawag, Langkaan, or Biñan by date, morning/afternoon/evening slot, public/open game or private rental. Prevent capacity, field, and equipment overbooking. Support rescheduling at least three days before the original reservation, crediting eligible non-refundable deposits to the new slot.

- [x] Validate booking date, slot, location, session type, player count, and selected fields on the server.
- [x] Recheck field conflicts and capacity inside a transaction with a per-slot lock.
- [x] Calculate reservation price and deposit on the server; ignore client totals and client-supplied own-gear counts.
- [x] Configurable per-location/slot capacity values are served to the booking calendar.
- [x] Atomically mark a reservation cancelled, append status history, and release its inventory holds.
- [ ] Add periodic/on-focus availability refresh and clear UI for unavailable/full slots.
- [ ] Add end-to-end MongoDB replica-set tests for two simultaneous bookings competing for the same field/capacity.
- [ ] Add a rescheduling request workflow: authenticated reservation owner, reservation ID, new date/slot, and reason.
- [ ] Enforce the three-day cutoff using server time and the original reservation date.
- [ ] Revalidate new-slot capacity, field availability, and inventory in a transaction.
- [ ] Transfer the eligible deposit credit without duplicating or losing payment history; audit request, approval, credit, and denial.
- [ ] Test rescheduling deadline boundaries, concurrent claims, denial, and deposit-credit ledger behavior.

## 2. Budget and rental recommendation engine

**Goal:** Given budget and group size, recommend available packages or combinations, with transparent total and per-player prices.

- [ ] Use server-calculated pricing from persisted package/item records rather than a client-only quote.
- [ ] Filter out unavailable, inactive, or under-stocked packages and equipment using current holds.
- [ ] Show why each suggestion fits the budget and group size, including itemized total/per-player costs.
- [ ] Test exact-budget, under-budget, no-match, and limited-stock cases.

## 3. Custom equipment package and gear customization

**Goal:** Let players choose AEGs, vests, masks, approved optics/scopes, and extra ammunition while repricing and enforcing inventory.

- [x] Validate selected catalog item status and reserve package/custom weapon/equipment stock transactionally.
- [x] Release held stock atomically when a reservation is cancelled.
- [ ] Normalize inventory to explicit quantities or individually tracked assets; validate current collection semantics and migrate inconsistent records.
- [ ] Confirm the package includes the correct per-player quantities and that pricing matches those included items.
- [ ] Configure reload options and prices after owner approval; add them to server pricing and inventory holds.
- [ ] Define allowed optic/scope classifications with the owner and enforce them on the server.
- [ ] Add replica-set integration tests for competing reservations against the same item stock and cancellation release.

## 4. Automated billing and pricing

**Goal:** Calculate entrance, rental, add-on, discount, and approved penalty totals on the server.

- [x] Calculate base entrance fee and standard/custom/own-gear deposits on the server.
- [x] Use persisted package and item prices; compute configured package discounts and verified-profile CvSU discount.
- [x] Ignore client-submitted price, deposit, and own-weapon count fields.
- [ ] Validate the live ₱750 full-rental package record, its included inventory, and itemized breakdown against the approved ₱150/₱500/₱50/₱50/600-BB composition.
- [ ] Make reload, field modification, damage/loss, and future penalties configurable; do not activate a fee before owner approval.
- [ ] Implement audited registrar review of CvSU/partner proof before enabling a discount for a player.
- [ ] Use the same server pricing calculator for recommendation quotes and show the saved server total before payment.
- [ ] Add tests for every enabled discount, add-on, pricing configuration boundary, and rounding rule.

## 5. Online registration and digital liability waiver

**Goal:** Secure player profiles, ID submissions, and signed waivers linked to the correct identity/reservation.

- [x] Require authentication for identity uploads and restrict player uploads to the authenticated account.
- [x] Restrict player profile updates from changing protected role/identity fields.
- [ ] Bind waiver records to the verified account and relevant reservation/game session.
- [ ] Define and implement duplicate, renewal, expiry, and staff-review workflows.
- [ ] Review and test access controls for identity documents and waiver contents for every role.
- [ ] Add a verifiable integrity mechanism for signed waiver data if cryptographic binding is required; do not describe data as cryptographically bound until implemented and tested.
- [ ] Define owner-approved age policy, privacy/retention period, and secure deletion/export process.

## 6. Dynamic player profiles and skill-based team balancing

**Goal:** Track validated age, experience/skill, ID status, and rental history; recommend balanced public-game teams while allowing marshals to override.

- [ ] Define trusted profile fields and staff validation for age, experience, skill tier, ID status, and rental history.
- [ ] Document and implement a deterministic age/experience weighting and team-balancing algorithm.
- [ ] Generate recommendations from confirmed attendance, not just booking headcount.
- [ ] Let marshals override recommendations and preserve both original recommendation and final assignment with actor/time audit history.
- [ ] Link saved assignments to gameplay and reservation.
- [ ] Test fairness/consistency, odd player counts, missing skill data, and marshal edits.

## 7. Payment verification and receipt generation

**Goal:** Accept approved deposits and remaining balances through GCash, bank transfer, cash, or configured card provider; staff verify proof and issue auditable receipts.

- [x] Enforce server-calculated deposit amounts and authenticated reservation ownership for player GCash submissions.
- [x] Serialize competing GCash submissions, reject reused transaction references, and support configured split shares.
- [x] Use Stripe Elements; verify succeeded PaymentIntents server-side against amount, currency, reservation, and owner.
- [x] Serialize Stripe confirmation with GCash submissions and record verified Stripe payments idempotently by PaymentIntent.
- [x] Audit staff payment status changes with actor, role, timestamp, and reason; prevent staff from changing Stripe-provider status manually.
- [ ] Run live Stripe test-mode end-to-end checks and configure deployment publishable/secret keys and webhook/reconciliation policy.
- [ ] Add audited registrar verification/rejection UX for GCash proof/reference and document approved bank-transfer proof handling.
- [ ] Add registrar cash and bank-transfer balance settlement with actor, amount, method, timestamp, and reason.
- [ ] Prevent overpayment/duplicate settlement across all payment methods and reconcile partial/split shares with the remaining balance.
- [ ] Generate printable/downloadable receipts only for verified payments; persist receipt number and link it to the financial ledger.
- [ ] Test live MongoDB transaction races and provider retry/idempotency behavior.
- [ ] Never store card numbers or CVVs.

## 8. Equipment rental inventory, chronograph, maintenance, and repairs

**Goal:** Track center-owned and partner assets, player assignments, FPS readings, condition, maintenance, repairs, and approved charges.

- [ ] Verify and enter actual quantities/assets for the approximate categories provided: M4 rifles, gel blasters, pistols, sniper rifles, machine gun, shotgun, pyrotechnics/bombs, and photoshoot weapons.
- [ ] Assign individual asset IDs/serials; distinguish center-owned, partner-borrowed, consumable, and photoshoot-only equipment.
- [ ] Record checkout to player/gameplay, return time, condition, missing/damaged status, and responsible staff.
- [ ] Prevent issuance of maintained, damaged, unavailable, or already-assigned assets.
- [ ] Record chronograph reading, test timestamp, weapon/asset, marshal, and pass/fail against configurable approved limits (AEG 450 FPS; sniper/VSR 550 FPS).
- [ ] Record damage report, evidence, repair parts, gunsmith cost, status, and auditable responsible-player linkage.
- [ ] Attach a damage/repair charge only after authorized review and owner-approved pricing; add it to the correct bill.
- [ ] Track partner center, borrowed/returned state, revenue share, and 50/50 settlement only after owner confirms calculation rules.
- [ ] Test concurrent asset assignment, return, maintenance hold, chronograph limits, and repair billing.

## 9. Game preferences and tactical field layout requests

**Goal:** Capture structured game modes and setup requests during booking and dispatch them to marshals before game day.

- [ ] Add structured game-mode preference and obstacle/objective layout fields to the reservation request.
- [ ] Validate allowed options and safely bound free-text details.
- [ ] Provide marshals a role-protected advance preparation view with reservation schedule and request details.
- [ ] Add preparation status, assigned marshal, update timestamp, and audit history.
- [ ] Test player ownership and marshal/admin authorization.

## 10. Automated status notifications and email

**Goal:** Send persisted, event-triggered updates for reservations, payments, waivers, booking changes, weather, and game reminders.

- [ ] Trigger in-app and email notifications only after the related database change succeeds.
- [ ] Cover confirmation, payment verification/rejection, waiver reminders, booking changes, weather updates, and pre-game reminders.
- [ ] Add configurable email/weather provider settings and scheduled reminder execution.
- [ ] Record delivery status/failure and retry policy; do not report a failed send as successful.
- [ ] Prevent duplicate notifications on transaction retries and repeated provider callbacks.
- [ ] Test event-to-notification behavior and delivery failure handling.

## 11. Financial, operational, and audit report generator

**Goal:** Produce date-filtered, printable/exportable administrative reports with traceable calculations.

- [ ] Add daily, weekly, monthly, yearly, and custom date-range filters.
- [ ] Report reservations, gross/net revenue, players, equipment rentals, approved damage/penalty fees, and compliance data that is actually stored.
- [ ] Include payment/refund/reconciliation and audit history with clear calculation definitions.
- [ ] Ensure queries use the full date-filtered dataset, not a fixed recent-record limit.
- [ ] Add print/PDF and export output with access restricted to authorized roles.
- [ ] Test date boundaries, timezone handling, aggregation totals, and role permissions.

## 12. REACH community outreach fund tracker

**Goal:** Maintain a separate audit ledger for approved allocations from qualifying net revenue and outreach spending.

- [ ] Obtain owner approval for allocation rate, qualifying revenue basis, timing, and refund/fee treatment.
- [ ] Add configurable rules; no default/hardcoded allocation percentage.
- [ ] Record allocation entries and outreach expenditures as separate auditable transactions.
- [ ] Prevent duplicate allocation for the same qualifying payment/revenue event.
- [ ] Display balances and transaction history in admin reports with restricted access.
- [ ] Test allocation, reversal/refund adjustment, audit, and report reconciliation.

## 13. Digital customer feedback and evaluation

**Goal:** Collect post-game ratings for reservation, cleanliness, equipment, field layout, and staff/marshal performance; aggregate results for admins.

- [x] Provide player/admin feedback pages and backend rating validation.
- [x] Restrict player feedback to their own completed gameplay and one submission per game/player.
- [x] Show admin/staff aggregate ratings and comments.
- [ ] Verify the full player-to-admin workflow against persisted gameplay and live authorization in integration tests.
- [ ] Add abuse controls/moderation and privacy rules for comments if approved.

## 14. Staff recruitment and hiring portal

**Goal:** Publish job openings and accept applications with a protected staff review workflow.

- [ ] Add public job listing records for roles such as marshal and registrar, with description and requirements.
- [ ] Add validated application submission with contact details and approved supporting-document handling.
- [ ] Restrict applicant records to authorized hiring staff; do not expose applications through public APIs.
- [ ] Add review/status history, applicant notification, and retention/deletion rules.
- [ ] Test public listing, private application data, and staff role enforcement.

## 15. RBAC and cross-platform security architecture

**Goal:** Enforce role boundaries on the server and provide responsive mobile/tablet/desktop workflows for admin, registrar, marshal, and player.

- [x] Apply server-side authentication, role checks, and ownership checks to core reservation/payment/upload paths.
- [x] Derive player identity from the authenticated session; do not trust client-supplied user IDs or roles for these workflows.
- [ ] Complete an endpoint-by-endpoint authorization matrix for super admin, registrar, marshal, and player; test forbidden reads/writes as well as allowed access.
- [ ] Restrict registrar to booking validation, counter billing, payment verification, and receipt operations.
- [ ] Restrict marshal to attendance, chronograph, team balancing, and damage logging; prevent access to unrelated financial/admin data.
- [ ] Restrict player portal to own booking, profile, waiver, package, payment, and feedback records.
- [ ] Review audit logging, rate limiting, session/token handling, file access, input validation, and sensitive-data exposure.
- [ ] Test booking, payment, waiver, inventory, reports, and recruitment flows on mobile, tablet, and desktop; fix usability/accessibility issues.
- [ ] Run authorization/security tests and production configuration review before deployment.

## Verification and release gates

- [x] Add unit tests for server-side pricing, slot rules, inventory hold logic, GCash/Stripe payment rules, and cancellation/status handling.
- [x] Run the production frontend build and TypeScript check; resolve TypeScript errors.
- [ ] Add integration tests against a MongoDB replica set for transactional booking, inventory, payments, and cancellation.
- [ ] Add provider test-mode integration tests for Stripe and end-to-end staff verification tests for manual payment methods.
- [ ] Add browser-level tests for core booking, payment, waiver, feedback, registrar, and marshal workflows.
- [ ] Configure and verify production environment variables, owner-approved business values, backups, and operational monitoring.
- [ ] Revisit this checklist after each phase; mark an item complete only after its acceptance criteria pass end-to-end.
- [ ] Do not create a commit unless explicitly requested.