'use client'

import { useState, useRef, KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [digits, setDigits] = useState(['', '', '', ''])
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)
  const inputs = useRef<(HTMLInputElement | null)[]>([])
  const router = useRouter()

  async function submit(code: string) {
    setLoading(true)
    setError(false)
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    if (res.ok) {
      router.replace('/')
    } else {
      setError(true)
      setDigits(['', '', '', ''])
      inputs.current[0]?.focus()
    }
    setLoading(false)
  }

  function onInput(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1)
    const next = [...digits]
    next[index] = digit
    setDigits(next)
    setError(false)

    if (digit && index < 3) {
      inputs.current[index + 1]?.focus()
    }

    if (digit && index === 3) {
      const code = next.join('')
      if (code.length === 4) submit(code)
    }
  }

  function onKey(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputs.current[index - 1]?.focus()
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-8">
        <div>
          <p className="text-white/40 text-sm font-medium tracking-widest uppercase">Graphic Vision</p>
          <h1 className="text-2xl font-bold mt-1">Toegangscode</h1>
        </div>

        <div className="flex gap-3 justify-center">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={el => { inputs.current[i] = el }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={d}
              autoFocus={i === 0}
              onChange={e => onInput(i, e.target.value)}
              onKeyDown={e => onKey(i, e)}
              className={`w-14 h-16 text-center text-2xl font-bold bg-surface border rounded-xl focus:outline-none transition-colors ${
                error
                  ? 'border-red-500/60 text-red-400'
                  : d
                  ? 'border-white/30 text-white'
                  : 'border-subtle text-white/60'
              } focus:border-white/40`}
            />
          ))}
        </div>

        {error && (
          <p className="text-red-400 text-sm">Verkeerde code, probeer opnieuw</p>
        )}

        {loading && (
          <p className="text-white/30 text-sm">Controleren…</p>
        )}
      </div>
    </div>
  )
}
