'use client'

import { useState, useEffect, useCallback } from 'react'
import { LeadsTable } from '@/components/LeadsTable'
import { PhaseRunner } from '@/components/PhaseRunner'
import { Lead } from '@/types'

export default function QualifiedPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const PAGE_SIZE = 50

  const fetchLeads = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/leads?status=qualified&page=${page}`)
      const data = await res.json()
      setLeads(data.leads ?? [])
      setTotal(data.total ?? 0)
      setTotalPages(Math.max(data.totalPages ?? 1, 1))
    } finally {
      setIsLoading(false)
    }
  }, [page])

  useEffect(() => {
    fetchLeads()
  }, [fetchLeads])

  // Only leads with email that haven't been sent yet
  const readyToEmail = leads.filter(l => l.email && !l.email1_sent_at)
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeEnd = total === 0 ? 0 : rangeStart + leads.length - 1

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Gekwalificeerd</h1>
        <p className="text-white/45 text-sm mt-1">Leads klaar voor e-mailsequentie — redesign pas na reactie</p>
      </div>
      <PhaseRunner
        phase="email-qualified"
        label="Genereer sequentie + verstuur Email 1"
        color="text-blue-400"
        leadCount={readyToEmail.length}
        onDone={fetchLeads}
      />
      <LeadsTable
        leads={leads}
        statusFilter="qualified"
        onFilterChange={() => {}}
        isLoading={isLoading}
        onRefresh={fetchLeads}
      />
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-white/40">
          {total === 0
            ? 'Geen leads'
            : `${rangeStart}–${rangeEnd} van ${total} leads`}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || isLoading}
            className="px-3 py-1.5 rounded-lg text-xs bg-surface border border-subtle text-white/60 hover:text-white hover:border-white/20 transition-colors disabled:opacity-40 disabled:hover:text-white/60"
          >
            ← Vorige
          </button>
          <span className="text-xs text-white/45 min-w-[96px] text-center">
            Pagina {page} van {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || isLoading}
            className="px-3 py-1.5 rounded-lg text-xs bg-surface border border-subtle text-white/60 hover:text-white hover:border-white/20 transition-colors disabled:opacity-40 disabled:hover:text-white/60"
          >
            Volgende →
          </button>
        </div>
      </div>
    </div>
  )
}
