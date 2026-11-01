# STK Pay

A self-hosted payment checkout built for Kenyan businesses. Customers can pay with M-Pesa, Airtel Money, a bank card, or an M-Pesa Paybill, while every transaction is recorded in a ledger you control.

The app is built with Next.js 15 and React 19, uses Paystack for payment processing, and runs on Cloudflare Workers with D1 for storage. It ships with a responsive checkout, dark and light themes, live payment status polling, and a transaction view for following up on pending Paybill payments.

## Features

- **M-Pesa STK Push** — send a payment prompt straight to the customer's phone.
- **Airtel Money** — collect payments through Paystack's mobile money channel.
- **Card payments** — Paystack's secure inline checkout, with server-side verification of the reference, amount, and currency.
- **Paybill (pay later)** — generate Paybill details for offline payment and track the transaction until it is settled.
- **OTP and date-of-birth challenges** — handle the extra verification steps Paystack may request for a charge.
- **Transaction ledger** — browse, filter, and manually confirm payments from the Transactions tab.
- **Webhook support** — keep the ledger in sync with signed `charge.success` and `charge.failed` events.
- **Pending payment tracking** — unfinished Paybill payments are kept in the browser so customers can come back and check them.
- **Thoughtful UI** — responsive layout, light/dark mode, keyboard-friendly forms, and clear success, failure, and timeout states.

## Tech stack

| Layer | Technology |
| --- | --- |
| Framework | Next.js 15 (App Router) |
| UI | React 19, Tailwind CSS 4 |
| Language | TypeScript |
| Payments | Paystack Charge API and Inline checkout |
| Storage | Cloudflare D1 (SQLite) |
| Hosting | Cloudflare Workers via `@opennextjs/cloudflare` |

## Why Workers instead of Pages

Cloudflare Pages' Next.js adapter (`@cloudflare/next-on-pages`) is deprecated, and Pages cannot run the native SQLite driver this project originally used. Cloudflare's supported path for Next.js is Workers with the OpenNext adapter, with D1 providing a managed SQLite-compatible database. This project has been set up for that path.

## Requirements

- Node.js 22 or newer
- npm
- A Cloudflare account with Wrangler authenticated
- A Paystack account with KES payments enabled
- A publicly reachable HTTPS URL for webhooks (production)

## Getting started

Install dependencies:

```bash
npm install
```

Create the D1 database:

```bash
npx wrangler d1 create stk-pay-db
```

Wrangler prints a `database_id`. Replace the placeholder in `wrangler.jsonc` with that value.

Create a `.dev.vars` file from the example and fill in your keys:

```bash
cp .dev.vars.example .dev.vars
```

```dotenv
NEXTJS_ENV=development
NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY=pk_test_xxxxxxxxxxxxxxxxx
PAYSTACK_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxx
PAYSTACK_WEBHOOK_SECRET=sk_test_xxxxxxxxxxxxxxxxx
```

Apply the database migration locally:

```bash
npm run db:migrate:local
```

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The app does not read `process.env`. Server code reads Cloudflare bindings through `getCloudflareContext().env` in `src/lib/env.ts`, and the browser gets the Paystack public key from `/api/config`.

> Paystack cannot reach `localhost`. To test webhooks locally, expose the app with a tunnel such as ngrok or cloudflared and use the public `/api/webhook` URL in your Paystack dashboard.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | For card payments | Returned to the browser by `/api/config` for the Paystack inline checkout. Public by design. |
| `PAYSTACK_SECRET_KEY` | Yes | Authenticates server-side requests to the Paystack API. Also used to verify webhook signatures when no separate webhook secret is set. |
| `PAYSTACK_WEBHOOK_SECRET` | Optional | Overrides `PAYSTACK_SECRET_KEY` for webhook signature verification. Paystack signs webhooks with your secret key, so if you set this, use the same value. |
| `NEXTJS_ENV` | Local only | Tells OpenNext which Next.js env file to load when developing. |

