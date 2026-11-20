# Chapter 1 Scope Checklist

Each item from **Chapter 1 – Scope and Limitations** of *Aim. Book. Play.*, checked against the system as of **November 20, 2026**.

**Status:** ✅ Done · 🟡 Done, with a note · ⬜ Still needed

## Summary

| Status | Count |
| --- | --- |
| ✅ Done | 36 |
| 🟡 Done, with a note | 4 |
| ⬜ Still needed | 2 |

## Branches and capacity

| # | Scope item | Status | In the system |
| --- | --- | --- | --- |
| 1 | Three branches (Salawag, Langkaan, BBC Airsoft Gamesite Biñan), each with Upper, Lower and Forest grounds | ✅ | Booking page, server field list |
| 2 | Salawag and Langkaan hold 400 players per session; Biñan holds 200 | ✅ | Server capacity settings, booking page, landing page |
| 3 | Rental sets per branch: Salawag 50, Langkaan 100, Biñan 50 | ✅ | Each rental piece has a branch, and each branch rents only its own pieces. Inventory: Salawag 50, Langkaan 100, Biñan 50 complete sets (M4 rifle, mask, vest); specialty gear at Salawag; BB ammo shared |
| 4 | One centralized database for all branches | ✅ | MongoDB |

## Reservations and scheduling

| # | Scope item | Status | In the system |
| --- | --- | --- | --- |
| 5 | Book by location, date and morning / afternoon / evening slot | ✅ | Book a game page |
| 6 | Public games on weekends; private games on weekdays | ✅ | Enforced by the server |
| 7 | Prevent double-booking and overcapacity; disable full schedules | ✅ | Locked check on every booking; full slots show "FULL"; rental shortages block the booking |
| 8 | Replaces Messenger and logbook booking | ✅ | Online booking with live availability |
| 9 | Pick game modes and request tactical field layouts | ✅ | Game setup step and field layout designer |
| 10 | Grounds assigned automatically from the headcount (no manual pick) | ✅ | Below 20 players: Upper. 20–49: Upper + Lower. 50+: all 3. Public games use the whole slot's headcount |
| 11 | Game preferences and grounds sent to marshals before the game | ✅ | Games and game queue pages |
| 12 | One-click reschedule from the dashboard, no Reservation ID or reason needed | ✅ | My Reservations |
| 13 | Reschedule only 3+ days before; down payment carries over and is non-refundable | ✅ | Enforced by the server |

## Billing, discounts and payments

| # | Scope item | Status | In the system |
| --- | --- | --- | --- |
| 14 | Itemized costs: entrance fees, packages, custom add-ons, extra BB reloads | ✅ | Calculated by the server |
| 15 | Admin-configured partner discounts (CvSU and other institutions) | 🟡 | Rates are set on the Partnerships page. Applied automatically **after** a registrar or admin approves the player's proof |
| 16 | Discounted total and remaining balance computed | ✅ | Booking summary and billing |
| 17 | Budget-based recommendation by budget and group size | 🟡 | Recommends **packages** within the budget. It doesn't build custom combinations |
| 18 | Packages have built-in bundle discounts (no promo codes) | ✅ | Rental Packages page |
| 19 | Custom loadout: rifles, pistols, gel blasters, vests, masks, extra BBs, or own gear, repriced live within stock | ✅ | Custom selection on the booking page |
| 20 | Pay online by card, GCash or QR Ph | ✅ | Stripe (cards) and Xendit (GCash, QR Ph) in **demo mode for the capstone**. No real money moves |
| 21 | Choose a 50% down payment or full payment | ✅ | Payment page |
| 22 | Online payments confirmed automatically; onsite balances recorded by registrars | ✅ | Payment gateways and the Counter page |
| 23 | Itemized billing statements and receipts generated | ✅ | Receipts (print / download) and billing summary in emails |

## Waivers and player profiles

