import type { D1Database } from '@cloudflare/workers-types'
import { getEnv } from './env'

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

function getDb(): D1Database {
  const db = getEnv().DB
  if (!db) throw new Error('D1 binding "DB" is not configured')
  return db
}

export async function insertTransaction(tx: {
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
}): Promise<Transaction> {
  const db = getDb()
  await db
    .prepare(`
      INSERT INTO transactions
        (reference, phone, amount, customer_name, email, payment_method,
         account_number, account_reference, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      tx.reference,
      tx.phone,
      tx.amount,
      tx.customer_name,
      tx.email,
      tx.payment_method,
      tx.account_number,
      tx.account_reference,
      tx.status ?? 'pending',
      tx.notes ?? '',
    )
    .run()

  const row = await getTransaction(tx.reference)
  if (!row) throw new Error('Failed to read inserted transaction')
  return row
}

export async function updateTransactionStatus(
  reference: string,
  status: 'paid' | 'failed',
  notes?: string,
): Promise<Transaction | null> {
  const db = getDb()
  const now = new Date().toISOString()

  await db
    .prepare(`
      UPDATE transactions
      SET status = ?,
          updated_at = ?,
          confirmed_at = CASE WHEN ? = 'paid' THEN ? ELSE confirmed_at END,
          notes = CASE WHEN ? IS NOT NULL THEN ? ELSE notes END
      WHERE reference = ?
    `)
    .bind(status, now, status, now, notes ?? null, notes ?? null, reference)
    .run()

  return getTransaction(reference)
}

export async function getTransaction(reference: string): Promise<Transaction | null> {
  const row = await getDb()
    .prepare('SELECT * FROM transactions WHERE reference = ?')
    .bind(reference)
    .first<Transaction>()

  return row ?? null
}

export async function getAllTransactions(status?: string): Promise<Transaction[]> {
  const db = getDb()

  if (status) {
    const { results } = await db
      .prepare('SELECT * FROM transactions WHERE status = ? ORDER BY created_at DESC')
      .bind(status)
      .all<Transaction>()
    return results ?? []
  }

  const { results } = await db
    .prepare('SELECT * FROM transactions ORDER BY created_at DESC')
    .all<Transaction>()
  return results ?? []
}

export async function confirmPayment(reference: string): Promise<Transaction | null> {
  return updateTransactionStatus(reference, 'paid', 'Manually confirmed')
}