Webhook requests must include a valid `x-paystack-signature` header. If the signature is missing or invalid, the request is rejected.

## Available scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Next.js development server with local Cloudflare bindings. |
| `npm run build` | Create a standard Next.js production build. |
| `npm run start` | Serve the Next.js build locally. API routes need Cloudflare bindings, so use `npm run preview` for runtime testing. |
| `npm run lint` | Run Next.js linting. |
| `npm run preview` | Build with OpenNext and run the app in the local Workers runtime. |
| `npm run deploy` | Build with OpenNext and deploy the Worker to Cloudflare. |
| `npm run upload` | Build and upload a new Worker version without deploying it. |
| `npm run cf-typegen` | Generate binding types into `worker-configuration.d.ts`. |
| `npm run db:migrate:local` | Apply D1 migrations to the local database. |
| `npm run db:migrate:remote` | Apply D1 migrations to the deployed database. |

## How payments flow

### M-Pesa and Airtel Money

1. The customer enters their name, phone number, and amount.
2. The browser posts to `/api/charge`, which asks Paystack to initiate a mobile money charge.
3. The customer approves the STK prompt on their phone.
4. The checkout polls `/api/verify-charge` every five seconds, for up to three minutes, until Paystack reports success, failure, or timeout.
5. If Paystack requests an OTP or date of birth, the customer completes that step in the checkout and the app forwards it to Paystack.

### Card

1. The browser fetches the public key from `/api/config` and opens the Paystack inline checkout.
2. Paystack processes the card and returns a transaction reference.
3. The server verifies that reference with Paystack and confirms the amount and currency match the checkout before recording the payment.
4. Card details never touch this application.

### Paybill

1. The customer chooses Paybill and submits their details.
2. Paystack returns a Paybill number and account reference, which the checkout displays with copy buttons and payment instructions.
3. The transaction is saved in D1 as pending.
4. The customer can pay later from their M-Pesa menu. Once paid, it can be confirmed with **Check payment status** or manually from the Transactions tab.

All amounts sent to Paystack are in the currency's minor unit, so a KES 1,500.00 charge is sent as `150000`. The ledger stores amounts in KES.

## API routes

| Route | Method | Description |
| --- | --- | --- |
| `/api/config` | `GET` | Return the Paystack public key for card checkout. |
| `/api/charge` | `POST` | Initiate a mobile money charge through Paystack. |
| `/api/verify-charge` | `POST` | Check the status of a pending charge by reference. |
| `/api/verify-card` | `POST` | Verify a completed card transaction and record it. |
| `/api/submit-otp` | `POST` | Submit an OTP for a charge that requires one. |
| `/api/submit-birthday` | `POST` | Submit a date of birth for a charge that requires it. |
| `/api/paybill` | `GET` | List transactions, or fetch one with `?reference=`. Filter with `?status=pending\|paid\|failed`. |
| `/api/paybill` | `POST` | Record, confirm, or update a transaction using an `action` of `record`, `confirm`, or `update`. |
| `/api/webhook` | `POST` | Receive signed Paystack `charge.success` and `charge.failed` events. |

## Database

Storage lives in Cloudflare D1. The schema is managed by `migrations/0001_create_transactions.sql`, which creates the `transactions` table and a status index.

Transactions are stored in a single `transactions` table:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | integer | Primary key |
| `reference` | text | Unique Paystack reference |
| `phone` | text | Customer phone number |
| `amount` | real | Amount in KES |
| `customer_name` | text | Customer name |
| `email` | text | Customer email |
| `payment_method` | text | `mpesa`, `airtel`, `card`, or `mpesa_offline` |
| `account_number` | text | Paybill number, when applicable |
| `account_reference` | text | Paybill account reference, when applicable |
| `status` | text | `pending`, `paid`, or `failed` |
| `created_at` | text | Creation timestamp |
| `updated_at` | text | Last update timestamp |
| `confirmed_at` | text | Payment confirmation timestamp |
| `notes` | text | Human-readable status notes |

