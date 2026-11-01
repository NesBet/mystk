import { type NextRequest, NextResponse } from 'next/server'
import { checkPendingCharge } from '@/lib/paystack'

export async function POST(req: NextRequest) {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY
    if (!secret) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
    }

    const { reference } = await req.json()
    if (!reference) {
      return NextResponse.json({ error: 'reference is required' }, { status: 400 })
    }

    const result = await checkPendingCharge(secret, reference)
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
