'use client'

import Link from 'next/link'
import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { nl } from 'date-fns/locale'
import { Lead, LeadStatus } from '@/types'
import { getFakeEmailReason } from '@/lib/email-quality'
import { StatusBadge } from './StatusBadge'

const NEXT_PHASE_LABEL: Record<string, string> = {
  scraped:    'Kwalificeren',
  no_email:   'Kwalificeren',
  error:      'Opnieuw kwalificeren',
  redesigned: 'Deployen',
}

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: 'all',          label: 'Alles' },
  { value: 'scraped',      label: 'Gescraped' },
  { value: 'email_needed', label: 'Email nodig' },
  { value: 'qualified',    label: 'Gekwalificeerd' },
  { value: 'disqualified', label: 'Afgewezen' },
  { value: 'deployed',     label: 'Deployed' },
  { value: 'sent',         label: 'Verzonden' },
  { value: 'error',        label: 'Errors' },
]

function toDateTimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function defaultScheduleInput(): string {
  const now = new Date()
  const target = new Date(now.getTime() + 30 * 60 * 1000)
  target.setSeconds(0, 0)
  target.setMinutes(target.getMinutes() <= 30 ? 30 : 60, 0, 0)
  if (target.getHours() < 7) target.setHours(7, 0, 0, 0)
  if (target.getHours() >= 18) {
    target.setDate(target.getDate() + 1)
    target.setHours(7, 0, 0, 0)
  }
  return toDateTimeLocalValue(target)
}

function parseScheduleInput(value: string): { ok: true; iso: string } | { ok: false; error: string } {
  if (!value) return { ok: false, error: 'Kies datum/tijd' }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return { ok: false, error: 'Ongeldige datum/tijd' }
  if (date.getTime() <= Date.now()) return { ok: false, error: 'Kies een tijd in de toekomst' }
  const mins = date.getHours() * 60 + date.getMinutes()
  if (mins < 7 * 60 || mins >= 18 * 60) return { ok: false, error: 'Plan tussen 07:00 en 18:00' }
  return { ok: true, iso: date.toISOString() }
}

function hasEmail(lead: Lead): boolean {
  return !!lead.email?.trim()
}

function isEmailNeeded(lead: Lead): boolean {
  return ['qualified', 'redesigned', 'deployed'].includes(lead.status) &&
    !hasEmail(lead) &&
    !['closed', 'rejected'].includes(lead.crm_status ?? '') &&
    lead.sequence_stopped !== true
}

function isReadyToSend(lead: Lead): boolean {
  return ['qualified', 'redesigned', 'deployed'].includes(lead.status) &&
    hasEmail(lead) &&
    !!lead.email1_body?.trim() &&
    !lead.email1_sent_at &&
    !['closed', 'rejected'].includes(lead.crm_status ?? '') &&
    lead.sequence_stopped !== true
}

interface LeadsTableProps {
  leads: Lead[]
  statusFilter: string
  onFilterChange: (status: string) => void
  isLoading: boolean
  onRefresh: () => void
  hideFilterBar?: boolean
  showSegment?: boolean
}

const SEGMENT_LABELS: Record<string, string> = {
  ideal:        'Ideaal',
  no_website:   'Geen website',
  low_reviews:  'Weinig reviews',
  high_reviews: 'Veel reviews',
  high_rating:  'Hoge score',
}

const SEGMENT_COLORS: Record<string, string> = {
  ideal:        'bg-green-500/10 text-green-400',
  no_website:   'bg-orange-500/10 text-orange-400',
  low_reviews:  'bg-yellow-500/10 text-yellow-400',
  high_reviews: 'bg-blue-500/10 text-blue-400',
  high_rating:  'bg-purple-500/10 text-purple-400',
}

