CREATE TABLE IF NOT EXISTS transactions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  reference         TEXT UNIQUE NOT NULL,
  phone             TEXT NOT NULL,
  amount            REAL NOT NULL,
  customer_name     TEXT NOT NULL DEFAULT '',
  email             TEXT NOT NULL DEFAULT '',
  payment_method    TEXT NOT NULL DEFAULT 'mpesa_offline',
  account_number    TEXT,
  account_reference TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'paid', 'failed')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at      TEXT,
  notes             TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions (status);
