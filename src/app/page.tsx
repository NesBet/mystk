'use client' //paystack

import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react'
import ThemeToggle from '@/components/ThemeToggle'

type PaymentMethod = 'mpesa' | 'airtel' | 'card' | 'mpesa_offline'
type PaymentStatus =
  | 'form'
  | 'processing'
  | 'pay_offline'
  | 'send_otp'
  | 'send_birthday'
  | 'verifying'
  | 'success'
  | 'failed'
  | 'timeout'

interface PaymentState {
  status: PaymentStatus
  reference: string | null
  message: string | null
  displayText: string | null
  accountNumber: string | null
  accountReference: string | null
}

interface PendingPayment {
  id: string
  reference: string
  accountNumber: string
  accountReference: string
  amount: string
  customerName: string
  phone: string
  status: 'pending' | 'success' | 'failed'
  createdAt: string
}

interface DbTransaction {
  id: number
  reference: string
  phone: string
  amount: number
  customer_name: string
  email: string
  payment_method: string
  account_number: string | null
  account_reference: string | null
  status: 'pending' | 'paid' | 'failed'
  created_at: string
  updated_at: string
  confirmed_at: string | null
  notes: string
}

interface PaystackTransactionResult {
  reference?: string
  trxref?: string
  status?: string
  message?: string
}

interface PaystackPopup {
  newTransaction(options: {
    key: string
    email: string
    amount: number
    currency?: string
    channels?: string[]
    firstName?: string
    lastName?: string
    phone?: string
    metadata?: Record<string, unknown>
    reference?: string
    onSuccess?: (transaction: PaystackTransactionResult) => void
    onLoad?: (response: unknown) => void
    onCancel?: () => void
    onError?: (error: { message?: string }) => void
  }): unknown
}

declare global {
  interface Window {
    PaystackPop?: new () => PaystackPopup
  }
}

type IconName =
  | 'lock'
  | 'card'
  | 'phone'
  | 'signal'
  | 'receipt'
  | 'check'
  | 'x'
  | 'clock'
  | 'refresh'
  | 'arrow-left'
  | 'arrow-right'
  | 'shield'
  | 'bolt'
  | 'copy'
  | 'info'
  | 'alert'
  | 'wallet'

const POLL_INTERVAL = 5000
const TIMEOUT_MS = 180_000
const STORAGE_KEY = 'pending_payments'

let paystackScriptPromise: Promise<void> | null = null

function loadPaystack(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Paystack is unavailable'))
  if (window.PaystackPop) return Promise.resolve()
  if (!paystackScriptPromise) {
    paystackScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://js.paystack.co/v2/inline.js'
      script.async = true
      script.dataset.paystackInline = 'true'
      script.onload = () => resolve()
      script.onerror = () => {
        paystackScriptPromise = null
        reject(new Error('Could not load the secure card checkout. Check your connection and try again.'))
      }
      document.body.appendChild(script)
    })
  }
  return paystackScriptPromise
}

function toInternational(phone: string): string {
  const cleaned = phone.replace(/\s/g, '')
  if (cleaned.startsWith('0')) return '+254' + cleaned.slice(1)
  if (cleaned.startsWith('+')) return cleaned
  return '+254' + cleaned
}

function formatAmount(value: string): string {
  const n = Number(value)
  if (!value || !Number.isFinite(n)) return '0.00'
  return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function createReference(): string {
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `STK-CARD-${Date.now()}-${suffix}`
}

function loadPending(): PendingPayment[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function savePending(list: PendingPayment[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)) } catch {}
}

async function recordPaybillTransaction(tx: {
  reference: string
  phone: string
  amount: string
  customer_name: string
  email: string
  payment_method: string
  account_number: string | null
  account_reference: string | null
}) {
  try {
    await fetch('/api/paybill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'record',
        reference: tx.reference,
        phone: tx.phone,
        amount: parseFloat(tx.amount),
        customer_name: tx.customer_name,
        email: tx.email,
        payment_method: tx.payment_method,
        account_number: tx.account_number,
        account_reference: tx.account_reference,
      }),
    })
  } catch { /* non-critical */ }
}

async function confirmPaybillTransaction(reference: string): Promise<boolean> {
  try {
    const res = await fetch('/api/paybill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'confirm', reference }),
    })
    const data = await res.json()
    return data.status === true
  } catch { return false }
}

async function fetchTransactions(): Promise<DbTransaction[]> {
  try {
    const res = await fetch('/api/paybill')
    const data = await res.json()
    return data.status ? data.data : []
  } catch { return [] }
}

