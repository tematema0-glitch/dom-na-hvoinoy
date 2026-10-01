CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
  id text PRIMARY KEY,
  name text NOT NULL,
  phone text NOT NULL UNIQUE,
  code text NOT NULL UNIQUE,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS member_devices (
  token_hash text PRIMARY KEY,
  member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS member_devices_member_idx ON member_devices(member_id);
CREATE INDEX IF NOT EXISTS member_devices_expires_idx ON member_devices(expires_at);

CREATE TABLE IF NOT EXISTS point_ledger (
  id bigserial PRIMARY KEY,
  member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  points integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('earned','deducted','reserved','spent','release')),
  reason text NOT NULL DEFAULT '',
  request_id text UNIQUE,
  booking_id text,
  reward_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS point_ledger_member_idx ON point_ledger(member_id, created_at DESC);

CREATE TABLE IF NOT EXISTS calendar_blocks (
  id text PRIMARY KEY,
  arrival date NOT NULL,
  departure date NOT NULL,
  note text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'blocked' CHECK (kind IN ('blocked','booked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (departure > arrival)
);
CREATE INDEX IF NOT EXISTS calendar_blocks_dates_idx ON calendar_blocks(arrival, departure);

CREATE TABLE IF NOT EXISTS bookings (
  id text PRIMARY KEY,
  user_id text,
  name text NOT NULL,
  phone text NOT NULL,
  arrival date NOT NULL,
  departure date NOT NULL,
  guests integer NOT NULL DEFAULT 12 CHECK (guests > 0),
  nights integer NOT NULL CHECK (nights > 0),
  total integer NOT NULL DEFAULT 0,
  referrer text REFERENCES members(id),
  status text NOT NULL DEFAULT 'request' CHECK (status IN ('waitlist','request','confirmed','completed','cancelled')),
  request_key text UNIQUE NOT NULL,
  early_credited boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  dates_released boolean NOT NULL DEFAULT false,
  telegram_state text,
  telegram_attempted_at bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (departure > arrival)
);
CREATE INDEX IF NOT EXISTS bookings_dates_idx ON bookings(arrival, departure, status);
CREATE INDEX IF NOT EXISTS bookings_phone_idx ON bookings(phone);

CREATE TABLE IF NOT EXISTS rewards (
  id text PRIMARY KEY,
  member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('cash','stay')),
  date date,
  called boolean NOT NULL DEFAULT false,
  points integer NOT NULL DEFAULT 10,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','issued','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_outbox (
  id bigserial PRIMARY KEY,
  booking_id text REFERENCES bookings(id) ON DELETE SET NULL,
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sent','failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  attempted_at timestamptz
);

CREATE TABLE IF NOT EXISTS telegram_links (
  token text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
