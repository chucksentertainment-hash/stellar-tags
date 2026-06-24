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
[ stellar-payment-platform ] <---> [ SQLite Database ] 
  (server.js: Server router on Railway)      (data/registrations.db: User/payment layout)
       |
       | Stellar Network / RPC
       v
[ payment_router ]
  (src/lib.rs: Soroban smart contract routing logic)
```

**Data Flow:**
1. **User** accesses the `payment-dashboard` and connects their Stellar wallet.
2. The dashboard queries the `stellar-payment-platform` server for user registrations and payment routing information.
3. The server interacts with its local SQLite database to resolve usernames to addresses using the endpoints documented below.
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
    └── data/
        └── registrations.db # SQLite database for user/payment lookups
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

```bash
cd stellar-payment-platform
npm install
npm run dev
```

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
- `PORT` - (Optional) The port for the Node.js server to listen on. Defaults to `5000`.
- `DB_PATH` - (Optional) The file path to the SQLite database. Defaults to `data/registrations.db` relative to the server directory.

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
