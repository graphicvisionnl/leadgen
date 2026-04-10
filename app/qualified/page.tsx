'use client'

import { useState, useEffect, useCallback } from 'react'
import { LeadsTable } from '@/components/LeadsTable'
import { PhaseRunner } from '@/components/PhaseRunner'
import { Lead } from '@/types'

export default function QualifiedPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const fetchLeads = useCallback(async () => {
    const res = await fetch('/api/leads?status=qualified')
    const data = await res.json()
    setLeads(data.leads ?? [])
  }, [])

  useEffect(() => {
    fetchLeads().finally(() => setIsLoading(false))
  }, [fetchLeads])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Gekwalificeerd</h1>
        <p className="text-white/45 text-sm mt-1">Leads klaar voor redesign generatie</p>
      </div>
      <PhaseRunner
        phase="phase3"
        label="Genereer redesigns"
        color="text-purple-400"
        leadCount={leads.length}
        onDone={fetchLeads}
      />
      <LeadsTable
        leads={leads}
        statusFilter="qualified"
        onFilterChange={() => {}}
        isLoading={isLoading}
        onRefresh={fetchLeads}
      />
    </div>
  )
}
