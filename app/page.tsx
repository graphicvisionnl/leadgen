'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { StatsCards } from '@/components/StatsCards'

interface Stats {
  scraped: number
  qualified: number
  deployed: number
  sent: number
  hot_leads: number
  due_followups: number
}

interface LastRun {
  id: string
  niche: string
  city: string
  status: 'running' | 'completed' | 'failed'
  scraped_count: number | null
  qualified_count: number | null
  created_at: string
  completed_at: string | null
  error: string | null
}

const PHASES = [
  { key: 'phase1', label: 'Leads scrapen',       desc: 'Apify scraper',         color: 'text-blue-400' },
  { key: 'phase2', label: 'Kwalificeren',         desc: 'Haiku beoordeelt',      color: 'text-yellow-400' },
  { key: 'phase3', label: 'Redesign genereren',   desc: 'Opus bouwt HTML',       color: 'text-purple-400' },
  { key: 'phase4', label: 'Deployen',             desc: 'Vercel deployment',     color: 'text-green-400' },
] as const

const NAV_CARDS = [
  { href: '/scraped',   label: 'Gescraped',      desc: 'Wacht op kwalificatie',  color: 'text-blue-400',   stat: 'scraped' },
  { href: '/qualified', label: 'Gekwalificeerd',  desc: 'Klaar voor redesign',    color: 'text-yellow-400', stat: 'qualified' },
  { href: '/redesigns', label: 'Redesigns',       desc: 'Klaar voor deployment',  color: 'text-purple-400', stat: null },
  { href: '/deployed',  label: 'Deployed',        desc: 'Klaar om te versturen',  color: 'text-brand',      stat: 'deployed' },
  { href: '/contacted', label: 'Benaderd',        desc: 'CRM & sequentie',        color: 'text-green-400',  stat: 'sent' },
] as const

