# TokenPap - Prepaid Utility Token Platform

TokenPap sells prepaid electricity/water tokens. Admins onboard **vendors** and **landlords** and assign them STS **meters**; customers pay with **M-Pesa** (STK push or paybill) and receive a 20-digit token by SMS, issued through the **Prism** STS vending API. Landlords map their properties into zones → routes → streets → units and link a meter to each unit.

This is the successor to the Laravel + MongoDB system (`../backend`, `../frontend`), rebuilt on:

- **Backend:** [backend/](backend/) - Node.js + **Fastify 5** + TypeScript, **PostgreSQL** via Prisma 7, JWT auth, Socket.io for live vend events.
- **Frontend:** [frontend/](frontend/) - React 19 + TypeScript + Vite, Tailwind v4 + the Apiwapi design system, TanStack Query, Zustand.

## Roles

| Role | Signs in with | Can |
|---|---|---|
| `SUPER_ADMIN` | email / username + password | everything, incl. managing other super admins |
| `ADMIN` | email / username + password | vendors, landlords, meters, customers, settings, operators, audit log |
| `VENDOR` | email / username / account ID + password | own meters (sets price), own customers, vend tokens, branding, own SMS gateway |
| `LANDLORD` | email / username + password | properties + hierarchy, tenants, assigned meters, vend tokens |
| `CUSTOMER` | phone one-time code (or Google) | own meter, buy tokens, purchase history |

Vendors can self-register at `/register`; they stay `PENDING` until an admin approves them.

## How a token gets sold

1. **STK push** - customer (or `/buy` page) calls `POST /api/mpesa/stkpush` with the meter number as reference. Credentials come from the meter's vendor/landlord Daraja config, else the global `mpesa_*` settings. A `PENDING` payment is stored.
2. **Callback** - Safaricom calls `POST /api/mpesa/callback`; the payment is confirmed, a credit token is issued through Prism and SMS'd to the payer. The page long-polls `GET /api/mpesa/query/:checkoutRequestId?wait=1` and shows the token.
3. **Paybill** - NCBA (`POST /api/notifications/ncba`) or Safaricom C2B (`POST /api/mpesa/c2b/confirmation`) notifications with a `TILL#METER` account reference are vended the same way.
4. **Manual** - admins/vendors/landlords vend credit or control tokens (clear tamper, clear credit, max overdraft) from **Token Vending**.

Every attempt is a `TokenTransaction` row; admins and the meter's owner get a live `transaction:created` Socket.io event.

## Project structure

```
backend/
  prisma/schema.prisma          # data model (schema-per-app: ?schema= in DATABASE_URL)
  prisma/migrations/            # versioned SQL migrations
  prisma/seed.ts                # super admin, config keys, vending params, Kenya locations
  scripts/migrate-from-mongo.ts # one-shot import from the legacy MongoDB
  scripts/paybill.ts            # process a missed paybill payment / register C2B URLs
  scripts/prism-test.ts         # Prism connectivity check
  src/
    app.ts, server.ts           # Fastify app (all routes under /api) + Socket.io
    integrations/               # prism/ (Thrift client), mpesa, sms, mail
    modules/                    # auth, admin, vendors, landlords, meters, customers,
                                # locations, properties, tokens, payments, settings, enquiries, audit
    shared/                     # errors, guards, types, utils (crypto, phone, actor scoping)
frontend/
  src/pages/                    # public, auth, dashboards, tokens, partners, meters,
                                # properties, vendor, admin, shared
  src/api/                      # typed API calls
  src/components/               # layout, shared UI, public (buy/track widgets)
```

## Getting started

### Backend

```bash
cd backend
cp .env.example .env     # DATABASE_URL (+ DIRECT_URL), JWT_SECRET, Prism + NCBA credentials
npm install
npx prisma migrate deploy
npm run db:seed          # prints a generated super admin password unless SEED_ADMIN_PASSWORD is set
npm run dev              # http://localhost:3000/api
```

