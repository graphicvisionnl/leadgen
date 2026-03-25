'use client'

import Link from 'next/link'
import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { nl } from 'date-fns/locale'
import { Lead, LeadStatus } from '@/types'
import { StatusBadge } from './StatusBadge'

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: 'all',          label: 'Alles' },
  { value: 'scraped',      label: 'Gescraped' },
  { value: 'qualified',    label: 'Gekwalificeerd' },
  { value: 'disqualified', label: 'Afgewezen' },
  { value: 'deployed',     label: 'Deployed' },
  { value: 'sent',         label: 'Verzonden' },
]

interface LeadsTableProps {
  leads: Lead[]
  statusFilter: string
  onFilterChange: (status: string) => void
  isLoading: boolean
  onRefresh: () => void
}

export function LeadsTable({ leads, statusFilter, onFilterChange, isLoading, onRefresh }: LeadsTableProps) {
  const [deletingAll, setDeletingAll] = useState(false)

  async function deleteAllDisqualified() {
    if (!confirm('Alle afgewezen leads verwijderen? Dit kan niet ongedaan worden gemaakt.')) return
    setDeletingAll(true)
    const res = await fetch('/api/leads/delete-disqualified', { method: 'DELETE' })
    const data = await res.json()
    setDeletingAll(false)
    if (res.ok) {
      onFilterChange('all')
      onRefresh()
    } else {
      alert(data.error ?? 'Verwijderen mislukt')
    }
  }

  return (
    <div>
      {/* Filter tabs */}
      <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => onFilterChange(f.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              statusFilter === f.value
                ? 'bg-white/10 text-white'
                : 'text-white/45 hover:text-white/70'
            }`}
          >
            {f.label}
          </button>
        ))}
        <button
          onClick={deleteAllDisqualified}
          disabled={deletingAll}
          className="ml-auto px-3 py-1.5 rounded-lg text-xs whitespace-nowrap text-red-400/70 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
        >
          {deletingAll ? 'Verwijderen…' : 'Verwijder afgewezen'}
        </button>
      </div>

      {/* Table */}
      <div className="bg-surface rounded-xl border border-subtle overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-subtle">
                <th className="text-left text-white/40 font-medium px-4 py-3">Bedrijf</th>
                <th className="text-left text-white/40 font-medium px-4 py-3">Niche / Stad</th>
                <th className="text-left text-white/40 font-medium px-4 py-3">E-mail</th>
                <th className="text-left text-white/40 font-medium px-4 py-3">Rating</th>
                <th className="text-left text-white/40 font-medium px-4 py-3">Status</th>
                <th className="text-left text-white/40 font-medium px-4 py-3">Preview</th>
                <th className="text-left text-white/40 font-medium px-4 py-3">Toegevoegd</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-white/30">
                    Laden…
                  </td>
                </tr>
              ) : leads.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-white/30">
                    Geen leads gevonden
                  </td>
                </tr>
              ) : (
                leads.map((lead) => (
                  <tr
                    key={lead.id}
                    className="border-b border-subtle last:border-0 hover:bg-white/[0.03] transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/leads/${lead.id}`}
                        className="font-medium hover:text-brand transition-colors"
                      >
                        {lead.company_name ?? '—'}
                      </Link>
                      {lead.website_url && (
                        <a
                          href={lead.website_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-xs text-white/30 hover:text-white/50 truncate max-w-[180px] mt-0.5"
                        >
                          {lead.website_url.replace(/^https?:\/\//, '')}
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3 text-white/60">
                      <span>{lead.niche ?? '—'}</span>
                      {lead.city && (
                        <span className="text-white/30 ml-1">· {lead.city}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-white/60 max-w-[160px] truncate">
                      {lead.email ?? (
                        <span className="text-white/25 italic">geen</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-white/60">
                      {lead.google_rating ? (
                        <span className="flex items-center gap-1">
                          <span className="text-yellow-400">★</span>
                          {lead.google_rating.toFixed(1)}
                          {lead.review_count && (
                            <span className="text-white/30 text-xs">({lead.review_count})</span>
                          )}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={lead.status as LeadStatus} />
                      {lead.qualify_reason && (
                        <p className="text-xs text-white/30 mt-0.5 max-w-[180px] truncate" title={lead.qualify_reason}>
                          {lead.qualify_reason}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {lead.preview_url ? (
                        <a
                          href={lead.preview_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-brand hover:underline text-xs"
                        >
                          Bekijk →
                        </a>
                      ) : (
                        <span className="text-white/25">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-white/35 text-xs">
                      {formatDistanceToNow(new Date(lead.created_at), {
                        addSuffix: true,
                        locale: nl,
                      })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
