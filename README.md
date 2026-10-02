# EVE Diagnostic Booking API

Node.js + Express + PostgreSQL. JWT auth, centres/tests with per-centre pricing, bookings, simulated payments, and an idempotent signed webhook.

## Run locally
```bash
cp .env.example .env            # edit secrets
docker compose up --build       # API on :3000 + Postgres
# or without Docker: start Postgres, set env vars, then
npm install && npm start        # schema is applied automatically on boot
```
Tests (need a Postgres DB; **tables are truncated**, use a throwaway DB):
```bash
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/eve_test npm test
```
Emails listed in `ADMIN_EMAILS` become admins on signup.

## Endpoints
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | /auth/signup | – | `{name,email,password(min 8)}` -> user + token |
| POST | /auth/login | – | `{email,password}` -> token |
| GET | /centres?limit&offset | – | paginated |
| GET | /centres/:id | – | includes tests + prices |
| GET | /tests | – | |
| POST | /centres, /tests | admin | |
| PUT | /centres/:id/tests | admin | `{test_id,price}` offer/re-price |
| POST | /bookings | user | `{centre_id,test_id,appointment_at(ISO, future)}`; amount = centre price |
| GET | /bookings, /bookings/:id | user | own bookings only |
| PATCH | /bookings/:id/cancel | user | |
| POST | /payments/ | user | `{booking_id, outcome?}` random 80% success if `outcome` omitted |
| POST | /payments/webhook/ | HMAC | `{event_id,booking_id,status}` + `X-Signature` |

Example:
```bash
curl -X POST localhost:3000/auth/signup -H 'Content-Type: application/json' \
  -d '{"name":"Asha","email":"asha@x.com","password":"password1"}'
curl -X POST localhost:3000/bookings -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"centre_id":1,"test_id":1,"appointment_at":"2026-12-01T09:00:00Z"}'
# webhook signature: hex HMAC-SHA256 of the raw body using WEBHOOK_SECRET
```

## Schema
`users` · `centres` · `tests` · `centre_tests(centre_id,test_id,price)` (price lives here) · `bookings` (FK to centre_tests so a booking can't reference a test the centre doesn't offer; `amount` is a price snapshot) · `payments` (`event_id` UNIQUE) · `webhook_events(event_id PK)` (idempotency ledger). See `schema.sql`.

## Key design decisions
- **Idempotency:** inside one transaction the booking row is locked (`FOR UPDATE`), then `INSERT INTO webhook_events ... ON CONFLICT DO NOTHING`. Zero rows inserted = duplicate -> return 200 and change nothing. Safe under concurrent deliveries (tested).
- **State machine:** PENDING/FAILED -> CONFIRMED or FAILED; CONFIRMED/CANCELLED can't be paid again; late or out-of-order webhooks are recorded but never downgrade a booking.
- **Authorization:** non-owners get 404 (not 403) on bookings to avoid ID probing. Catalogue writes are admin-only.
- **Webhook auth:** HMAC-SHA256 over the raw body, constant-time compare.

## Assumptions
- Currency-agnostic amounts; no refunds (cancelling a CONFIRMED booking just changes status).
- No slot capacity / double-booking checks.
- FAILED bookings may be retried.

## With more time
Refresh tokens, rate limiting, refund flow on cancel, slot capacity, migrations (e.g. node-pg-migrate), OpenAPI docs, structured logging, background retry of webhook processing, CI.