The old local SQLite file in `data/payments.db` is no longer read by the application. If you need its records, export them and import them into D1 before switching over. If that file contains real customer data, remove it from version control.

## Project structure

```
src/
├── app/
│   ├── api/
│   │   ├── charge/           # Initiate Paystack charges
│   │   ├── config/           # Runtime public configuration
│   │   ├── paybill/          # D1 transaction ledger
│   │   ├── submit-birthday/  # Charge verification challenge
│   │   ├── submit-otp/       # Charge verification challenge
│   │   ├── verify-card/      # Card payment verification
│   │   ├── verify-charge/    # Charge status polling
│   │   └── webhook/          # Signed Paystack webhook handler
│   ├── globals.css           # Tailwind theme tokens and base styles
│   ├── layout.tsx            # Root layout, fonts, metadata, theme
│   └── page.tsx              # Checkout and transactions UI
├── components/
│   └── ThemeToggle.tsx
├── contexts/
│   └── ThemeContext.tsx
└── lib/
    ├── db.ts                 # D1 transaction queries
    ├── env.ts                # Cloudflare binding access
    └── paystack.ts           # Paystack API client
migrations/
└── 0001_create_transactions.sql
cloudflare-env.d.ts           # Binding and secret types
open-next.config.ts           # OpenNext configuration
wrangler.jsonc                # Worker, assets, and D1 bindings
```

## Deploying to Cloudflare

1. Sign in to Wrangler:

   ```bash
   npx wrangler login
   ```

2. Create the production D1 database if you have not already:

   ```bash
   npx wrangler d1 create stk-pay-db
   ```

3. Put the returned `database_id` into `wrangler.jsonc`.

4. Apply the migration to the remote database:

   ```bash
   npm run db:migrate:remote
   ```

5. Set the runtime values on the Worker:

   ```bash
   npx wrangler secret put PAYSTACK_SECRET_KEY
   npx wrangler secret put NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY
   ```

   The public key is not sensitive, so you can also add it under `vars` in `wrangler.jsonc` if you prefer. You do not need to set `PAYSTACK_WEBHOOK_SECRET`; the app falls back to `PAYSTACK_SECRET_KEY`, which is what Paystack uses to sign webhooks. If you set it anyway, use the same secret key value.

6. Deploy:

   ```bash
   npm run deploy
   ```

7. Point the Paystack webhook at `https://your-domain.com/api/webhook`.

Run `npm run preview` before deploying if you want to test the exact Workers runtime locally.

## Going live

1. **Protect the ledger endpoints.** In this version, `/api/paybill` is unauthenticated. Anyone who can reach it can list transactions or manually confirm a payment. Put it behind authentication or restrict access at the network level.
2. **Use HTTPS.** Card checkout and webhooks should only run over TLS.
3. **Keep secrets server-side.** Only the public key belongs in the browser. Store the secret key and webhook secret with `wrangler secret`.
4. **Review your Paystack settings.** Confirm the business name, currency (KES), and allowed payment channels match what the checkout offers.
5. **Back up D1.** Use Cloudflare's export tools or `wrangler d1 export` before major changes.

## Troubleshooting

- **`D1 binding "DB" is not configured`** — create the D1 database, update `wrangler.jsonc`, and restart the dev server.
- **`no such table: transactions`** — run `npm run db:migrate:local` or `npm run db:migrate:remote`.
- **`Server misconfigured`** — `PAYSTACK_SECRET_KEY` is missing from your Cloudflare bindings.
- **Card checkout says it is not configured** — `/api/config` could not find `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`.
- **Webhook returns 401** — the signature is missing or the secret does not match the one Paystack used.
- **Bindings are missing during local development** — make sure `initOpenNextCloudflareForDev()` runs in `next.config.ts` and that `.dev.vars` exists.
