'use client'

import Image from 'next/image'
import { useState, type MouseEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Lead, LeadStatus, CrmStatus, ScoreBreakdown, EmailVariant, ReplyClassification } from '@/types'
import { StatusBadge } from './StatusBadge'
import { format, formatDistanceToNow, isPast } from 'date-fns'
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

const SEGMENT_LABELS: Record<string, string> = {
  ideal:        'Ideaal',
  no_website:   'Geen website',
  low_reviews:  'Weinig reviews',
  high_reviews: 'Veel reviews',
  high_rating:  'Hoge score',
}

const SEGMENT_COLORS: Record<string, string> = {
  ideal:        'bg-green-500/10 text-green-400 border-green-500/20',
  no_website:   'bg-orange-500/10 text-orange-400 border-orange-500/20',
  low_reviews:  'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  high_reviews: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  high_rating:  'bg-purple-500/10 text-purple-400 border-purple-500/20',
}

const CRM_OPTIONS: { value: CrmStatus; label: string; color: string }[] = [
  { value: 'not_contacted', label: 'Niet benaderd', color: 'text-white/40' },
  { value: 'contacted',     label: 'Benaderd',       color: 'text-blue-400' },
  { value: 'replied',       label: 'Gereageerd',     color: 'text-yellow-400' },
  { value: 'interested',    label: 'Geïnteresseerd', color: 'text-green-400' },
  { value: 'closed',        label: 'Gesloten',       color: 'text-purple-400' },
  { value: 'rejected',      label: 'Afgewezen',      color: 'text-red-400' },
]

function Collapsible({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-subtle rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-sm text-white/50 hover:text-white/70 hover:bg-white/[0.02] transition-colors"
      >
        <span className="font-medium text-white/60">{title}</span>
        <span className="text-white/30 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t border-subtle bg-surface/50 px-5 py-5">
          {children}
        </div>
      )}
    </div>
  )
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
          <span>✓</span> Reactie mail concept klaar — zie de sequentie hieronder
        </p>
      )}

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

function toDateTimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function defaultScheduledTimeLocal(): string {
  const now = new Date()
  const target = new Date(now.getTime() + 30 * 60 * 1000)
  target.setSeconds(0, 0)
  const roundedMinutes = target.getMinutes() <= 30 ? 30 : 60
  target.setMinutes(roundedMinutes, 0, 0)
  if (target.getHours() < 7) {
    target.setHours(7, 0, 0, 0)
  } else if (target.getHours() >= 18) {
    target.setDate(target.getDate() + 1)
    target.setHours(7, 0, 0, 0)
  }
  return toDateTimeLocalValue(target)
}

function validateScheduledLocal(value: string): { ok: true; iso: string } | { ok: false; error: string } {
  if (!value) return { ok: false, error: 'Kies een datum en tijd' }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return { ok: false, error: 'Ongeldige datum/tijd' }
  if (date.getTime() <= Date.now()) return { ok: false, error: 'Kies een tijd in de toekomst' }
  const minutes = date.getHours() * 60 + date.getMinutes()
  if (minutes < 7 * 60 || minutes >= 18 * 60) {
    return { ok: false, error: 'Plan tussen 07:00 en 18:00' }
  }
  return { ok: true, iso: date.toISOString() }
}

function deriveNextAction(lead: Lead): { text: string; color: string } | null {
  if (!lead.email?.trim() && ['qualified', 'redesigned', 'deployed'].includes(lead.status) && !['closed', 'rejected'].includes(lead.crm_status ?? '') && lead.sequence_stopped !== true)
    return { text: 'Email toevoegen', color: 'text-yellow-400' }
  if (lead.reply_received_at && !lead.email2_draft_ready)
    return { text: 'Verwerk reply', color: 'text-green-400' }
  if (lead.reply_received_at && lead.email2_draft_ready)
    return { text: 'Stuur reactie-mail', color: 'text-green-400' }
  if (lead.next_followup_at && !lead.sequence_stopped && isPast(new Date(lead.next_followup_at)))
    return { text: 'Follow-up klaar om te sturen', color: 'text-yellow-400' }
  if (lead.status === 'qualified' && lead.email1_subject && !lead.email1_sent_at)
    return { text: 'Stuur email 1', color: 'text-blue-400' }
  if (lead.status === 'qualified' && !lead.email1_subject)
    return { text: 'Genereer e-mailreeks', color: 'text-white/60' }
  if (lead.status === 'sent' && lead.sequence_stopped)
    return { text: 'Sequentie gestopt', color: 'text-white/30' }
  if (lead.status === 'sent')
    return { text: 'Wachten op reactie', color: 'text-white/40' }
  if (['scraped', 'no_email', 'error'].includes(lead.status))
    return { text: 'Kwalificeren', color: 'text-white/50' }
  return null
}

