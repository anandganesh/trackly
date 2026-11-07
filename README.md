# Trackly Order Tracking

This project currently runs with a local React web app, Express API, and local PostgreSQL database. No Railway or other cloud deployment configuration is included.

## Local database

The API defaults to the local PostgreSQL database named `order_tracking` at `postgresql:///order_tracking`. Local connection and development credentials are stored in the ignored `.env` file. Use `.env.example` as the template for another workstation.

Create the database and setup the login table:

```bash
createdb order_tracking
npm run db:migrate
npm run db:seed
```

The seed command creates or updates the local development account configured by `SEED_USERNAME` and `SEED_PASSWORD` in `.env`. Passwords are stored only as bcrypt hashes.

## Run locally

```bash
npm run dev
```

This starts:

- web client: Vite (the URL is displayed in the terminal, normally `http://localhost:5173`)
- API: `http://localhost:3001`

Vite proxies browser requests from `/api` to the local API.

## Login API

`POST /api/auth/login`

```json
{ "username": "local-admin", "password": "your-local-password" }
```

Successful responses return a user object. Invalid credentials return `401` without identifying whether the username or password was wrong.

Authentication uses a PostgreSQL-backed server session and an HTTP-only cookie. Dashboard and order APIs reject unauthenticated requests.

## Orders API

The order form saves to the local database after login.

- `POST /api/orders` creates an order. It stores customer, payment, balance due date, and delivery date details.
- `GET /api/orders` returns the 50 most recently saved orders.

The server calculates and stores the outstanding balance; it does not trust the browser-calculated value. The `orders` table is created by `npm run db:migrate` and is linked to the user who placed it.

## Dashboard

After login, the dashboard is the default screen. It provides:

- pending and delivered order totals
- pending and overdue due amounts
- search by order number, customer, or phone
- delivery and payment-status filters
- compact order cards
- order details and payment history
- payment recording
- pending/delivered status updates

Dashboard API endpoints:

- `GET /api/dashboard/summary`
- `GET /api/orders`
- `GET /api/orders/:id`
- `POST /api/orders/:id/payments`
- `PATCH /api/orders/:id/delivery-status`

Payments are stored as individual records in the `payments` table. The current paid and balance amounts are updated transactionally on the order.

## Local verification

After starting the API, verify the configured account with:

```bash
npm run test:api
```

## Configure the login brand

Edit `/Users/naruto/ai/order_tracking/src/config/brand.ts` to update the company name or logo URL. The default logo is the local dummy asset at `public/logo-placeholder.svg`.

## Validation

```bash
npm run lint
npm run typecheck
npm run build
```

## Railway deployment

The included `railway.json` configures Railway to:

- build with `npm run build`
- run migrations with `npm run db:migrate` before deployment
- start with `npm run start`
- health-check `/api/health`

Create one application service and one PostgreSQL service. Set the application variables:

- `DATABASE_URL` as a Railway reference to the PostgreSQL service's `DATABASE_URL`
- `SESSION_SECRET` to a cryptographically random value of at least 32 characters
- `SEED_USERNAME` and `SEED_PASSWORD` temporarily if you need to run `npm run db:seed`

After seeding the first user, remove the seed password variables from the application service.