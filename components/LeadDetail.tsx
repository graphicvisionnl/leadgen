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

  async function handleSendMail() {
    setSending(true)
    setSendError('')
    try {
      const res = await fetch(`/api/leads/${lead.id}/send-email`, { method: 'POST' })
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
        {/* Original screenshot */}
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

        {/* Preview screenshot */}
        <div>
          <p className="text-white/40 text-xs uppercase tracking-wider mb-3">
            Gegenereerde preview
          </p>
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

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        {lead.preview_url && (
          <a
            href={lead.preview_url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand/90 transition-colors"
          >
            Bekijk preview →
          </a>
        )}
        {lead.status === 'deployed' && !sent && (
          <button
            onClick={handleSendMail}
            disabled={sending}
            className="px-4 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand/90 transition-colors disabled:opacity-50 flex items-center gap-2"
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
        )}
        {sent && (
          <span className="px-4 py-2 bg-green-500/10 border border-green-500/20 text-green-400 rounded-lg text-sm font-medium">
            ✓ Mail verzonden
          </span>
        )}
        {sendError && (
          <span className="px-4 py-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm">
            Fout: {sendError}
          </span>
        )}
      </div>
    </div>
  )
}
