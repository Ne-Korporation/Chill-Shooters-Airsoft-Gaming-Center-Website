# Project Backlog — Chill Shooters Airsoft Gaming Center

## Frontend Implementation Status
- [x] Step 4: Admin CRUD wiring in the admin pages. Implemented across [src/pages/admin/AdminEquipmentPage.tsx](src/pages/admin/AdminEquipmentPage.tsx), [src/pages/admin/AdminRentalPackagesPage.tsx](src/pages/admin/AdminRentalPackagesPage.tsx), [src/pages/admin/AdminWeaponsPage.tsx](src/pages/admin/AdminWeaponsPage.tsx), [src/pages/admin/AdminPaymentsPage.tsx](src/pages/admin/AdminPaymentsPage.tsx), [src/pages/admin/AdminReservationsPage.tsx](src/pages/admin/AdminReservationsPage.tsx), and [src/pages/admin/AdminGameplayPage.tsx](src/pages/admin/AdminGameplayPage.tsx).

## Frontend Detail Plan

### 1. Shared design system and interaction patterns
- Priority: P0
- Effort: M
- Acceptance criteria:
  - Buttons, cards, inputs, modals, tables, tabs, and alert states use consistent styling and spacing.
  - Loading, empty, success, and error states are implemented consistently across pages.
  - The app remains readable and usable on mobile, tablet, and desktop.
  - Accessibility basics are covered for forms, dialogs, focus states, and keyboard navigation.

### 2. Authentication screens and session experience
- Priority: P0
- Effort: M
- Acceptance criteria:
  - Login, register, forgot password, OTP, and reset password screens have complete user feedback.
  - Session state persists cleanly across refreshes without breaking role-based navigation.
  - Errors explain what the user should do next instead of showing raw failures.
  - Role-specific redirects land the user on the correct dashboard.

### 3. Reservation booking UI and confirmation flow
- Priority: P0
- Effort: L
- Acceptance criteria:
  - Users can choose location, field, date, slot, session type, and player count in a guided flow.
  - Availability, minimum players, and capacity warnings are visible before confirmation.
  - Package selection, custom loadout selection, and summary review are all shown clearly.
  - The final reservation confirmation screen reflects the exact booking state saved to the backend.

### 4. Payment UI, proof upload, and payment choice
- Priority: P0
- Effort: M
- Acceptance criteria:
  - Users can review payment totals, payer share, and split-payment settings before submitting.
  - GCash and card payment paths are visually distinct and fully guided.
  - Payment proof upload, QR display, and receipt preview are easy to follow on mobile.
  - The payment screen reflects reservation metadata and does not require manual data re-entry.

### 5. Waiver UX and print flow
- Priority: P0
- Effort: M
- Acceptance criteria:
  - Waiver forms guide users through required fields with clear validation.
  - Signature, proof, or uploaded assets are handled without breaking the form flow.
  - Submitted waivers show status and allow printing or review where needed.
  - Waiver state remains visible across user and admin pages.

### 6. Player profile, skills, and progression UI
- Priority: P1
- Effort: M
- Acceptance criteria:
  - Player profiles display personal information, history, skills, and owned gear clearly.
  - Skill or experience values refresh after completed games or admin-approved updates.
  - Profile edits and image uploads have clear save states and error handling.
  - Profile history shows the records that caused progression changes.

### 7. Team generator and team review module
- Priority: P1
- Effort: L
- Acceptance criteria:
  - Admins or marshals can generate teams based on player skills, availability, and booking context.
  - Generated teams can be reviewed, adjusted, and saved before gameplay starts.
  - Team results remain linked to the reservation or gameplay record.
  - The frontend clearly distinguishes recommended teams from manually edited teams.

### 8. Admin analytics and printable reports
- Priority: P1
- Effort: M
- Acceptance criteria:
  - Admin reports include reservations, payments, waivers, gameplay, and operational totals.
  - Print-friendly output works for browser print and PDF export.
  - Report filters and summary cards help admins read the data quickly.
  - The report page works well on common dashboard screen sizes.

### 9. Admin operations dashboard and record review pages
- Priority: P1
- Effort: M
- Acceptance criteria:
  - Admin tables, filters, detail drawers, and action buttons follow a consistent pattern.
  - Reservations, payments, weapons, equipment, and gameplay pages show related records together.
  - Action feedback explains whether the record was approved, updated, or rejected.
  - Print, inspect, and bulk-review actions are available where operationally useful.