interface LeadDetailProps {
  lead: Lead
}

export function LeadDetail({ lead: initialLead }: LeadDetailProps) {
  const router = useRouter()
  const [lead, setLead] = useState(initialLead)
  const [deleting, setDeleting] = useState(false)

  const [crmUpdating, setCrmUpdating] = useState(false)

  const [activeEmailTab, setActiveEmailTab] = useState(0)
  const [activeVariantTab, setActiveVariantTab] = useState(lead.selected_variant ?? 0)
  const [generatingSequence, setGeneratingSequence] = useState(false)
  const [generatingVariants, setGeneratingVariants] = useState(false)
  const [sequenceError, setSequenceError] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [sendSuccess, setSendSuccess] = useState('')
  const [sendMode, setSendMode] = useState<'now' | 'schedule'>('now')
  const [scheduledAtLocal, setScheduledAtLocal] = useState(defaultScheduledTimeLocal())
  const [stoppingSequence, setStoppingSequence] = useState(false)
  const [savingEmail, setSavingEmail] = useState(false)
  const [emailSaveMessage, setEmailSaveMessage] = useState('')
  const [emailSaveError, setEmailSaveError] = useState('')
  const [markingPainpoint, setMarkingPainpoint] = useState(false)
  const [savingPainpoint, setSavingPainpoint] = useState(false)
  const [painpointMessage, setPainpointMessage] = useState('')
  const [painpointError, setPainpointError] = useState('')

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
    router.push('/leads')
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

  async function sendEmail(emailIdx: number, scheduledFor?: string) {
    setSending(true)
    setSendError('')
    setSendSuccess('')
    try {
      if (emailTo && emailTo !== lead.email) {
        await fetch(`/api/leads/${lead.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: emailTo }),
        })
        setLead(l => ({ ...l, email: emailTo }))
      }
      const res = await fetch(`/api/leads/${lead.id}/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailNumber: emailIdx, scheduledFor }),
      })
      const data = await res.json()
      if (res.ok) {
        if (data.scheduled) {
          const when = data.scheduled_for ? format(new Date(data.scheduled_for), 'dd MMM yyyy HH:mm', { locale: nl }) : 'gekozen tijd'
          setSendSuccess(`Email ${emailIdx} ingepland voor ${when}`)
          return
        }
        setLead(l => ({
          ...l,
          status: 'sent',
          crm_status: 'contacted',
          email_sequence_index: (l.email_sequence_index ?? 0) + 1,
          next_followup_at: data.next_followup_at,
          [`email${emailIdx}_sent_at`]: data.sent_at ?? new Date().toISOString(),
        }))
        if (emailIdx < 4) setActiveEmailTab(emailIdx)
        setSendSuccess(`Email ${emailIdx} verstuurd`)
      } else {
        setSendError(data.error ?? 'Onbekende fout')
      }
    } finally {
      setSending(false)
    }
  }

  async function saveRecipientEmail() {
    const nextEmail = emailTo.trim()
    if (!nextEmail || nextEmail === lead.email) return
    setSavingEmail(true)
    setEmailSaveMessage('')
    setEmailSaveError('')
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: nextEmail }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setEmailSaveError(data.error ?? 'Opslaan mislukt')
        return
      }
      setLead(l => ({ ...l, email: nextEmail }))
      setEmailSaveMessage(lead.email1_body ? 'E-mailadres opgeslagen. Lead staat nu klaar om te sturen.' : 'E-mailadres opgeslagen.')
    } finally {
      setSavingEmail(false)
    }
  }

  async function updateVariantType(type: 'text_only' | 'painpoint_screenshot') {
    await fetch(`/api/leads/${lead.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email1_variant_type: type }),
    }).catch(() => {})
    setLead(l => ({ ...l, email1_variant_type: type }))
  }

  function deriveAutomaticPainpoint() {
    const breakdown = lead.score_breakdown
    if (breakdown?.has_cta === false) {
      return { targetX: 0.58, targetY: 0.24, startX: 0.22, startY: 0.12, label: 'Geen duidelijke CTA' }
    }
    if (breakdown?.mobile_friendly === false) {
      return { targetX: 0.78, targetY: 0.20, startX: 0.48, startY: 0.10, label: 'Mobiel onduidelijk' }
    }
    if (breakdown?.outdated_feel === true) {
      return { targetX: 0.34, targetY: 0.22, startX: 0.66, startY: 0.10, label: 'Verouderde eerste indruk' }
    }
    return { targetX: 0.50, targetY: 0.26, startX: 0.18, startY: 0.12, label: 'Hier haken bezoekers af' }
  }

  async function savePainpointScreenshot(image: string) {
    setSavingPainpoint(true)
    setPainpointMessage('')
    setPainpointError('')
    try {
      const res = await fetch(`/api/leads/${lead.id}/painpoint-screenshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setPainpointError(data.error ?? 'Screenshot opslaan mislukt')
        return
      }
      setLead(l => ({
        ...l,
        painpoint_screenshot_url: data.url,
        email1_variant_type: 'painpoint_screenshot',
      }))
      setPainpointMessage('Screenshot opgeslagen en geselecteerd voor email 1.')
      setMarkingPainpoint(false)
    } finally {
      setSavingPainpoint(false)
    }
  }

  async function createMarkedPainpointScreenshot(opts: {
    targetX: number
    targetY: number
    startX?: number
    startY?: number
    label?: string
  }) {
    if (savingPainpoint || !lead.screenshot_url) return
    try {
      const img = document.createElement('img')
      img.crossOrigin = 'anonymous'
      img.src = lead.screenshot_url
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('Screenshot laden mislukt'))
      })

      const maxWidth = 1400
      const scale = Math.min(1, maxWidth / img.naturalWidth)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.naturalWidth * scale)
      canvas.height = Math.round(img.naturalHeight * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas niet beschikbaar')

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

      const targetX = Math.max(24, Math.min(canvas.width - 24, opts.targetX * canvas.width))
      const targetY = Math.max(24, Math.min(canvas.height - 24, opts.targetY * canvas.height))
      const startX = Math.max(30, Math.min(canvas.width - 30, (opts.startX ?? opts.targetX - 0.22) * canvas.width))
      const startY = Math.max(30, Math.min(canvas.height - 30, (opts.startY ?? opts.targetY - 0.20) * canvas.height))
      const angle = Math.atan2(targetY - startY, targetX - startX)
      const headLength = 34

      if (opts.label) {
        ctx.save()
        ctx.font = '700 28px Arial, sans-serif'
        const labelWidth = Math.min(canvas.width - 36, ctx.measureText(opts.label).width + 32)
        const labelX = Math.max(18, Math.min(canvas.width - labelWidth - 18, startX - 20))
        const labelY = Math.max(18, startY - 64)
        ctx.fillStyle = '#ff3b30'
        ctx.shadowColor = 'rgba(0,0,0,0.35)'
        ctx.shadowBlur = 10
        ctx.beginPath()
        ctx.roundRect(labelX, labelY, labelWidth, 48, 10)
        ctx.fill()
        ctx.shadowBlur = 0
        ctx.fillStyle = '#fff'
        ctx.fillText(opts.label, labelX + 16, labelY + 33)
        ctx.restore()
      }

      ctx.save()
      ctx.lineWidth = 10
      ctx.strokeStyle = '#ff3b30'
      ctx.fillStyle = '#ff3b30'
      ctx.shadowColor = 'rgba(0,0,0,0.35)'
      ctx.shadowBlur = 8
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(startX, startY)
      ctx.lineTo(targetX, targetY)
      ctx.stroke()

      ctx.beginPath()
      ctx.moveTo(targetX, targetY)
      ctx.lineTo(targetX - headLength * Math.cos(angle - Math.PI / 6), targetY - headLength * Math.sin(angle - Math.PI / 6))
      ctx.lineTo(targetX - headLength * Math.cos(angle + Math.PI / 6), targetY - headLength * Math.sin(angle + Math.PI / 6))
      ctx.closePath()
      ctx.fill()

      ctx.lineWidth = 8
      ctx.strokeStyle = '#ff3b30'
      ctx.beginPath()
      ctx.arc(targetX, targetY, 42, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()

      await savePainpointScreenshot(canvas.toDataURL('image/jpeg', 0.86))
    } catch (error) {
      setPainpointError(error instanceof Error ? error.message : 'Screenshot maken mislukt')
    }
  }

  async function handlePainpointClick(event: MouseEvent<HTMLImageElement>) {
    if (!markingPainpoint || savingPainpoint || !lead.screenshot_url) return

    const rect = event.currentTarget.getBoundingClientRect()
    await createMarkedPainpointScreenshot({
      targetX: (event.clientX - rect.left) / rect.width,
      targetY: (event.clientY - rect.top) / rect.height,
    })
  }

  async function createAutomaticPainpointScreenshot() {
    if (lead.screenshot_url) {
      await createMarkedPainpointScreenshot(deriveAutomaticPainpoint())
      return
    }

    if (!lead.website_url) {
      setPainpointError('Geen website beschikbaar om een screenshot te maken')
      return
    }

    setSavingPainpoint(true)
    setPainpointMessage('')
    setPainpointError('')
    try {
      const res = await fetch(`/api/leads/${lead.id}/painpoint-screenshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setPainpointError(data.error ?? 'Screenshot genereren mislukt')
        return
      }
      setLead(l => ({
        ...l,
        painpoint_screenshot_url: data.url,
        email1_variant_type: 'painpoint_screenshot',
      }))
      setPainpointMessage('Screenshot gegenereerd en geselecteerd voor email 1.')
    } finally {
      setSavingPainpoint(false)
    }
  }

  async function stopSequence() {
    setStoppingSequence(true)
    await fetch(`/api/leads/${lead.id}/stop-sequence`, { method: 'POST' }).catch(() => {})
    setLead(l => ({ ...l, sequence_stopped: true, next_followup_at: null }))
    setStoppingSequence(false)
  }

  const sb: ScoreBreakdown | null = lead.score_breakdown ?? null
  const nextAction = deriveNextAction(lead)
  const activeCrm = CRM_OPTIONS.find(o => o.value === (lead.crm_status ?? 'not_contacted'))
  const missingEmail = !lead.email?.trim()

  return (
    <div className="space-y-6">

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
            {lead.segment && (
              <span className={`px-2 py-0.5 border rounded-full text-xs font-medium ${SEGMENT_COLORS[lead.segment] ?? 'bg-white/5 text-white/40 border-subtle'}`}>
                {SEGMENT_LABELS[lead.segment] ?? lead.segment}
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

      {/* Decision bar */}
      <div className="flex items-center gap-4 flex-wrap bg-surface border border-subtle rounded-xl px-5 py-3.5">
        {nextAction && (
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" style={{ color: 'inherit' }} />
            <span className={`text-sm font-medium ${nextAction.color}`}>{nextAction.text}</span>
          </div>
        )}
        <div className="flex items-center gap-2 ml-auto flex-wrap">
          <span className="text-xs text-white/30">CRM:</span>
          {CRM_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => updateCrm(opt.value)}
              disabled={crmUpdating}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                (lead.crm_status ?? 'not_contacted') === opt.value
                  ? `border-current bg-white/5 ${opt.color}`
                  : 'border-transparent text-white/25 hover:text-white/50 hover:border-subtle'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Reply panel — shown first when reply received */}
      {lead.reply_received_at && (
        <ReplyPanel lead={lead} onTriggered={() => window.location.reload()} />
      )}

      {/* Email sequence panel — primary action area */}
      <div className="bg-surface rounded-xl border border-subtle p-6 space-y-5">
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

        {missingEmail && (
          <div className="rounded-lg border border-yellow-400/25 bg-yellow-400/10 p-3 space-y-3">
            <p className="text-sm text-yellow-200">
              Geen e-mailadres gevonden. Voeg handmatig een e-mailadres toe om te kunnen versturen.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="email"
                value={emailTo}
                onChange={e => {
                  setEmailTo(e.target.value)
                  setEmailSaveMessage('')
                  setEmailSaveError('')
                }}
                placeholder="naam@bedrijf.nl"
                className="min-w-[240px] flex-1 bg-surface-2 border border-yellow-400/20 rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-yellow-400/50"
              />
              <button
                type="button"
                onClick={saveRecipientEmail}
                disabled={savingEmail || !emailTo.trim()}
                className="px-3 py-2 bg-yellow-400/15 border border-yellow-400/30 text-yellow-200 rounded-lg text-sm hover:bg-yellow-400/25 transition-colors disabled:opacity-40 whitespace-nowrap"
              >
                {savingEmail ? 'Opslaan…' : 'Email opslaan'}
              </button>
            </div>
            {emailSaveMessage && <p className="text-xs text-green-400">{emailSaveMessage}</p>}
            {emailSaveError && <p className="text-xs text-red-400">{emailSaveError}</p>}
          </div>
        )}

        {!emails[0].subject && !generatingSequence ? (
          <div className="py-8 text-center">
            <p className="text-white/30 text-sm mb-4">Genereer de 4-mail reeks: Outreach → Reactie → Herinnering 1 → Herinnering 2</p>
            <button onClick={generateSequence}
              className="px-5 py-2.5 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand/90 transition-colors">
              ✦ Genereer sequentie
            </button>
          </div>
        ) : generatingSequence ? (
          <div className="py-8 text-center">
            <span className="w-5 h-5 border-2 border-white/20 border-t-brand rounded-full animate-spin inline-block mb-3" />
            <p className="text-white/30 text-sm">Sequentie genereren met Gemini…</p>
          </div>
        ) : (
          <>
            <div className="flex gap-1 border-b border-subtle pb-0">
              {emails.map((e, i) => (
                <button
                  key={i}
                  onClick={() => setActiveEmailTab(i)}
                  className={`px-3 py-2 text-xs font-medium rounded-t-lg transition-colors relative ${
                    activeEmailTab === i ? 'text-white bg-white/5' : 'text-white/40 hover:text-white/70'
                  }`}
                >
                  {['Outreach', 'Reactie', 'Herinnering 1', 'Herinnering 2'][i]}
                  {e.sentAt && (
                    <span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                  )}
                </button>
              ))}
            </div>

            {(() => {
              const email = emails[activeEmailTab]
              const subjectKey = `email${activeEmailTab + 1}_subject` as keyof typeof emailFields
              const bodyKey = `email${activeEmailTab + 1}_body` as keyof typeof emailFields
              const seqIdx = lead.email_sequence_index ?? 0
              const isNextToSend = activeEmailTab === seqIdx && !email.sentAt

              return (
                <div className="space-y-4">
                  {activeEmailTab === 0 && (
                    <div className="space-y-2">
                      <p className="text-xs text-white/40">Email 1 type</p>
                      <div className="flex gap-2">
                        {(['text_only', 'painpoint_screenshot'] as const).map(type => (
                          <button
                            key={type}
                            onClick={() => updateVariantType(type)}
                            className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                              (lead.email1_variant_type ?? 'text_only') === type
                                ? 'border-brand text-brand bg-brand/10'
                                : 'border-subtle text-white/40 hover:text-white/60'
                            }`}
                          >
                            {type === 'text_only' ? 'Tekst only' : 'Met screenshot'}
                          </button>
                        ))}
                      </div>
                      {(lead.email1_variant_type ?? 'text_only') === 'painpoint_screenshot' && !lead.painpoint_screenshot_url && (
                        <p className="text-yellow-400/80 text-xs">⚠ Geen screenshot URL — valt terug op tekst only bij verzending</p>
                      )}
                      {(lead.email1_variant_type ?? 'text_only') === 'painpoint_screenshot' && lead.painpoint_screenshot_url && (
                        <img src={lead.painpoint_screenshot_url} alt="Painpoint screenshot" className="max-w-[180px] rounded border border-subtle mt-1" />
                      )}
                    </div>
                  )}

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

                  {activeEmailTab !== 1 ? (
                    <div>
                      <label className="block text-xs text-white/40 mb-1.5">Onderwerp</label>
                      <input
                        type="text"
                        value={email.subject}
                        onChange={e => setEmailFields(f => ({ ...f, [subjectKey]: e.target.value }))}
                        className="w-full bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/20"
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs text-white/40 mb-1.5">Onderwerp</label>
                      <p className="text-sm text-white/40 italic">Re: {lead.email1_subject ?? lead.email_subject ?? '…'}</p>
                    </div>
                  )}

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
                          onChange={e => {
                            setEmailTo(e.target.value)
                            setEmailSaveMessage('')
                            setEmailSaveError('')
                          }}
                          className="w-full bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/20"
                        />
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs text-white/40">Verzendmodus</p>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => setSendMode('now')}
                            className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${sendMode === 'now' ? 'border-white/25 bg-white/10 text-white' : 'border-subtle text-white/45 hover:text-white/70'}`}>
                            Nu versturen
                          </button>
                          <button type="button" onClick={() => { setSendMode('schedule'); if (!scheduledAtLocal) setScheduledAtLocal(defaultScheduledTimeLocal()) }}
                            className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${sendMode === 'schedule' ? 'border-white/25 bg-white/10 text-white' : 'border-subtle text-white/45 hover:text-white/70'}`}>
                            Inplannen
                          </button>
                        </div>
                      </div>
                      {sendMode === 'schedule' && (
                        <div>
                          <label className="block text-xs text-white/40 mb-1.5">Verstuur op</label>
                          <input
                            type="datetime-local"
                            value={scheduledAtLocal}
                            onChange={(e) => setScheduledAtLocal(e.target.value)}
                            className="w-full max-w-[280px] bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/20"
                          />
                          <p className="text-xs text-white/30 mt-1">Alleen tussen 07:00 en 18:00</p>
                        </div>
                      )}
                      <div className="flex items-center gap-3 flex-wrap">
                        <button
                          type="button"
                          onClick={saveRecipientEmail}
                          disabled={savingEmail || !emailTo.trim() || emailTo.trim() === lead.email}
                          className="px-3 py-2 bg-surface-2 border border-subtle text-white/60 rounded-lg text-sm hover:text-white hover:border-white/20 transition-colors disabled:opacity-40"
                        >
                          {savingEmail ? 'Opslaan…' : 'Email opslaan'}
                        </button>
                        <button
                          onClick={() => {
                            if (sendMode === 'schedule') {
                              const parsed = validateScheduledLocal(scheduledAtLocal)
                              if (!parsed.ok) { setSendError(parsed.error); return }
                              sendEmail(activeEmailTab + 1, parsed.iso)
                              return
                            }
                            sendEmail(activeEmailTab + 1)
                          }}
                          disabled={sending || !emailTo || !email.subject || !email.body || (sendMode === 'schedule' && !scheduledAtLocal)}
                          className="px-5 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                          {sending ? (
                            <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Versturen…</>
                          ) : sendMode === 'schedule'
                            ? `Plan email ${activeEmailTab + 1}`
                            : `Stuur email ${activeEmailTab + 1} →`}
                        </button>
                        {sendError && <span className="text-red-400 text-sm">{sendError}</span>}
                        {sendSuccess && <span className="text-green-400 text-sm">{sendSuccess}</span>}
                        {emailSaveMessage && <span className="text-green-400 text-sm">{emailSaveMessage}</span>}
                        {emailSaveError && <span className="text-red-400 text-sm">{emailSaveError}</span>}
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}
          </>
        )}
      </div>

      {/* Collapsible: Contact */}
      <Collapsible title="Contact">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {lead.website_url && (
            <a href={lead.website_url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 bg-surface border border-subtle rounded-lg text-xs text-white/60 hover:text-white transition-colors">
              <span>🌐</span>
              <span className="truncate">{lead.website_url.replace(/^https?:\/\//, '').split('/')[0]}</span>
            </a>
          )}
          {lead.email && (
            <a href={`mailto:${lead.email}`}
              className="flex items-center gap-2 px-3 py-2 bg-surface border border-subtle rounded-lg text-xs text-white/60 hover:text-white transition-colors">
              <span>✉</span>
              <span className="truncate">{lead.email}</span>
            </a>
          )}
          {lead.phone && (
            <a href={`tel:${lead.phone}`}
              className="flex items-center gap-2 px-3 py-2 bg-surface border border-subtle rounded-lg text-xs text-white/60 hover:text-white transition-colors">
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
              className="flex items-center gap-2 px-3 py-2 bg-surface border border-subtle rounded-lg text-xs text-white/60 hover:text-white transition-colors">
              <span>f</span>
              <span>Facebook</span>
            </a>
          )}
          {lead.instagram_url && (
            <a href={lead.instagram_url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 bg-surface border border-subtle rounded-lg text-xs text-white/60 hover:text-white transition-colors">
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
          {!lead.website_url && !lead.email && !lead.phone && !lead.whatsapp_url && !lead.preview_url && (
            <p className="text-white/25 text-sm col-span-3">Geen contactgegevens beschikbaar</p>
          )}
        </div>
      </Collapsible>

      {/* Collapsible: Lead score */}
      {(lead.lead_score !== null || sb) && (
        <Collapsible title={`Lead score${lead.lead_score !== null ? ` — ${lead.lead_score}/100` : ''}`}>
          {sb && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { key: 'website_exists',  label: 'Website' },
                { key: 'email_found',     label: 'Email' },
                { key: 'phone_found',     label: 'Telefoon' },
                { key: 'outdated_feel',   label: 'Verouderd' },
                { key: 'mobile_friendly', label: 'Mobiel' },
                { key: 'has_cta',         label: 'CTA' },
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
        </Collapsible>
      )}

      {/* Collapsible: Screenshots */}
      <Collapsible title="Screenshots">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <div className="flex items-center justify-between gap-3 mb-3">
              <p className="text-white/40 text-xs uppercase tracking-wider">Originele website</p>
              {(lead.screenshot_url || lead.website_url) && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={createAutomaticPainpointScreenshot}
                    disabled={savingPainpoint}
                    className="px-2.5 py-1 rounded-lg text-xs border border-subtle bg-surface text-white/55 hover:text-white hover:border-white/20 transition-colors disabled:opacity-40"
                  >
                    {savingPainpoint ? 'Opslaan...' : 'Auto pijl maken'}
                  </button>
                  {lead.screenshot_url && (
                    <button
                      type="button"
                      onClick={() => {
                        setMarkingPainpoint(v => !v)
                        setPainpointMessage('')
                        setPainpointError('')
                      }}
                      disabled={savingPainpoint}
                      className={`px-2.5 py-1 rounded-lg text-xs border transition-colors disabled:opacity-40 ${
                        markingPainpoint
                          ? 'border-red-400/40 bg-red-500/10 text-red-300'
                          : 'border-subtle bg-surface text-white/55 hover:text-white hover:border-white/20'
                      }`}
                    >
                      {savingPainpoint ? 'Opslaan...' : markingPainpoint ? 'Klik zwak punt' : 'Pijl plaatsen'}
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="bg-surface rounded-xl border border-subtle overflow-hidden aspect-video flex items-center justify-center">
              {lead.screenshot_url ? (
                <Image src={lead.screenshot_url} alt="Screenshot originele site"
                  width={640} height={360}
                  onClick={handlePainpointClick}
                  className={`w-full h-full object-cover object-top ${markingPainpoint ? 'cursor-crosshair' : ''}`}
                  unoptimized />
              ) : (
                <div className="text-center px-4">
                  <p className="text-white/25 text-sm">Geen screenshot beschikbaar</p>
                  {lead.website_url && (
                    <p className="text-white/25 text-xs mt-2">Gebruik Auto pijl maken om er nu een te genereren.</p>
                  )}
                </div>
              )}
            </div>
            {markingPainpoint && (
              <p className="text-xs text-yellow-300/80 mt-2">Klik op het zwakke punt in de screenshot.</p>
            )}
            {painpointMessage && <p className="text-xs text-green-400 mt-2">{painpointMessage}</p>}
            {painpointError && <p className="text-xs text-red-400 mt-2">{painpointError}</p>}
            {lead.painpoint_screenshot_url && (
              <div className="mt-3">
                <p className="text-white/35 text-xs mb-2">Gemarkeerde screenshot</p>
                <img src={lead.painpoint_screenshot_url} alt="Gemarkeerde website screenshot" className="max-w-[220px] rounded-lg border border-subtle" />
              </div>
            )}
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
      </Collapsible>

    </div>
  )
}
