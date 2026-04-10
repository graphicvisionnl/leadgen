'use client'

import { useState, useEffect, useCallback } from 'react'
import { LeadsTable } from '@/components/LeadsTable'
import { Lead } from '@/types'

export default function ScrapedPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const fetchLeads = useCallback(async () => {
    const res = await fetch('/api/leads?status=scraped,no_email,error')
    const data = await res.json()
    setLeads(data.leads ?? [])
  }, [])

  useEffect(() => {
    fetchLeads().finally(() => setIsLoading(false))
  }, [fetchLeads])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Gescraped</h1>
        <p className="text-white/45 text-sm mt-1">Leads klaar voor kwalificatie</p>
      </div>
      <LeadsTable
        leads={leads}
        statusFilter="scraped"
        onFilterChange={() => {}}
        isLoading={isLoading}
        onRefresh={fetchLeads}
      />
    </div>
  )
}