### 10. Notifications, activity states, and data refresh
- Priority: P1
- Effort: S
- Acceptance criteria:
  - Notification toasts, banners, and counters match the latest backend state.
  - Pages refresh or invalidate stale data after reservation, payment, waiver, or gameplay changes.
  - The user can tell when a record is still pending, confirmed, reviewed, or rejected.
  - The UI avoids stale totals after save actions.

### 11. Frontend validation and error handling
- Priority: P0
- Effort: M
- Acceptance criteria:
  - Required fields, numeric-only fields, file uploads, and date rules are validated before submit.
  - Error messages are specific and actionable.
  - The app blocks invalid workflow transitions before they hit the backend.
  - Failed requests show recoverable UI states instead of silent failures.

### 12. Responsive layout and mobile-first polish
- Priority: P1
- Effort: M
- Acceptance criteria:
  - Core flows remain usable on small screens without horizontal overflow.
  - Tables collapse into mobile-friendly cards or stacked layouts where needed.
  - Modals and sidebars remain usable on touch devices.
  - Mobile users can complete booking, payment, and profile tasks without desktop-only controls.

### 13. Frontend data binding for business rules
- Priority: P1
- Effort: M
- Acceptance criteria:
  - UI reflects pricing, discounts, minimum player rules, and availability from backend data.
  - Player skill updates, team generation, and gameplay completion all show the latest saved state.
  - Admin settings like GCash QR and payment instructions are displayed from persisted configuration.
  - The frontend does not rely on hardcoded values for business-critical rules.

## Priority Legend
- P0: Critical for working system and core business flow
- P1: High value, required before launch or core operations
- P2: Important but can be delivered after core flow is stable
- S: Small effort (1–2 days)
- M: Medium effort (3–5 days)
- L: Large effort (1–2 weeks)

---

- Priority: P0
- Effort: M
- Acceptance criteria:
  - Users can log in with email/password and correct role is returned.
  - Admin, registrar, marshal, and player routes enforce access rules.
  - Invalid credentials return clear error messages.
- Priority: P0
- Effort: M
- Acceptance criteria:
  - Required collections exist for users, reservations, payments, waivers, gameplay, equipment, and reports.
  - Duplicate reservation submissions are prevented.
  - User records contain correct role and verification fields.
- Priority: P0
- Effort: M
- Acceptance criteria:
  - All routes return consistent success/error payloads.
  - Validation prevents missing required fields and invalid role values.
  - Backend rejects malformed payment, waiver, and reservation requests.
  - Error messages are meaningful to the frontend and operators.
- Effort: M
- Acceptance criteria:
  - Payment proof uploads save to Cloudinary and return a valid public URL.
  - Waiver signature/upload images save and are accessible by URL.
  - Failed uploads return clear errors instead of creating broken records.
  - Uploaded assets are linked to the correct user or reservation record.
## Phase 2 — Core Customer Booking Flow

### 5. Reservation creation and booking rules
- Priority: P0
- Effort: L
- Acceptance criteria:
  - Reservations include user linkage and status tracking.

### 6. Package recommendation and customization
- Priority: P1
- Effort: M
- Acceptance criteria:
  - Final package selections are saved with reservation data.

### 7. Payment workflow with proof upload
- Priority: P0
- Effort: M
- Acceptance criteria:
  - Players can submit GCash or bank transfer proof.
  - Payment proof is uploaded, stored, and linked to reservation.
  - Transaction reference and amount are captured correctly.
  - Registrar verification marks the payment as confirmed or rejected.

### 8. Waiver submission and tracking
- Priority: P0
- Effort: M
- Acceptance criteria:
  - Users can complete a digital waiver before or during reservation flow.
  - Waiver records connect to user and reservation profile.
  - Waiver status is visible to admins and registrars.
  - Duplicate or outdated waiver submissions are handled gracefully.

---

## Phase 3 — Operations, Admin, and Game Management

### 9. Reservation confirmation and gameplay auto-creation
- Priority: P0
- Effort: L
- Acceptance criteria:
  - Approved reservations automatically create gameplay records when required.
  - Duplicate gameplay records are not created for the same reservation.
  - Gameplay status transitions are tracked from pending to active to completed.
  - Admin can update gameplay status and view linked reservation details.