- `DATABASE_URL` selects the Postgres schema with `?schema=` (e.g. `tokenpap`), so TokenPap can share a database with other apps without touching their tables.
- `DIRECT_URL` is used by Prisma migrate and the Mongo import (DDL doesn't work through pgbouncer's transaction pooler).
- Gateway secrets (M-Pesa, SMS) are entered in **Settings** and stored AES-256-GCM encrypted with `ENCRYPTION_KEY` (falls back to `JWT_SECRET`). Changing that key makes saved secrets unreadable.

### Frontend

```bash
cd frontend
cp .env.example .env     # VITE_API_BASE_URL=http://localhost:3000/api, VITE_SOCKET_URL=http://localhost:3000
npm install
npm run dev              # http://localhost:5173
```

### Migrating from the legacy MongoDB

```bash
cd backend
MONGO_URI="mongodb+srv://..." MONGO_DB=tokens LARAVEL_APP_KEY="base64:..." npm run migrate:mongo -- --dry-run
MONGO_URI="mongodb+srv://..." MONGO_DB=tokens LARAVEL_APP_KEY="base64:..." npm run migrate:mongo
npm run db:seed          # fills any defaults the legacy data didn't have
```

- Idempotent: rows are upserted by their old ObjectId (`legacy_mongo_id`), so re-running is safe.
- Users keep their passwords (bcrypt hashes are carried over).
- Secrets Laravel encrypted are decrypted with `LARAVEL_APP_KEY` and re-encrypted. **Use the production `APP_KEY`** - values encrypted with a different key are left empty and reported (re-run with the right key, or re-enter them in Settings).
- Vendor logos are copied from `LARAVEL_STORAGE_DIR` (default `../../backend/storage/app/public`) into `UPLOAD_DIR`.
- Not migrated: Sanctum tokens, sessions, OTPs, cache/job tables (everyone signs in again).

### Webhooks (unchanged URLs)

All routes are served under `/api`, so the URLs registered with providers for the Laravel API keep working when the new API is deployed on the same host:

| Provider | URL |
|---|---|
| M-Pesa STK callback | `/api/mpesa/callback` (or the `mpesa_callback_url` setting) |
| Safaricom C2B | `/api/mpesa/c2b/validation`, `/api/mpesa/c2b/confirmation` |
| NCBA paybill | `/api/notifications/ncba` (authenticated with `NCBA_PAYBILL_USERNAME/PASSWORD`) |

## Scripts

| | |
|---|---|
| `npm run dev` / `build` / `start` | backend dev server, compile, run compiled |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:seed` | idempotent seed |
| `npm run migrate:mongo -- [--dry-run]` | legacy import |
| `npm run prism:test -- <meter> <amount>` | issue a real test token through Prism |
| `npx tsx scripts/paybill.ts process <transId> <amount> <phone> <till> <meter>` | vend for a paybill payment whose webhook never arrived |
| `npx tsx scripts/paybill.ts register-c2b [shortcode] [vendorName]` | register C2B URLs with Safaricom |
| `npx tsx scripts/create-user.ts <email> <password> <name> [ADMIN\|SUPER_ADMIN]` | create/reset an operator |
| `npx tsx scripts/set-super-admin.ts <email>` | promote an operator |

## Behaviour changes from the legacy system

- **Public token tracking** matches the exact meter number or customer phone (the legacy `LIKE %q%` search exposed other customers' tokens).
- **Vendors** can only attach customers to their own meters; **landlords** can no longer edit meters (they could reassign a meter's vendor before).
- **Suspended/rejected** accounts can't sign in (legacy only blocked pending ones).
- **Password reset** answers the same whether or not an account exists; OTP endpoints and logins are rate limited and codes are stored hashed with an attempt limit.
- **Google sign-in** returns the session in the URL fragment instead of the query string.
- **Sessions** are stateless JWTs (default 7 days) - sign-out discards the token client-side.
- **STS vending overrides** (Settings → STS vending) only apply when switched on; the legacy rows never had the flag set, so vends keep using each meter's own STS values until an admin activates one.
