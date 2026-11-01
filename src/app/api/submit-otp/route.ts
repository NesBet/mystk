import { type NextRequest, NextResponse } from 'next/server'
import { submitOtp } from '@/lib/paystack'

export async function POST(req: NextRequest) {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY
    if (!secret) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
    }

    const { reference, otp } = await req.json()
    if (!reference || !otp) {
      return NextResponse.json({ error: 'reference and otp are required' }, { status: 400 })
    }

    const result = await submitOtp(secret, reference, otp)
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
