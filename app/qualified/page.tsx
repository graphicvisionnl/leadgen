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

  // Only leads with email that haven't been sent yet
  const readyToEmail = leads.filter(l => l.email && !l.email1_sent_at)

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
    </div>
  )
}
