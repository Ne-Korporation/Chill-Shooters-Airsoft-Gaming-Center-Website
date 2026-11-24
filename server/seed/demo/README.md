# Capstone demo database

Builds `chillshooters_demo`, a separate database with realistic, connected demo data:
months of history, today's games, and the next few weeks. The production database
(`chillshootersgamecenter`) is only **read** (to copy the business setup) and is never changed.

## Commands (from the project root)

| Command | What it does |
|---|---|
| `npm run demo:plan` | Shows what is kept, cleared and generated. Changes nothing. |
| `npm run demo:seed` | Backs up the production database to `server/backups/` (JSON, git-ignored), then rebuilds `chillshooters_demo` from scratch, seeds it and validates it (about 5 minutes). |
| `npm run demo:validate` | Re-runs the consistency checks on the demo database. |
| `npm run demo:server` | Starts the API on the demo database (port 3001). Add `-- --no-email` to send no emails. |

Run the site on the demo: `npm run demo:server` in one terminal, `npm run dev` in another.

**Re-seed on the morning of the defense.** The demo is built around the moment it runs:
today's games (finished, in play, or later today), payment windows still open, upcoming
bookings. The data is the same on every run; only the dates move with the current day.

### Options (`node server/seed/demo/index.js …`)

- `--confirm chillshooters_demo` is required to change anything. The target name must contain
  `demo`, and the script refuses the production database.
- `--files-base <url>` is the address of the API that will serve the demo images (ID photos,
  GCash receipts, posters). The default is `http://localhost:3001`. If the deployed API runs on
  the demo database, seed with `--files-base https://chill-shooters-api.onrender.com` and set
  `DB_NAME=chillshooters_demo` on Render.
- `--no-backup` skips the backup (not recommended).

## Demo logins

Every demo account uses the password **`ChillDemo2026!`**. Emails end in `@demo.chillshooters.test`
(a reserved domain, so app emails never reach anyone). The existing `admin@`, `registrar@` and
`marshal@chillshooters.com` accounts are copied over with their current passwords.

| Role | Email (before `@demo.chillshooters.test`) | Shows |
|---|---|---|
| Admin (owner) | `ricardo.villanueva` | Dashboards, reports, donation fund, expenses |
| Registrar | `liza.manalo` | Counter payments, check-in, ID, waiver and CvSU review |
| Marshal | `jomar.bautista`, `kevin.soriano` | Games board, rentals, FPS checks, repairs |
| Player (regular) | `juan.delacruz`, `marco.santos` | Long booking history, receipts, feedback |
| Player (CvSU, verified) | `miguel.ocampo`, `alyssa.dizon`, `renz.manalastas`, `trisha.galang`, `kenneth.sison` | 10% discount; a team split payment in progress |
| Player (CvSU request) | `jasmine.velasco` (pending), `lance.bernardo` (rejected) | Partnership review |
| Parent with minors | `vincent.tan` (2 children), `grace.torres` (1), `dennis.castillo` (child's waiver pending) | Minors, guardian approvals |
| Own gear | `paolo.garcia`, `rafael.aquino`, `jerome.salazar` | Registered guns, Hybrid bookings |
| Account states | `sean.fernandez` (ID waiting for review), `ella.javier` (ID rejected), `louie.panganiban` (waiver and ID expired), `tomas.herrera` (suspended: cannot log in) | Review queues, expiry |
| New player | `nicole.aguilar` | First booking, paid online (gateway) |

## Files

- `index.js`: entry point, safety checks, backup, copy of the business setup, orchestration.
- `people.js`: staff, players, children, ID verification, CvSU requests, waivers.
- `bookings.js`: reservations, payments, games, check-ins, teams, rentals, FPS checks, damage,
  repairs, receipts, feedback. Uses the server's own pricing, split-share and inventory functions.
- `extras.js`: cause and closed days, expenses, donation fund, partner loans, announcements,
  messages, notifications, weather advisories, audit log.
- `validate.js`: the consistency checks.
- `serve.js`: starts the API on the demo database.

Every generated document carries `demoSeed: true`.
