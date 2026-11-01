import { NextResponse } from 'next/server'
import { getEnv } from '@/lib/env'

export const dynamic = 'force-dynamic'

export async function GET() {
  const publicKey = getEnv().NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY

  if (!publicKey) {
    return NextResponse.json(
      { error: 'Card payments are not configured' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  return NextResponse.json(
    { publicKey },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
