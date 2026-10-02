CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS centres (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, location TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tests (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE
);
-- price lives here: each centre prices each test differently
CREATE TABLE IF NOT EXISTS centre_tests (
  centre_id INT NOT NULL REFERENCES centres(id) ON DELETE CASCADE,
  test_id INT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  PRIMARY KEY (centre_id, test_id)
);
CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  centre_id INT NOT NULL, test_id INT NOT NULL,
  appointment_at TIMESTAMPTZ NOT NULL,
  amount NUMERIC(10,2) NOT NULL, -- snapshot of price at booking time
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','CONFIRMED','FAILED','CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (centre_id, test_id) REFERENCES centre_tests(centre_id, test_id)
);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  booking_id INT NOT NULL REFERENCES bookings(id),
  amount NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SUCCESS','FAILED')),
  source TEXT NOT NULL CHECK (source IN ('API','WEBHOOK')),
  event_id TEXT UNIQUE, -- set for webhook-created payments
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- idempotency ledger: PK guarantees one processing per event
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id TEXT PRIMARY KEY, booking_id INT NOT NULL,
  status TEXT NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
