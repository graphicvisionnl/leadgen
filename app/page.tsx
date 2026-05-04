'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { StatsCards } from '@/components/StatsCards'

interface Stats {
  scraped: number
  qualified: number
  deployed: number
  sent: number
  errors: number
  fake_emails: number
  email_ready: number
  added_today: number
  last_lead_at: string | null
  last_activity_at: string | null
  hot_leads: number
  due_followups: number
  replied: number
}

interface LastRun {
  id: string
  niche: string
  city: string
  status: 'running' | 'completed' | 'failed'
  scraped_count: number | null
  qualified_count: number | null
  created_at?: string
  started_at?: string
  completed_at: string | null
  error: string | null
}

const PHASES = [
  { key: 'phase2', label: 'Kwalificeer',  desc: 'Check website + e-mail',        color: 'text-yellow-400' },
  { key: 'phase3', label: 'Redesign',     desc: 'Maak concept na interesse',     color: 'text-purple-400' },
  { key: 'phase4', label: 'Deploy',       desc: 'Zet preview live',              color: 'text-green-400' },
] as const

export default function Dashboard() {
  const [stats, setStats] = useState<Stats>({
    scraped: 0, qualified: 0, deployed: 0, sent: 0, errors: 0,
    fake_emails: 0, email_ready: 0, added_today: 0,
    last_lead_at: null, last_activity_at: null,
    hot_leads: 0, due_followups: 0, replied: 0,
  })
  const [lastRun, setLastRun] = useState<LastRun | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [niche, setNiche] = useState('')
  const [city, setCity] = useState('')
  const [maxLeads, setMaxLeads] = useState(80)
  const [activePhase, setActivePhase] = useState<string | null>(null)
  const [runMessage, setRunMessage] = useState('')
  const [logs, setLogs] = useState<string[]>([])
  const [logOffset, setLogOffset] = useState(0)
  const [showAdvanced, setShowAdvanced] = useState(false)
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

  useEffect(() => {
    if (!activePhase) return
    const interval = setInterval(() => {
      fetchStats()
      fetchLogs(logOffset)
    }, 4000)
    return () => clearInterval(interval)
  }, [activePhase, fetchStats, fetchLogs, logOffset])

  async function triggerScrape() {
    if (activePhase) return
    if (!niche || !city) { setRunMessage('Vul niche en stad in.'); return }
    setActivePhase('phase1')
    setRunMessage('')
    setLogs([])
    setLogOffset(0)

    const res = await fetch('/api/pipeline/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase: 'phase1', niche, city, maxLeads }),
    }).catch(() => null)
    const data = await res?.json()

    if (data?.success) {
      setRunMessage('Scrape gestart')
      setTimeout(() => { setActivePhase(null); fetchStats() }, 20 * 60 * 1000)
    } else {
      setRunMessage(`Fout: ${data?.error ?? 'Verbindingsfout'}`)
      setActivePhase(null)
    }
  }

  async function triggerPhase(phase: string, label: string) {
    if (activePhase) return
    setActivePhase(phase)
    setRunMessage('')
    setLogs([])
    setLogOffset(0)

    const res = await fetch('/api/pipeline/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase }),
    }).catch(() => null)
    const data = await res?.json()

    if (data?.success) {
      setRunMessage(`${label} gestart`)
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

  async function flagFakeEmails() {
    setRunMessage('Fake e-mails scannen...')
    const res = await fetch('/api/leads/flag-fake-emails', { method: 'POST' }).catch(() => null)
    const data = await res?.json().catch(() => ({}))
    setRunMessage(`${data?.count ?? 0} fake/test e-mails als error gemarkeerd`)
    fetchStats()
  }

  const lastLog = logs[logs.length - 1] ?? ''
  const currentPhase = lastLog.includes('[Phase 1]') ? 'Scrapen…'
    : lastLog.includes('[Phase 2]') ? 'Kwalificeren…'
    : lastLog.includes('[Phase 3]') ? 'Redesign genereren…'
    : lastLog.includes('[Phase 4]') ? 'Deployen…'
    : lastLog.includes('[Pipeline]') ? 'Voltooid'
    : activePhase ? 'Verbinden…' : ''

  return (
    <div className="space-y-8">

      {/* Header */}
      <div>
        <p className="text-xs text-brand font-medium uppercase tracking-wider">Graphic Vision Lead Gen</p>
        <h1 className="text-2xl font-bold mt-1">Dashboard</h1>
      </div>

      {/* Key stats */}
      <StatsCards stats={stats} />

      {/* Last run indicator */}
      {lastRun && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/40">
          <span className="flex items-center gap-1.5">
            {lastRun.status === 'running' ? (
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
            ) : lastRun.status === 'failed' ? (
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
            ) : (
              <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
            )}
            Laatste run: {lastRun.niche} · {lastRun.city}
          </span>
          {lastRun.scraped_count != null && (
            <span>{lastRun.scraped_count} gescraped · {lastRun.qualified_count ?? 0} gekwalificeerd</span>
          )}
          {lastRun.status === 'failed' && lastRun.error && (
            <span className="text-red-400 truncate max-w-[200px]">{lastRun.error}</span>
          )}
          <span className="ml-auto">
            {new Date(lastRun.completed_at ?? lastRun.created_at ?? lastRun.started_at ?? Date.now()).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      )}

      {/* Process new leads */}
      <div className="bg-surface border border-subtle rounded-lg p-6">
        <h2 className="font-semibold mb-1">Nieuwe leads verwerken</h2>
        <p className="text-white/40 text-sm mb-5">Scrape Google Maps voor een niche en stad.</p>

        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-white/40">Niche</label>
            <input
              type="text"
              value={niche}
              onChange={e => setNiche(e.target.value)}
              placeholder="bijv. loodgieter"
              className="bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/20 w-44"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-white/40">Stad</label>
            <input
              type="text"
              value={city}
              onChange={e => setCity(e.target.value)}
              placeholder="bijv. Amsterdam"
              className="bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/20 w-44"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-white/40">Max leads</label>
            <input
              type="number"
              value={maxLeads}
              onChange={e => setMaxLeads(Number(e.target.value))}
              min={5}
              max={200}
              className="bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/20 w-24"
            />
          </div>
          <button
            onClick={triggerScrape}
            disabled={activePhase !== null}
            className="px-5 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {activePhase === 'phase1'
              ? <><span className="w-3.5 h-3.5 border border-white/30 border-t-white rounded-full animate-spin" />Bezig…</>
              : '▶ Scrape starten'}
          </button>
        </div>

        {runMessage && (
          <p className="text-xs text-white/40 font-mono mt-3">{runMessage}</p>
        )}

        {/* Live logs while phase1 running */}
        {(activePhase === 'phase1' || (activePhase === null && logs.length > 0)) && (
          <div className="mt-4 space-y-2">
            {currentPhase && (
              <div className="flex items-center gap-2 text-sm text-white/60">
                <span className="w-2 h-2 rounded-full bg-brand animate-pulse" />
                {currentPhase}
              </div>
            )}
            <div
              ref={logRef}
              className="bg-black/40 rounded-lg border border-subtle p-3 h-36 overflow-y-auto font-mono text-xs text-white/50 space-y-0.5"
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
      </div>

      {/* Advanced pipeline controls */}
      <div className="border border-subtle rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setShowAdvanced(v => !v)}
          className="w-full flex items-center justify-between px-5 py-3.5 text-sm text-white/50 hover:text-white/70 hover:bg-white/[0.02] transition-colors"
        >
          <span className="font-medium">Geavanceerde pipeline controls</span>
          <span className="text-white/30">{showAdvanced ? '▲' : '▼'}</span>
        </button>

        {showAdvanced && (
          <div className="border-t border-subtle bg-surface/50 px-5 py-5 space-y-4">
            <p className="text-xs text-white/35">Run individuele stappen handmatig.</p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {PHASES.map(({ key, label, desc, color }) => (
                <div key={key} className="bg-surface border border-subtle rounded-lg p-4 space-y-3">
                  <div>
                    <p className={`text-xs font-medium ${color}`}>{label}</p>
                    <p className="text-xs text-white/30 mt-0.5">{desc}</p>
                  </div>
                  <button
                    onClick={() => triggerPhase(key, label)}
                    disabled={activePhase !== null}
                    className="w-full px-3 py-2 bg-surface-2 border border-subtle text-white/60 rounded-md text-xs font-medium hover:text-white hover:border-white/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                  >
                    {activePhase === key
                      ? <><span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />Bezig…</>
                      : `▶ ${label}`}
                  </button>
                </div>
              ))}
            </div>

            {/* Logs for non-scrape phases */}
            {activePhase && activePhase !== 'phase1' && (
              <div className="space-y-2">
                {currentPhase && (
                  <div className="flex items-center gap-2 text-sm text-white/60">
                    <span className="w-2 h-2 rounded-full bg-brand animate-pulse" />
                    {currentPhase}
                  </div>
                )}
                <div
                  ref={logRef}
                  className="bg-black/40 rounded-lg border border-subtle p-3 h-36 overflow-y-auto font-mono text-xs text-white/50 space-y-0.5"
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

            <div className="pt-2 border-t border-subtle flex flex-wrap gap-3 items-center">
              <button
                onClick={resetErrors}
                className="px-3 py-1.5 bg-surface-2 border border-subtle text-white/50 rounded-md text-xs hover:text-white hover:border-white/20 transition-colors"
              >
                Fouten resetten
              </button>
              <button
                onClick={flagFakeEmails}
                className="px-3 py-1.5 bg-red-500/10 border border-red-500/25 text-red-300 rounded-md text-xs hover:bg-red-500/20 transition-colors"
              >
                Fake e-mails scannen
              </button>
              <button
                onClick={() => fetchLogs(0).then(() => setLogOffset(0))}
                className="px-3 py-1.5 bg-surface-2 border border-subtle text-white/50 rounded-md text-xs hover:text-white hover:border-white/20 transition-colors"
              >
                Logs vernieuwen
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
