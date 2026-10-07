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
