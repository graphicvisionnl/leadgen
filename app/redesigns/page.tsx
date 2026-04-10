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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Redesigns</h1>
        <p className="text-white/45 text-sm mt-1">Websites gegenereerd, klaar voor deployment</p>
      </div>
      <PhaseRunner
        phase="phase4"
        label="Deploy naar Vercel"
        color="text-green-400"
        leadCount={leads.length}
        onDone={fetchLeads}
      />
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
