import { type NextRequest, NextResponse } from 'next/server'
import { getTransaction, insertTransaction, updateTransactionStatus } from '@/lib/db'
import { getEnv } from '@/lib/env'

async function hmacSha512Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text()
    const payload = JSON.parse(rawBody)

    const env = getEnv()
    const secret = env.PAYSTACK_WEBHOOK_SECRET || env.PAYSTACK_SECRET_KEY
    const signature = req.headers.get('x-paystack-signature')

    if (!secret) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
    }

    if (!signature) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const hash = await hmacSha512Hex(secret, rawBody)
    if (!timingSafeEqual(hash, signature)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const event = payload.event
    const data = payload.data

    switch (event) {
      case 'charge.success': {
        console.log('Charge successful:', data.reference, data.amount, data.email)
        const updated = await updateTransactionStatus(data.reference, 'paid', 'Webhook confirmation')
        if (!updated && data.reference && !(await getTransaction(data.reference))) {
          const metadata = data.metadata || {}
          const customerName =
            [metadata.first_name, metadata.last_name].filter(Boolean).join(' ') ||
            [data.customer?.first_name, data.customer?.last_name].filter(Boolean).join(' ')
          await insertTransaction({
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
        await updateTransactionStatus(data.reference, 'failed', data.message || 'Webhook failure notification')
        break
      default:
        console.log('Unhandled event:', event)
    }

    return NextResponse.json({ received: true })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
