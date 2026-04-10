'use client'

import { useState, useEffect, useCallback } from 'react'
import { LeadsTable } from '@/components/LeadsTable'
import { PhaseRunner } from '@/components/PhaseRunner'
import { Lead } from '@/types'

export default function RedesignsPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const fetchLeads = useCallback(async () => {
    const res = await fetch('/api/leads?status=redesigned')
    const data = await res.json()
    setLeads(data.leads ?? [])
  }, [])

  useEffect(() => {
    fetchLeads().finally(() => setIsLoading(false))
  }, [fetchLeads])

  // Leads that have been redesigned but not yet deployed
  const pendingDeploy = leads.filter(l => l.status === 'redesigned')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Redesigns</h1>
        <p className="text-white/45 text-sm mt-1">Automatisch gegenereerd na reactie — Email 2 concept klaar voor review</p>
      </div>
      {pendingDeploy.length > 0 && (
        <PhaseRunner
          phase="phase4"
          label="Deploy naar Vercel"
          color="text-green-400"
          leadCount={pendingDeploy.length}
          onDone={fetchLeads}
        />
      )}
      <LeadsTable
        leads={leads}
        statusFilter="redesigned"
        onFilterChange={() => {}}
        isLoading={isLoading}
        onRefresh={fetchLeads}
      />
    </div>
  )
}
