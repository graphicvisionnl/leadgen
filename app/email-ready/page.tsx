'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { nl } from 'date-fns/locale'
import { Lead } from '@/types'

interface EmailReadyResponse {
  leads: Lead[]
  total: number
  totalPages: number
  page: number
}

interface BulkSendResult {
  leadId: string
  ok: boolean
  status: number
  error?: string
}

interface BulkSendResponse {
  success: boolean
  total: number
  sent: number
  failed: number
  delayMs: number
  results: BulkSendResult[]
  truncated?: boolean
  maxBatchSize?: number
  error?: string
}

const DEFAULT_DELAY_MS = 2500

export default function EmailReadyPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [delayMs, setDelayMs] = useState(DEFAULT_DELAY_MS)
  const [sendSummary, setSendSummary] = useState<string>('')
  const [sendErrors, setSendErrors] = useState<string[]>([])

  const fetchLeads = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/leads/email-ready?page=${page}`)
      const data: EmailReadyResponse = await res.json()
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

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const pageIds = leads.map((lead) => lead.id)
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedSet.has(id))

  function toggleOne(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function toggleAllOnPage() {
    setSelectedIds((prev) => {
      if (allOnPageSelected) {
        return prev.filter((id) => !pageIds.includes(id))
      }
      const next = new Set(prev)
      for (const id of pageIds) next.add(id)
      return Array.from(next)
    })
  }

  async function sendBatch(payload: { allReady?: boolean; leadIds?: string[] }) {
    setIsSending(true)
    setSendSummary('')
    setSendErrors([])
    try {
      const res = await fetch('/api/pipeline/send-email/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, delayMs }),
      })
      const data: BulkSendResponse = await res.json()
      if (!res.ok && !data.results) {
        setSendSummary(data.error ?? 'Bulk verzenden mislukt')
        return
      }

      const failures = (data.results ?? []).filter((r) => !r.ok)
      const capNote = data.truncated ? ` (gelimiteerd op ${data.maxBatchSize ?? 500})` : ''
      setSendSummary(`Klaar: ${data.sent}/${data.total} verzonden (${data.failed} mislukt)${capNote}`)
      setSendErrors(failures.slice(0, 8).map((f) => `${f.leadId}: ${f.error ?? 'Onbekende fout'}`))

      const successfulIds = new Set((data.results ?? []).filter((r) => r.ok).map((r) => r.leadId))
      if (successfulIds.size > 0) {
        setSelectedIds((prev) => prev.filter((id) => !successfulIds.has(id)))
      }

      await fetchLeads()
    } finally {
      setIsSending(false)
    }
  }

  function sendSelected() {
    if (selectedIds.length === 0 || isSending) return
    sendBatch({ leadIds: selectedIds })
  }

  function sendAllReady() {
    if (isSending || total === 0) return
    sendBatch({ allReady: true })
  }

  const rangeStart = total === 0 ? 0 : (page - 1) * 50 + 1
  const rangeEnd = total === 0 ? 0 : rangeStart + leads.length - 1

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Email Ready</h1>
        <p className="text-white/45 text-sm mt-1">Leads met een klaarstaande Email 1. Selecteer meerdere of verstuur alles in batch.</p>
      </div>

      <div className="bg-surface rounded-xl border border-subtle p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={toggleAllOnPage}
            disabled={isLoading || leads.length === 0 || isSending}
            className="px-3 py-1.5 rounded-lg text-xs bg-surface-2 border border-subtle text-white/65 hover:text-white hover:border-white/20 transition-colors disabled:opacity-40"
          >
            {allOnPageSelected ? 'Deselecteer pagina' : 'Selecteer pagina'}
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds([])}
            disabled={selectedIds.length === 0 || isSending}
            className="px-3 py-1.5 rounded-lg text-xs bg-surface-2 border border-subtle text-white/55 hover:text-white hover:border-white/20 transition-colors disabled:opacity-40"
          >
            Wis selectie ({selectedIds.length})
          </button>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <span className="text-white/45">Delay/mail (ms)</span>
            <input
              type="number"
              min={800}
              max={15000}
              step={100}
              value={delayMs}
              onChange={(e) => setDelayMs(Math.max(800, Math.min(15000, Number(e.target.value) || DEFAULT_DELAY_MS)))}
              className="w-28 bg-surface-2 border border-subtle rounded-lg px-2 py-1 text-white focus:outline-none focus:border-white/20"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={sendSelected}
            disabled={selectedIds.length === 0 || isSending}
            className="px-3 py-1.5 rounded-lg text-sm bg-blue-500/15 border border-blue-500/30 text-blue-400 hover:bg-blue-500/25 transition-colors disabled:opacity-40"
          >
            {isSending ? 'Versturen…' : `Stuur geselecteerd (${selectedIds.length})`}
          </button>
          <button
            type="button"
            onClick={sendAllReady}
            disabled={total === 0 || isSending}
            className="px-3 py-1.5 rounded-lg text-sm bg-green-500/15 border border-green-500/30 text-green-400 hover:bg-green-500/25 transition-colors disabled:opacity-40"
          >
            {isSending ? 'Bezig…' : `Stuur alles (${total})`}
          </button>
          <button
            type="button"
            onClick={fetchLeads}
            disabled={isLoading || isSending}
            className="px-3 py-1.5 rounded-lg text-sm bg-surface-2 border border-subtle text-white/65 hover:text-white hover:border-white/20 transition-colors disabled:opacity-40"
          >
            Vernieuw
          </button>
        </div>

        {sendSummary && <p className="text-sm text-white/75">{sendSummary}</p>}
        {sendErrors.length > 0 && (
          <div className="text-xs text-red-400/90 space-y-1">
            {sendErrors.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        )}
      </div>

      <div className="bg-surface rounded-xl border border-subtle overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-subtle">
                <th className="text-left text-white/40 font-medium px-4 py-3 w-12">#</th>
                <th className="text-left text-white/40 font-medium px-4 py-3">Bedrijf</th>
                <th className="text-left text-white/40 font-medium px-4 py-3">E-mail</th>
                <th className="text-left text-white/40 font-medium px-4 py-3">Onderwerp</th>
                <th className="text-left text-white/40 font-medium px-4 py-3">Aangemaakt</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-white/30">Laden…</td>
                </tr>
              ) : leads.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-white/30">Geen email-ready leads</td>
                </tr>
              ) : (
                leads.map((lead) => (
                  <tr
                    key={lead.id}
                    className="border-b border-subtle last:border-0 hover:bg-white/[0.03] transition-colors"
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedSet.has(lead.id)}
                        onChange={() => toggleOne(lead.id)}
                        disabled={isSending}
                        className="w-4 h-4 accent-blue-500"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/leads/${lead.id}`} className="font-medium hover:text-brand transition-colors">
                        {lead.company_name ?? '—'}
                      </Link>
                      {lead.website_url && (
                        <a
                          href={lead.website_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-xs text-white/30 hover:text-white/50 truncate max-w-[220px] mt-0.5"
                        >
                          {lead.website_url.replace(/^https?:\/\//, '')}
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3 text-white/70 max-w-[240px] truncate">{lead.email ?? '—'}</td>
                    <td className="px-4 py-3 text-white/65 max-w-[420px] truncate">{lead.email1_subject ?? '—'}</td>
                    <td className="px-4 py-3 text-white/35 text-xs">
                      {formatDistanceToNow(new Date(lead.created_at), { addSuffix: true, locale: nl })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-white/40">
          {total === 0 ? 'Geen leads' : `${rangeStart}–${rangeEnd} van ${total} leads`}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || isLoading || isSending}
            className="px-3 py-1.5 rounded-lg text-xs bg-surface border border-subtle text-white/60 hover:text-white hover:border-white/20 transition-colors disabled:opacity-40"
          >
            ← Vorige
          </button>
          <span className="text-xs text-white/45 min-w-[96px] text-center">Pagina {page} van {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || isLoading || isSending}
            className="px-3 py-1.5 rounded-lg text-xs bg-surface border border-subtle text-white/60 hover:text-white hover:border-white/20 transition-colors disabled:opacity-40"
          >
            Volgende →
          </button>
        </div>
      </div>
    </div>
  )
}
