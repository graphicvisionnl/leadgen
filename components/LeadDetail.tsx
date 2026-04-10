'use client'

import Image from 'next/image'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Lead, LeadStatus, CrmStatus, ScoreBreakdown, EmailVariant, ReplyClassification } from '@/types'
import { StatusBadge } from './StatusBadge'
import { formatDistanceToNow, isPast } from 'date-fns'
import { nl } from 'date-fns/locale'

const REPLY_CLASS_LABELS: Record<ReplyClassification, { label: string; color: string }> = {
  interested:      { label: 'Geïnteresseerd',  color: 'text-green-400' },
  question:        { label: 'Vraag',            color: 'text-blue-400' },
  price_check:     { label: 'Prijs check',      color: 'text-yellow-400' },
  busy_later:      { label: 'Later',            color: 'text-white/50' },
  not_interested:  { label: 'Niet geïnteresseerd', color: 'text-red-400' },
  out_of_office:   { label: 'Afwezig',          color: 'text-white/40' },
  other:           { label: 'Overig',           color: 'text-white/40' },
}

function ReplyPanel({ lead, onTriggered }: { lead: Lead; onTriggered: () => void }) {
  const [manualReply, setManualReply] = useState('')
  const [showManual, setShowManual] = useState(!lead.reply_received_at)
  const [triggering, setTriggering] = useState(false)
  const [error, setError] = useState('')
  const cls = lead.reply_classification ? REPLY_CLASS_LABELS[lead.reply_classification] : null

  async function triggerOnReply(text: string) {
    setTriggering(true)
    setError('')
    const res = await fetch(`/api/leads/${lead.id}/on-reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ replyText: text }),
    })
    const data = await res.json()
    if (res.ok) {
      onTriggered()
    } else {
      setError(data.error ?? 'Fout')
      setTriggering(false)
    }
  }

  return (
    <div className={`rounded-xl border p-5 space-y-4 ${lead.reply_received_at ? 'bg-green-500/5 border-green-500/20' : 'bg-surface border-subtle'}`}>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Reactie ontvangen</p>
          {lead.reply_received_at && (
            <p className="text-xs text-white/30">
              {formatDistanceToNow(new Date(lead.reply_received_at), { addSuffix: true, locale: nl })}
              {cls && <span className={`ml-2 font-medium ${cls.color}`}>· {cls.label}</span>}
            </p>
          )}
        </div>
        {lead.reply_received_at && !lead.email2_draft_ready && (
          <button
            onClick={() => triggerOnReply(lead.reply_text ?? '')}
            disabled={triggering}
            className="px-3 py-1.5 bg-brand text-white rounded-lg text-xs font-medium hover:bg-brand/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {triggering
              ? <><span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />Bezig…</>
              : '▶ Genereer redesign + draft'}
          </button>
        )}
      </div>

      {lead.reply_text && (
        <div className="bg-black/20 rounded-lg p-3 text-sm text-white/70 font-mono whitespace-pre-wrap">
          {lead.reply_text}
        </div>
      )}

      {lead.email2_draft_ready && (
        <p className="text-xs text-green-400 flex items-center gap-1.5">
          <span>✓</span> Email 2 concept klaar — zie de sequentie hieronder
        </p>
      )}

      {/* Manual reply input */}
      <div>
        <button
          onClick={() => setShowManual(v => !v)}
          className="text-xs text-white/35 hover:text-white/60 transition-colors"
        >
          {showManual ? '▲ Verberg' : '+ Voer reactie handmatig in'}
        </button>
        {showManual && (
          <div className="mt-3 space-y-2">
            <textarea
              value={manualReply}
              onChange={e => setManualReply(e.target.value)}
              placeholder="Plak hier de reactie van de lead..."
              rows={4}
              className="w-full bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/20 font-mono resize-y"
            />
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <button
              onClick={() => triggerOnReply(manualReply)}
              disabled={triggering || !manualReply.trim()}
              className="px-4 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand/90 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {triggering
                ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Verwerken…</>
                : 'Verwerk reactie + genereer redesign'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const CRM_OPTIONS: { value: CrmStatus; label: string; color: string }[] = [
  { value: 'not_contacted', label: 'Niet benaderd', color: 'text-white/40' },
  { value: 'contacted',     label: 'Benaderd',       color: 'text-blue-400' },
  { value: 'replied',       label: 'Gereageerd',     color: 'text-yellow-400' },
  { value: 'interested',    label: 'Geïnteresseerd', color: 'text-green-400' },
  { value: 'closed',        label: 'Gesloten',       color: 'text-purple-400' },
  { value: 'rejected',      label: 'Afgewezen',      color: 'text-red-400' },
]

interface LeadDetailProps {
  lead: Lead
}

export function LeadDetail({ lead: initialLead }: LeadDetailProps) {
  const router = useRouter()
  const [lead, setLead] = useState(initialLead)
  const [deleting, setDeleting] = useState(false)

  // CRM state
  const [crmUpdating, setCrmUpdating] = useState(false)

  // Sequence state
  const [activeEmailTab, setActiveEmailTab] = useState(0)  // 0-3 for emails 1-4
  const [activeVariantTab, setActiveVariantTab] = useState(lead.selected_variant ?? 0)
  const [generatingSequence, setGeneratingSequence] = useState(false)
  const [generatingVariants, setGeneratingVariants] = useState(false)
  const [sequenceError, setSequenceError] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [stoppingSequence, setStoppingSequence] = useState(false)

  // Per-email editable state
  const [emailFields, setEmailFields] = useState({
    email1_subject: lead.email1_subject ?? lead.email_subject ?? '',
    email1_body:    lead.email1_body    ?? lead.email_body    ?? '',
    email2_subject: lead.email2_subject ?? '',
    email2_body:    lead.email2_body    ?? '',
    email3_subject: lead.email3_subject ?? '',
    email3_body:    lead.email3_body    ?? '',
    email4_subject: lead.email4_subject ?? '',
    email4_body:    lead.email4_body    ?? '',
  })
  const [emailTo, setEmailTo] = useState(lead.email ?? '')

  const emails = [
    { idx: 1, subject: emailFields.email1_subject, body: emailFields.email1_body, sentAt: lead.email1_sent_at },
    { idx: 2, subject: emailFields.email2_subject, body: emailFields.email2_body, sentAt: lead.email2_sent_at },
    { idx: 3, subject: emailFields.email3_subject, body: emailFields.email3_body, sentAt: lead.email3_sent_at },
    { idx: 4, subject: emailFields.email4_subject, body: emailFields.email4_body, sentAt: lead.email4_sent_at },
  ]

  const variants: EmailVariant[] = lead.email_variants ?? []

  async function handleDelete() {
    if (!confirm(`"${lead.company_name}" verwijderen? Dit kan niet ongedaan worden gemaakt.`)) return
    setDeleting(true)
    await fetch(`/api/leads/${lead.id}`, { method: 'DELETE' })
    router.push('/')
  }

  async function updateCrm(status: CrmStatus) {
    setCrmUpdating(true)
    await fetch(`/api/leads/${lead.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ crm_status: status }),
    }).catch(() => {})
    setLead(l => ({ ...l, crm_status: status }))
    setCrmUpdating(false)
  }

  async function generateSequence() {
    setGeneratingSequence(true)
    setSequenceError('')
    try {
      const res = await fetch(`/api/leads/${lead.id}/generate-email-sequence`, { method: 'POST' })
      const data = await res.json()
      if (res.ok && data.emails) {
        const e = data.emails
        setEmailFields({
          email1_subject: e.email1.subject, email1_body: e.email1.body,
          email2_subject: e.email2.subject, email2_body: e.email2.body,
          email3_subject: e.email3.subject, email3_body: e.email3.body,
          email4_subject: e.email4.subject, email4_body: e.email4.body,
        })
        setActiveEmailTab(0)
      } else {
        setSequenceError(data.error ?? 'Genereren mislukt')
      }
    } finally {
      setGeneratingSequence(false)
    }
  }

  async function generateVariants() {
    setGeneratingVariants(true)
    setSequenceError('')
    try {
      const res = await fetch(`/api/leads/${lead.id}/generate-email-variants`, { method: 'POST' })
      const data = await res.json()
      if (res.ok && data.variants) {
        setLead(l => ({ ...l, email_variants: data.variants, selected_variant: 0 }))
        setActiveVariantTab(0)
      } else {
        setSequenceError(data.error ?? 'Varianten genereren mislukt')
      }
    } finally {
      setGeneratingVariants(false)
    }
  }

  async function selectVariant(idx: number) {
    await fetch(`/api/leads/${lead.id}/select-variant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variant: idx }),
    }).catch(() => {})
    const chosen = variants[idx]
    if (chosen) {
      setEmailFields(f => ({ ...f, email1_subject: chosen.subject, email1_body: chosen.body }))
    }
    setActiveVariantTab(idx)
    setLead(l => ({ ...l, selected_variant: idx }))
  }

  async function sendEmail(emailIdx: number) {
    const email = emails[emailIdx - 1]
    setSending(true)
    setSendError('')
    try {
      const res = await fetch(`/api/leads/${lead.id}/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: email.subject, body: email.body, emailTo }),
      })
      const data = await res.json()
      if (res.ok) {
        setLead(l => ({
          ...l,
          status: 'sent',
          crm_status: 'contacted',
          email_sequence_index: (l.email_sequence_index ?? 0) + 1,
          next_followup_at: data.next_followup_at,
          [`email${emailIdx}_sent_at`]: new Date().toISOString(),
        }))
        if (emailIdx < 4) setActiveEmailTab(emailIdx)  // jump to next email
      } else {
        setSendError(data.error ?? 'Onbekende fout')
      }
    } finally {
      setSending(false)
    }
  }

  async function stopSequence() {
    setStoppingSequence(true)
    await fetch(`/api/leads/${lead.id}/stop-sequence`, { method: 'POST' }).catch(() => {})
    setLead(l => ({ ...l, sequence_stopped: true, next_followup_at: null }))
    setStoppingSequence(false)
  }

  const sb: ScoreBreakdown | null = lead.score_breakdown ?? null

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold">{lead.company_name}</h1>
            {lead.hot_lead && (
              <span className="px-2 py-0.5 bg-yellow-400/15 border border-yellow-400/30 text-yellow-400 text-xs font-semibold rounded-full">
                🔥 Hot lead
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-2 text-sm text-white/50 flex-wrap">
            {lead.niche && <span>{lead.niche}</span>}
            {lead.city && <><span>·</span><span>{lead.city}</span></>}
            {lead.google_rating && (
              <>
                <span>·</span>
                <span className="text-yellow-400">★ {lead.google_rating.toFixed(1)}</span>
                {lead.review_count && <span className="text-white/30">({lead.review_count} reviews)</span>}
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <StatusBadge status={lead.status as LeadStatus} />
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="px-3 py-1.5 bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 rounded-lg text-xs transition-colors disabled:opacity-50"
          >
            {deleting ? 'Verwijderen…' : 'Verwijder'}
          </button>
        </div>
      </div>

      {/* Score breakdown */}
      {(lead.lead_score !== null || sb) && (
        <div className="bg-surface rounded-xl border border-subtle p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-white/40 text-xs uppercase tracking-wider">Lead score</p>
            {lead.lead_score !== null && (
              <span className={`text-lg font-bold ${(lead.lead_score ?? 0) >= 65 ? 'text-yellow-400' : 'text-white'}`}>
                {lead.lead_score} / 100
              </span>
            )}
          </div>
          {sb && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { key: 'website_exists',      label: 'Website' },
                { key: 'email_found',         label: 'Email' },
                { key: 'phone_found',         label: 'Telefoon' },
                { key: 'outdated_feel',       label: 'Verouderd' },
                { key: 'mobile_friendly',     label: 'Mobiel'},
                { key: 'has_cta',             label: 'CTA' },
              ].map(({ key, label }) => {
                const val = sb[key as keyof ScoreBreakdown]
                const isOpportunity = key === 'outdated_feel' || key === 'mobile_friendly' || key === 'has_cta'
                const positive = isOpportunity ? !val : !!val
                return (
                  <div key={key} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${positive ? 'bg-green-500/10 text-green-400' : 'bg-white/5 text-white/30'}`}>
                    <span>{positive ? '✓' : '✗'}</span>
                    <span>{label}</span>
                    {isOpportunity && !val && <span className="ml-auto text-yellow-400/60">kans</span>}
                  </div>
                )
              })}
              {sb.internal_link_count !== undefined && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs bg-white/5 text-white/40">
                  <span>{sb.internal_link_count} interne links</span>
                </div>
              )}
            </div>
          )}
          {lead.qualify_reason && (
            <p className="text-white/50 text-sm mt-3 pt-3 border-t border-subtle">{lead.qualify_reason}</p>
          )}
        </div>
      )}

      {/* Contact data */}
      <div className="bg-surface rounded-xl border border-subtle p-5">
        <p className="text-white/40 text-xs uppercase tracking-wider mb-4">Contact</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {lead.website_url && (
            <a href={lead.website_url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 bg-surface-2 border border-subtle rounded-lg text-xs text-white/60 hover:text-white transition-colors">
              <span>🌐</span>
              <span className="truncate">{lead.website_url.replace(/^https?:\/\//, '').split('/')[0]}</span>
            </a>
          )}
          {lead.email && (
            <a href={`mailto:${lead.email}`}
              className="flex items-center gap-2 px-3 py-2 bg-surface-2 border border-subtle rounded-lg text-xs text-white/60 hover:text-white transition-colors">
              <span>✉</span>
              <span className="truncate">{lead.email}</span>
            </a>
          )}
          {lead.phone && (
            <a href={`tel:${lead.phone}`}
              className="flex items-center gap-2 px-3 py-2 bg-surface-2 border border-subtle rounded-lg text-xs text-white/60 hover:text-white transition-colors">
              <span>📞</span>
              <span>{lead.phone}</span>
            </a>
          )}
          {lead.whatsapp_url && (
            <a href={lead.whatsapp_url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-lg text-xs text-green-400 hover:text-green-300 transition-colors">
              <span>💬</span>
              <span>WhatsApp</span>
            </a>
          )}
          {lead.facebook_url && (
            <a href={lead.facebook_url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 bg-surface-2 border border-subtle rounded-lg text-xs text-white/60 hover:text-white transition-colors">
              <span>f</span>
              <span>Facebook</span>
            </a>
          )}
          {lead.instagram_url && (
            <a href={lead.instagram_url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 bg-surface-2 border border-subtle rounded-lg text-xs text-white/60 hover:text-white transition-colors">
              <span>📷</span>
              <span>Instagram</span>
            </a>
          )}
          {lead.preview_url && (
            <a href={lead.preview_url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 bg-brand/10 border border-brand/20 rounded-lg text-xs text-brand hover:text-brand/80 transition-colors">
              <span>→</span>
              <span>Preview bekijken</span>
            </a>
          )}
        </div>
      </div>

      {/* CRM status */}
      <div className="bg-surface rounded-xl border border-subtle p-5">
        <p className="text-white/40 text-xs uppercase tracking-wider mb-3">CRM status</p>
        <div className="flex flex-wrap gap-2">
          {CRM_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => updateCrm(opt.value)}
              disabled={crmUpdating}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                (lead.crm_status ?? 'not_contacted') === opt.value
                  ? `border-current bg-white/5 ${opt.color}`
                  : 'border-subtle text-white/35 hover:text-white/60 hover:border-white/20'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Screenshots */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <p className="text-white/40 text-xs uppercase tracking-wider mb-3">Originele website</p>
          <div className="bg-surface rounded-xl border border-subtle overflow-hidden aspect-video flex items-center justify-center">
            {lead.screenshot_url ? (
              <Image src={lead.screenshot_url} alt="Screenshot originele site"
                width={640} height={360} className="w-full h-full object-cover object-top" unoptimized />
            ) : (
              <p className="text-white/25 text-sm">Geen screenshot beschikbaar</p>
            )}
          </div>
        </div>
        <div>
          <p className="text-white/40 text-xs uppercase tracking-wider mb-3">Gegenereerde preview</p>
          <div className="bg-surface rounded-xl border border-subtle overflow-hidden aspect-video flex items-center justify-center">
            {lead.preview_screenshot_url ? (
              <Image src={lead.preview_screenshot_url} alt="Screenshot preview"
                width={640} height={360} className="w-full h-full object-cover object-top" unoptimized />
            ) : lead.preview_url ? (
              <iframe src={lead.preview_url}
                className="w-full h-full border-0 scale-[0.5] origin-top-left"
                style={{ width: '200%', height: '200%' }} title="Preview" />
            ) : (
              <p className="text-white/25 text-sm">Preview nog niet gegenereerd</p>
            )}
          </div>
        </div>
      </div>

      {/* Email sequence panel */}
      {/* Reply panel — shown when a reply has been received */}
      {lead.reply_received_at && (
        <ReplyPanel lead={lead} onTriggered={() => window.location.reload()} />
      )}

      <div className="bg-surface rounded-xl border border-subtle p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-white/40 text-xs uppercase tracking-wider">E-mailsequentie</p>
          <div className="flex items-center gap-2 flex-wrap">
            {lead.next_followup_at && !lead.sequence_stopped && (
              <span className={`text-xs px-2.5 py-1 rounded-full border ${isPast(new Date(lead.next_followup_at)) ? 'border-yellow-400/40 text-yellow-400' : 'border-subtle text-white/40'}`}>
                {isPast(new Date(lead.next_followup_at)) ? '⚠ ' : ''}Volgende: {formatDistanceToNow(new Date(lead.next_followup_at), { addSuffix: true, locale: nl })}
              </span>
            )}
            {lead.sequence_stopped && (
              <span className="text-xs px-2.5 py-1 rounded-full border border-red-400/30 text-red-400">Gestopt</span>
            )}
            {!lead.sequence_stopped && (lead.email_sequence_index ?? 0) > 0 && (
              <button
                onClick={stopSequence}
                disabled={stoppingSequence}
                className="px-2.5 py-1 text-xs text-red-400/70 hover:text-red-400 border border-red-400/20 hover:border-red-400/40 rounded-lg transition-colors disabled:opacity-50"
              >
                {stoppingSequence ? 'Stoppen…' : 'Stop sequentie'}
              </button>
            )}
            <button
              onClick={generateSequence}
              disabled={generatingSequence}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-2 border border-subtle rounded-lg text-xs text-white/60 hover:text-white hover:border-white/20 transition-colors disabled:opacity-50"
            >
              {generatingSequence ? (
                <><span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />Genereren…</>
              ) : emails[0].subject ? '↻ Regenereer reeks' : '✦ Genereer reeks'}
            </button>
          </div>
        </div>

        {sequenceError && <p className="text-red-400 text-xs">{sequenceError}</p>}

        {!emails[0].subject && !generatingSequence ? (
          <div className="py-8 text-center">
            <p className="text-white/30 text-sm mb-4">
              {lead.preview_url ? 'Genereer 4 gepersonaliseerde e-mails gebaseerd op de lead.' : 'Deploy eerst een preview voordat je e-mails kunt genereren.'}
            </p>
            {lead.preview_url && (
              <button onClick={generateSequence}
                className="px-5 py-2.5 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand/90 transition-colors">
                ✦ Genereer sequentie
              </button>
            )}
          </div>
        ) : generatingSequence ? (
          <div className="py-8 text-center">
            <span className="w-5 h-5 border-2 border-white/20 border-t-brand rounded-full animate-spin inline-block mb-3" />
            <p className="text-white/30 text-sm">Sequentie genereren met Claude…</p>
          </div>
        ) : (
          <>
            {/* Email tabs */}
            <div className="flex gap-1 border-b border-subtle pb-0">
              {emails.map((e, i) => (
                <button
                  key={i}
                  onClick={() => setActiveEmailTab(i)}
                  className={`px-3 py-2 text-xs font-medium rounded-t-lg transition-colors relative ${
                    activeEmailTab === i ? 'text-white bg-white/5' : 'text-white/40 hover:text-white/70'
                  }`}
                >
                  Email {i + 1}
                  {e.sentAt && (
                    <span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                  )}
                </button>
              ))}
            </div>

            {/* Active email content */}
            {(() => {
              const email = emails[activeEmailTab]
              const subjectKey = `email${activeEmailTab + 1}_subject` as keyof typeof emailFields
              const bodyKey = `email${activeEmailTab + 1}_body` as keyof typeof emailFields
              const seqIdx = lead.email_sequence_index ?? 0
              const isNextToSend = activeEmailTab === seqIdx && !email.sentAt

              return (
                <div className="space-y-4">
                  {/* A/B variants (email 1 only) */}
                  {activeEmailTab === 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      {variants.map((v, i) => (
                        <button
                          key={i}
                          onClick={() => selectVariant(i)}
                          className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                            activeVariantTab === i ? 'border-brand text-brand bg-brand/10' : 'border-subtle text-white/40 hover:text-white/60'
                          }`}
                        >
                          Variant {v.label}
                        </button>
                      ))}
                      <button
                        onClick={generateVariants}
                        disabled={generatingVariants}
                        className="px-2.5 py-1 text-xs rounded-lg border border-subtle text-white/40 hover:text-white/60 transition-colors disabled:opacity-50"
                      >
                        {generatingVariants ? 'A/B genereren…' : variants.length ? '↻ A/B vernieuwen' : '+ A/B varianten'}
                      </button>
                    </div>
                  )}

                  {email.sentAt && (
                    <div className="flex items-center gap-2 text-xs text-green-400">
                      <span>✓</span>
                      <span>Verzonden {formatDistanceToNow(new Date(email.sentAt), { addSuffix: true, locale: nl })}</span>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs text-white/40 mb-1.5">Onderwerp</label>
                    <input
                      type="text"
                      value={email.subject}
                      onChange={e => setEmailFields(f => ({ ...f, [subjectKey]: e.target.value }))}
                      className="w-full bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/20"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-white/40 mb-1.5">Bericht</label>
                    <textarea
                      value={email.body}
                      onChange={e => setEmailFields(f => ({ ...f, [bodyKey]: e.target.value }))}
                      rows={10}
                      className="w-full bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/20 font-mono resize-y"
                    />
                  </div>

                  {isNextToSend && (
                    <div className="space-y-3 pt-1 border-t border-subtle">
                      <div>
                        <label className="block text-xs text-white/40 mb-1.5">Aan</label>
                        <input
                          type="email"
                          value={emailTo}
                          onChange={e => setEmailTo(e.target.value)}
                          className="w-full bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/20"
                        />
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => sendEmail(activeEmailTab + 1)}
                          disabled={sending || !emailTo || !email.subject || !email.body}
                          className="px-5 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                          {sending ? (
                            <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Versturen…</>
                          ) : `Stuur email ${activeEmailTab + 1} →`}
                        </button>
                        {sendError && <span className="text-red-400 text-sm">{sendError}</span>}
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}
          </>
        )}
      </div>
    </div>
  )
}