export default function Home() {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('mpesa')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [birthday, setBirthday] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [payment, setPayment] = useState<PaymentState>({
    status: 'form',
    reference: null,
    message: null,
    displayText: null,
    accountNumber: null,
    accountReference: null,
  })
  const [pendingPayments, setPendingPayments] = useState<PendingPayment[]>([])
  const [listOpen, setListOpen] = useState(true)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [shakeKey, setShakeKey] = useState(0)
  const [view, setView] = useState<'payment' | 'transactions'>('payment')
  const [dbTransactions, setDbTransactions] = useState<DbTransaction[]>([])
  const [transactionsLoading, setTransactionsLoading] = useState(false)

  useEffect(() => { setPendingPayments(loadPending()) }, [])

  useEffect(() => { savePending(pendingPayments) }, [pendingPayments])

  const loadTransactions = useCallback(async () => {
    setTransactionsLoading(true)
    const txs = await fetchTransactions()
    setDbTransactions(txs)
    setTransactionsLoading(false)
  }, [])

  const clearTimers = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }
  }, [])

  useEffect(() => {
    return () => clearTimers()
  }, [clearTimers])

  const validate = (): boolean => {
    const e: Record<string, string> = {}
    if (!firstName.trim()) e.firstName = 'First name is required'
    if (!lastName.trim()) e.lastName = 'Last name is required'
    if (method === 'card') {
      if (!email.trim()) e.email = 'Email is required for card payments'
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = 'Enter a valid email'
    } else if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      e.email = 'Enter a valid email'
    }
    if (!amount || Number(amount) <= 0) e.amount = 'Enter a valid amount'
    if (method !== 'card') {
      if (!phone.trim()) e.phone = 'Phone number is required'
      else if (!/^0\d{9}$/.test(phone.replace(/\s/g, ''))) e.phone = 'Use format 0712345678'
    }
    setErrors(e)
    if (Object.keys(e).length > 0) setShakeKey(k => k + 1)
    return Object.keys(e).length === 0
  }

  const startPolling = useCallback((reference: string) => {
    clearTimers()
    timeoutRef.current = setTimeout(() => {
      clearTimers()
      setPayment(prev => ({ ...prev, status: 'timeout', message: 'Transaction timed out after 180 seconds. No payment confirmation received.' }))
    }, TIMEOUT_MS)

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/verify-charge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reference }),
        })
        const data = await res.json()
        if (!data.status) return

        const s = data.data.status
        if (s === 'success') {
          clearTimers()
          setPayment(prev => ({ ...prev, status: 'success', message: 'Payment completed successfully', displayText: null }))
        } else if (s === 'failed') {
          clearTimers()
          setPayment(prev => ({ ...prev, status: 'failed', message: data.data.message || 'Payment failed', displayText: null }))
        } else if (s === 'timeout') {
          clearTimers()
          setPayment(prev => ({ ...prev, status: 'timeout', message: data.data.message || 'Transaction timed out', displayText: null }))
        } else if (s === 'send_otp') {
          clearTimers()
          setPayment(prev => ({ ...prev, status: 'send_otp', displayText: data.data.display_text || 'Enter the OTP sent to your device' }))
        } else if (s === 'send_birthday') {
          clearTimers()
          setPayment(prev => ({ ...prev, status: 'send_birthday', displayText: data.data.display_text || 'Enter your date of birth' }))
        }
      } catch { /* keep polling */ }
    }, POLL_INTERVAL)
  }, [clearTimers])

  const checkStatus = async () => {
    if (!payment.reference) return
    setPayment(prev => ({ ...prev, status: 'verifying' }))
    try {
      const res = await fetch('/api/verify-charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: payment.reference }),
      })
      const data = await res.json()
      if (!data.status) {
        setPayment(prev => ({ ...prev, status: 'pay_offline', message: 'Could not verify status. Please try again.' }))
        return
      }
      const s = data.data.status
      if (s === 'success') {
        setPayment(prev => ({ ...prev, status: 'success', message: 'Payment completed successfully', displayText: null }))
        updatePendingStatus(payment.reference!, 'success')
      } else if (s === 'failed') {
        setPayment(prev => ({ ...prev, status: 'failed', message: data.data.message || 'Payment failed', displayText: null }))
        updatePendingStatus(payment.reference!, 'failed')
      } else if (s === 'timeout') {
        setPayment(prev => ({ ...prev, status: 'timeout', message: data.data.message || 'Transaction timed out', displayText: null }))
      } else {
        setPayment(prev => ({ ...prev, status: 'pay_offline', message: 'Payment not received yet.', displayText: prev.displayText }))
      }
    } catch {
      setPayment(prev => ({ ...prev, status: 'pay_offline', message: 'Network error. Please try again.' }))
    }
  }

  const checkPendingStatus = async (id: string) => {
    setPendingPayments(prev => prev.map(p => p.id === id ? { ...p, status: 'pending' } : p))
    const target = pendingPayments.find(p => p.id === id)
    if (!target) return
    try {
      const res = await fetch('/api/verify-charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: target.reference }),
      })
      const data = await res.json()
      if (!data.status) return
      const s = data.data.status
      if (s === 'success') {
        setPendingPayments(prev => prev.map(p => p.id === id ? { ...p, status: 'success' } : p))
      } else if (s === 'failed' || s === 'timeout') {
        setPendingPayments(prev => prev.map(p => p.id === id ? { ...p, status: 'failed' } : p))
      }
    } catch {}
  }

  const updatePendingStatus = (reference: string, status: 'success' | 'failed') => {
    setPendingPayments(prev => prev.map(p => p.reference === reference ? { ...p, status } : p))
  }

  const removePendingPayment = (id: string) => {
    setPendingPayments(prev => prev.filter(p => p.id !== id))
  }

  const handleConfirmTransaction = async (reference: string) => {
    const ok = await confirmPaybillTransaction(reference)
    if (ok) {
      setPendingPayments(prev => prev.map(p => p.reference === reference ? { ...p, status: 'success' } : p))
      await loadTransactions()
    }
  }

  const payWithCard = async () => {
    let publicKey: string | null = null
    try {
      const configRes = await fetch('/api/config', { cache: 'no-store' })
      if (configRes.ok) {
        const config = await configRes.json()
        publicKey = typeof config.publicKey === 'string' ? config.publicKey : null
      }
    } catch {}

    if (!publicKey) {
      setPayment({ status: 'failed', reference: null, message: 'Card payments are not configured yet. Choose M-Pesa or Airtel Money.', displayText: null, accountNumber: null, accountReference: null })
      return
    }

    const amountInKobo = Math.round(Number(amount) * 100)
    const resolvedEmail = email.trim() || 'pulsemationltd@gmail.com'
    const reference = createReference()
    const customerName = `${firstName} ${lastName}`.trim()

    setPayment({ status: 'processing', reference: null, message: 'Opening secure card checkout...', displayText: null, accountNumber: null, accountReference: null })

    try {
      await loadPaystack()
      const PaystackPop = window.PaystackPop
      if (!PaystackPop) throw new Error('The secure card checkout is unavailable right now.')

      const popup = new PaystackPop()
      popup.newTransaction({
        key: publicKey,
        email: resolvedEmail,
        amount: amountInKobo,
        currency: 'KES',
        channels: ['card'],
        firstName,
        lastName,
        phone: phone ? toInternational(phone) : undefined,
        reference,
        metadata: {
          first_name: firstName,
          last_name: lastName,
          phone: phone ? toInternational(phone) : undefined,
          payment_method: 'card',
        },
        onSuccess: async (transaction) => {
          const ref = transaction.reference || transaction.trxref || reference
          setPayment(prev => ({ ...prev, status: 'verifying', reference: ref, message: 'Confirming your card payment...' }))
          try {
            const res = await fetch('/api/verify-card', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                reference: ref,
                amount: amountInKobo,
                customer_name: customerName,
                phone,
                email: resolvedEmail,
              }),
            })
            const data = await res.json()
            if (data.status && data.data?.status === 'success') {
              setPayment({ status: 'success', reference: ref, message: 'Payment completed successfully', displayText: null, accountNumber: null, accountReference: null })
            } else {
              const failure =
                (typeof data.data?.gateway_response === 'string' && data.data.gateway_response) ||
                (typeof data.message === 'string' && data.message) ||
                'We could not verify this card payment'
              setPayment({ status: 'failed', reference: ref, message: failure, displayText: null, accountNumber: null, accountReference: null })
            }
          } catch {
            setPayment({ status: 'failed', reference: ref, message: 'The payment went through but verification failed. Contact support with this reference.', displayText: null, accountNumber: null, accountReference: null })
          }
        },
        onCancel: () => {
          setPayment({ status: 'form', reference: null, message: null, displayText: null, accountNumber: null, accountReference: null })
          setNotice('Card checkout closed. No payment was taken.')
        },
        onError: (error) => {
          setPayment({ status: 'failed', reference: null, message: error?.message || 'The card checkout could not be opened. Please try again.', displayText: null, accountNumber: null, accountReference: null })
        },
      })
    } catch (err) {
      setPayment({
        status: 'failed',
        reference: null,
        message: err instanceof Error ? err.message : 'The card checkout could not be opened. Please try again.',
        displayText: null,
        accountNumber: null,
        accountReference: null,
      })
    }
  }

  const handleSubmit = async () => {
    setNotice(null)
    if (!validate()) return
    if (method === 'card') {
      await payWithCard()
      return
    }

    setPayment({ status: 'processing', reference: null, message: null, displayText: null, accountNumber: null, accountReference: null })

    const resolvedEmail = email.trim() || 'pulsemationltd@gmail.com'
    const amountInKobo = Math.round(Number(amount) * 100)
    const body: Record<string, unknown> = {
      amount: amountInKobo,
      email: resolvedEmail,
      currency: 'KES',
      metadata: { first_name: firstName, last_name: lastName },
    }

    if (method === 'mpesa') {
      body.mobile_money = { phone: toInternational(phone), provider: 'mpesa' }
    } else if (method === 'airtel') {
      body.mobile_money = { phone: toInternational(phone), provider: 'atl' }
    } else {
      body.mobile_money = { phone: toInternational(phone), provider: 'mpesa_offline' }
    }

    try {
      const res = await fetch('/api/charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!data.status) {
        setPayment({ status: 'failed', reference: null, message: data.message || data.error || 'Something went wrong', displayText: null, accountNumber: null, accountReference: null })
        return
      }

      const s = data.data.status
      const ref = data.data.reference
      const accountNumber = data.data.account_number || null
      const accountReference = data.data.account_reference != null ? String(data.data.account_reference) : null

      recordPaybillTransaction({
        reference: ref,
        phone,
        amount,
        customer_name: `${firstName} ${lastName}`.trim(),
        email: resolvedEmail,
        payment_method: method,
        account_number: accountNumber,
        account_reference: accountReference,
      })

      if (s === 'pay_offline') {
        setPayment({
          status: 'pay_offline',
          reference: ref,
          message: data.data.message || 'Payment request sent',
          displayText: data.data.display_text || 'Please complete authorization on your mobile phone',
          accountNumber,
          accountReference,
        })

        if (method === 'mpesa_offline' && accountNumber && accountReference) {
          const newPending: PendingPayment = {
            id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            reference: ref,
            accountNumber,
            accountReference,
            amount,
            customerName: `${firstName} ${lastName}`.trim(),
            phone,
            status: 'pending',
            createdAt: new Date().toISOString(),
          }
          setPendingPayments(prev => [newPending, ...prev])
          setListOpen(true)
        }

        if (method !== 'mpesa_offline') startPolling(ref)
      } else if (s === 'send_otp') {
        setPayment({ status: 'send_otp', reference: ref, message: null, displayText: data.data.display_text || 'Enter the OTP sent to your device', accountNumber: null, accountReference: null })
      } else if (s === 'send_birthday') {
        setPayment({ status: 'send_birthday', reference: ref, message: null, displayText: data.data.display_text || 'Enter your date of birth', accountNumber: null, accountReference: null })
      } else if (s === 'success') {
        setPayment({ status: 'success', reference: ref, message: 'Payment completed successfully', displayText: null, accountNumber: null, accountReference: null })
      } else if (s === 'failed') {
        setPayment({ status: 'failed', reference: ref, message: data.data.message || 'Payment failed', displayText: null, accountNumber: null, accountReference: null })
      } else if (s === 'timeout') {
        setPayment({ status: 'timeout', reference: ref, message: data.data.message || 'Transaction timed out', displayText: null, accountNumber: null, accountReference: null })
      }
    } catch {
      setPayment({ status: 'failed', reference: null, message: 'Network error. Please try again.', displayText: null, accountNumber: null, accountReference: null })
    }
  }

  const handleOtpSubmit = async () => {
    if (!otp.trim()) return
    setPayment(prev => ({ ...prev, status: 'verifying' }))
    try {
      const res = await fetch('/api/submit-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: payment.reference, otp }),
      })
      const data = await res.json()
      if (!data.status) {
        setPayment(prev => ({ ...prev, status: 'send_otp', message: data.message || 'Invalid OTP' }))
        return
      }
      const s = data.data.status
      if (s === 'success') {
        setPayment({ status: 'success', reference: payment.reference, message: 'Payment completed successfully', displayText: null, accountNumber: null, accountReference: null })
      } else if (s === 'pay_offline') {
        setPayment(prev => ({ ...prev, status: 'pay_offline', message: data.data.message || 'Processing...', displayText: data.data.display_text }))
        startPolling(payment.reference!)
      } else if (s === 'send_otp') {
        setPayment(prev => ({ ...prev, message: null, displayText: data.data.display_text || 'Incorrect code, try again' }))
        setOtp('')
      } else {
        setPayment(prev => ({ ...prev, status: 'failed', message: data.data.message || 'Something went wrong' }))
      }
    } catch {
      setPayment(prev => ({ ...prev, status: 'failed', message: 'Network error' }))
    }
  }

  const handleBirthdaySubmit = async () => {
    if (!birthday.trim()) return
    setPayment(prev => ({ ...prev, status: 'verifying' }))
    try {
      const res = await fetch('/api/submit-birthday', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: payment.reference, birthday }),
      })
      const data = await res.json()
      if (!data.status) {
        setPayment(prev => ({ ...prev, status: 'send_birthday', message: data.message || 'Invalid date' }))
        return
      }
      const s = data.data.status
      if (s === 'success') {
        setPayment({ status: 'success', reference: payment.reference, message: 'Payment completed successfully', displayText: null, accountNumber: null, accountReference: null })
      } else if (s === 'pay_offline') {
        setPayment(prev => ({ ...prev, status: 'pay_offline', message: data.data.message || 'Processing...', displayText: data.data.display_text }))
        startPolling(payment.reference!)
      } else {
        setPayment(prev => ({ ...prev, status: 'failed', message: data.data.message || 'Something went wrong' }))
      }
    } catch {
      setPayment(prev => ({ ...prev, status: 'failed', message: 'Network error' }))
    }
  }

  const resetForm = () => {
    clearTimers()
    setPayment({ status: 'form', reference: null, message: null, displayText: null, accountNumber: null, accountReference: null })
    setOtp('')
    setBirthday('')
    setErrors({})
    setNotice(null)
  }

  const switchMethod = (m: PaymentMethod) => {
    setMethod(m)
    setErrors({})
    setNotice(null)
  }

  const formatPhone = (val: string) => val.replace(/\D/g, '').slice(0, 10)

  const openTransactions = () => {
    loadTransactions()
    setView('transactions')
  }

  return (
    <div className="relative z-10 flex min-h-dvh flex-col">
      <a
        href="#checkout"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-th-card focus:px-4 focus:py-2 focus:text-sm focus:shadow-lg"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-th-border/80 bg-th-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <button onClick={() => setView('payment')} className="group flex items-center gap-3 rounded-xl text-left">
            <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl border border-th-border bg-th-card shadow-sm">
              <img src="/favicon.jpg" alt="" className="h-full w-full object-cover" />
            </span>
            <span className="hidden flex-col sm:flex">
              <span className="text-sm font-semibold tracking-[-0.02em] text-th-text">STK Pay</span>
              <span className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-th-muted">Checkout</span>
            </span>
          </button>

          <nav className="flex items-center gap-1 rounded-full border border-th-border bg-th-card p-1" aria-label="Main">
            <button
              onClick={() => setView('payment')}
              className={`inline-flex h-8 items-center rounded-full px-3.5 text-xs font-medium transition-colors ${
                view === 'payment' ? 'bg-th-text text-th-bg' : 'text-th-muted hover:text-th-text'
              }`}
            >
              Pay
            </button>
            <button
              onClick={openTransactions}
              className={`inline-flex h-8 items-center rounded-full px-3.5 text-xs font-medium transition-colors ${
                view === 'transactions' ? 'bg-th-text text-th-bg' : 'text-th-muted hover:text-th-text'
              }`}
            >
              Transactions
            </button>
          </nav>

          <div className="flex items-center gap-2">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main id="checkout" className="flex-1">
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8 lg:py-16">
          {view === 'payment' ? (
            <div className="grid items-start gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:gap-14">
              <CheckoutAside amount={amount} method={method} />

              <div className="w-full space-y-5">
                <section className="panel p-6 sm:p-8">
                  {payment.status === 'form' && (
                    <FormView
                      firstName={firstName} setFirstName={setFirstName}
                      lastName={lastName} setLastName={setLastName}
                      email={email} setEmail={setEmail}
                      amount={amount} setAmount={setAmount}
                      method={method} switchMethod={switchMethod}
                      phone={phone} setPhone={setPhone} formatPhone={formatPhone}
                      errors={errors} shakeKey={shakeKey}
                      onSubmit={handleSubmit}
                      pendingCount={pendingPayments.length}
                      onToggleList={() => setListOpen(!listOpen)}
                      listOpen={listOpen}
                      notice={notice}
                    />
                  )}

                  {(payment.status === 'processing' || payment.status === 'verifying') && (
                    <ProcessingView message={payment.message} />
                  )}

                  {payment.status === 'pay_offline' && (
                    <PayOfflineView
                      message={payment.message!}
                      displayText={payment.displayText!}
                      reference={payment.reference!}
                      accountNumber={payment.accountNumber}
                      accountReference={payment.accountReference}
                      amount={amount}
                      method={method}
                      onCheckStatus={checkStatus}
                      onNewPayment={resetForm}
                    />
                  )}

                  {payment.status === 'send_otp' && (
                    <OtpView
                      displayText={payment.displayText!}
                      error={payment.message}
                      otp={otp} setOtp={setOtp}
                      onSubmit={handleOtpSubmit}
                      onCancel={resetForm}
                    />
                  )}

                  {payment.status === 'send_birthday' && (
                    <BirthdayView
                      displayText={payment.displayText!}
                      error={payment.message}
                      birthday={birthday} setBirthday={setBirthday}
                      onSubmit={handleBirthdaySubmit}
                      onCancel={resetForm}
                    />
                  )}

                  {payment.status === 'success' && (
                    <SuccessView reference={payment.reference!} amount={amount} onNewPayment={resetForm} />
                  )}

                  {(payment.status === 'failed' || payment.status === 'timeout') && (
                    <FailedView message={payment.message!} type={payment.status} onRetry={resetForm} />
                  )}
                </section>

                {listOpen && (
                  <PendingPaymentsList
                    payments={pendingPayments}
                    onCheckStatus={checkPendingStatus}
                    onRemove={removePendingPayment}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-4xl">
              <TransactionsPanel
                transactions={dbTransactions}
                loading={transactionsLoading}
                onRefresh={loadTransactions}
                onConfirm={handleConfirmTransaction}
                onBack={() => setView('payment')}
              />
            </div>
          )}
        </div>
      </main>

      <footer className="border-t border-th-border/80">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-th-muted sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>STK Pay · Secure payment checkout</p>
          <p className="flex items-center gap-1.5">
            <Icon name="lock" className="h-3.5 w-3.5" />
            Payments secured by Paystack
          </p>
        </div>
      </footer>
    </div>
  )
}

function CheckoutAside({ amount, method }: { amount: string; method: PaymentMethod }) {
  return (
    <aside className="hidden lg:sticky lg:top-24 lg:flex lg:flex-col">
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-th-primary" />
        <p className="eyebrow">Secure checkout</p>
      </div>
      <h1 className="mt-5 max-w-md text-balance text-4xl font-semibold leading-[1.04] tracking-[-0.045em] text-th-text xl:text-[3.35rem]">
        Pay the way that works for you.
      </h1>
      <p className="mt-5 max-w-sm text-[15px] leading-7 text-th-secondary">
        Settle with M-Pesa, Airtel Money, or your bank card. Every payment is encrypted and confirmed in real time.
      </p>

      <div className="panel-soft mt-9 p-5">
        <div className="flex items-center justify-between">
          <p className="eyebrow">Amount due</p>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-th-primary-soft px-2.5 py-1 text-[11px] font-medium text-th-primary">
            <Icon name="lock" className="h-3 w-3" />
            Encrypted
          </span>
        </div>
        <p className="mt-3 font-mono text-[2rem] font-semibold tracking-[-0.04em] text-th-text">
          <span className="mr-1 text-base font-medium text-th-muted">KES</span>
          {formatAmount(amount)}
        </p>
        <div className="mt-4 flex items-center justify-between border-t border-th-border pt-4">
          <span className="text-xs text-th-muted">Paying with</span>
          <MethodBadge method={method} />
        </div>
      </div>

      <ul className="mt-9 space-y-5">
        <TrustItem icon="bolt" title="Instant confirmation" text="Get a receipt the moment your payment clears." />
        <TrustItem icon="shield" title="Bank-grade security" text="256-bit encryption through Paystack." />
        <TrustItem icon="wallet" title="No card details stored" text="Card data stays inside the secure checkout." />
      </ul>
    </aside>
  )
}

function TrustItem({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-th-border bg-th-card text-th-primary">
        <Icon name={icon} className="h-4 w-4" />
      </span>
      <span>
        <span className="block text-sm font-medium text-th-text">{title}</span>
        <span className="mt-0.5 block text-xs leading-5 text-th-muted">{text}</span>
      </span>
    </li>
  )
}

function InputField({
  label, type = 'text', value, onChange, placeholder, error, helper, min, step, prefix, autoComplete, inputMode, inputClassName,
}: {
  label: string; type?: string; value: string; onChange: (v: string) => void
  placeholder?: string; error?: string; helper?: string; min?: string; step?: string; prefix?: string
  autoComplete?: string; inputMode?: 'text' | 'email' | 'tel' | 'numeric' | 'decimal'; inputClassName?: string
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-medium text-th-secondary">{label}</span>
      <span className="field-shell h-11" data-invalid={error ? 'true' : 'false'}>
        {prefix && <span className="text-xs font-medium text-th-muted">{prefix}</span>}
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          min={min}
          step={step}
          autoComplete={autoComplete}
          inputMode={inputMode}
          className={`h-full w-full min-w-0 bg-transparent text-sm text-th-text outline-none placeholder:text-th-muted/70 ${inputClassName || ''}`}
        />
      </span>
      {error && <span className="mt-1.5 block text-xs text-th-error">{error}</span>}
      {helper && !error && <span className="mt-1.5 block text-[11px] text-th-muted">{helper}</span>}
    </label>
  )
}

function MethodCard({ active, onClick, icon, label, subtitle }: { active: boolean; onClick: () => void; icon: ReactNode; label: string; subtitle: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`group relative flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition-all duration-200 sm:p-3 ${
        active
          ? 'border-th-primary bg-th-primary-soft shadow-[inset_0_0_0_1px_var(--primary)]'
          : 'border-th-border bg-th-card-soft hover:border-th-border-strong hover:bg-th-input'
      }`}
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
        active ? 'bg-th-primary text-th-primary-contrast' : 'bg-th-card text-th-secondary group-hover:text-th-text'
      }`}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium leading-tight text-th-text">{label}</span>
        <span className="mt-0.5 block truncate text-[10px] leading-tight text-th-muted">{subtitle}</span>
      </span>
      {active && (
        <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-th-primary text-th-primary-contrast">
          <Icon name="check" className="h-2.5 w-2.5" />
        </span>
      )}
    </button>
  )
}

function FormView({
  firstName, setFirstName, lastName, setLastName, email, setEmail, amount, setAmount,
  method, switchMethod, phone, setPhone, formatPhone,
  errors, shakeKey, onSubmit, pendingCount, onToggleList, listOpen, notice,
}: {
  firstName: string; setFirstName: (v: string) => void
  lastName: string; setLastName: (v: string) => void
  email: string; setEmail: (v: string) => void
  amount: string; setAmount: (v: string) => void
  method: PaymentMethod; switchMethod: (m: PaymentMethod) => void
  phone: string; setPhone: (v: string) => void; formatPhone: (v: string) => string
  errors: Record<string, string>; shakeKey: number
  onSubmit: () => void
  pendingCount: number; onToggleList: () => void; listOpen: boolean
  notice: string | null
}) {
  const amountValid = amount && Number(amount) > 0
  const cta = method === 'mpesa_offline'
    ? 'Generate paybill details'
    : method === 'card'
      ? 'Continue to secure card checkout'
      : amountValid
        ? `Pay KES ${formatAmount(amount)}`
        : 'Continue to payment'

  return (
    <div key={shakeKey} className={shakeKey > 0 ? 'animate-shake' : ''}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Checkout</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-th-text">Complete your payment</h2>
          <p className="mt-1.5 text-sm text-th-muted">Enter your details and choose how you would like to pay.</p>
        </div>
        {pendingCount > 0 && (
          <button
            type="button"
            onClick={onToggleList}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-th-border bg-th-card-soft px-3 py-1.5 text-[11px] font-medium text-th-secondary transition-colors hover:border-th-border-strong hover:text-th-text"
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-th-primary-soft text-[9px] font-semibold text-th-primary">{pendingCount}</span>
            {listOpen ? 'Hide' : 'Pending'}
          </button>
        )}
      </div>

      {notice && (
        <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-th-border bg-th-card-soft p-3 text-xs leading-5 text-th-secondary animate-rise">
          <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-th-muted" />
          <p>{notice}</p>
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="animate-rise stagger-1">
          <InputField label="First name" value={firstName} onChange={setFirstName} placeholder="Amina" autoComplete="given-name" error={errors.firstName} />
        </div>
        <div className="animate-rise stagger-2">
          <InputField label="Last name" value={lastName} onChange={setLastName} placeholder="Wanjiku" autoComplete="family-name" error={errors.lastName} />
        </div>
      </div>

      <div className="mt-4 animate-rise stagger-2">
        <InputField
          label="Email address"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="amina@example.com"
          autoComplete="email"
          inputMode="email"
          error={errors.email}
          helper={method === 'card' ? 'Required for your card receipt' : 'Optional, for receipts'}
        />
      </div>

      <div className="mt-4 animate-rise stagger-3">
        <InputField
          label="Amount"
          type="number"
          value={amount}
          onChange={setAmount}
          placeholder="1,500.00"
          min="1"
          step="0.01"
          inputMode="decimal"
          prefix="KES"
          error={errors.amount}
        />
      </div>

      <fieldset className="mt-6 animate-rise stagger-4">
        <legend className="mb-2.5 text-xs font-medium text-th-secondary">Payment method</legend>
        <div className="grid grid-cols-2 gap-2.5">
          <MethodCard
            active={method === 'mpesa'} onClick={() => switchMethod('mpesa')}
            icon={<Icon name="phone" className="h-4 w-4" />}
            label="M-Pesa"
            subtitle="STK push"
          />
          <MethodCard
            active={method === 'airtel'} onClick={() => switchMethod('airtel')}
            icon={<Icon name="signal" className="h-4 w-4" />}
            label="Airtel Money"
            subtitle="Mobile money"
          />
          <MethodCard
            active={method === 'card'} onClick={() => switchMethod('card')}
            icon={<Icon name="card" className="h-4 w-4" />}
            label="Card"
            subtitle="Visa · Mastercard"
          />
          <MethodCard
            active={method === 'mpesa_offline'} onClick={() => switchMethod('mpesa_offline')}
            icon={<Icon name="receipt" className="h-4 w-4" />}
            label="Paybill"
            subtitle="Pay later"
          />
        </div>
      </fieldset>

      {method !== 'card' && (
        <div className="mt-4 animate-rise stagger-5">
          <InputField
            label="Phone number"
            type="tel"
            value={phone}
            onChange={v => setPhone(formatPhone(v))}
            placeholder="0712 345 678"
            autoComplete="tel"
            inputMode="tel"
            error={errors.phone}
            helper="Safaricom or Airtel number"
          />
        </div>
      )}

      {method === 'mpesa_offline' && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-th-warning/25 bg-th-warning-soft p-3.5 text-xs leading-5 text-th-warning animate-rise">
          <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Pay after service. You will receive M-Pesa Paybill details to complete payment later.</p>
        </div>
      )}

      {method === 'card' && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-th-border bg-th-card-soft p-3.5 text-xs leading-5 text-th-secondary animate-rise">
          <Icon name="shield" className="mt-0.5 h-4 w-4 shrink-0 text-th-primary" />
          <p>You will enter your card details in Paystack&apos;s secure checkout. We never see or store your card number.</p>
        </div>
      )}

      <button
        onClick={onSubmit}
        className="btn-primary mt-6 h-12 w-full px-6 text-sm"
      >
        <Icon name={method === 'card' ? 'card' : 'lock'} className="h-4 w-4" />
        {cta}
        <Icon name="arrow-right" className="h-4 w-4 opacity-80" />
      </button>

      <p className="mt-3.5 flex items-center justify-center gap-1.5 text-[11px] text-th-muted">
        <Icon name="shield" className="h-3.5 w-3.5" />
        256-bit encrypted · Secured by Paystack
      </p>
    </div>
  )
}

function ProcessingView({ message }: { message?: string | null }) {
  return (
    <div className="flex flex-col items-center py-14 text-center animate-rise">
      <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-th-primary-soft">
        <span className="absolute inset-0 rounded-2xl border border-th-primary/25 animate-ping-soft" />
        <span className="h-7 w-7 rounded-full border-2 border-th-primary/25 border-t-th-primary animate-spin" />
      </div>
      <h2 className="mt-6 text-lg font-semibold tracking-[-0.02em] text-th-text">Processing payment</h2>
      <p className="mt-1.5 max-w-xs text-sm leading-6 text-th-muted">
        {message || 'Please keep this page open while we confirm your transaction.'}
      </p>
    </div>
  )
}

function PayOfflineView({ message, displayText, reference, accountNumber, accountReference, amount, method, onCheckStatus, onNewPayment }: {
  message: string; displayText: string; reference: string
  accountNumber: string | null; accountReference: string | null
  amount: string; method: PaymentMethod
  onCheckStatus: () => void; onNewPayment: () => void
}) {
  const isPaybill = method === 'mpesa_offline'

  return (
    <div className="flex flex-col items-center animate-rise">
      <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${isPaybill ? 'bg-th-warning-soft text-th-warning' : 'bg-th-primary-soft text-th-primary'}`}>
        <Icon name={isPaybill ? 'receipt' : 'phone'} className="h-6 w-6" />
      </div>

      {isPaybill ? (
        <>
          <h2 className="mt-5 text-xl font-semibold tracking-[-0.03em] text-th-text">Paybill details ready</h2>
          <p className="mt-1.5 text-center text-sm text-th-muted">Complete the payment from your M-Pesa menu.</p>

          <div className="mt-6 w-full overflow-hidden rounded-2xl border border-th-border bg-th-card-soft">
            <div className="border-b border-dashed border-th-border-strong px-4 py-3 text-center">
              <p className="eyebrow">M-Pesa paybill</p>
            </div>
            <dl className="divide-y divide-th-border px-4">
              <div className="flex items-center justify-between gap-4 py-3.5">
                <dt className="text-xs text-th-muted">Paybill number</dt>
                <dd className="flex items-center gap-1.5 font-mono text-sm font-semibold tracking-wide text-th-text">
                  {accountNumber}
                  <CopyValue value={accountNumber || ''} />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3.5">
                <dt className="text-xs text-th-muted">Account number</dt>
                <dd className="flex items-center gap-1.5 font-mono text-sm font-semibold tracking-wide text-th-text">
                  {accountReference}
                  <CopyValue value={accountReference || ''} />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3.5">
                <dt className="text-xs text-th-muted">Amount</dt>
                <dd className="font-mono text-sm font-semibold text-th-text">KES {formatAmount(amount)}</dd>
              </div>
            </dl>
          </div>

          <div className="mt-4 w-full rounded-xl border border-th-warning/20 bg-th-warning-soft p-4 text-xs leading-5 text-th-warning">
            <p className="font-semibold">How to pay</p>
            <ol className="mt-2 list-inside list-decimal space-y-1">
              <li>Open M-Pesa and choose Lipa na M-Pesa</li>
              <li>Select Paybill and enter the business number</li>
              <li>Enter the account number and exact amount</li>
              <li>Confirm with your M-Pesa PIN</li>
            </ol>
            <p className="mt-2 font-medium opacity-90">A different amount will fail the payment.</p>
          </div>

          <button onClick={onCheckStatus} className="btn-primary mt-5 h-12 w-full">
            <Icon name="refresh" className="h-4 w-4" />
            Check payment status
          </button>
        </>
      ) : (
        <>
          <h2 className="mt-5 text-xl font-semibold tracking-[-0.03em] text-th-text">Approve on your phone</h2>
          <p className="mt-1.5 text-center text-sm text-th-muted">{displayText}</p>

          <div className="mt-6 w-full rounded-2xl border border-th-border bg-th-card-soft p-4 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-th-primary-soft text-th-primary">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-th-primary opacity-60" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-th-primary" />
              </span>
            </div>
            <p className="mt-3 text-sm font-medium text-th-text">Waiting for confirmation</p>
            <p className="mt-1 text-xs leading-5 text-th-muted">{message}</p>
            <p className="mt-3 text-[11px] text-th-muted">You have 3 minutes to approve the request.</p>
          </div>
        </>
      )}

      <p className="mt-5 break-all text-center text-[11px] text-th-muted">Reference: <span className="font-mono">{reference}</span></p>
      <button onClick={onNewPayment} className="mt-2 text-xs font-medium text-th-muted underline-offset-4 transition-colors hover:text-th-text hover:underline">
        {isPaybill ? 'Start another payment' : 'Try a different method'}
      </button>
    </div>
  )
}

