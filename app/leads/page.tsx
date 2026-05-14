'use client'

import { Suspense, useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
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

type ManualAddResult = {
  lead?: Lead
  email?: string | null
  sent?: boolean
  sendError?: string | null
  existingLeadUpdated?: boolean
  painpoint?: string
  error?: string
}

function ManualLeadAdd({ onDone }: { onDone: () => void }) {
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [niche, setNiche] = useState('')
  const [city, setCity] = useState('')
  const [sendNow, setSendNow] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [result, setResult] = useState<ManualAddResult | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!websiteUrl.trim()) return

    setIsSubmitting(true)
    setResult(null)
    try {
      const res = await fetch('/api/leads/manual-add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          websiteUrl,
          niche: niche.trim() || undefined,
          city: city.trim() || undefined,
          sendNow,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setResult({ error: data?.error ?? 'Lead kon niet worden toegevoegd' })
        return
      }
      setResult(data)
      setWebsiteUrl('')
      onDone()
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-surface border border-subtle rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-medium text-white/75">Handmatig lead toevoegen</p>
          <p className="text-xs text-white/35 mt-0.5">Website invullen, e-mail zoeken, sequence maken en direct versturen.</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-white/55 select-none">
          <input
            type="checkbox"
            checked={sendNow}
            onChange={e => setSendNow(e.target.checked)}
            className="h-4 w-4 rounded border-white/20 bg-black/30 accent-brand"
          />
          Direct versturen
        </label>
      </div>

      <div className="grid gap-2 md:grid-cols-[minmax(220px,1fr)_160px_160px_auto]">
        <input
          type="url"
          value={websiteUrl}
          onChange={e => setWebsiteUrl(e.target.value)}
          placeholder="https://voorbeeld.nl"
          required
          className="bg-black/20 border border-subtle rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/20"
        />
        <input
          type="text"
          value={niche}
          onChange={e => setNiche(e.target.value)}
          placeholder="Niche"
          className="bg-black/20 border border-subtle rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/20"
        />
        <input
          type="text"
          value={city}
          onChange={e => setCity(e.target.value)}
          placeholder="Stad"
          className="bg-black/20 border border-subtle rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/20"
        />
        <button
          type="submit"
          disabled={isSubmitting || !websiteUrl.trim()}
          className="px-4 py-2 rounded-lg text-sm bg-brand text-white hover:bg-brand/90 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
        >
          {isSubmitting ? 'Bezig...' : 'Toevoegen'}
        </button>
      </div>

      {result?.error && (
        <p className="text-sm text-red-400">{result.error}</p>
      )}
      {result?.lead && (
        <div className="text-sm text-white/55">
          <span className="text-white/75">{result.lead.company_name ?? 'Lead'}</span>
          {' '}is {result.existingLeadUpdated ? 'bijgewerkt' : 'toegevoegd'}.
          {' '}E-mail: <span className={result.email ? 'text-green-400' : 'text-yellow-400'}>{result.email ?? 'niet gevonden'}</span>.
          {' '}Status: <span className={result.sent ? 'text-green-400' : 'text-yellow-400'}>{result.sent ? 'verzonden' : (result.sendError ?? 'niet verzonden')}</span>.
        </div>
      )}
    </form>
  )
}

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

      <ManualLeadAdd onDone={() => fetchLeads(filter, search, page)} />

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

      {filter === 'ready_to_send' && (
        <div className="flex items-center justify-between gap-3 flex-wrap bg-surface border border-subtle rounded-lg px-4 py-3">
          <div>
            <p className="text-sm font-medium text-white/75">Meerdere mails versturen</p>
            <p className="text-xs text-white/35 mt-0.5">Selecteer leads of verstuur alle klaarstaande mails in batch.</p>
          </div>
          <Link
            href="/email-ready"
            className="px-3 py-1.5 rounded-lg text-sm bg-blue-500/15 border border-blue-500/30 text-blue-400 hover:bg-blue-500/25 transition-colors whitespace-nowrap"
          >
            Bulk versturen
          </Link>
        </div>
      )}

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
