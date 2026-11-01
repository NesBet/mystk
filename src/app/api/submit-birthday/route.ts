import { type NextRequest, NextResponse } from 'next/server'
import { submitBirthday } from '@/lib/paystack'
import { getEnv } from '@/lib/env'

export async function POST(req: NextRequest) {
  try {
    const secret = getEnv().PAYSTACK_SECRET_KEY
    if (!secret) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
    }

    const { reference, birthday } = await req.json()
    if (!reference || !birthday) {
      return NextResponse.json({ error: 'reference and birthday are required' }, { status: 400 })
    }

    const result = await submitBirthday(secret, reference, birthday)
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
