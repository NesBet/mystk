import { type NextRequest, NextResponse } from 'next/server'
import { initiateCharge } from '@/lib/paystack'
import { getEnv } from '@/lib/env'

export async function POST(req: NextRequest) {
  try {
    const secret = getEnv().PAYSTACK_SECRET_KEY
    if (!secret) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
    }

    const body = await req.json()
    const { amount, email, currency, mobile_money, card, metadata } = body

    if (!email || !amount) {
      return NextResponse.json({ error: 'email and amount are required' }, { status: 400 })
    }

    if (!mobile_money && !card) {
      return NextResponse.json({ error: 'A payment method is required' }, { status: 400 })
    }

    const result = await initiateCharge(secret, {
      amount,
      email,
      currency: currency || 'KES',
      mobile_money,
      card,
      metadata,
    })

    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
