'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { StatsCards } from '@/components/StatsCards'
import { LeadsTable } from '@/components/LeadsTable'
import { Lead } from '@/types'

interface Stats {
  scraped: number
  qualified: number
  deployed: number
  sent: number
}

export default function Dashboard() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [stats, setStats] = useState<Stats>({ scraped: 0, qualified: 0, deployed: 0, sent: 0 })
  const [isLoading, setIsLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [isRunning, setIsRunning] = useState(false)
  const [runMessage, setRunMessage] = useState('')
  const [niche, setNiche] = useState('')
  const [city, setCity] = useState('')
  const [maxLeads, setMaxLeads] = useState(30)
  const [debugMode, setDebugMode] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [logOffset, setLogOffset] = useState(0)
  const [phaseLoading, setPhaseLoading] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const fetchLeads = useCallback(async () => {
    const params = new URLSearchParams()
    if (statusFilter !== 'all') params.set('status', statusFilter)
    const res = await fetch(`/api/leads?${params}`)
    const data = await res.json()
    setLeads(data.leads ?? [])
  }, [statusFilter])

  const fetchStats = useCallback(async () => {
    const res = await fetch('/api/leads/stats')
    const data = await res.json()
    setStats(data)
  }, [])

  const fetchSettings = useCallback(async () => {
    const res = await fetch('/api/settings')
    const data = await res.json()
    if (data.default_niche) setNiche(data.default_niche)
    if (data.default_city) setCity(data.default_city)
    if (data.max_leads) setMaxLeads(parseInt(data.max_leads))
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
    Promise.all([fetchLeads(), fetchStats(), fetchSettings()]).finally(() =>
      setIsLoading(false)
    )
  }, [fetchLeads, fetchStats, fetchSettings])

  // Poll leads + logs while running
  useEffect(() => {
    if (!isRunning) return
    const interval = setInterval(() => {
      fetchLeads()
      fetchStats()
      fetchLogs(logOffset)
    }, 4000)
    return () => clearInterval(interval)
  }, [isRunning, fetchLeads, fetchStats, fetchLogs, logOffset])

  async function resetErrors() {
    setRunMessage('Fouten resetten…')
    const res = await fetch('/api/leads/reset-errors', { method: 'POST' }).catch(() => null)
    const data = await res?.json()
    setRunMessage(`${data?.count ?? 0} leads gereset naar scraped`)
    fetchLeads()
    fetchStats()
  }

  async function triggerPhase(phase: string) {
    setPhaseLoading(phase)
    setRunMessage('')
    setIsRunning(true)
    const res = await fetch('/api/pipeline/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase }),
    }).catch(() => null)
    const data = await res?.json()
    if (data?.success) {
      setRunMessage(`${phase} gestart op Hetzner`)
      setTimeout(() => setIsRunning(false), 20 * 60 * 1000)
    } else {
      setRunMessage(`Fout: ${data?.error ?? 'onbekend'}`)
      setIsRunning(false)
    }
    setPhaseLoading(null)
  }

  async function triggerPipeline() {
    if (!niche || !city) { setRunMessage('Vul niche en stad in.'); return }
    setIsRunning(true)
    setLogs([])
    setLogOffset(0)
    setRunMessage('')
    const res = await fetch('/api/pipeline/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ niche, city, maxLeads }),
    }).catch(() => null)
    const data = await res?.json()
    if (data?.success) {
      setTimeout(() => setIsRunning(false), 20 * 60 * 1000)
    } else {
      setRunMessage(`Fout: ${data?.error ?? 'Verbindingsfout'}`)
      setIsRunning(false)
    }
  }

  const lastLog = logs[logs.length - 1] ?? ''
  const currentPhase = lastLog.includes('[Phase 1]') ? 'Phase 1: scrapen'
    : lastLog.includes('[Phase 2]') ? 'Phase 2: kwalificeren'
    : lastLog.includes('[Phase 3]') ? 'Phase 3: redesign genereren'
    : lastLog.includes('[Phase 4]') ? 'Phase 4: deployen'
    : lastLog.includes('[Pipeline]') ? 'Voltooid'
    : isRunning ? 'Verbinden…' : ''

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-white/45 text-sm mt-1">Beheer je lead generation pipeline</p>
        </div>
      </div>

      <StatsCards stats={stats} />

      {/* Pipeline control */}
      <div className="bg-surface rounded-xl border border-subtle p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Pipeline</h2>
          <button
            onClick={() => setDebugMode(d => !d)}
            className={`px-3 py-1 rounded-lg text-xs border transition-colors ${debugMode ? 'bg-brand/20 border-brand/40 text-brand' : 'bg-surface-2 border-subtle text-white/40 hover:text-white/60'}`}
          >
            {debugMode ? 'Debug aan' : 'Debug'}
          </button>
        </div>

        {/* Auto mode */}
        {!debugMode && (
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs text-white/40 mb-1.5">Niche</label>
              <input
                type="text" value={niche} onChange={e => setNiche(e.target.value)}
                placeholder="bijv. loodgieter"
                className="bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/20 w-44"
              />
            </div>
            <div>
              <label className="block text-xs text-white/40 mb-1.5">Stad</label>
              <input
                type="text" value={city} onChange={e => setCity(e.target.value)}
                placeholder="bijv. Amsterdam"
                className="bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/20 w-44"
              />
            </div>
            <button
              onClick={triggerPipeline} disabled={isRunning}
              className="px-5 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isRunning ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Bezig…</> : 'Pipeline starten →'}
            </button>
          </div>
        )}

        {/* Debug mode */}
        {debugMode && (
          <div className="space-y-3">
            <p className="text-xs text-white/30">Trigger een fase handmatig op Hetzner — verwerkt alle leads in de juiste status.</p>
            <div className="flex flex-wrap gap-2">
              {(['phase2', 'phase3', 'phase4'] as const).map(phase => (
                <button
                  key={phase}
                  onClick={() => triggerPhase(phase)}
                  disabled={phaseLoading !== null}
                  className="px-4 py-2 bg-surface-2 border border-subtle text-white/60 rounded-lg text-sm hover:text-white hover:border-white/20 transition-colors disabled:opacity-40 flex items-center gap-2"
                >
                  {phaseLoading === phase
                    ? <><span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />{phase}…</>
                    : `▶ ${phase}`}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Status + live logs */}
        {(isRunning || logs.length > 0) && (
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

        {/* Footer actions */}
        <div className="pt-2 border-t border-subtle flex gap-3">
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
          {runMessage && <p className="text-xs text-white/40 font-mono self-center">{runMessage}</p>}
        </div>
      </div>

      {/* Leads table */}
      <div>
        <h2 className="font-semibold mb-4">Leads</h2>
        <LeadsTable
          leads={leads}
          statusFilter={statusFilter}
          onFilterChange={s => { setStatusFilter(s); setIsLoading(true); fetchLeads().finally(() => setIsLoading(false)) }}
          isLoading={isLoading}
        />
      </div>
    </div>
  )
}
