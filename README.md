# Chill Shooters Airsoft Gaming Center

**Aim. Book. Play.**

A web-based reservation and operations management system designed for airsoft gaming centers.

---

# About the System

Chill Shooters Airsoft Gaming Center streamlines the entire player journey—from booking a reservation to managing game-day operations.

The system allows players to reserve game schedules, select packages, submit digital waivers, upload payment proofs, and track their reservations online. Staff members can efficiently manage reservations, payments, inventory, and game sessions through dedicated dashboards.

There are four user roles in the system:

- Player
- Registrar
- Marshal
- Admin

---

# Features

## Player

- Create an account with OTP email verification
- Log in using Email or Google
- Reserve game schedules
- Choose fields and packages
- Submit digital waivers
- Upload payment proofs
- View reservation history
- Manage profile

## Registrar

- Process reservations
- Verify payments
- Review submitted waivers
- Manage player records

## Marshal

- Monitor game sessions
- Manage equipment
- Manage weapons
- Update game status

## Admin

- Dashboard analytics
- User management
- Reservation management
- Inventory management
- Payment verification
- Waiver approval
- Reports
- Notifications
- Audit logs

---

# Technology Stack

## Frontend

- React
- TypeScript
- Vite
- Tailwind CSS
- React Router
- Framer Motion
- Firebase Authentication

## Backend

- Express.js
- MongoDB
- Nodemailer
- Cloudinary
- Stripe (Optional, test mode only — PayMongo is the planned production gateway)

---

# System Requirements

- Node.js 18 or higher
- npm 9 or higher
- MongoDB
- Firebase Project
- SMTP Email
- Cloudinary (Optional)
- Stripe Account (Optional)

---

# Installation

## 1. Clone the Repository

```bash
git clone <repository-url>
cd Chill-Shooters-Airsoft-Gaming-Center-Website
```

## 2. Install Dependencies

```bash
npm install
```

## 3. Configure Environment Variables

Create a `.env` file and add your credentials for:

- MongoDB (shared URI, not `mongodb://localhost:27017/`)
- Email (SMTP)
- Firebase
- Stripe (Optional, test mode only — PayMongo is the planned production gateway)
- Cloudinary (Optional)

## 4. Start MongoDB

Use a shared MongoDB instance such as MongoDB Atlas, then set `MONGODB_URI` in your `.env` file.

Example:

```bash
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/<db>?retryWrites=true&w=majority
```

## 5. Seed Demo Data (Optional)

```bash
node server/seed/seed.js
```

### Demo Accounts

| Role | Email | Password |
|------|-------|----------|
| Player | player@demo.com | player |
| Registrar | registrar@demo.com | registrar |
| Marshal | marshal@demo.com | marshal |
| Admin | admin@demo.com | admin |

## 6. Run the Application

Start the backend:

```bash
npm run server
```

Start the frontend:

```bash
npm run dev
```

Open your browser and go to:

```
http://localhost:5173
```

---

# How to Use

## Player Workflow

1. Create an account.
2. Verify your email using the OTP.
3. Log in.
4. Book a reservation.
5. Select a package and schedule.
6. Complete the digital waiver.
7. Upload your payment proof.
8. Wait for reservation approval.
9. Enjoy your game.

## Staff Workflow

### Registrar

- Review reservations
- Verify payments
- Approve waivers

### Marshal

- Prepare equipment
- Monitor ongoing games
- Update game status

### Admin

- Manage users
- Manage reservations
- Manage inventory
- View reports and analytics
- Send notifications

---

# Project Structure

```
server/
├── db/
├── routes/
├── services/
├── seed/

src/
├── components/
├── context/
├── layouts/
├── pages/
├── routes/
├── styles/
├── utils/

public/
```

---

# Available Commands

| Command | Description |
|----------|-------------|
| npm run dev | Start the frontend |
| npm run server | Start the backend |
| npm run build | Build the production version |
| npm run preview | Preview the production build |

---

# Deployment

The repository includes deployment configuration for a Vite frontend on Vercel and
an Express API on Render:

- Import the repository into Render. The `render.yaml` Blueprint installs
  dependencies, starts the API, and checks `/api/health`. Set the prompted
  `MONGODB_URI`; `AUTH_SECRET` is generated automatically. Add optional email,
  Cloudinary, Stripe, or Azure credentials in the Render service environment if
  those features are needed.
- Import the repository into Vercel with the project root as the root directory,
  `npm run build` as the build command, and `dist` as the output directory.
  Configure `VITE_API_URL` to the Render service's base URL, without a trailing
  slash or `/api`, then redeploy. `vercel.json` supplies the SPA route fallback.
- Use `.env.example` as the local environment-variable template. Do not commit
  populated `.env` files or deploy credentials in frontend variables.

---

# API Overview

## Authentication

- Register
- Login
- Google Login
- Send OTP
- Verify OTP
- Reset Password

## CRUD Operations

- GET
- POST
- PUT
- DELETE

---

# Team Members

| Name | Role |
|------|------|
| Team Member | Team Leader |
| Team Member | Backend Developer |
| Team Member | Frontend Developer |
| Team Member | UI/UX Designer |
| Team Member | QA Tester |

---

**Chill Shooters Airsoft Gaming Center**

*Aim. Book. Play.*