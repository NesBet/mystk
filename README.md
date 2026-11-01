# STK Pay

A self-hosted payment checkout built for Kenyan businesses. Customers can pay with M-Pesa, Airtel Money, a bank card, or an M-Pesa Paybill, while every transaction is recorded in a local ledger you control.

The app is built with Next.js 15 and React 19, uses Paystack for payment processing, and stores transaction data in SQLite. It ships with a responsive checkout, dark and light themes, live payment status polling, and a transaction view for following up on pending Paybill payments.

## Features

- **M-Pesa STK Push** — send a payment prompt straight to the customer's phone.
- **Airtel Money** — collect payments through Paystack's mobile money channel.
- **Card payments** — Paystack's secure inline checkout, with server-side verification of the reference, amount, and currency.
- **Paybill (pay later)** — generate Paybill details for offline payment and track the transaction until it is settled.
- **OTP and date-of-birth challenges** — handle the extra verification steps Paystack may request for a charge.
- **Transaction ledger** — browse, filter, and manually confirm payments from the Transactions tab.
- **Webhook support** — keep the ledger in sync with `charge.success` and `charge.failed` events.
- **Pending payment tracking** — unfinished Paybill payments are kept in the browser so customers can come back and check them.
- **Thoughtful UI** — responsive layout, light/dark mode, keyboard-friendly forms, and clear success, failure, and timeout states.

## Tech stack

| Layer | Technology |
| --- | --- |
| Framework | Next.js 15 (App Router) |
| UI | React 19, Tailwind CSS 4 |
| Language | TypeScript |
| Payments | Paystack Charge API and Inline checkout |
| Storage | SQLite via `better-sqlite3` |

## Requirements

- Node.js 22 or newer (`better-sqlite3` 13 requires it)
- npm
- A Paystack account with KES payments enabled
- A publicly reachable HTTPS URL for webhooks (production)

## Getting started

Install dependencies:

```bash
npm install
```

Create a `.env.local` file in the project root:

