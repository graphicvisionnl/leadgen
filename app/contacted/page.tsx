'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { formatDistanceToNow, isPast } from 'date-fns'
import { nl } from 'date-fns/locale'
import { Lead, CrmStatus } from '@/types'
import { StatusBadge } from '@/components/StatusBadge'

const CRM_LABELS: Record<CrmStatus, string> = {
  not_contacted: 'Niet benaderd',
  contacted: 'Benaderd',
  replied: 'Gereageerd',
  interested: 'Geïnteresseerd',
  closed: 'Gesloten',
  rejected: 'Afgewezen',
}

const CRM_COLORS: Record<CrmStatus, string> = {
  not_contacted: 'text-white/40',
  contacted: 'text-blue-400',
  replied: 'text-yellow-400',
  interested: 'text-green-400',
  closed: 'text-purple-400',
  rejected: 'text-red-400',
}

export default function ContactedPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [checkingReplies, setCheckingReplies] = useState(false)

  const fetchLeads = useCallback(async () => {
    const res = await fetch('/api/leads?status=sent')
    const data = await res.json()
    setLeads(data.leads ?? [])
  }, [])

  useEffect(() => {
    fetchLeads().finally(() => setIsLoading(false))
  }, [fetchLeads])

  async function checkReplies() {
    setCheckingReplies(true)
    await fetch('/api/pipeline/check-replies', { method: 'POST' }).catch(() => null)
    await new Promise(r => setTimeout(r, 3000))
    await fetchLeads()
    setCheckingReplies(false)
  }

  const dueLeads = leads.filter(l => l.next_followup_at && isPast(new Date(l.next_followup_at)) && !l.sequence_stopped)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold">Benaderd</h1>
          <p className="text-white/45 text-sm mt-1">CRM status & e-mailsequentie tracking</p>
        </div>
        <button
          onClick={checkReplies}
          disabled={checkingReplies}
          className="flex items-center gap-1.5 px-4 py-2 bg-surface border border-subtle text-white/60 rounded-lg text-sm hover:text-white hover:border-white/20 transition-colors disabled:opacity-50"
        >
          {checkingReplies
            ? <><span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />Checken…</>
            : '↻ Check reacties (IMAP)'}
        </button>
      </div>

      {dueLeads.length > 0 && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4">
          <p className="text-yellow-400 text-sm font-medium">{dueLeads.length} follow-up{dueLeads.length > 1 ? 's' : ''} klaar om te versturen</p>
          <div className="mt-2 space-y-1">
            {dueLeads.map(l => (
              <Link key={l.id} href={`/leads/${l.id}`} className="block text-sm text-white/60 hover:text-white transition-colors">
                → {l.company_name} (email {(l.email_sequence_index ?? 0) + 1}/4)
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="bg-surface rounded-xl border border-subtle overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-subtle">
                <th className="text-left text-white/40 font-medium px-4 py-3">Bedrijf</th>
                <th className="text-left text-white/40 font-medium px-4 py-3">CRM Status</th>
                <th className="text-left text-white/40 font-medium px-4 py-3">Sequentie</th>
                <th className="text-left text-white/40 font-medium px-4 py-3">Volgende</th>
                <th className="text-left text-white/40 font-medium px-4 py-3">Pipeline</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} className="text-center py-12 text-white/30">Laden…</td></tr>
              ) : leads.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-12 text-white/30">Geen benaderde leads</td></tr>
              ) : leads.map(lead => {
                const crm = (lead.crm_status ?? 'not_contacted') as CrmStatus
                const seqIdx = lead.email_sequence_index ?? 0
                const isDue = lead.next_followup_at && isPast(new Date(lead.next_followup_at)) && !lead.sequence_stopped
                return (
                  <tr key={lead.id} className="border-b border-subtle last:border-0 hover:bg-white/[0.03] transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Link href={`/leads/${lead.id}`} className="font-medium hover:text-brand transition-colors">
                          {lead.company_name ?? '—'}
                        </Link>
                        {lead.reply_received_at && (
                          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${lead.email2_draft_ready ? 'bg-green-500/15 text-green-400' : 'bg-yellow-400/15 text-yellow-400'}`}>
                            {lead.email2_draft_ready ? '✓ concept' : '↩ reactie'}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-white/30 mt-0.5">{lead.niche} · {lead.city}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${CRM_COLORS[crm]}`}>{CRM_LABELS[crm]}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {[1, 2, 3, 4].map(n => {
                          const sent = !!(lead as any)[`email${n}_sent_at`]
                          return (
                            <span key={n} className={`w-5 h-5 rounded-full text-xs flex items-center justify-center font-medium ${sent ? 'bg-green-500/20 text-green-400' : 'bg-white/5 text-white/20'}`}>
                              {n}
                            </span>
                          )
                        })}
                      </div>
                      {lead.sequence_stopped && <p className="text-xs text-red-400/60 mt-1">Gestopt</p>}
                    </td>
                    <td className="px-4 py-3">
                      {lead.sequence_stopped ? (
                        <span className="text-xs text-white/25">Gestopt</span>
                      ) : lead.next_followup_at ? (
                        <span className={`text-xs ${isDue ? 'text-yellow-400 font-medium' : 'text-white/40'}`}>
                          {isDue ? '⚠ ' : ''}{formatDistanceToNow(new Date(lead.next_followup_at), { addSuffix: true, locale: nl })}
                        </span>
                      ) : seqIdx >= 4 ? (
                        <span className="text-xs text-white/25">Voltooid</span>
                      ) : (
                        <span className="text-xs text-white/25">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={lead.status} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