### 10. Equipment inventory and maintenance tracking
- Priority: P1
- Effort: L
- Acceptance criteria:
  - Equipment stock and statuses are visible in admin pages.
  - Equipment can be marked available, rented, or under maintenance.
  - Maintenance records include issue date, repair status, and cost.
  - Damaged equipment adds penalty tracking to billing records.

### 11. Weapon and rental package admin management
- Priority: P1
- Effort: M
- Acceptance criteria:
  - Admins can create, update, and deactivate equipment and weapons.
  - Rental package values reflect current equipment and pricing.
  - Inventory constraints are visible and enforced in the UI.
  - Data is saved to MongoDB and reflected in user-facing flows.

### 12. Player management and profile records
- Priority: P1
- Effort: M
- Acceptance criteria:
  - Players have profile records with personal info, age, ID, reservation history, and ownership details.
  - Admin can view and update player data.
  - Experience and team grouping metadata are stored for marshal review.
  - Historical records remain accessible for audit.

### 13. Marshal and registrar workflows
- Priority: P1
- Effort: M
- Acceptance criteria:
  - Registrar can review reservations, payments, and waivers.
  - Marshal can review games, assignments, and equipment readiness.
  - Role-specific dashboards show only relevant operational records.
  - Final operational decisions can be approved or rejected.

---

## Phase 4 — Analytics, Reporting, and Compliance

### 14. Financial and operational reporting
- Priority: P1
- Effort: M
- Acceptance criteria:
  - Admin can generate daily, weekly, monthly, and yearly reports.
  - Reports include reservations, payments, equipment, penalties, and sales totals.
  - Output can be viewed in the dashboard and exported for documentation.
  - Reports are based on persisted MongoDB records, not stale UI state.

### 15. Notifications and reminders
- Priority: P1
- Effort: M
- Acceptance criteria:
  - Users receive reservation confirmation, waiver reminder, and payment verification notifications.
  - Admin and registrar role notifications are triggered for relevant updates.
  - Unread notification counts reflect real state.
  - Notification records are stored and queryable.

### 16. Feedback and satisfaction tracking
- Priority: P2
- Effort: S
- Acceptance criteria:
  - Players can submit session feedback after gameplay.
  - Feedback records include service, equipment, facility, and overall satisfaction.
  - Admin can review feedback trends and flag issues.
  - Feedback is stored with the relevant reservation or user reference.

### 17. REACH and donation monitoring
- Priority: P2
- Effort: M
- Acceptance criteria:
  - Community outreach activities and donation data are tracked.
  - Financial calculations are based on defined percentage or threshold rules.
  - Donation status appears in admin financial reports.
  - Records are attributable to qualifying sessions or events.

---

## Phase 5 — Advanced Business Rules & Future Growth

### 18. Discount and partnership rules
- Priority: P1
- Effort: M
- Acceptance criteria:
  - Admin can configure approved partner and institutional discounts.
  - Eligible discounts apply automatically based on configured rules.
  - Discount amounts appear in reservation totals and final billing.
  - Exceptions are visible and auditable.

### 19. Team recommendation engine
- Priority: P2
- Effort: L
- Acceptance criteria:
  - System recommends groups using age and experience data.
  - Marshals can override recommendations without losing source data.
  - Recommended teams are stored and reviewable by admins.
  - Data supports current operational needs without full automation.

### 20. Walk-in handling and pricing enforcement
- Priority: P2
- Effort: S
- Acceptance criteria:
  - Walk-in players with gear are charged the correct entrance fee.
  - Rental walk-in flows use available inventory and pricing rules.
  - UI blocks invalid walk-in requests that exceed inventory limits.
  - Admin can reconcile walk-in bookings against recorded sales.

### 21. Native app and PWA enhancements
- Priority: P3
- Effort: L
- Acceptance criteria:
  - The web app remains mobile-friendly and installable as a PWA.
  - Core flows work on mobile without browser friction.
  - Offline support is not required for the initial release.
  - Future app development remains possible without redesigning the data model.

---

## Delivery Plan

### Phase 1: Foundation Launch
Goal: Make the app usable and stable for the team.
Deliverables:
- Authentication and role gating
- MongoDB structure and validation
- Cloudinary image upload support
- Core API consistency

### Phase 2: Core Customer Experience
Goal: Support actual customer booking and payment flow.
Deliverables:
- Reservation booking
- Package recommendation
- Payment proof upload
- Waiver submission

### Phase 3: Operational Management
Goal: Support admin and staff running the business.
Deliverables:
- Reservation confirmation + gameplay automation
- Equipment, weapon, and maintenance management
- Player records and marshal/registrar processes