export function LeadsTable({ leads, statusFilter, onFilterChange, isLoading, onRefresh, hideFilterBar, showSegment }: LeadsTableProps) {
  const [deletingAll, setDeletingAll] = useState(false)
  const [advancing, setAdvancing] = useState<string | null>(null)
  const [sending, setSending] = useState<string | null>(null)
  const [scheduleLeadId, setScheduleLeadId] = useState<string | null>(null)
  const [scheduledAtLocal, setScheduledAtLocal] = useState(defaultScheduleInput())
  const [scheduleError, setScheduleError] = useState('')

  async function sendEmail1(lead: Lead, scheduledFor?: string) {
    if (!scheduledFor && !confirm(`Email 1 versturen naar ${lead.company_name}?`)) return
    setSending(lead.id)
    try {
      const pipelineUrl = '/api/pipeline/send-email'
      const res = await fetch(pipelineUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: lead.id, emailNumber: 1, scheduledFor }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(data.error ?? 'Versturen mislukt')
        return
      }
      if (data.scheduled) {
        setScheduleLeadId(null)
        setScheduleError('')
        alert(`Email ingepland voor ${new Date(data.scheduled_for).toLocaleString('nl-NL')}`)
      }
      onRefresh()
    } finally {
      setSending(null)
    }
  }

  async function advanceLead(lead: Lead) {
    setAdvancing(lead.id)
    await fetch(`/api/leads/${lead.id}/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: lead.status }),
    })
    // Poll until status changes (max 3 min)
    const start = Date.now()
    while (Date.now() - start < 180_000) {
      await new Promise(r => setTimeout(r, 3000))
      onRefresh()
      const res = await fetch(`/api/leads/${lead.id}`).catch(() => null)
      const data = await res?.json().catch(() => null)
      if (data?.status && data.status !== lead.status) break
    }
    setAdvancing(null)
    onRefresh()
  }

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
      {/* Filter tabs — hidden when parent manages filters */}
      {!hideFilterBar && (
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
      )}

      {/* Table */}
      <div className="bg-surface rounded-lg border border-subtle overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-subtle">
                <th className="text-left text-white/40 font-medium px-4 py-3">Bedrijf</th>
                <th className="text-left text-white/40 font-medium px-4 py-3">Niche / Stad</th>
                <th className="text-left text-white/40 font-medium px-4 py-3">E-mail</th>
                <th className="text-left text-white/40 font-medium px-4 py-3">Rating</th>
                <th className="text-left text-white/40 font-medium px-4 py-3">Status</th>
                {showSegment && <th className="text-left text-white/40 font-medium px-4 py-3">Segment</th>}
                <th className="text-left text-white/40 font-medium px-4 py-3">Preview</th>
                <th className="text-left text-white/40 font-medium px-4 py-3">Toegevoegd</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={showSegment ? 9 : 8} className="text-center py-12 text-white/30">
                    Laden…
                  </td>
                </tr>
              ) : leads.length === 0 ? (
                <tr>
                  <td colSpan={showSegment ? 9 : 8} className="text-center py-12 text-white/30">
                    Geen leads gevonden
                  </td>
                </tr>
              ) : (
                leads.map((lead) => {
                  const emailNeeded = isEmailNeeded(lead)
                  const readyToSend = isReadyToSend(lead)

                  return (
                  <tr
                    key={lead.id}
                    className="border-b border-subtle last:border-0 hover:bg-white/[0.03] transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/leads/${lead.id}`}
                          className="font-medium hover:text-brand transition-colors"
                        >
                          {lead.company_name ?? '—'}
                        </Link>
                        {lead.status === 'qualified' && lead.email1_subject && !lead.email1_sent_at && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 font-medium whitespace-nowrap">
                            ✓ concept
                          </span>
                        )}
                        {lead.email1_sent_at && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 font-medium whitespace-nowrap">
                            ✓ verstuurd
                          </span>
                        )}
                      </div>
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
                      {hasEmail(lead) ? (
                        <div className="space-y-1">
                          <span>{lead.email}</span>
                          {getFakeEmailReason(lead.email) && (
                            <span className="block text-[11px] text-red-300">fake/test</span>
                          )}
                        </div>
                      ) : (
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
                    {showSegment && (
                      <td className="px-4 py-3">
                        {lead.segment ? (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SEGMENT_COLORS[lead.segment] ?? 'bg-white/10 text-white/50'}`}>
                            {SEGMENT_LABELS[lead.segment] ?? lead.segment}
                          </span>
                        ) : (
                          <span className="text-white/25">—</span>
                        )}
                      </td>
                    )}
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
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-start gap-2">
                        {emailNeeded && (
                          <>
                            <span className="text-xs font-medium text-yellow-400 whitespace-nowrap">Email toevoegen</span>
                            <Link
                              href={`/leads/${lead.id}`}
                              className="px-2.5 py-1 bg-surface-2 border border-subtle text-white/60 rounded-lg text-xs hover:text-white hover:border-white/20 transition-colors whitespace-nowrap"
                            >
                              Open lead
                            </Link>
                          </>
                        )}
                        {/* Draft ready + not yet sent → Send button */}
                        {!emailNeeded && readyToSend && lead.email1_subject && (
                          <>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => sendEmail1(lead)}
                                disabled={sending === lead.id}
                                className="px-2.5 py-1 bg-blue-500/15 border border-blue-500/30 text-blue-400 rounded-lg text-xs hover:bg-blue-500/25 transition-colors disabled:opacity-40 whitespace-nowrap flex items-center gap-1"
                              >
                                {sending === lead.id
                                  ? <><span className="w-2.5 h-2.5 border border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />Verzenden…</>
                                  : '↑ Verstuur nu'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setScheduleLeadId(lead.id)
                                  setScheduledAtLocal(defaultScheduleInput())
                                  setScheduleError('')
                                }}
                                className="px-2.5 py-1 bg-surface-2 border border-subtle text-white/55 rounded-lg text-xs hover:text-white hover:border-white/20 transition-colors whitespace-nowrap"
                              >
                                Plan
                              </button>
                            </div>

                            {scheduleLeadId === lead.id && (
                              <div className="flex flex-col gap-2">
                                <input
                                  type="datetime-local"
                                  value={scheduledAtLocal}
                                  onChange={(e) => setScheduledAtLocal(e.target.value)}
                                  className="bg-surface-2 border border-subtle rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-white/20"
                                />
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const parsed = parseScheduleInput(scheduledAtLocal)
                                      if (!parsed.ok) {
                                        setScheduleError(parsed.error)
                                        return
                                      }
                                      sendEmail1(lead, parsed.iso)
                                    }}
                                    disabled={sending === lead.id}
                                    className="px-2.5 py-1 bg-blue-500/15 border border-blue-500/30 text-blue-400 rounded-lg text-xs hover:bg-blue-500/25 transition-colors disabled:opacity-40 whitespace-nowrap"
                                  >
                                    Bevestig planning
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setScheduleLeadId(null)
                                      setScheduleError('')
                                    }}
                                    className="px-2.5 py-1 bg-surface-2 border border-subtle text-white/45 rounded-lg text-xs hover:text-white/70 transition-colors whitespace-nowrap"
                                  >
                                    Annuleer
                                  </button>
                                </div>
                                <p className="text-[11px] text-white/30">Alleen tussen 07:00 en 18:00</p>
                                {scheduleError && <p className="text-[11px] text-red-400">{scheduleError}</p>}
                              </div>
                            )}
                          </>
                        )}
                        {/* Other phases advance button */}
                        {!emailNeeded && NEXT_PHASE_LABEL[lead.status] && (
                          <button
                            onClick={() => advanceLead(lead)}
                            disabled={advancing !== null}
                            className="px-2.5 py-1 bg-surface-2 border border-subtle text-white/50 rounded-lg text-xs hover:text-white hover:border-white/20 transition-colors disabled:opacity-40 whitespace-nowrap flex items-center gap-1"
                          >
                            {advancing === lead.id
                              ? <><span className="w-2.5 h-2.5 border border-white/30 border-t-white rounded-full animate-spin" />Bezig…</>
                              : `▶ ${NEXT_PHASE_LABEL[lead.status]}`}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
