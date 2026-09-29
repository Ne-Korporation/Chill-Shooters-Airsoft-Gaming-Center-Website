# Stripe Card Payment Integration Plan

## Information Gathered

### Current State
- **PaymentPage.tsx**: Has two payment methods - "GCash" (manual QR upload) and "Bank Transfer" (collects raw Card Number, CVV, Expiry directly — NOT PCI-compliant)
- **Server**: Express.js backend with MongoDB, already has `stripe` package in `package.json` (v22.3.2)
- **API Client**: Uses `fetch` wrapper (`apiClient.ts`) for all HTTP calls
- **Components**: Custom `Card`, `Button`, `Input` UI components with glass/styled theme
- **Styling**: Dark/light theme via CSS variables, Tailwind CSS, framer-motion for animations

### Existing Payment Flow
1. User fills reservation form → stored in `localStorage` as `pending_reservation`
2. PaymentPage reads from localStorage, shows breakdown
3. On submit: uploads proof (GCash) → creates reservation via `/api/reservations` → creates payment via `/api/payments`
4. Payment status is set to "pending" for registrar review

### Dependencies Already Available
- `stripe` (v22.3.2) — server-side Stripe SDK already installed
- No client-side Stripe packages yet (`@stripe/react-stripe-js`, `@stripe/stripe-js`)

### Key Issue with User's Keys
- Both "publishable key" and "secret key" provided are identical `pk_test_...` keys
- A Stripe **secret key** should start with `sk_test_...`
- Will need the actual secret key (`sk_test_...`) for server-side PaymentIntent creation

## Plan

### Step 1: Install Client-Side Stripe Dependencies
- Install `@stripe/react-stripe-js` and `@stripe/stripe-js`

### Step 2: Create Server-Side Stripe PaymentIntent Endpoint
- Add a new endpoint `POST /api/create-payment-intent` in `server/routes/paymentsWorkflows.js` (or a new file)
- Uses `stripe.paymentIntents.create()` with the amount from the reservation
- Returns `clientSecret` to the frontend
- Requires `STRIPE_SECRET_KEY` environment variable

### Step 3: Update PaymentPage.tsx to Integrate Stripe
- Replace the insecure "Bank Transfer" card fields with Stripe Elements (`CardElement` or `PaymentElement`)
- Import `Elements`, `useStripe`, `useElements` from `@stripe/react-stripe-js`
- Wrap the Stripe card form in `<Elements>` provider with publishable key
- On submit: create PaymentIntent via backend → confirm card payment via Stripe → create reservation/payment records
- Keep the GCash flow unchanged

### Step 4: Environment Variables
- Add `VITE_STRIPE_PUBLISHABLE_KEY` to frontend (in `.env`)
- Add `STRIPE_SECRET_KEY` to server (in `.env`)
- Note: User needs to provide actual `sk_test_...` secret key

### Step 5: Handle Payment Confirmation Flow
- After Stripe confirms payment → create reservation → create payment with status "paid" (instead of "pending")
- This streamlines the flow for card payments since Stripe handles verification

## Files to be Edited
1. **package.json** — Add `@stripe/react-stripe-js`, `@stripe/stripe-js` to dependencies
2. **server/routes/paymentsWorkflows.js** — Add Stripe PaymentIntent endpoint
3. **src/pages/payments/PaymentPage.tsx** — Replace Bank Transfer with Stripe Elements
4. **server/index.js** — Possibly load Stripe config (or inline in route)

## Follow-up Steps
1. Install npm packages
2. Test that Stripe Elements render correctly
3. Test end-to-end payment flow

## Note to User
Please confirm: The "secret key" you provided appears to be the same as the publishable key. A Stripe secret key starts with `sk_test_...`. Could you provide the correct secret key for server-side operations?