### Phase 4: Reporting and Monitoring
Goal: Support decision-making and compliance.
Deliverables:
- Reports and notifications
- Feedback tracking
- Donation and outreach reporting

### Phase 5: Advanced Automation and Expansion
Goal: Add business intelligence and future-facing capabilities.
Deliverables:
- Discount automation
- Team recommendation logic
- Walk-in support refinements
- Future PWA/mobile scaling

---

## Recommended Delivery Order
1. P0 items first: auth, MongoDB, validation, upload, reservation flow, payment, waiver.
2. P1 items next: admin operations, gameplay automation, equipment management, reporting.
3. P2 items after operational stability: donation tracking, discount logic, walk-in enhancements.
4. P3 items as optional roadmap items after the core product is stable.

---

## Definition of Done
A feature is considered done when:
- The frontend flow works end-to-end.
- The backend route saves and reads the correct MongoDB documents.
- Validation and error handling are in place.
- Admin or staff can complete the workflow without manual workarounds.
- Data is visible and consistent across related pages.
- The functionality is tested with realistic reservations, payments, and waiver scenarios.

---

## Core System Requirements Gap Checklist

Review baseline: 2026-10-20. Statuses below describe the implementation observed during the review; a UI screen or placeholder alone does not count as a complete workflow.

### 1. Reservation scheduler and rescheduling
- Status: Partial
- Existing: Customer booking supports Salawag, Langkaan, and Biñan, with dates, morning/afternoon/evening slots, public/private sessions, and availability indicators.
- Remaining:
  - Enforce public capacity and all field/slot conflicts on the server, including simultaneous booking attempts.
  - Make backend availability authoritative and keep UI availability in sync.
  - Add rescheduling requests by reservation ID, requested date/slot, and reason.
  - Enforce the three-day rescheduling deadline and apply eligible deposit credits to the replacement slot.
  - Confirm and configure capacity limits by location and slot; do not rely on UI-only hardcoded values.

### 2. Budget and rental recommendations
- Status: Partial
- Existing: The recommendation page filters configured packages by group size and budget.
- Remaining:
  - Use current inventory availability and persisted pricing in recommendations.
  - Explain why each recommendation fits and display total and per-player costs.
  - Do not recommend unavailable or unaffordable combinations.

### 3. Custom equipment selection
- Status: Partial
- Existing: Customers can select custom weapons and equipment, with some stock checks.
- Remaining:
  - Enforce equipment and weapon stock on the server at reservation creation.
  - Configure and price extra ammunition reloads.
  - Define and enforce allowed optics/scope classifications.
  - Confirm that selected equipment is held for the booking and released if it is cancelled.

### 4. Billing and pricing rules
- Status: Partial
- Existing: Shared package pricing supports entrance fees and configurable package discounts.
- Remaining:
  - Verify the ₱150 entrance fee and configure the ₱750 rental package with the required included items.
  - Add configurable prices for ammo reloads, late cancellations, field modifications, and damage.
  - Configure approved CvSU and other partnership discounts, with eligibility and calculations recorded.
  - Ensure the same authoritative pricing calculation is used at recommendation, reservation, and payment.

### 5. Registration, identity, and digital waivers
- Status: Partial
- Existing: Accounts, identity uploads, waiver forms, signatures, and waiver records are present.
- Remaining:
  - Ensure waiver data is securely linked to the verified user and relevant reservation.
  - Add appropriate duplicate, renewal, and review rules.
  - Restrict sensitive ID and waiver data to authorized roles.
  - Do not claim cryptographic binding unless an actual verifiable integrity mechanism is implemented and tested.

### 6. Player profiles and team balancing
- Status: Partial
- Existing: Profiles include experience and identity verification; waiver submissions capture age.
- Remaining:
  - Track validated age, experience/skill tier, ID status, and rental history for team recommendations.
  - Implement and test a documented balancing algorithm for public sessions.
  - Let marshals override assignments while preserving both the recommendation and final teams.
  - Link saved team assignments to the relevant gameplay/reservation.

### 7. Payment verification and receipts
- Status: Partial
- Existing: GCash proof upload, transaction references, payment records, and staff payment screens exist.
- Remaining:
  - Confirm and implement the approved ₱350 fixed deposit or 50% rental-package deposit rules.
  - Support the approved payment methods, including bank transfer and cash settlement where required.
  - Connect card payments to the configured payment provider and verify payment state server-side; never treat frontend-submitted status as proof of payment.
  - Provide registrar verification/rejection with an audit trail.
  - Generate printable receipts only for verified payments and record them in the financial ledger.

