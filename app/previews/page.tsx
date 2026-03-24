'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { nl } from 'date-fns/locale'
import { Lead } from '@/types'
import { StatusBadge } from '@/components/StatusBadge'

export default function PreviewsPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    fetch('/api/leads?status=deployed&page=1')
      .then((r) => r.json())
      .then((data) => {
        // Also fetch sent leads
        return fetch('/api/leads?status=sent&page=1')
          .then((r2) => r2.json())
          .then((data2) => {
            const combined = [...(data.leads ?? []), ...(data2.leads ?? [])]
            // Sort by created_at descending
            combined.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            setLeads(combined)
          })
      })
      .finally(() => setIsLoading(false))
  }, [])

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Preview log</h1>
          <p className="text-white/45 text-sm mt-1">
            Alle gegenereerde websites — {leads.length} preview{leads.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Link
          href="/"
          className="text-white/40 hover:text-white text-sm transition-colors"
        >
          ← Dashboard
        </Link>
      </div>

      {isLoading ? (
        <div className="text-white/30 text-sm py-16 text-center">Laden…</div>
      ) : leads.length === 0 ? (
        <div className="bg-surface rounded-xl border border-subtle p-12 text-center">
          <p className="text-white/30">Nog geen previews gegenereerd.</p>
          <p className="text-white/20 text-sm mt-1">Start de pipeline om je eerste leads te verwerken.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {leads.map((lead) => (
            <PreviewCard key={lead.id} lead={lead} />
          ))}
        </div>
      )}
    </div>
  )
}

function PreviewCard({ lead }: { lead: Lead }) {
  return (
    <div className="bg-surface rounded-xl border border-subtle overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_320px] gap-0">

        {/* Screenshots */}
        <div className="border-b lg:border-b-0 lg:border-r border-subtle">
          <p className="text-white/30 text-xs px-4 pt-3 pb-2 uppercase tracking-wider">Origineel</p>
          <div className="h-40 bg-surface-2 overflow-hidden">
            {lead.screenshot_url ? (
              <Image
                src={lead.screenshot_url}
                alt="Originele site"
                width={400}
                height={160}
                className="w-full h-full object-cover object-top"
                unoptimized
              />
            ) : (
              <div className="h-full flex items-center justify-center text-white/20 text-xs">Geen screenshot</div>
            )}
          </div>
        </div>

        <div className="border-b lg:border-b-0 lg:border-r border-subtle">
          <p className="text-white/30 text-xs px-4 pt-3 pb-2 uppercase tracking-wider">Preview</p>
          <div className="h-40 bg-surface-2 overflow-hidden">
            {lead.preview_screenshot_url ? (
              <Image
                src={lead.preview_screenshot_url}
                alt="Preview"
                width={400}
                height={160}
                className="w-full h-full object-cover object-top"
                unoptimized
              />
            ) : (
              <div className="h-full flex items-center justify-center text-white/20 text-xs">Geen screenshot</div>
            )}
          </div>
        </div>

        {/* Info */}
        <div className="p-5 flex flex-col justify-between gap-4">
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <Link
                  href={`/leads/${lead.id}`}
                  className="font-semibold hover:text-brand transition-colors"
                >
                  {lead.company_name}
                </Link>
                <p className="text-white/40 text-xs mt-0.5">
                  {lead.niche}{lead.city ? ` · ${lead.city}` : ''}
                </p>
              </div>
              <StatusBadge status={lead.status} />
            </div>

            {/* Qualify reason / summary */}
            {lead.qualify_reason && (
              <p className="text-white/50 text-xs leading-relaxed bg-surface-2 rounded-lg px-3 py-2">
                {lead.qualify_reason}
              </p>
            )}

            {/* Links */}
            <div className="space-y-1.5">
              {lead.website_url && (
                <a
                  href={lead.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-xs text-white/40 hover:text-white/70 transition-colors"
                >
                  <span className="text-white/20">↗</span>
                  <span className="truncate">{lead.website_url.replace(/^https?:\/\//, '')}</span>
                </a>
              )}
              {lead.preview_url && (
                <a
                  href={lead.preview_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-xs text-brand hover:underline"
                >
                  <span>↗</span>
                  <span className="truncate">{lead.preview_url.replace(/^https?:\/\//, '')}</span>
                </a>
              )}
            </div>
          </div>

          <p className="text-white/25 text-xs">
            {formatDistanceToNow(new Date(lead.created_at), { addSuffix: true, locale: nl })}
          </p>
        </div>
      </div>
    </div>
  )
}
