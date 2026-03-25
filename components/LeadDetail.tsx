'use client'

import Image from 'next/image'
import { useState } from 'react'
import { Lead, LeadStatus } from '@/types'
import { StatusBadge } from './StatusBadge'

interface LeadDetailProps {
  lead: Lead
}

export function LeadDetail({ lead }: LeadDetailProps) {
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(lead.status === 'sent')
  const [sendError, setSendError] = useState('')

  // Email compose state — pre-fill from saved Supabase draft
  const [emailTo, setEmailTo] = useState(lead.email ?? '')
  const [subject, setSubject] = useState(lead.email_subject ?? '')
  const [body, setBody] = useState(lead.email_body ?? '')
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState('')
  const [showPreview, setShowPreview] = useState(false)

  const canCompose = !!lead.preview_url && !sent
  const draftReady = subject !== '' && body !== ''

  async function saveDraft(newSubject: string, newBody: string) {
    await fetch(`/api/leads/${lead.id}/email-draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: newSubject, body: newBody }),
    }).catch(() => {})
  }

  async function generateDraft() {
    setGenerating(true)
    setGenerateError('')
    setShowPreview(false)
    try {
      const res = await fetch(`/api/leads/${lead.id}/generate-email`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setSubject(data.subject ?? '')
        setBody(data.body ?? '')
      } else {
        setGenerateError(data.error ?? 'Genereren mislukt')
      }
    } finally {
      setGenerating(false)
    }
  }

  async function handleSendMail() {
    setSending(true)
    setSendError('')
    try {
      const res = await fetch(`/api/leads/${lead.id}/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body, emailTo }),
      })
      const data = await res.json()
      if (res.ok) {
        setSent(true)
      } else {
        setSendError(data.error ?? 'Onbekende fout')
      }
    } finally {
      setSending(false)
    }
  }

  function toPreviewHtml(text: string): string {
    const previewUrl = lead.preview_url ?? ''
    const lines = text.split('\n').map(line => {
      const escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      if (previewUrl && line.includes(previewUrl)) {
        return escaped.replace(
          previewUrl,
          `<a href="${previewUrl}" style="color:#FF794F;font-weight:bold;">${previewUrl}</a>`
        )
      }
      return escaped
    })
    return '<p style="font-family:sans-serif;font-size:14px;line-height:1.7;color:#1a1a1a;margin:0 0 12px">' +
      lines.join('<br>').replace(/<br><br>/g, '</p><p style="font-family:sans-serif;font-size:14px;line-height:1.7;color:#1a1a1a;margin:0 0 12px">') +
      '</p>'
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{lead.company_name}</h1>
          <div className="flex items-center gap-3 mt-2 text-sm text-white/50">
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
        <StatusBadge status={lead.status as LeadStatus} />
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Website', value: lead.website_url, link: true },
          { label: 'E-mail', value: lead.email },
          { label: 'Preview URL', value: lead.preview_url, link: true },
          { label: 'Gmail Draft ID', value: lead.gmail_draft_id },
        ].map(({ label, value, link }) => (
          <div key={label} className="bg-surface rounded-xl border border-subtle p-4">
            <p className="text-white/40 text-xs uppercase tracking-wider mb-1">{label}</p>
            {value ? (
              link ? (
                <a href={value} target="_blank" rel="noopener noreferrer"
                  className="text-brand text-sm hover:underline break-all">
                  {value.replace(/^https?:\/\//, '').slice(0, 40)}
                </a>
              ) : (
                <p className="text-sm text-white/80 break-all">{value}</p>
              )
            ) : (
              <p className="text-sm text-white/25 italic">—</p>
            )}
          </div>
        ))}
      </div>

      {/* Qualification reason */}
      {lead.qualify_reason && (
        <div className="bg-surface rounded-xl border border-subtle p-5">
          <p className="text-white/40 text-xs uppercase tracking-wider mb-2">Claude beoordeling</p>
          <p className="text-white/80 text-sm">{lead.qualify_reason}</p>
        </div>
      )}

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

      {lead.preview_url && (
        <div>
          <a href={lead.preview_url} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand/90 transition-colors">
            Bekijk preview →
          </a>
        </div>
      )}

      {/* Email compose */}
      {sent ? (
        <div className="bg-surface rounded-xl border border-green-500/20 p-5">
          <p className="text-white/40 text-xs uppercase tracking-wider mb-1">E-mail</p>
          <p className="text-green-400 text-sm font-medium">✓ Mail verzonden naar {lead.email}</p>
        </div>
      ) : !canCompose ? (
        <div className="bg-surface rounded-xl border border-subtle p-5">
          <p className="text-white/40 text-xs uppercase tracking-wider mb-1">E-mail</p>
          <p className="text-white/40 text-sm">
            {!lead.preview_url ? 'Deploy eerst een preview voordat je een mail kunt sturen.' : 'Geen e-mailadres gevonden voor deze lead.'}
          </p>
        </div>
      ) : (
        <div className="bg-surface rounded-xl border border-subtle p-6 space-y-5">
          {/* Header row */}
          <div className="flex items-center justify-between">
            <p className="text-white/40 text-xs uppercase tracking-wider">E-mail concept</p>
            <div className="flex items-center gap-3">
              {draftReady && (
                <button onClick={() => setShowPreview(p => !p)}
                  className="text-xs text-white/40 hover:text-white/70 transition-colors">
                  {showPreview ? '← Bewerken' : 'Voorbeeld →'}
                </button>
              )}
              <button
                onClick={generateDraft}
                disabled={generating}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-2 border border-subtle rounded-lg text-xs text-white/60 hover:text-white hover:border-white/20 transition-colors disabled:opacity-50"
              >
                {generating ? (
                  <><span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />Genereren…</>
                ) : draftReady ? (
                  '↻ Regenereer'
                ) : (
                  '✦ Genereer mail'
                )}
              </button>
            </div>
          </div>

          {generateError && (
            <p className="text-red-400 text-xs">{generateError}</p>
          )}

          {!draftReady && !generating ? (
            <div className="py-8 text-center">
              <p className="text-white/30 text-sm mb-4">Klik op "Genereer mail" om een gepersonaliseerde e-mail te maken met Claude.</p>
              <button
                onClick={generateDraft}
                className="px-5 py-2.5 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand/90 transition-colors"
              >
                ✦ Genereer mail
              </button>
            </div>
          ) : generating ? (
            <div className="py-8 text-center">
              <span className="w-5 h-5 border-2 border-white/20 border-t-brand rounded-full animate-spin inline-block mb-3" />
              <p className="text-white/30 text-sm">Mail genereren met Claude…</p>
            </div>
          ) : showPreview ? (
            /* Rendered preview */
            <div className="bg-white rounded-lg overflow-hidden border border-white/10">
              {/* Email header preview */}
              <div style={{ background: '#0f0f0f', padding: '20px 28px' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="https://graphicvision.nl/wp-content/uploads/2026/03/graphic-vision-logo-wit.png"
                  alt="Graphic Vision" style={{ height: '30px', objectFit: 'contain' }}
                />
              </div>
              <div className="p-6 pb-4">
                <div className="mb-4 pb-3 border-b border-gray-100 space-y-1">
                  <p className="text-xs text-gray-400">Aan: <span className="text-gray-700">{emailTo}</span></p>
                  <p className="text-xs text-gray-400">Onderwerp: <span className="text-gray-700 font-medium">{subject}</span></p>
                </div>
                <div dangerouslySetInnerHTML={{ __html: toPreviewHtml(body) }} />
              </div>
              <div style={{ background: '#fafafa', padding: '16px 28px', borderTop: '1px solid #eee' }}>
                <p style={{ margin: 0, fontSize: '12px', color: '#999' }}>
                  Ezra — Graphic Vision · <a href="https://graphicvision.nl" style={{ color: '#FF794F' }}>graphicvision.nl</a>
                </p>
              </div>
            </div>
          ) : (
            /* Edit mode */
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-white/40 mb-1.5">Aan</label>
                <input
                  type="email"
                  value={emailTo}
                  onChange={e => setEmailTo(e.target.value)}
                  className="w-full bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/20"
                />
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-1.5">Onderwerp</label>
                <input
                  type="text"
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  onBlur={e => saveDraft(e.target.value, body)}
                  className="w-full bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/20"
                />
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-1.5">Bericht</label>
                <textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  onBlur={e => saveDraft(subject, e.target.value)}
                  rows={12}
                  className="w-full bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/20 font-mono resize-y"
                />
              </div>
            </div>
          )}

          {draftReady && !generating && (
            <div className="flex items-center gap-3 pt-1 border-t border-subtle">
              <button
                onClick={handleSendMail}
                disabled={sending || !emailTo || !subject || !body}
                className="mt-3 px-5 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {sending ? (
                  <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Versturen…</>
                ) : 'Verstuur mail →'}
              </button>
              {sendError && <span className="text-red-400 text-sm mt-3">{sendError}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
