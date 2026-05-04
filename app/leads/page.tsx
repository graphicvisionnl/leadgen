'use client'

import { Suspense, useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { LeadsTable } from '@/components/LeadsTable'
import { PaginationControls } from '@/components/PaginationControls'
import { Lead } from '@/types'

const FILTER_TABS = [
  { value: '',              label: 'All' },
  { value: 'to_review',     label: 'Te beoordelen' },
  { value: 'email_needed',  label: 'Email nodig' },
  { value: 'ready_to_send', label: 'Klaar om te sturen' },
  { value: 'sent',          label: 'Verzonden' },
  { value: 'replied',       label: 'Gereageerd' },
  { value: 'closed',        label: 'Gesloten' },
  { value: 'rejected',      label: 'Afgewezen' },
] as const

function LeadsPageContent() {
  const searchParams = useSearchParams()
  const initialFilter = searchParams.get('filter') ?? ''

  const [filter, setFilter] = useState(initialFilter)
  const [search, setSearch] = useState('')
  const [leads, setLeads] = useState<Lead[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchLeads = useCallback(async (f: string, s: string, p: number) => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams({ page: String(p) })
      if (f) params.set('filter', f)
      if (s) params.set('search', s)
      const res = await fetch(`/api/leads?${params}`)
      const data = await res.json()
      setLeads(data.leads ?? [])
      setTotal(data.total ?? 0)
      setTotalPages(Math.max(data.totalPages ?? 1, 1))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchLeads(filter, search, page)
  }, [filter, page, fetchLeads]) // search handled via debounce below

  function handleFilterChange(value: string) {
    setFilter(value)
    setPage(1)
  }

  function handleSearchChange(value: string) {
    setSearch(value)
    setPage(1)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => {
      fetchLeads(filter, value, 1)
    }, 350)
  }

  const activeLabel = FILTER_TABS.find(t => t.value === filter)?.label ?? 'Leads'

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Leads</h1>
          <p className="text-white/40 text-sm mt-1">
            {isLoading ? 'Laden…' : `${total} ${activeLabel.toLowerCase()}`}
          </p>
        </div>
        <input
          type="text"
          value={search}
          onChange={e => handleSearchChange(e.target.value)}
          placeholder="Zoek op naam, e-mail of website…"
          className="bg-surface border border-subtle rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/20 w-64"
        />
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => handleFilterChange(tab.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              filter === tab.value
                ? 'bg-white/10 text-white'
                : 'text-white/45 hover:text-white/70'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <LeadsTable
        leads={leads}
        statusFilter={filter}
        onFilterChange={handleFilterChange}
        isLoading={isLoading}
        onRefresh={() => fetchLeads(filter, search, page)}
        hideFilterBar
        showSegment
      />

      <PaginationControls
        page={page}
        total={total}
        totalPages={totalPages}
        itemCount={leads.length}
        isLoading={isLoading}
        onPageChange={(p) => setPage(p)}
      />
    </div>
  )
}

export default function LeadsPage() {
  return (
    <Suspense fallback={<div className="text-white/40 text-sm">Leads laden...</div>}>
      <LeadsPageContent />
    </Suspense>
  )
}
