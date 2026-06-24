# Stellar Tags

Stellar Tags is a payment platform that combines a Soroban smart contract, a Node.js server, and a React dashboard. It is structured as a small mono-repo so each piece can be developed and deployed independently while still working together as a single product.

## What is inside

- `payment-dashboard/` - React + Vite frontend dashboard.
- `stellar-payment-platform/` - Node.js server for API and business logic.
- `payment_router/` - Rust/Soroban contract.

## Key features

- Desired specific username
- Fast transfer
- Secured payment flows

## Architecture Map

The following diagram maps exactly how data flows between the user, Vercel, Railway, and the Stellar network.

```text
[ User / Browser ]
       |
       | (Vite App hosted on Vercel)
       v
[ payment-dashboard ]
  (src/App.jsx: Wallet connections & UI)
       |
       | HTTP API Calls (via VITE_API_BASE)
       v
[ stellar-payment-platform ] <---> [ PostgreSQL Database ]
  (server.js: Server router on Railway)      (via Prisma ORM: User/payment layout)
       |
       | Stellar Network / RPC
       v
[ payment_router ]
  (src/lib.rs: Soroban smart contract routing logic)
```

**Data Flow:**
1. **User** accesses the `payment-dashboard` and connects their Stellar wallet.
2. The dashboard queries the `stellar-payment-platform` server for user registrations and payment routing information.
3. The server interacts with its PostgreSQL database (via the Prisma ORM) to resolve usernames to addresses using the endpoints documented below.
4. When a payment is initiated, it's routed through the `payment_router` Soroban contract on the Stellar network.

## Repository structure

```text
.
├── payment-dashboard/
│   ├── .env                 # Frontend environment variables
│   └── src/
│       └── App.jsx          # Wallet connections and React UI
├── payment_router/
│   └── src/
│       └── lib.rs           # Soroban smart contract logic
└── stellar-payment-platform/
    ├── server.js            # Server router (Express API endpoints)
    └── prisma/
        └── schema.prisma    # Prisma schema for the PostgreSQL database
```

## Getting started

> These steps are split by module so you can run only what you need.

### Frontend dashboard

```bash
cd payment-dashboard
npm install
npm run dev
```

### Server

The server uses **PostgreSQL** as its database, accessed through the
[Prisma ORM](https://www.prisma.io/). You need a running Postgres instance
(local install, Docker, or a hosted provider) before starting the server.

```bash
cd stellar-payment-platform
npm install

# 1. Create your local env file and point DATABASE_URL at your Postgres DB
cp .env.example .env
#    then edit .env (see "Database setup" below)

# 2. Apply the schema to your database
npm run prisma:migrate

# 3. Start the server
npm run dev
```

#### Database setup

The connection string lives in `stellar-payment-platform/.env` as `DATABASE_URL`.
Copy `.env.example` to `.env` and set it to your own Postgres database:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public"
```

For a typical local install that becomes, for example:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/stellar_tags?schema=public"
```

The quickest way to get a local database is Docker:

```bash
docker run --name stellar-postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=stellar_tags -p 5432:5432 -d postgres:16
```

Useful Prisma commands (run from `stellar-payment-platform/`):

| Command | Description |
| --- | --- |
| `npm run prisma:migrate` | Create/apply migrations against your dev database |
| `npm run prisma:deploy` | Apply existing migrations (CI / production) |
| `npm run prisma:generate` | Regenerate the Prisma Client after schema changes |
| `npm run prisma:studio` | Open Prisma Studio to browse the data |

> `.env` is gitignored — never commit real credentials. Each contributor keeps
> their own local `DATABASE_URL`.

### Smart contract (Soroban)

```bash
cd payment_router
cargo build
```

## Tests

```bash
# frontend
cd payment-dashboard
npm test

# server
cd ../stellar-payment-platform
npm test

# contract
cd ../payment_router
cargo test
```

## Environment variables

To ensure a seamless local developer installation requiring zero guesswork, please configure the following environment variables in their respective directories:

### Frontend (`payment-dashboard/.env`)
- `VITE_API_BASE` - The base URL where the frontend expects the Node.js server API to be running (e.g., `http://localhost:5000`).

### Server (`stellar-payment-platform/.env` or exported directly)
- `DATABASE_URL` - **(Required)** PostgreSQL connection string used by Prisma (see [Database setup](#database-setup)).
- `PORT` - (Optional) The port for the Node.js server to listen on. Defaults to `5000`.
- `HORIZON_NETWORK` - (Optional) Stellar network for the payment listener: `testnet` (default) or `public`.
- `STELLAR_TAG_DOMAIN` - (Optional) Extra origin to add to the CORS allow-list.

## Detailed Endpoint Documentation

The Node.js server (`stellar-payment-platform/server.js`) exposes the following endpoints for username and payment lookups:

### `GET /federation`
Resolves a given username tag to a Stellar address.
- **Query Parameter:** `q` (string) - The username tag to lookup (e.g., `alice*localhost`).
- **Returns:** A JSON object with `stellar_address`, `account_id`, `memo_type`, and `memo`.
- **Status Codes:**
  - `200 OK`: Address found.
  - `400 Bad Request`: Missing `q` parameter.
  - `404 Not Found`: Name tag not found.
  - `500 Internal Server Error`: Database lookup failed.

### `POST /register`
Registers a new username and associates it with a Stellar address.
- **Body Parameters (JSON):** 
  - `username` (string) - The desired username.
  - `address` (string) - The user's Stellar address.
- **Returns:** A JSON object with registration details `{ ok: true, username, address }`.
- **Status Codes:**
  - `200 OK`: Registration successful.
  - `400 Bad Request`: Missing `username` or `address`.
  - `409 Conflict`: Address or username already registered.
  - `500 Internal Server Error`: Database lookup or insertion failed.

### `GET /lookup`
Resolves a given Stellar address to its registered username.
- **Query Parameter:** `address` (string) - The Stellar address to lookup.
- **Returns:** A JSON object with `username` and `address`.
- **Status Codes:**
  - `200 OK`: Username found.
  - `400 Bad Request`: Missing `address` parameter.
  - `404 Not Found`: Username not found for this address.
  - `500 Internal Server Error`: Database lookup failed.

### `GET /health`
A simple health check endpoint.
- **Returns:** `{ status: 'ok' }`
- **Status Codes:** `200 OK`.

## Architecture notes

- The React dashboard runs on `http://localhost:3000` in dev (Vite) and provides the UI.
- The dashboard calls the Node.js API at `http://localhost:5000` via `VITE_API_BASE` and a `/api` proxy.
- The Soroban contract handles on-chain payment routing logic.

## License

See [LICENSE](LICENSE).
