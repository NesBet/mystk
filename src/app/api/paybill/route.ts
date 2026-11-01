import { type NextRequest, NextResponse } from 'next/server'
import {
  insertTransaction,
  getAllTransactions,
  getTransaction,
  confirmPayment,
  updateTransactionStatus,
} from '@/lib/db'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const reference = searchParams.get('reference')
    const status = searchParams.get('status')

    if (reference) {
      const tx = getTransaction(reference)
      if (!tx) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
      return NextResponse.json({ status: true, data: tx })
    }

    const transactions = status ? getAllTransactions(status) : getAllTransactions()
    return NextResponse.json({ status: true, data: transactions })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error'
    return NextResponse.json({ status: false, error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const action = body.action

    if (action === 'record') {
      const tx = insertTransaction({
        reference: body.reference,
        phone: body.phone,
        amount: body.amount,
        customer_name: body.customer_name,
        email: body.email || '',
        payment_method: body.payment_method || 'mpesa_offline',
        account_number: body.account_number || null,
        account_reference: body.account_reference || null,
      })
      return NextResponse.json({ status: true, data: tx })
    }

    if (action === 'confirm') {
      if (!body.reference) return NextResponse.json({ status: false, error: 'Reference is required' }, { status: 400 })
      const tx = confirmPayment(body.reference)
      if (!tx) return NextResponse.json({ status: false, error: 'Transaction not found' }, { status: 404 })
      return NextResponse.json({ status: true, data: tx })
    }

    if (action === 'update') {
      if (!body.reference || !body.status) {
        return NextResponse.json({ status: false, error: 'Reference and status are required' }, { status: 400 })
      }
      if (!['paid', 'failed'].includes(body.status)) {
        return NextResponse.json({ status: false, error: 'Status must be "paid" or "failed"' }, { status: 400 })
      }
      const tx = updateTransactionStatus(body.reference, body.status, body.notes || undefined)
      if (!tx) return NextResponse.json({ status: false, error: 'Transaction not found' }, { status: 404 })
      return NextResponse.json({ status: true, data: tx })
    }

    return NextResponse.json({ status: false, error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error'
    return NextResponse.json({ status: false, error: msg }, { status: 500 })
  }
}
