'use client'

import Image from 'next/image'
import { useState, useEffect } from 'react'
import { Lead, LeadStatus } from '@/types'
import { StatusBadge } from './StatusBadge'

interface LeadDetailProps {
  lead: Lead
}

export function LeadDetail({ lead }: LeadDetailProps) {
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(lead.status === 'sent')
  const [sendError, setSendError] = useState('')

  // Email compose state
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [draftLoaded, setDraftLoaded] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  const canCompose = !!lead.email && !!lead.preview_url && !sent

  useEffect(() => {
    if (!canCompose) return
    fetch(`/api/leads/${lead.id}/email-draft`)
      .then(r => r.json())
      .then(data => {
        if (data.subject) setSubject(data.subject)
        if (data.plainText) setBody(data.plainText)
        setDraftLoaded(true)
      })
      .catch(() => setDraftLoaded(true))
  }, [lead.id, canCompose])

  async function handleSendMail() {
    setSending(true)
    setSendError('')
    try {
      const res = await fetch(`/api/leads/${lead.id}/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body }),
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

  // Convert plain text to preview HTML (same logic as server)
  function toPreviewHtml(text: string): string {
    const lines = text.split('\n').map(line => {
      if (lead.preview_url && line.includes(lead.preview_url)) {
        return line.replace(
          lead.preview_url,
          `<a href="${lead.preview_url}" style="color:#FF794F;font-weight:bold;">${lead.preview_url}</a>`
        )
      }
      return line
    })
    return '<p style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a">' +
      lines.join('<br>').replace(/<br><br>/g, '</p><p style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a">') +
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
                <a
                  href={value}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand text-sm hover:underline break-all"
                >
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

      {/* Screenshots side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <p className="text-white/40 text-xs uppercase tracking-wider mb-3">Originele website</p>
          <div className="bg-surface rounded-xl border border-subtle overflow-hidden aspect-video flex items-center justify-center">
            {lead.screenshot_url ? (
              <Image
                src={lead.screenshot_url}
                alt="Screenshot originele site"
                width={640}
                height={360}
                className="w-full h-full object-cover object-top"
                unoptimized
              />
            ) : (
              <p className="text-white/25 text-sm">Geen screenshot beschikbaar</p>
            )}
          </div>
        </div>

        <div>
          <p className="text-white/40 text-xs uppercase tracking-wider mb-3">Gegenereerde preview</p>
          <div className="bg-surface rounded-xl border border-subtle overflow-hidden aspect-video flex items-center justify-center">
            {lead.preview_screenshot_url ? (
              <Image
                src={lead.preview_screenshot_url}
                alt="Screenshot preview"
                width={640}
                height={360}
                className="w-full h-full object-cover object-top"
                unoptimized
              />
            ) : lead.preview_url ? (
              <iframe
                src={lead.preview_url}
                className="w-full h-full border-0 scale-[0.5] origin-top-left"
                style={{ width: '200%', height: '200%' }}
                title="Preview"
              />
            ) : (
              <p className="text-white/25 text-sm">Preview nog niet gegenereerd</p>
            )}
          </div>
        </div>
      </div>

      {/* Preview link */}
      {lead.preview_url && (
        <div>
          <a
            href={lead.preview_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand/90 transition-colors"
          >
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
      ) : canCompose ? (
        <div className="bg-surface rounded-xl border border-subtle p-6 space-y-5">
          <div className="flex items-center justify-between">
            <p className="text-white/40 text-xs uppercase tracking-wider">E-mail concept</p>
            <button
              onClick={() => setShowPreview(p => !p)}
              className="text-xs text-white/40 hover:text-white/70 transition-colors"
            >
              {showPreview ? 'Bewerken' : 'Voorbeeld →'}
            </button>
          </div>

          {!draftLoaded ? (
            <p className="text-white/30 text-sm">Concept laden…</p>
          ) : showPreview ? (
            /* Rendered email preview */
            <div className="bg-white rounded-lg p-6 border border-white/10">
              <div className="mb-4 pb-4 border-b border-gray-200 space-y-1">
                <p className="text-xs text-gray-400">Aan: <span className="text-gray-700">{lead.email}</span></p>
                <p className="text-xs text-gray-400">Onderwerp: <span className="text-gray-700 font-medium">{subject}</span></p>
              </div>
              <div
                dangerouslySetInnerHTML={{ __html: toPreviewHtml(body) }}
              />
            </div>
          ) : (
            /* Edit mode */
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-white/40 mb-1.5">Aan</label>
                <p className="text-sm text-white/60 bg-surface-2 border border-subtle rounded-lg px-3 py-2">
                  {lead.email}
                </p>
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-1.5">Onderwerp</label>
                <input
                  type="text"
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  className="w-full bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/20"
                />
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-1.5">Bericht</label>
                <textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  rows={10}
                  className="w-full bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/20 font-mono resize-y"
                />
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleSendMail}
              disabled={sending || !subject || !body}
              className="px-5 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {sending ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Versturen…
                </>
              ) : (
                'Verstuur mail →'
              )}
            </button>
            {sendError && (
              <span className="text-red-400 text-sm">{sendError}</span>
            )}
          </div>
        </div>
      ) : !lead.email ? (
        <div className="bg-surface rounded-xl border border-subtle p-5">
          <p className="text-white/40 text-xs uppercase tracking-wider mb-1">E-mail</p>
          <p className="text-white/40 text-sm">Geen e-mailadres gevonden voor deze lead.</p>
        </div>
      ) : null}
    </div>
  )
}