function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {}
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${value}`}
      className="rounded-md p-1 text-th-muted transition-colors hover:bg-th-input hover:text-th-text"
    >
      <Icon name={copied ? 'check' : 'copy'} className={`h-3.5 w-3.5 ${copied ? 'text-th-success' : ''}`} />
    </button>
  )
}

function PendingPaymentsList({ payments, onCheckStatus, onRemove }: {
  payments: PendingPayment[]
  onCheckStatus: (id: string) => void
  onRemove: (id: string) => void
}) {
  if (payments.length === 0) return null

  const pending = payments.filter(p => p.status === 'pending')
  const completed = payments.filter(p => p.status !== 'pending')

  return (
    <section className="panel p-5 animate-rise">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-th-warning-soft text-th-warning">
            <Icon name="clock" className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-th-text">Pending payments</h3>
            <p className="text-[11px] text-th-muted">{pending.length} waiting · {payments.length} total</p>
          </div>
        </div>
      </div>

      <div className="scroll-slim max-h-80 space-y-2 overflow-y-auto pr-1">
        {pending.map(p => (
          <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-th-border bg-th-card-soft p-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-th-warning" />
                <p className="truncate text-sm font-medium text-th-text">{p.customerName}</p>
              </div>
              <p className="mt-1 pl-3.5 text-[11px] text-th-muted">
                KES {formatAmount(p.amount)} · Ref {p.accountReference}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={() => onCheckStatus(p.id)}
                className="rounded-lg bg-th-primary px-2.5 py-1.5 text-[11px] font-semibold text-th-primary-contrast transition-opacity hover:opacity-90"
              >
                Check
              </button>
              <button
                onClick={() => onRemove(p.id)}
                aria-label="Remove from list"
                className="rounded-lg p-1.5 text-th-muted transition-colors hover:bg-th-input hover:text-th-text"
              >
                <Icon name="x" className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}

        {completed.length > 0 && (
          <>
            <p className="pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-th-muted">Resolved</p>
            {completed.map(p => (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-th-border bg-th-card-soft p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Icon
                      name={p.status === 'success' ? 'check' : 'x'}
                      className={`h-3 w-3 shrink-0 ${p.status === 'success' ? 'text-th-success' : 'text-th-error'}`}
                    />
                    <p className="truncate text-sm font-medium text-th-text">{p.customerName}</p>
                  </div>
                  <p className="mt-1 pl-5 text-[11px] text-th-muted">
                    KES {formatAmount(p.amount)} · {p.status === 'success' ? 'Paid' : 'Failed'}
                  </p>
                </div>
                <button
                  onClick={() => onRemove(p.id)}
                  className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium text-th-muted transition-colors hover:bg-th-input hover:text-th-text"
                >
                  Clear
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </section>
  )
}

function TransactionsPanel({ transactions, loading, onRefresh, onConfirm, onBack }: {
  transactions: DbTransaction[]
  loading: boolean
  onRefresh: () => void
  onConfirm: (reference: string) => void
  onBack: () => void
}) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'paid' | 'failed'>('all')
  const [confirming, setConfirming] = useState<string | null>(null)

  const filtered = filter === 'all'
    ? transactions
    : transactions.filter(t => t.status === filter)

  const handleConfirm = async (reference: string) => {
    setConfirming(reference)
    await onConfirm(reference)
    setConfirming(null)
  }

  const filters = ['all', 'pending', 'paid', 'failed'] as const

  return (
    <section className="panel p-5 sm:p-6 animate-rise">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <button onClick={onBack} className="mt-0.5 rounded-lg p-1.5 text-th-muted transition-colors hover:bg-th-input hover:text-th-text" title="Back to checkout">
            <Icon name="arrow-left" className="h-4 w-4" />
          </button>
          <div>
            <p className="eyebrow">Ledger</p>
            <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-th-text">Transactions</h2>
            <p className="mt-1 text-sm text-th-muted">Every payment recorded on this checkout.</p>
          </div>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="rounded-lg p-2 text-th-muted transition-colors hover:bg-th-input hover:text-th-text disabled:opacity-50"
          title="Refresh transactions"
        >
          <Icon name="refresh" className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="mt-6 flex flex-wrap gap-1.5 rounded-full border border-th-border bg-th-card-soft p-1">
        {filters.map(f => {
          const count = f === 'all' ? transactions.length : transactions.filter(t => t.status === f).length
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium capitalize transition-colors ${
                filter === f ? 'bg-th-text text-th-bg' : 'text-th-muted hover:text-th-text'
              }`}
            >
              {f}
              <span className={`rounded-full px-1.5 text-[10px] ${filter === f ? 'bg-th-bg/15' : 'bg-th-input'}`}>{count}</span>
            </button>
          )
        })}
      </div>

      {loading && filtered.length === 0 ? (
        <div className="mt-4 space-y-2" aria-label="Loading transactions">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-[74px] animate-pulse rounded-xl bg-th-card-soft" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-4 flex flex-col items-center rounded-2xl border border-dashed border-th-border-strong bg-th-card-soft px-6 py-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-th-card text-th-muted">
            <Icon name="receipt" className="h-5 w-5" />
          </span>
          <p className="mt-4 text-sm font-medium text-th-text">No transactions yet</p>
          <p className="mt-1 max-w-xs text-xs leading-5 text-th-muted">M-Pesa, Airtel Money, and card payments will appear here after checkout.</p>
        </div>
      ) : (
        <div className="scroll-slim mt-4 max-h-[28rem] space-y-2 overflow-y-auto pr-1">
          {filtered.map(tx => (
            <article key={tx.id} className="rounded-xl border border-th-border bg-th-card-soft p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <MethodIcon method={tx.payment_method} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-sm font-medium text-th-text">{tx.customer_name || tx.phone}</p>
                      <StatusBadge status={tx.status} />
                    </div>
                    <p className="mt-1 text-xs text-th-muted">
                      {tx.payment_method === 'mpesa_offline' && tx.account_reference
                        ? `Ref ${tx.account_reference}`
                        : tx.reference}
                    </p>
                    <p className="mt-1 text-[10px] text-th-muted">
                      {new Date(tx.created_at).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}
                      {tx.confirmed_at ? ' · confirmed' : ''}
                    </p>
                    {tx.notes && <p className="mt-1 text-[10px] text-th-muted">{tx.notes}</p>}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-sm font-semibold text-th-text">KES {formatAmount(String(tx.amount))}</p>
                  <div className="mt-1.5 flex justify-end">
                    <MethodBadge method={tx.payment_method} />
                  </div>
                </div>
              </div>

              {tx.status === 'pending' && (
                <div className="mt-3 flex justify-end border-t border-th-border pt-3">
                  <button
                    onClick={() => handleConfirm(tx.reference)}
                    disabled={confirming === tx.reference}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-th-success/25 bg-th-success-soft px-3 text-[11px] font-semibold text-th-success transition-colors hover:border-th-success/40 disabled:opacity-50"
                  >
                    {confirming === tx.reference ? (
                      <span className="h-3 w-3 rounded-full border-2 border-th-success border-t-transparent animate-spin" />
                    ) : (
                      <Icon name="check" className="h-3.5 w-3.5" />
                    )}
                    Confirm paid
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function StatusBadge({ status }: { status: 'pending' | 'paid' | 'failed' }) {
  const styles = {
    pending: 'bg-th-warning-soft text-th-warning',
    paid: 'bg-th-success-soft text-th-success',
    failed: 'bg-th-error-soft text-th-error',
  }
  const labels = { pending: 'Unpaid', paid: 'Paid', failed: 'Failed' }

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${styles[status]}`}>
      <span className="h-1 w-1 rounded-full bg-current" />
      {labels[status]}
    </span>
  )
}

function MethodBadge({ method }: { method: string }) {
  const labels: Record<string, string> = {
    mpesa: 'M-Pesa',
    airtel: 'Airtel',
    card: 'Card',
    mpesa_offline: 'Paybill',
  }
  const styles: Record<string, string> = {
    mpesa: 'bg-th-success-soft text-th-success',
    airtel: 'bg-th-error-soft text-th-error',
    card: 'bg-th-primary-soft text-th-primary',
    mpesa_offline: 'bg-th-warning-soft text-th-warning',
  }

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${styles[method] || 'bg-th-input text-th-muted'}`}>
      {labels[method] || method}
    </span>
  )
}

function MethodIcon({ method }: { method: string }) {
  const icon: IconName = method === 'card' ? 'card' : method === 'mpesa_offline' ? 'receipt' : method === 'airtel' ? 'signal' : 'phone'

  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-th-border bg-th-card text-th-secondary">
      <Icon name={icon} className="h-4 w-4" />
    </span>
  )
}

function OtpView({ displayText, error, otp, setOtp, onSubmit, onCancel }: {
  displayText: string; error?: string | null; otp: string; setOtp: (v: string) => void; onSubmit: () => void; onCancel: () => void
}) {
  return (
    <div className="animate-rise">
      <div className="flex flex-col items-center pb-6 pt-2 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-th-primary-soft text-th-primary">
          <Icon name="lock" className="h-6 w-6" />
        </div>
        <h2 className="mt-5 text-xl font-semibold tracking-[-0.03em] text-th-text">Verify it&apos;s you</h2>
        <p className="mt-1.5 max-w-xs text-sm leading-6 text-th-muted">{displayText}</p>
        {error && <p className="mt-2 text-xs text-th-error">{error}</p>}
      </div>

      <InputField
        label="One-time code"
        value={otp}
        onChange={v => setOtp(v.replace(/\D/g, '').slice(0, 6))}
        placeholder="000000"
        inputMode="numeric"
        inputClassName="text-center font-mono text-lg tracking-[0.45em]"
      />

      <div className="mt-5 flex gap-3">
        <button onClick={onSubmit} disabled={!otp.trim()} className="btn-primary h-11 flex-1">Verify code</button>
        <button onClick={onCancel} className="btn-secondary h-11 px-5">Cancel</button>
      </div>
    </div>
  )
}

function BirthdayView({ displayText, error, birthday, setBirthday, onSubmit, onCancel }: {
  displayText: string; error?: string | null; birthday: string; setBirthday: (v: string) => void; onSubmit: () => void; onCancel: () => void
}) {
  return (
    <div className="animate-rise">
      <div className="flex flex-col items-center pb-6 pt-2 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-th-primary-soft text-th-primary">
          <Icon name="shield" className="h-6 w-6" />
        </div>
        <h2 className="mt-5 text-xl font-semibold tracking-[-0.03em] text-th-text">Confirm your identity</h2>
        <p className="mt-1.5 max-w-xs text-sm leading-6 text-th-muted">{displayText}</p>
        {error && <p className="mt-2 text-xs text-th-error">{error}</p>}
      </div>

      <InputField label="Date of birth" type="date" value={birthday} onChange={setBirthday} autoComplete="bday" />

      <div className="mt-5 flex gap-3">
        <button onClick={onSubmit} disabled={!birthday.trim()} className="btn-primary h-11 flex-1">Submit date</button>
        <button onClick={onCancel} className="btn-secondary h-11 px-5">Cancel</button>
      </div>
    </div>
  )
}

function SuccessView({ reference, amount, onNewPayment }: { reference: string; amount: string; onNewPayment: () => void }) {
  return (
    <div className="flex flex-col items-center py-10 text-center animate-rise">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-th-success-soft">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-th-success text-white">
          <Icon name="check" className="h-6 w-6" />
        </span>
      </div>
      <h2 className="mt-6 text-2xl font-semibold tracking-[-0.03em] text-th-text">Payment received</h2>
      <p className="mt-2 text-sm text-th-muted">Your transaction was confirmed successfully.</p>

      <div className="mt-6 w-full rounded-2xl border border-th-border bg-th-card-soft p-4">
        <p className="eyebrow">Amount paid</p>
        <p className="mt-2 font-mono text-3xl font-semibold tracking-[-0.04em] text-th-text">KES {formatAmount(amount)}</p>
        <p className="mt-3 break-all border-t border-th-border pt-3 text-[11px] text-th-muted">
          Reference <span className="ml-1 font-mono text-th-secondary">{reference}</span>
        </p>
      </div>

      <button onClick={onNewPayment} className="btn-primary mt-6 h-12 w-full">
        Make another payment
        <Icon name="arrow-right" className="h-4 w-4" />
      </button>
    </div>
  )
}

function FailedView({ message, type, onRetry }: { message: string; type: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center py-10 text-center animate-rise">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-th-error-soft text-th-error">
        <Icon name="alert" className="h-7 w-7" />
      </div>
      <h2 className="mt-6 text-xl font-semibold tracking-[-0.03em] text-th-text">
        {type === 'timeout' ? 'Transaction timed out' : 'Payment failed'}
      </h2>
      <p className="mt-2 max-w-sm text-sm leading-6 text-th-muted">{message}</p>

      <button onClick={onRetry} className="btn-primary mt-6 h-12 w-full">
        <Icon name="refresh" className="h-4 w-4" />
        Try again
      </button>
    </div>
  )
}

function Icon({ name, className = 'h-4 w-4' }: { name: IconName; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    lock: (
      <>
        <rect x="4" y="10" width="16" height="10" rx="2.5" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
    card: (
      <>
        <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
        <path d="M2.5 10h19" />
        <path d="M6.5 15h4" />
      </>
    ),
    phone: (
      <>
        <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
        <path d="M11 18.5h2" />
      </>
    ),
    signal: (
      <>
        <path d="M4 20v-4" />
        <path d="M9 20v-8" />
        <path d="M14 20V8" />
        <path d="M19 20V4" />
      </>
    ),
    receipt: (
      <>
        <path d="M5 3.5h14v17l-3-2-2 2-2-2-2 2-2-2-3 2v-17z" />
        <path d="M9 8h6" />
        <path d="M9 12h6" />
        <path d="M9 16h3" />
      </>
    ),
    check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
    x: (
      <>
        <path d="m6 6 12 12" />
        <path d="M18 6 6 18" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 11a8 8 0 0 0-14.9-3.4L3 10" />
        <path d="M3 4v6h6" />
        <path d="M4 13a8 8 0 0 0 14.9 3.4L21 14" />
        <path d="M21 20v-6h-6" />
      </>
    ),
    'arrow-left': (
      <>
        <path d="M19 12H5" />
        <path d="m11 18-6-6 6-6" />
      </>
    ),
    'arrow-right': (
      <>
        <path d="M5 12h14" />
        <path d="m13 6 6 6-6 6" />
      </>
    ),
    shield: (
      <>
        <path d="M12 2.5 4 6v6c0 4.5 3.4 8.3 8 9.5 4.6-1.2 8-5 8-9.5V6l-8-3.5z" />
        <path d="m8.5 12 2.4 2.4 4.6-4.8" />
      </>
    ),
    bolt: <path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13V2z" />,
    copy: (
      <>
        <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
        <path d="M15.5 8.5v-3a2 2 0 0 0-2-2h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5" />
        <path d="M12 8h.01" />
      </>
    ),
    alert: (
      <>
        <path d="M12 3 2.8 19.5h18.4L12 3z" />
        <path d="M12 9v4.5" />
        <path d="M12 17h.01" />
      </>
    ),
    wallet: (
      <>
        <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 1 3 16.5v-9z" />
        <path d="M3 8h18" />
        <path d="M16 13h2" />
      </>
    ),
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}
