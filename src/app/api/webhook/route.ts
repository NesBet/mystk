import { type NextRequest, NextResponse } from 'next/server'
import { getTransaction, insertTransaction, updateTransactionStatus } from '@/lib/db'

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json()

    const secret = process.env.PAYSTACK_WEBHOOK_SECRET
    const signature = req.headers.get('x-paystack-signature')

    if (secret) {
      if (!signature) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const crypto = await import('crypto')
      const hash = crypto
        .createHmac('sha512', secret)
        .update(JSON.stringify(payload))
        .digest('hex')

      if (hash !== signature) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
    }

    const event = payload.event
    const data = payload.data

    switch (event) {
      case 'charge.success': {
        console.log('Charge successful:', data.reference, data.amount, data.email)
        const updated = updateTransactionStatus(data.reference, 'paid', 'Webhook confirmation')
        if (!updated && data.reference && !getTransaction(data.reference)) {
          const metadata = data.metadata || {}
          const customerName =
            [metadata.first_name, metadata.last_name].filter(Boolean).join(' ') ||
            [data.customer?.first_name, data.customer?.last_name].filter(Boolean).join(' ')
          insertTransaction({
            reference: data.reference,
            phone: metadata.phone || data.customer?.phone || 'N/A',
            amount: Number(data.amount) / 100,
            customer_name: customerName,
            email: data.customer?.email || data.email || '',
            payment_method: metadata.payment_method || data.channel || 'card',
            account_number: null,
            account_reference: null,
            status: 'paid',
            notes: 'Webhook confirmation',
          })
        }
        break
      }
      case 'charge.failed':
        console.log('Charge failed:', data.reference, data.amount, data.email)
        updateTransactionStatus(data.reference, 'failed', data.message || 'Webhook failure notification')
        break
      default:
        console.log('Unhandled event:', event)
    }

    return NextResponse.json({ received: true })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
