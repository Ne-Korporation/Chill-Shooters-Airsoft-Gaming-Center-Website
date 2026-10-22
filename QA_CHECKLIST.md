# QA Checklist

Status from manual testing, updated after the fix pass.
`[x]` = verified working · `[~]` = fixed/built in code, **needs re-test in the app** · `[ ]` = still open

## 1. Registration & Login

- [~] Create new user account — the API works locally (account created, OTP email accepted by Brevo). If it still fails on the live site, note the exact error message. Also fixed: new user IDs could duplicate an existing ID after a deletion.
- [~] Sign up with Google — the server now verifies the Google token (before, anyone could sign in as any Google user by sending just an email). If it still fails, check that the site's domain is listed under Firebase → Authentication → Authorized domains, and note the error.
- [x] Admin email login
- [x] Marshal email login
- [~] Registrar email login — no code bug; the password is unknown. Admin → Users → Reset password on the registrar shows a new password. Only admins can now reset staff passwords.
- [x] Centralized Administrative Portal

## 2. Reservation

- [x] Time slot selection
- [x] Session type selection
- [~] Teammates and payment (user side) — **this was the blocker for most items below.** Players couldn't see other players' waivers, so every teammate showed "waiver not approved", and a booking needed exactly players − 1 teammates. Teammates are now optional (empty spots count as walk-ins), and approval status comes from the server.
- [~] Package recommendation — packages priced per player never matched groups larger than 1. Private-session quotes also used 1.25× while the server charges 1×.
- [~] Conflict / capacity engine — the client counter now matches the server's per-location/slot capacity and refreshes every minute and when the tab regains focus. The server already enforces this in a transaction.
- [~] Customizable gameplay reference — new: preferred game mode and field layout request in booking step 2; shown to marshals on the Games page.
- [~] Rescheduling — new **My Reservations** page (player sidebar). Reschedule at least 3 days before the game; the server re-checks capacity and field conflicts; the deposit carries over; history is recorded; the gameplay schedule follows.

## 3. Billing & Payments

- [x] Automated billing and pricing engine
- [~] Budget-based package recommendation — same fix as 2.
- [~] Payment verification & upload portal — unblocked by item 2. Uploads now require login (they were open to anyone). A stale reservation ID from a failed earlier attempt is no longer reused.
- [~] Digital receipt generation — **Print receipt** on My Reservations once a payment is verified (only verified payments are listed).
- [~] Partnership discount management — new: players request the CvSU discount on their Profile with a school-ID photo; admins Verify/Reject at the top of Users. Before, nothing could ever mark a player verified, so the discount never applied.

## 4. Waivers & Security

- [x] Digital waiver processing
- [x] Secure database binding

## 5. Players & Teams

- [x] Centralized player database
- [ ] Dynamic team balancing recommendation engine — unblocked by item 2; re-test. Not reviewed in this pass.

## 6. Inventory

- [x] Rental inventory database
- [x] Equipment assignment tracking
- [~] FPS safety log management — new **Safety Logs** page (marshal + admin): chronograph readings vs. AEG 450 / sniper 550 FPS. A failing center weapon moves to the maintenance queue.
- [~] Partner equipment income-sharing records — Partnerships has a new "Equipment partner" type with a share %. Weapons/Equipment forms have "Owned by partner". The Partnerships page shows rental income, the partner's share, and per-rental detail. **Owner must confirm the share %.**

## 7. Maintenance

- [x] Maintenance tracking database
- [~] Automated damage penalty billing — Safety Logs → Damage reports: marshals file a report (item goes to maintenance); an admin sets the approved amount and bills it to the reservation (added to total and balance, player emailed) or waives it. No fee is hard-coded.

## 8. REACH Fund

- [~] REACH fund calculation — new **REACH Fund** page (admin): set the owner-approved rate, then allocate from collected payments (each payment only once). **Rate is unset until the owner decides.**
- [~] Donation financial isolation — a separate ledger for allocations, donations and spending; never counted in revenue reports; spending can't exceed the balance.

## 9. Notifications

- [~] Automated email notification dispatch engine — new emails: reservation received / confirmed / needs review / cancelled / rescheduled, payment verified / rejected, damage charge. Each send is logged in `email_log` with sent/failed and de-duplicated. The contact form now falls back to the same mail service.

## 10. Reports

- [~] Operational & financial report generation — Daily / Weekly / Monthly / Yearly / Custom filters; loads all records (not just the first 200). Revenue counts only verified payments (before, it counted pending and rejected ones too).
- [~] Printable & exportable reports — Print / PDF and Export CSV buttons on Reports.

## 11. Feedback

- [~] Online evaluation form — it existed as "Game Feedback" but only appears after a completed game. Renamed **Game Evaluation**; dropdowns fixed.

## Cleanup

- [ ] Delete test account `qa-test-reg-001@example.com` from `user_accounts` (created while testing registration).