```dotenv
NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY=pk_test_xxxxxxxxxxxxxxxxx
PAYSTACK_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxx
PAYSTACK_WEBHOOK_SECRET=sk_test_xxxxxxxxxxxxxxxxx
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | For card payments | Loads the Paystack inline checkout in the browser. Public by design. |
| `PAYSTACK_SECRET_KEY` | Yes | Authenticates server-side requests to the Paystack API. Never expose this to the client. |
| `PAYSTACK_WEBHOOK_SECRET` | Recommended | Used to validate the `x-paystack-signature` header on incoming webhooks. Signature checks are skipped when this is unset. |

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

> Paystack cannot reach `localhost`. To test webhooks locally, expose the app with a tunnel such as ngrok or cloudflared and use the public `/api/webhook` URL in your Paystack dashboard.

## Available scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the development server. |
| `npm run build` | Create a production build. |
| `npm run start` | Serve the production build. |
| `npm run lint` | Run Next.js linting. |

## How payments flow

### M-Pesa and Airtel Money

1. The customer enters their name, phone number, and amount.
2. The browser posts to `/api/charge`, which asks Paystack to initiate a mobile money charge.
3. The customer approves the STK prompt on their phone.
4. The checkout polls `/api/verify-charge` every five seconds, for up to three minutes, until Paystack reports success, failure, or timeout.
5. If Paystack requests an OTP or date of birth, the customer completes that step in the checkout and the app forwards it to Paystack.

### Card

1. The browser loads the Paystack inline script and opens the card checkout with the public key.
2. Paystack processes the card and returns a transaction reference.
3. The server verifies that reference with Paystack and confirms the amount and currency match the checkout before recording the payment.
4. Card details never touch this application.

### Paybill

1. The customer chooses Paybill and submits their details.
2. Paystack returns a Paybill number and account reference, which the checkout displays with copy buttons and payment instructions.
3. The transaction is saved locally as pending.
4. The customer can pay later from their M-Pesa menu. Once paid, it can be confirmed with **Check payment status** or manually from the Transactions tab.

All amounts sent to Paystack are in the currency's minor unit, so a KES 1,500.00 charge is sent as `150000`. The local ledger stores amounts in KES.

## API routes

| Route | Method | Description |
| --- | --- | --- |
| `/api/charge` | `POST` | Initiate a mobile money charge through Paystack. |
| `/api/verify-charge` | `POST` | Check the status of a pending charge by reference. |
| `/api/verify-card` | `POST` | Verify a completed card transaction and record it. |
| `/api/submit-otp` | `POST` | Submit an OTP for a charge that requires one. |
| `/api/submit-birthday` | `POST` | Submit a date of birth for a charge that requires it. |
| `/api/paybill` | `GET` | List transactions, or fetch one with `?reference=`. Filter with `?status=pending\|paid\|failed`. |
| `/api/paybill` | `POST` | Record, confirm, or update a transaction using an `action` of `record`, `confirm`, or `update`. |
| `/api/webhook` | `POST` | Receive Paystack `charge.success` and `charge.failed` events. |

## Database

The first request that needs storage creates `data/payments.db` automatically. The app enables WAL mode, so SQLite also creates `data/payments.db-wal` and `data/payments.db-shm`.

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

The database is persistent local storage. Back it up before deploying changes, and make sure the `data/` directory is on a persistent volume. The repository currently tracks an existing database file; for real deployments, keep customer transaction data out of version control.

## Project structure

```
src/
├── app/
│   ├── api/
│   │   ├── charge/           # Initiate Paystack charges
│   │   ├── paybill/          # Local transaction ledger
│   │   ├── submit-birthday/  # Charge verification challenge
│   │   ├── submit-otp/       # Charge verification challenge
│   │   ├── verify-card/      # Card payment verification
│   │   ├── verify-charge/    # Charge status polling
│   │   └── webhook/          # Paystack webhook handler
│   ├── globals.css           # Tailwind theme tokens and base styles
│   ├── layout.tsx            # Root layout, fonts, metadata, theme
│   └── page.tsx              # Checkout and transactions UI
├── components/
│   └── ThemeToggle.tsx
├── contexts/
│   └── ThemeContext.tsx
└── lib/
    ├── db.ts                 # SQLite setup and transaction queries
    └── paystack.ts           # Paystack API client
data/
└── payments.db               # Local ledger (created automatically)
```

## Going live

A few things are worth doing before you accept real payments:

1. **Set the webhook URL.** In the Paystack dashboard, point the webhook to `https://your-domain.com/api/webhook` and set `PAYSTACK_WEBHOOK_SECRET` to validate incoming signatures.
2. **Protect the ledger endpoints.** In this version, `/api/paybill` is unauthenticated. Anyone who can reach it can list transactions or manually confirm a payment. Put it behind authentication or restrict access at the network level.
3. **Use HTTPS.** Card checkout and webhooks should only run over TLS.
4. **Use persistent storage.** Serverless platforms with ephemeral filesystems will lose the SQLite database between deployments. Use a persistent volume or move the ledger to a hosted database.
5. **Keep secrets server-side.** Only the public key belongs in the browser. Never prefix the secret key or webhook secret with `NEXT_PUBLIC_`.
6. **Review your Paystack settings.** Confirm the business name, currency (KES), and allowed payment channels match what the checkout offers.

## Troubleshooting

- **`Server misconfigured`** — `PAYSTACK_SECRET_KEY` is missing from the environment.
- **Card checkout will not open** — check that `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` is set, then restart the dev server so Next.js picks it up.
- **Webhook events are ignored** — verify the public URL, the event types, and that the webhook secret produces the expected signature.
- **`better-sqlite3` fails to install** — confirm you are on Node.js 22 or newer, then run `npm rebuild better-sqlite3`.
