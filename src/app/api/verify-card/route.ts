import { type NextRequest, NextResponse } from 'next/server'
import { verifyTransaction } from '@/lib/paystack'
import { getTransaction, insertTransaction, updateTransactionStatus } from '@/lib/db'
import { getEnv } from '@/lib/env'

export async function POST(req: NextRequest) {
  try {
    const secret = getEnv().PAYSTACK_SECRET_KEY
    if (!secret) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
    }

    const body = await req.json()
    const reference = body.reference
    if (!reference) {
      return NextResponse.json({ error: 'reference is required' }, { status: 400 })
    }

    const result = await verifyTransaction(secret, reference)
    if (!result.status || !result.data) return NextResponse.json(result)

    const data = result.data
    if (data.status !== 'success') return NextResponse.json(result)

    const expectedAmount = Number(body.amount)
    if (Number.isFinite(expectedAmount) && expectedAmount > 0 && Number(data.amount) !== expectedAmount) {
      return NextResponse.json(
        { status: false, message: 'Verified amount does not match the checkout amount', data },
        { status: 400 },
      )
    }

    if (data.currency && data.currency !== 'KES') {
      return NextResponse.json(
        { status: false, message: 'Verified currency does not match KES', data },
        { status: 400 },
      )
    }

    const existing = await getTransaction(reference)
    if (existing) {
      await updateTransactionStatus(reference, 'paid', 'Card payment verified')
    } else {
      await insertTransaction({
        reference,
        phone: body.phone || 'N/A',
        amount: Number(data.amount) / 100,
        customer_name: body.customer_name || '',
        email: body.email || '',
        payment_method: 'card',
        account_number: null,
        account_reference: null,
        status: 'paid',
        notes: 'Card payment verified',
      })
    }

    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