export default function Dashboard() {
  const [stats, setStats] = useState<Stats>({ scraped: 0, qualified: 0, deployed: 0, sent: 0, hot_leads: 0, due_followups: 0 })
  const [lastRun, setLastRun] = useState<LastRun | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [niche, setNiche] = useState('')
  const [city, setCity] = useState('')
  const [maxLeads, setMaxLeads] = useState(30)
  const [activePhase, setActivePhase] = useState<string | null>(null)
  const [runMessage, setRunMessage] = useState('')
  const [logs, setLogs] = useState<string[]>([])
  const [logOffset, setLogOffset] = useState(0)
  const logRef = useRef<HTMLDivElement>(null)

  const fetchStats = useCallback(async () => {
    const res = await fetch('/api/leads/stats')
    const data = await res.json()
    setStats(data)
  }, [])

  const fetchLogs = useCallback(async (offset: number) => {
    const res = await fetch(`/api/pipeline/logs?since=${offset}`).catch(() => null)
    if (!res?.ok) return
    const data = await res.json()
    if (data.logs?.length) {
      setLogs(prev => [...prev, ...data.logs].slice(-150))
      setLogOffset(data.total)
      setTimeout(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }), 50)
    }
  }, [])

  useEffect(() => {
    Promise.all([
      fetchStats(),
      fetch('/api/pipeline/last-run').then(r => r.json()).then(data => setLastRun(data)).catch(() => null),
    ])
      .then(() => {
        fetch('/api/settings').then(r => r.json()).then(data => {
          if (data.default_niche) setNiche(data.default_niche)
          if (data.default_city) setCity(data.default_city)
          if (data.max_leads) setMaxLeads(parseInt(data.max_leads))
        }).catch(() => null)
      })
      .finally(() => setIsLoading(false))
  }, [fetchStats])

  // Poll while a phase is running
  useEffect(() => {
    if (!activePhase) return
    const interval = setInterval(() => {
      fetchStats()
      fetchLogs(logOffset)
    }, 4000)
    return () => clearInterval(interval)
  }, [activePhase, fetchStats, fetchLogs, logOffset])

  async function triggerPhase(phase: string) {
    if (activePhase) return
    setActivePhase(phase)
    setRunMessage('')
    setLogs([])
    setLogOffset(0)

    const body: Record<string, unknown> = { phase }
    if (phase === 'phase1') {
      if (!niche || !city) { setRunMessage('Vul niche en stad in.'); setActivePhase(null); return }
      body.niche = niche
      body.city = city
      body.maxLeads = maxLeads
    }

    const res = await fetch('/api/pipeline/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null)
    const data = await res?.json()

    if (data?.success) {
      setRunMessage(`${PHASES.find(p => p.key === phase)?.label} gestart`)
      setTimeout(() => { setActivePhase(null); fetchStats() }, 20 * 60 * 1000)
    } else {
      setRunMessage(`Fout: ${data?.error ?? 'Verbindingsfout'}`)
      setActivePhase(null)
    }
  }

  async function resetErrors() {
    setRunMessage('Fouten resetten…')
    const res = await fetch('/api/leads/reset-errors', { method: 'POST' }).catch(() => null)
    const data = await res?.json()
    setRunMessage(`${data?.count ?? 0} leads gereset`)
    fetchStats()
  }

  const lastLog = logs[logs.length - 1] ?? ''
  const currentPhase = lastLog.includes('[Phase 1]') ? 'Phase 1: scrapen'
    : lastLog.includes('[Phase 2]') ? 'Phase 2: kwalificeren'
    : lastLog.includes('[Phase 3]') ? 'Phase 3: redesign genereren'
    : lastLog.includes('[Phase 4]') ? 'Phase 4: deployen'
    : lastLog.includes('[Pipeline]') ? 'Voltooid'
    : activePhase ? 'Verbinden…' : ''

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-white/45 text-sm mt-1">Beheer je lead generation pipeline</p>
      </div>

      <StatsCards stats={stats} />

      {/* Last cron run */}
      {lastRun && (
        <div className="bg-surface rounded-xl border border-subtle p-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div className="flex items-center gap-2">
            {lastRun.status === 'running' ? (
              <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
            ) : lastRun.status === 'failed' ? (
              <span className="w-2 h-2 rounded-full bg-red-400" />
            ) : (
              <span className="w-2 h-2 rounded-full bg-green-400" />
            )}
            <span className="font-medium text-white/80">Laatste run</span>
          </div>
          <span className="text-white/50">
            {lastRun.niche} · {lastRun.city}
          </span>
          {lastRun.scraped_count != null && (
            <span className="text-white/40 text-xs">{lastRun.scraped_count} gescraped · {lastRun.qualified_count ?? 0} gekwalificeerd</span>
          )}
          {lastRun.status === 'failed' && lastRun.error && (
            <span className="text-red-400 text-xs truncate max-w-[200px]" title={lastRun.error}>{lastRun.error}</span>
          )}
          <span className="text-white/30 text-xs ml-auto">
            {new Date(lastRun.completed_at ?? lastRun.created_at).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      )}

      {/* Quick nav cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {NAV_CARDS.map(card => (
          <Link
            key={card.href}
            href={card.href}
            className="bg-surface border border-subtle rounded-xl p-4 hover:border-white/20 hover:bg-white/[0.04] transition-all group"
          >
            <p className={`text-sm font-semibold ${card.color} group-hover:opacity-100`}>{card.label}</p>
            <p className="text-xs text-white/35 mt-1">{card.desc}</p>
            {card.stat && (
              <p className="text-lg font-bold text-white mt-2">
                {isLoading ? '—' : stats[card.stat as keyof Stats]}
              </p>
            )}
          </Link>
        ))}
      </div>

      {/* Pipeline phases */}
      <div className="bg-surface rounded-xl border border-subtle p-6 space-y-5">
        <h2 className="font-semibold">Pipeline</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {PHASES.map(({ key, label, desc, color }) => (
            <div key={key} className="bg-surface-2 border border-subtle rounded-xl p-4 space-y-3">
              <div>
                <p className={`text-xs font-medium ${color}`}>{label}</p>
                <p className="text-xs text-white/30 mt-0.5">{desc}</p>
              </div>

              {/* Phase 1 inputs */}
              {key === 'phase1' && (
                <div className="space-y-2">
                  <input
                    type="text" value={niche} onChange={e => setNiche(e.target.value)}
                    placeholder="Niche (bijv. loodgieter)"
                    className="w-full bg-surface border border-subtle rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-white/25 focus:outline-none focus:border-white/20"
                  />
                  <input
                    type="text" value={city} onChange={e => setCity(e.target.value)}
                    placeholder="Stad (bijv. Amsterdam)"
                    className="w-full bg-surface border border-subtle rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-white/25 focus:outline-none focus:border-white/20"
                  />
                  <input
                    type="number" value={maxLeads} onChange={e => setMaxLeads(Number(e.target.value))}
                    min={5} max={100}
                    className="w-full bg-surface border border-subtle rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-white/20"
                  />
                </div>
              )}

              <button
                onClick={() => triggerPhase(key)}
                disabled={activePhase !== null}
                className="w-full px-3 py-2 bg-surface border border-subtle text-white/60 rounded-lg text-xs font-medium hover:text-white hover:border-white/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
              >
                {activePhase === key
                  ? <><span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />Bezig…</>
                  : `▶ ${label}`}
              </button>
            </div>
          ))}
        </div>

        {/* Live logs */}
        {(activePhase || logs.length > 0) && (
          <div className="space-y-2">
            {currentPhase && (
              <div className="flex items-center gap-2 text-sm text-white/60">
                <span className="w-2 h-2 rounded-full bg-brand animate-pulse" />
                {currentPhase}
              </div>
            )}
            <div
              ref={logRef}
              className="bg-black/40 rounded-lg border border-subtle p-3 h-40 overflow-y-auto font-mono text-xs text-white/50 space-y-0.5"
            >
              {logs.length === 0
                ? <p className="text-white/20">Wachten op logs…</p>
                : logs.map((line, i) => {
                    const isError = line.includes('Fout') || line.includes('mislukt')
                    const isGood = line.includes('QUALIFIED') || line.includes('Klaar') || line.includes('Live:') || line.includes('voltooid')
                    return (
                      <p key={i} className={isError ? 'text-red-400' : isGood ? 'text-green-400' : ''}>
                        {line.replace(/\[[\d-T:.Z]+\] /, '')}
                      </p>
                    )
                  })}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="pt-2 border-t border-subtle flex flex-wrap gap-3 items-center">
          <button
            onClick={resetErrors}
            className="px-3 py-1.5 bg-surface-2 border border-subtle text-white/50 rounded-lg text-xs hover:text-white hover:border-white/20 transition-colors"
          >
            Fouten resetten
          </button>
          <button
            onClick={() => fetchLogs(0).then(() => setLogOffset(0))}
            className="px-3 py-1.5 bg-surface-2 border border-subtle text-white/50 rounded-lg text-xs hover:text-white hover:border-white/20 transition-colors"
          >
            Logs vernieuwen
          </button>
          {runMessage && <p className="text-xs text-white/40 font-mono">{runMessage}</p>}
        </div>
      </div>
    </div>
  )
}
