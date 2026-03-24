'use client'

import { useState, useEffect, useCallback } from 'react'
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
  const [phaseLoading, setPhaseLoading] = useState<string | null>(null)
  const [niche, setNiche] = useState('')
  const [city, setCity] = useState('')
  const [maxLeads, setMaxLeads] = useState(30)

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

  useEffect(() => {
    Promise.all([fetchLeads(), fetchStats(), fetchSettings()]).finally(() =>
      setIsLoading(false)
    )
  }, [fetchLeads, fetchStats, fetchSettings])

  // Poll every 5s while pipeline is running
  useEffect(() => {
    if (!isRunning) return
    const interval = setInterval(() => {
      fetchLeads()
      fetchStats()
    }, 5000)
    return () => clearInterval(interval)
  }, [isRunning, fetchLeads, fetchStats])

  async function triggerPhase(phase: string, body: object = {}) {
    setPhaseLoading(phase)
    setRunMessage('')
    try {
      const res = await fetch(`/api/pipeline/${phase}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'manual', ...body }),
      })
      const data = await res.json()
      setRunMessage(`Phase ${phase}: ${JSON.stringify(data)}`)
      fetchLeads()
      fetchStats()
    } catch (err) {
      setRunMessage(`Fout: ${String(err)}`)
    } finally {
      setPhaseLoading(null)
    }
  }

  async function triggerPipeline() {
    if (!niche || !city) {
      setRunMessage('Vul niche en stad in.')
      return
    }
    setIsRunning(true)
    setRunMessage('Pipeline gestart…')
    try {
      const res = await fetch('/api/pipeline/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ niche, city, maxLeads }),
      })
      const data = await res.json()
      if (data.success) {
        setRunMessage(`Pipeline gestart (run ID: ${data.runId})`)
        // Stop polling after 10 minutes
        setTimeout(() => setIsRunning(false), 10 * 60 * 1000)
      } else {
        setRunMessage('Fout bij starten pipeline.')
        setIsRunning(false)
      }
    } catch {
      setRunMessage('Verbindingsfout.')
      setIsRunning(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-white/45 text-sm mt-1">
            Beheer je lead generation pipeline
          </p>
        </div>
      </div>

      {/* Stats */}
      <StatsCards stats={stats} />

      {/* Pipeline trigger */}
      <div className="bg-surface rounded-xl border border-subtle p-6">
        <h2 className="font-semibold mb-4">Pipeline starten</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-white/40 mb-1.5">Niche</label>
            <input
              type="text"
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              placeholder="bijv. loodgieter"
              className="bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/20 w-44"
            />
          </div>
          <div>
            <label className="block text-xs text-white/40 mb-1.5">Stad</label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="bijv. Amsterdam"
              className="bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/20 w-44"
            />
          </div>
          <button
            onClick={triggerPipeline}
            disabled={isRunning}
            className="px-5 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isRunning ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Bezig…
              </>
            ) : (
              'Pipeline starten →'
            )}
          </button>
        </div>
        {runMessage && (
          <p className="text-xs text-white/45 mt-3 font-mono break-all">{runMessage}</p>
        )}

        {/* Manual phase triggers */}
        <div className="mt-5 pt-5 border-t border-subtle">
          <p className="text-xs text-white/30 mb-3">Handmatig per fase triggeren (als de pipeline vastloopt)</p>
          <div className="flex flex-wrap gap-2">
            {(['phase2', 'phase3', 'phase4'] as const).map((phase) => (
              <button
                key={phase}
                onClick={() => triggerPhase(phase)}
                disabled={phaseLoading !== null}
                className="px-3 py-1.5 bg-surface-2 border border-subtle text-white/50 rounded-lg text-xs hover:text-white hover:border-white/20 transition-colors disabled:opacity-40"
              >
                {phaseLoading === phase ? (
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 border border-white/30 border-t-white rounded-full animate-spin" />
                    {phase}…
                  </span>
                ) : (
                  `▶ ${phase}`
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Leads table */}
      <div>
        <h2 className="font-semibold mb-4">Leads</h2>
        <LeadsTable
          leads={leads}
          statusFilter={statusFilter}
          onFilterChange={(s) => {
            setStatusFilter(s)
            setIsLoading(true)
            fetchLeads().finally(() => setIsLoading(false))
          }}
          isLoading={isLoading}
        />
      </div>
    </div>
  )
}
