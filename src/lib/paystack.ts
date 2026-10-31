export interface ChargePayload {
  amount: number
  email: string
  currency: 'KES'
  mobile_money?: {
    phone: string
    provider: 'mpesa' | 'atl' | 'mpesa_offline'
  }
  card?: {
    number: string
    cvv: string
    expiry_month: string
    expiry_year: string
  }
  metadata?: Record<string, unknown>
}

export interface ChargeResponse {
  status: boolean
  message: string
  data: {
    reference: string
    status: string
    amount: number
    currency: string
    message: string
    display_text?: string
    [key: string]: unknown
  }
}

const BASE = 'https://api.paystack.co'

function headers(secret: string): HeadersInit {
  return {
    Authorization: `Bearer ${secret}`,
    'Content-Type': 'application/json',
  }
}

export async function initiateCharge(
  secret: string,
  payload: ChargePayload,
): Promise<ChargeResponse> {
  const res = await fetch(`${BASE}/charge`, {
    method: 'POST',
    headers: headers(secret),
    body: JSON.stringify(payload),
  })
  return res.json()
}

export async function checkPendingCharge(
  secret: string,
  reference: string,
): Promise<ChargeResponse> {
  const res = await fetch(`${BASE}/charge/${reference}`, {
    headers: headers(secret),
  })
  return res.json()
}

export async function submitOtp(
  secret: string,
  reference: string,
  otp: string,
): Promise<ChargeResponse> {
  const res = await fetch(`${BASE}/charge/submit_otp`, {
    method: 'POST',
    headers: headers(secret),
    body: JSON.stringify({ reference, otp }),
  })
  return res.json()
}

export async function submitBirthday(
  secret: string,
  reference: string,
  birthday: string,
): Promise<ChargeResponse> {
  const res = await fetch(`${BASE}/charge/submit_birthday`, {
    method: 'POST',
    headers: headers(secret),
    body: JSON.stringify({ reference, birthday }),
  })
  return res.json()
}

export async function verifyTransaction(
  secret: string,
  reference: string,
): Promise<ChargeResponse> {
  const res = await fetch(`${BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: headers(secret),
  })
  return res.json()
}
