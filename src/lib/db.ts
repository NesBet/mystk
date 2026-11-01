import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DB_PATH = path.join(process.cwd(), 'data', 'payments.db')

let _db: Database.Database | null = null

export interface Transaction {
  id: number
  reference: string
  phone: string
  amount: number
  customer_name: string
  email: string
  payment_method: string
  account_number: string | null
  account_reference: string | null
  status: 'pending' | 'paid' | 'failed'
  created_at: string
  updated_at: string
  confirmed_at: string | null
  notes: string
}

function getDb(): Database.Database {
  if (!_db) {
    const dir = path.dirname(DB_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    _db = new Database(DB_PATH)
    _db.pragma('journal_mode = WAL')
    _db.pragma('foreign_keys = ON')

    _db.exec(`
      CREATE TABLE IF NOT EXISTS transactions (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        reference       TEXT UNIQUE NOT NULL,
        phone           TEXT NOT NULL,
        amount          REAL NOT NULL,
        customer_name   TEXT NOT NULL DEFAULT '',
        email           TEXT NOT NULL DEFAULT '',
        payment_method  TEXT NOT NULL DEFAULT 'mpesa_offline',
        account_number  TEXT,
        account_reference TEXT,
        status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK(status IN ('pending','paid','failed')),
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
        confirmed_at    TEXT,
        notes           TEXT DEFAULT ''
      )
    `)
  }
  return _db!
}

export function insertTransaction(tx: {
  reference: string
  phone: string
  amount: number
  customer_name: string
  email: string
  payment_method: string
  account_number: string | null
  account_reference: string | null
  status?: 'pending' | 'paid' | 'failed'
  notes?: string
}): Transaction {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO transactions (reference, phone, amount, customer_name, email, payment_method, account_number, account_reference, status, notes)
    VALUES (@reference, @phone, @amount, @customer_name, @email, @payment_method, @account_number, @account_reference, @status, @notes)
  `)
  stmt.run({
    ...tx,
    status: tx.status ?? 'pending',
    notes: tx.notes ?? '',
  })
  return db.prepare('SELECT * FROM transactions WHERE reference = ?').get(tx.reference) as Transaction
}

export function updateTransactionStatus(
  reference: string,
  status: 'paid' | 'failed',
  notes?: string,
): Transaction | null {
  const db = getDb()
  const now = new Date().toISOString()
  const stmt = db.prepare(`
    UPDATE transactions
    SET status = ?, updated_at = ?, confirmed_at = CASE WHEN ? = 'paid' THEN ? ELSE confirmed_at END,
        notes = CASE WHEN ? IS NOT NULL THEN ? ELSE notes END
    WHERE reference = ?
  `)
  const result = stmt.run(status, now, status, now, notes ?? null, notes ?? null, reference)
  if (result.changes === 0) return null
  return db.prepare('SELECT * FROM transactions WHERE reference = ?').get(reference) as Transaction
}

export function getTransaction(reference: string): Transaction | null {
  const db = getDb()
  return (db.prepare('SELECT * FROM transactions WHERE reference = ?').get(reference) as Transaction) ?? null
}

export function getAllTransactions(status?: string): Transaction[] {
  const db = getDb()
  if (status) {
    return db.prepare('SELECT * FROM transactions WHERE status = ? ORDER BY created_at DESC').all(status) as Transaction[]
  }
  return db.prepare('SELECT * FROM transactions ORDER BY created_at DESC').all() as Transaction[]
}

export function confirmPayment(reference: string): Transaction | null {
  return updateTransactionStatus(reference, 'paid', 'Manually confirmed')
}