| # | Scope item | Status | In the system |
| --- | --- | --- | --- |
| 24 | Online waiver, valid for 1 year once approved | ✅ | Waiver page; expires automatically after 365 days |
| 25 | Waivers stored with the profile; staff can print them | ✅ | Registrar Waivers page |
| 26 | Player profile: personal info, valid ID, age, reservation history, own gear, total games | ✅ | Player profile and My Weapons & Gear |
| 27 | Experience tiers: Beginner 0–10, Intermediate 11–25, Experienced 26+ | ✅ | Player stats card |
| 28 | Balanced teams by tier and age, using only checked-in players; marshals can adjust | ✅ | Team Grouping page |

## Notifications

| # | Scope item | Status | In the system |
| --- | --- | --- | --- |
| 29 | Emails: confirmation, billing summary, payment verification, waiver reminder, reschedule confirmation, game reminder | ✅ | Automatic emails; game reminder goes out the day before |

## Inventory, maintenance and penalties

| # | Scope item | Status | In the system |
| --- | --- | --- | --- |
| 30 | Tracks rifles, gel blasters, sidearms, protective gear, consumables and photoshoot replicas | ✅ | Weapons and Gear pages |
| 31 | Each item: rental history, availability, status, classification | ✅ | Rentals records and inventory pages |
| 32 | FPS limits: 450 regular, 550 sniper / VSR | ✅ | Chronograph (FPS) logs |
| 33 | Damage, loss and unreturned gear logged; item pulled from use; gunsmith repair log (issue, parts, date, cost, status) | 🟡 | Done. The status reads "Needs check" (weapons) or "Maintenance" (gear), not "Under Maintenance" |
| 34 | Penalty computed from repair / replacement cost and linked to the player's bill | ✅ | Penalty rules and damage reports |
| 35 | Ammunition tracked in bulk allocations per reservation | 🟡 | Packages include 2 reloads per player. BB stock is counted in **grams**, not rounds |

## Administration and reports

| # | Scope item | Status | In the system |
| --- | --- | --- | --- |
| 36 | Role-based access: admin, registrar, marshal, player | ✅ | Checked by the server on every request |
| 37 | Game-for-a-cause: beneficiary and donation % per event, kept separate in finances | ✅ | Cause days on the calendar; separate section in Reports |
| 38 | Post-game feedback: reservation, facilities, equipment, field, staff | ✅ | Game Evaluation (players), Player Feedback (admin) |
| 39 | Reports: daily / weekly / monthly / yearly, printable and exportable | ✅ | Reports page (print and CSV) |
| 40 | Responsive web app for phone, tablet and desktop | ✅ | Web app; no native mobile app |

## Limitations (correctly not built)

These are excluded by Chapter 1, and the system doesn't include them.

| Limitation | Status |
| --- | --- |
| No native Android / iOS app | ✅ Not built |
| Walk-ins only on weekends, only with own complete gear | ✅ Enforced |
| No supplier restocking, purchase orders, barcode or RFID | ✅ Not built |
| No POS hardware (receipt printers, cash drawers); chronograph testing is physical | ✅ Not built |
| No tax, payroll or BIR official receipts | ✅ Not built |
| ID verification API assists; unreadable IDs checked by registrars | ✅ Azure OCR (set up on Render) plus manual review |
| Marshals have final say on teams | ✅ Teams can be edited before saving |

## Still needed

| # | Task | Who |
| --- | --- | --- |
| 1 | **End-to-end browser test** of booking, walk-ins, rescheduling, payments, the Inbox reply and team grouping on phone and desktop | Team |
| 2 | **ISO/IEC 25010 evaluation** with end users and IT experts (Objective 6) | Team |

### Done

| Task | Result |
| --- | --- |
| Assign a branch to every rental piece | Salawag 50, Langkaan 100, Biñan 50 complete sets; specialty gear at Salawag |
| Render email settings | `EMAIL_FROM` and `TO_EMAIL` corrected |
| Payment gateway | Demo mode, by decision, for the capstone |
| ID verification | Azure keys set on Render |