### 8. Rental inventory, chronograph, maintenance, and repairs
- Status: Partial
- Existing: Admin weapon/equipment inventory and basic maintenance statuses exist.
- Remaining:
  - Track the center's individual assets and partner-borrowed equipment.
  - Record the player assigned each asset and its return/condition state.
  - Record pre-game chronograph results and configurable FPS limits by weapon class.
  - Track damage, repair parts/costs, and approved penalties linked to the responsible player and bill.
  - Prevent maintained, damaged, or already-assigned assets from being issued.

### 9. Game preferences and field layout requests
- Status: Partial
- Existing: Reservation notes are available.
- Remaining:
  - Capture game modes and tactical layout/setup requests as structured reservation data.
  - Provide marshals with an advance view of requests and a preparation status.

### 10. Status notifications and email
- Status: Partial
- Existing: In-app notifications and email infrastructure for contact/auth workflows exist.
- Remaining:
  - Trigger in-app and email notifications from persisted reservation, payment, waiver, and booking-change workflows.
  - Add configured weather updates and pre-game reminders.
  - Log delivery failures and avoid reporting failed email as successfully sent.

### 11. Financial, operational, and audit reports
- Status: Partial
- Existing: Admin dashboard provides basic operational and revenue snapshots.
- Remaining:
  - Add date filters and daily, weekly, monthly, and yearly reports.
  - Include reservation, revenue, player, rental, penalty, and compliance metrics supported by persisted data.
  - Add print/export functionality and traceable calculations.
  - Ensure reports use complete filtered data rather than a fixed recent-record limit.

### 12. REACH outreach fund
- Status: Not implemented
- Acceptance criteria:
  - Configure the approved percentage/rules for qualifying net revenue; do not invent or hardcode an unapproved rate.
  - Record allocations and outreach spending in a separate, auditable ledger.
  - Include fund totals and transactions in admin reporting.

### 13. Customer feedback and evaluation
- Status: Not implemented
- Acceptance criteria:
  - Allow players to submit post-game ratings for reservation, cleanliness, equipment, field layout, and staff/marshal performance.
  - Link feedback to the player and completed gameplay/reservation.
  - Aggregate results for authorized admin review.

### 14. Recruitment and applications
- Status: Not implemented
- Acceptance criteria:
  - Publish open roles, job descriptions, and application requirements publicly.
  - Allow candidates to submit applications online.
  - Provide a protected staff review/status workflow for applicant records.

### 15. RBAC and responsive security
- Status: Partial
- Existing: Frontend role-based routes and server authentication/role middleware exist.
- Remaining:
  - Enforce permissions on every relevant API read and write; never trust a role or user ID supplied by the client.
  - Define and test least-privilege permissions for Super Admin, Registrar, Marshal, and Player.
  - Protect financial, identity, waiver, and audit data from unauthorized access.
  - Verify booking, payment, waiver, inventory, and admin workflows on mobile, tablet, and desktop.

## AI Implementation Prompt

Copy this prompt into an AI coding agent working in this repository:

> Inspect the existing Chill Shooters Airsoft Gaming Center codebase and `TODO.md`. Implement the remaining requirements in the “Core System Requirements Gap Checklist” section, reusing existing components, API patterns, and data models where appropriate. Do not replace the application or claim a feature is complete based only on a UI placeholder.
>
> First identify the relevant existing code and any business decisions that need confirmation. Do not invent business values such as capacities, deposit rules, penalty amounts, discount eligibility, FPS limits, or the REACH allocation rate; make them configurable and clearly report any value that requires owner approval.
>
> Implement in small, coherent phases, prioritizing server-side authorization, concurrency-safe booking and inventory validation, payment verification, and auditable data handling. Enforce permissions on the backend and never trust client-supplied roles or user IDs. Do not store card numbers or CVVs; use the configured payment provider and verify payment status server-side. Keep changes focused, type-safe, and consistent with the repository.
>
> Add or update tests for every implemented workflow, run relevant tests and the production build, and update this checklist's status only when the feature works end-to-end and has been verified. At the end, report changed files, tests/build results, required configuration or business decisions, and any remaining partial or blocked requirements. Do not create commits.
