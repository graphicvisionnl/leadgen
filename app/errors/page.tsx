'use client'

import { useCallback, useEffect, useState } from 'react'
import { LeadsTable } from '@/components/LeadsTable'
import { PaginationControls } from '@/components/PaginationControls'
import { Lead } from '@/types'

export default function ErrorsPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [message, setMessage] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  const fetchLeads = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/leads?status=error&page=${page}`)
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

  async function flagFakeEmails() {
    setIsScanning(true)
    setMessage('')
    try {
      const res = await fetch('/api/leads/flag-fake-emails', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage(data.error ?? 'Scan mislukt')
        return
      }
      setMessage(`${data.count ?? 0} fake/test e-mail(s) als error gemarkeerd`)
      await fetchLeads()
    } finally {
      setIsScanning(false)
    }
  }

  async function resetErrors() {
    if (!confirm('Alle error leads terugzetten naar scraped?')) return
    setIsScanning(true)
    setMessage('')
    try {
      const res = await fetch('/api/leads/reset-errors', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      setMessage(`${data.count ?? 0} error lead(s) teruggezet naar scraped`)
      setPage(1)
      await fetchLeads()
    } finally {
      setIsScanning(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs text-red-400 font-medium uppercase tracking-wider">Review queue</p>
          <h1 className="text-2xl font-bold mt-1">Errors</h1>
          <p className="text-white/45 text-sm mt-1">Leads die aandacht nodig hebben, inclusief fake/test e-mails.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={flagFakeEmails}
            disabled={isScanning}
            className="px-3 py-2 rounded-md bg-red-500/15 border border-red-500/30 text-red-300 text-sm hover:bg-red-500/25 transition-colors disabled:opacity-50"
          >
            {isScanning ? 'Scannen...' : 'Scan fake e-mails'}
          </button>
          <button
            type="button"
            onClick={resetErrors}
            disabled={isScanning || total === 0}
            className="px-3 py-2 rounded-md bg-surface border border-subtle text-white/60 text-sm hover:text-white hover:border-white/20 transition-colors disabled:opacity-50"
          >
            Reset errors
          </button>
        </div>
      </div>

      {message && (
        <div className="rounded-md border border-subtle bg-surface px-4 py-3 text-sm text-white/65">
          {message}
        </div>
      )}

      <LeadsTable
        leads={leads}
        statusFilter="error"
        onFilterChange={() => {}}
        isLoading={isLoading}
        onRefresh={fetchLeads}
      />

      <PaginationControls
        page={page}
        total={total}
        totalPages={totalPages}
        itemCount={leads.length}
        isLoading={isLoading || isScanning}
        onPageChange={setPage}
      />
    </div>
  )
}
