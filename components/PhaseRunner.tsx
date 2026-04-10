'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface PhaseRunnerProps {
  phase: string        // 'phase2' | 'phase3' | 'phase4'
  label: string        // 'Kwalificeer alle leads'
  color: string        // tailwind text color class
  leadCount: number
  onDone: () => void
}

export function PhaseRunner({ phase, label, color, leadCount, onDone }: PhaseRunnerProps) {
  const [active, setActive] = useState(false)
  const [message, setMessage] = useState('')
  const [logs, setLogs] = useState<string[]>([])
  const [logOffset, setLogOffset] = useState(0)
  const logRef = useRef<HTMLDivElement>(null)

  const fetchLogs = useCallback(async (offset: number) => {
    const res = await fetch(`/api/pipeline/logs?since=${offset}`).catch(() => null)
    if (!res?.ok) return offset
    const data = await res.json()
    if (data.logs?.length) {
      setLogs(prev => [...prev, ...data.logs].slice(-100))
      setLogOffset(data.total)
      setTimeout(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }), 50)
      return data.total as number
    }
    return offset
  }, [])

  useEffect(() => {
    if (!active) return
    let currentOffset = logOffset
    const interval = setInterval(async () => {
      currentOffset = await fetchLogs(currentOffset)
    }, 3000)
    return () => clearInterval(interval)
  }, [active, fetchLogs, logOffset])

  async function trigger() {
    if (active || leadCount === 0) return
    setActive(true)
    setMessage('')
    setLogs([])
    setLogOffset(0)

    const res = await fetch('/api/pipeline/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase }),
    }).catch(() => null)
    const data = await res?.json()

    if (data?.success) {
      setMessage(`${label} gestart`)
      // Auto-stop polling after 20 min
      setTimeout(() => { setActive(false); onDone() }, 20 * 60 * 1000)
    } else {
      setMessage(`Fout: ${data?.error ?? 'Verbindingsfout'}`)
      setActive(false)
    }
  }

  function stop() {
    setActive(false)
    onDone()
  }

  return (
    <div className="bg-surface rounded-xl border border-subtle p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className={`text-sm font-semibold ${color}`}>{label}</p>
          <p className="text-xs text-white/35 mt-0.5">{leadCount} lead{leadCount !== 1 ? 's' : ''} klaar</p>
        </div>
        <div className="flex items-center gap-2">
          {message && <p className="text-xs text-white/40 font-mono">{message}</p>}
          {active && (
            <button onClick={stop} className="px-3 py-1.5 text-xs text-white/40 hover:text-white/70 border border-subtle rounded-lg transition-colors">
              Stop
            </button>
          )}
          <button
            onClick={trigger}
            disabled={active || leadCount === 0}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              leadCount === 0 ? 'bg-surface-2 border border-subtle text-white/30' : 'bg-white/10 border border-white/20 text-white hover:bg-white/15'
            }`}
          >
            {active
              ? <><span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />Bezig…</>
              : `▶ ${label}`}
          </button>
        </div>
      </div>

      {(active || logs.length > 0) && (
        <div
          ref={logRef}
          className="bg-black/40 rounded-lg border border-subtle p-3 h-32 overflow-y-auto font-mono text-xs text-white/50 space-y-0.5"
        >
          {logs.length === 0
            ? <p className="text-white/20">Wachten op logs…</p>
            : logs.map((line, i) => {
                const isError = /fout|mislukt/i.test(line)
                const isGood = /qualified|klaar|live:|voltooid/i.test(line)
                return (
                  <p key={i} className={isError ? 'text-red-400' : isGood ? 'text-green-400' : ''}>
                    {line.replace(/\[[\d-T:.Z]+\] /, '')}
                  </p>
                )
              })}
        </div>
      )}
    </div>
  )
}
