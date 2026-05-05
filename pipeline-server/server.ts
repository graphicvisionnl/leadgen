import 'dotenv/config'
import express from 'express'
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer'
import nodemailer from 'nodemailer'
import { ImapFlow } from 'imapflow'
import * as fs from 'fs'
import * as path from 'path'

const app = express()
app.use(express.json())

// ─── Auth middleware ──────────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (req.path === '/health') return next()
  const auth = req.headers['x-pipeline-secret']
  if (auth !== process.env.PIPELINE_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
})

// ─── Clients ──────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ─── Gemini 2.5 Flash helper (qualify + email — cheap & reliable) ────────────
async function callGemini(params: {
  system?: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  max_tokens: number
}): Promise<string> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${process.env.KIE_API_KEY}`,
    'Content-Type': 'application/json',
  }

  // Prepend system prompt as first user message if provided
  const messages = params.system
    ? [{ role: 'user' as const, content: params.system }, { role: 'assistant' as const, content: 'Begrepen.' }, ...params.messages]
    : params.messages

  const body = {
    model: 'gemini-2.5-flash',
    messages,
    stream: false,
    max_tokens: params.max_tokens,
    include_thoughts: false,
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch('https://api.kie.ai/gemini-2.5-flash/v1/chat/completions', {
        method: 'POST', headers, body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      })
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`)
      const data = await res.json()
      if (data.code && data.code !== 200) {
        return await callClaudeFallback(params, `Gemini provider error: ${JSON.stringify(data)}`)
      }
      if (data.error) throw new Error(`Gemini error: ${JSON.stringify(data.error)}`)
      const text = data.choices?.[0]?.message?.content
      if (!text) throw new Error(`Gemini: geen content in response`)
      return text
    } catch (e) {
      if (String(e).includes('TimeoutError') || String(e).includes('aborted due to timeout')) {
        return await callClaudeFallback(params, formatError(e))
      }
      if (attempt === 3) {
        return await callClaudeFallback(params, formatError(e))
      }
      log('Retry', `callGemini attempt ${attempt} mislukt: ${e} — wacht 30s`)
      await sleep(30_000)
    }
  }
  throw new Error('callGemini: alle pogingen mislukt')
}

async function callClaudeFallback(params: {
  system?: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  max_tokens: number
}, reason: string): Promise<string> {
  log('Retry', `Gemini niet beschikbaar: ${reason} — probeer Claude fallback`)
  const fallback = await callClaude({
    max_tokens: params.max_tokens,
    messages: params.messages,
    system: params.system,
  })
  const text = fallback.content
    ?.map((part: any) => typeof part === 'string' ? part : part.text ?? '')
    .join('')
    .trim()
  if (!text) throw new Error('Claude fallback: geen content in response')
  return text
}

// ─── kie.ai Claude helper (kept for HTML redesign fallback) ──────────────────
async function callClaude(params: {
  model?: string
  system?: string
  messages: any[]
  max_tokens: number
}): Promise<{ content: any[]; stop_reason: string; usage: any }> {
  const model = params.model ?? 'claude-sonnet-4-6'
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${process.env.KIE_API_KEY}`,
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  }
  const body: any = { model, max_tokens: params.max_tokens, messages: params.messages, stream: false }
  if (params.system) body.system = params.system

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch('https://api.kie.ai/claude/v1/messages', {
        method: 'POST', headers, body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      })
      if (!res.ok) throw new Error(`kie.ai ${res.status}: ${await res.text()}`)
      const data = await res.json()
      if (data.code && data.code !== 200) {
        const isServerError = data.code === 500 || data.code === 502 || data.code === 503
        if (isServerError && attempt < 3) {
          log('Retry', `callClaude attempt ${attempt} — kie.ai ${data.code} serverfout, wacht 30s`)
          await sleep(30_000)
          continue
        }
        throw new Error(`kie.ai error: ${JSON.stringify(data)}`)
      }
      return data
    } catch (e) {
      if (attempt === 3) throw e
      log('Retry', `callClaude attempt ${attempt} mislukt: ${e} — wacht 30s`)
      await sleep(30_000)
    }
  }
  throw new Error('callClaude: alle pogingen mislukt')
}

// ─── kie.ai Opus streaming helper (phase3 HTML) ───────────────────────────────
// Streams SSE so TCP stays alive during 5-min generation. Retries up to 3×.
async function callKieStreaming(params: {
  model: string
  system?: string
  messages: any[]
  max_tokens: number
}): Promise<{ content: any[]; stop_reason: string; usage: any }> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await callKieStreamingOnce(params)
    } catch (e) {
      if (attempt === 3) throw e
      log('Retry', `callKieStreaming attempt ${attempt} mislukt: ${e} — wacht 30s`)
      await sleep(30_000)
    }
  }
  throw new Error('callKieStreaming: alle pogingen mislukt')
}

async function callKieStreamingOnce(params: {
  model: string
  system?: string
  messages: any[]
  max_tokens: number
}): Promise<{ content: any[]; stop_reason: string; usage: any }> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${process.env.KIE_API_KEY}`,
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'output-128k-2025-02-19',
  }

  const body: any = { model: params.model, max_tokens: params.max_tokens, messages: params.messages, stream: true }
  if (params.system) body.system = params.system

  const res = await fetch('https://api.kie.ai/claude/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(600_000),
  })
  if (!res.ok) throw new Error(`kie.ai ${res.status}: ${await res.text()}`)

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let fullText = ''
  let stopReason = 'end_turn'
  let inputTokens = 0
  let outputTokens = 0
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6).trim()
      if (payload === '[DONE]') break
      try {
        const event = JSON.parse(payload)
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          fullText += event.delta.text ?? ''
        } else if (event.type === 'message_delta') {
          if (event.delta?.stop_reason) stopReason = event.delta.stop_reason
          if (event.usage?.output_tokens) outputTokens = event.usage.output_tokens
        } else if (event.type === 'message_start' && event.message?.usage) {
          inputTokens = event.message.usage.input_tokens ?? 0
        } else if (event.type === 'error') {
          throw new Error(`kie.ai stream error: ${JSON.stringify(event.error ?? event)}`)
        }
      } catch (parseErr) {
        if (String(parseErr).includes('kie.ai stream error')) throw parseErr
      }
    }
  }

  return {
    content: [{ type: 'text', text: fullText }],
    stop_reason: stopReason,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  }
}

// ─── Log buffer ───────────────────────────────────────────────────────────────
const logBuffer: string[] = []

function log(phase: string, msg: string) {
  const line = `[${new Date().toISOString()}] [${phase}] ${msg}`
  console.log(line)
  logBuffer.push(line)
  if (logBuffer.length > 300) logBuffer.shift()
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message
  if (typeof error === 'string') return error
  try { return JSON.stringify(error) } catch { return String(error) }
}

function normalizeUrl(url: string): string {
  const withProtocol = url.startsWith('http') ? url : `https://${url}`
  const parsed = new URL(withProtocol)
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '')
  parsed.hash = ''
  parsed.search = ''
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
  return parsed.toString().replace(/\/$/, '')
}

function isValidUrl(url: string): boolean {
  try { new URL(normalizeUrl(url)); return true } catch { return false }
}

// Search terms per niche — multiple intent-based terms for Apify
const NICHE_SEARCH_TERMS: Record<string, string[]> = {
  loodgieter:         ['loodgieter', 'spoed loodgieter', 'ontstoppingsdienst', 'cv monteur'],
  elektricien:        ['elektricien', 'storing elektricien', 'groepenkast vervangen'],
  schilder:           ['schilder', 'schildersbedrijf', 'binnenschilder'],
  kapper:             ['kapper', 'barbershop', 'kapsalon'],
  slotenmaker:        ['slotenmaker', 'spoed slotenmaker', 'deur openen slotenmaker'],
  dakdekker:          ['dakdekker', 'dakreparatie', 'daklekkage'],
  schoonmaakbedrijf:  ['schoonmaakbedrijf', 'kantoor schoonmaak', 'glasbewassing'],
  aannemer:           ['aannemer', 'verbouwing aannemer', 'bouwbedrijf'],
  stukadoor:          ['stukadoor', 'stucwerk', 'pleisterwerk'],
}

function loadSkill(filename: string): string {
  try {
    return fs.readFileSync(path.join(__dirname, '../../lib/skills', filename), 'utf-8')
  } catch { return '' }
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

const WORKDAY_TIMEZONE = 'Europe/Amsterdam'
const WORKDAY_START_MINUTES = 7 * 60
const WORKDAY_END_MINUTES = 18 * 60
const SCHEDULED_EMAILS_SETTING_KEY = 'scheduled_emails_v1'

type EmailNumber = 1 | 2 | 3 | 4
type LeadSegment = 'no_website' | 'low_reviews' | 'ideal' | 'high_reviews' | 'high_rating'

interface SegmentEmailTemplate {
  subject: string
  body: string
  segment: LeadSegment
  template: string
}

interface ScheduledEmailJob {
  leadId: string
  emailNumber: EmailNumber
  scheduledFor: string
  createdAt: string
}

function getMinutesInAmsterdam(date: Date): number {
  const parts = new Intl.DateTimeFormat('nl-NL', {
    timeZone: WORKDAY_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '-1')
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '-1')
  return hour * 60 + minute
}

function isWithinWorkingHours(date: Date): boolean {
  const minutes = getMinutesInAmsterdam(date)
  return minutes >= WORKDAY_START_MINUTES && minutes < WORKDAY_END_MINUTES
}

function parseScheduledFor(raw: unknown): { ok: true; iso: string; date: Date } | { ok: false; error: string } {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: 'Ongeldige geplande tijd' }
  }

  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) {
    return { ok: false, error: 'Ongeldige geplande tijd' }
  }

  if (date.getTime() <= Date.now()) {
    return { ok: false, error: 'Geplande tijd moet in de toekomst liggen' }
  }

  if (!isWithinWorkingHours(date)) {
    return { ok: false, error: 'Je kunt alleen plannen tussen 07:00 en 18:00 (Amsterdam tijd)' }
  }

  return { ok: true, iso: date.toISOString(), date }
}

function normalizeEmailNumber(raw: unknown): EmailNumber | null {
  const num = Number(raw)
  return num === 1 || num === 2 || num === 3 || num === 4 ? num : null
}

function getFakeEmailReason(email: string | null | undefined): string | null {
  if (!email) return null
  const normalized = normalizeRecipientEmail(email).toLowerCase()
  const match = normalized.match(/^([^@\s]+)@([^@\s]+\.[^@\s]+)$/)
  if (!match) return 'Ongeldig e-mailadres'

  const local = match[1].replace(/\+.*$/, '')
  const domain = match[2].replace(/^www\./, '')
  const fakeDomains = new Set([
    'example.com', 'example.nl', 'test.com', 'test.nl', 'fake.com', 'dummy.com',
    'domain.com', 'jouwweb.nl', 'onepage.website',
  ])
  const fakeLocals = new Set([
    'test', 'tester', 'testing', 'joedoe', 'joe.doe', 'johndoe', 'john.doe',
    'janedoe', 'jane.doe', 'dummy', 'fake', 'demo', 'example', 'mail', 'email',
    'name', 'naam', 'voornaam', 'achternaam', 'firstname', 'lastname',
  ])

  if (fakeDomains.has(domain)) return `Fake/test domein: ${domain}`
  if (fakeLocals.has(local)) return `Fake/test mailbox: ${local}`
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(domain)) return `Geen maildomein: ${domain}`
  if (/\d{8,}/.test(local)) return `Waarschijnlijk samengeplakte tekst/telefoonnummer: ${local}`
  if (/^(test|fake|dummy|demo)[._-]?\d*$/i.test(local)) return `Fake/test mailbox: ${local}`
  if (/^(joe|john|jane)[._-]?doe\d*$/i.test(local)) return `Placeholder mailbox: ${local}`
  if (local.includes('whatever')) return `Placeholder mailbox: ${local}`
  return null
}

function normalizeRecipientEmail(email: string | null | undefined): string {
  const raw = (email ?? '').trim()
  try {
    return decodeURIComponent(raw).trim()
  } catch {
    return raw
  }
}

function normalizeLeadSegment(raw: unknown): LeadSegment {
  return raw === 'no_website' ||
    raw === 'low_reviews' ||
    raw === 'ideal' ||
    raw === 'high_reviews' ||
    raw === 'high_rating'
    ? raw
    : 'ideal'
}

function leadSearchLine(lead: any): string {
  const niche = lead.niche || 'jullie branche'
  const city = lead.city || 'jullie regio'
  return `Ik kwam jullie tegen toen ik zocht naar ${niche} in ${city}`
}

function generateEmail1ForSegment(lead: any): SegmentEmailTemplate {
  const segment = normalizeLeadSegment(lead.segment)
  const intro = leadSearchLine(lead)

  const templates: Record<LeadSegment, Omit<SegmentEmailTemplate, 'segment'>> = {
    ideal: {
      template: 'ideal',
      subject: 'Snelle vraag over jullie website',
      body: `${intro}

1 ding viel me op

Jullie website stuurt bezoekers niet echt duidelijk naar een volgende stap
waardoor mensen waarschijnlijk afhaken

Zal ik laten zien hoe dit beter ingericht kan worden?

– Graphic Vision`,
    },
    no_website: {
      template: 'no_website',
      subject: 'Snelle vraag',
      body: `${intro}

Viel me op dat jullie nog geen echte website hebben

Daardoor mis je waarschijnlijk klanten die via Google zoeken

Zal ik laten zien hoe je dit simpel kunt oplossen?

– Graphic Vision`,
    },
    low_reviews: {
      template: 'low_reviews',
      subject: 'Korte vraag',
      body: `${intro}

Wat me opviel is dat jullie nog weinig reviews hebben

Daardoor kan het lastig zijn om vertrouwen te winnen bij nieuwe klanten

Een sterke website kan dat deels opvangen

Zal ik laten zien wat ik bedoel?

– Graphic Vision`,
    },
    high_reviews: {
      template: 'high_reviews',
      subject: 'Snelle vraag over jullie site',
      body: `${intro}

Jullie hebben al behoorlijk wat reviews

Alleen de website zelf laat nog kansen liggen om meer aanvragen eruit te halen

Zal ik laten zien wat ik bedoel?

– Graphic Vision`,
    },
    high_rating: {
      template: 'high_rating',
      subject: 'Korte vraag',
      body: `${intro}

Ziet er goed uit wat jullie doen

Alleen op de website zelf zie ik nog kansen om meer uit bezoekers te halen

Zal ik dat even laten zien?

– Graphic Vision`,
    },
  }

  return { ...templates[segment], segment }
}

function parseScheduledJobs(value: string | null | undefined): ScheduledEmailJob[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []

    return parsed.flatMap((item: any) => {
      const emailNumber = normalizeEmailNumber(item?.emailNumber)
      const scheduled = typeof item?.scheduledFor === 'string' ? new Date(item.scheduledFor) : null
      if (!item?.leadId || !emailNumber || !scheduled || Number.isNaN(scheduled.getTime())) return []
      return [{
        leadId: String(item.leadId),
        emailNumber,
        scheduledFor: scheduled.toISOString(),
        createdAt: typeof item?.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
      }]
    })
  } catch {
    return []
  }
}

async function getScheduledEmailJobs(): Promise<ScheduledEmailJob[]> {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', SCHEDULED_EMAILS_SETTING_KEY)
    .maybeSingle()

  if (error) {
    log('Scheduler', `Kon geplande e-mails niet laden: ${error.message}`)
    return []
  }

  return parseScheduledJobs(data?.value).sort(
    (a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime()
  )
}

async function saveScheduledEmailJobs(jobs: ScheduledEmailJob[]) {
  const sorted = [...jobs].sort(
    (a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime()
  )
  await supabase.from('settings').upsert(
    [{ key: SCHEDULED_EMAILS_SETTING_KEY, value: JSON.stringify(sorted) }],
    { onConflict: 'key' }
  )
}

async function removeScheduledEmailJobsForLead(leadId: string): Promise<number> {
  const jobs = await getScheduledEmailJobs()
  const remaining = jobs.filter((job) => job.leadId !== leadId)
  const removed = jobs.length - remaining.length
  if (removed > 0) await saveScheduledEmailJobs(remaining)
  return removed
}

// ─── Phase 1: Apify ──────────────────────────────────────────────────────────
async function phase1(runId: string, niche: string, city: string, maxLeads: number) {
  log('Phase 1', `Scraping "${niche}" in "${city}" (max ${maxLeads})`)
  const token = process.env.APIFY_API_TOKEN!

  // Use intent-based search terms per niche; fall back to niche name alone
  const searchTerms = NICHE_SEARCH_TERMS[niche.toLowerCase()] ?? [niche]
  log('Phase 1', `Zoektermen: ${searchTerms.join(', ')}`)

  const startRes = await fetch(
    `https://api.apify.com/v2/acts/nwua9Gu5YrADL7ZDj/runs?token=${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        searchStringsArray: searchTerms,
        locationQuery: `${city}, Nederland`,
        maxCrawledPlaces: maxLeads,
        language: 'nl',
      }),
    }
  )
  if (!startRes.ok) throw new Error(`Apify start failed: ${await startRes.text()}`)
  const { data: { id: actorRunId } } = await startRes.json()
  log('Phase 1', `Apify run: ${actorRunId}`)

  let status = 'RUNNING'
  while (status === 'RUNNING') {
    await sleep(4000)
    const r = await fetch(`https://api.apify.com/v2/actor-runs/${actorRunId}?token=${token}`)
    status = (await r.json()).data.status
    log('Phase 1', `Status: ${status}`)
  }
  if (status !== 'SUCCEEDED') throw new Error(`Apify run failed: ${status}`)

  const resultsRes = await fetch(
    `https://api.apify.com/v2/actor-runs/${actorRunId}/dataset/items?token=${token}&limit=1000`
  )
  const businesses: any[] = await resultsRes.json()
  log('Phase 1', `${businesses.length} bedrijven ontvangen van Apify`)

  // ─── Hard skip: only junk we truly never want ────────────────────────────────
  let skippedClosed = 0, skippedJunk = 0

  const afterJunkFilter = businesses.filter((b: any) => {
    if (!b.title) { skippedJunk++; return false }
    if (b.permanentlyClosed === true || b.temporarilyClosed === true) { skippedClosed++; return false }
    return true
  })

  if (skippedClosed) log('Phase 1', `Overgeslagen: ${skippedClosed} gesloten bedrijven`)
  if (skippedJunk)   log('Phase 1', `Overgeslagen: ${skippedJunk} zonder naam (junk)`)

  // ─── Segment assignment ───────────────────────────────────────────────────────
  // Every lead gets a segment instead of being filtered out
  let segNoWebsite = 0, segLowReviews = 0, segIdeal = 0, segHighReviews = 0, segHighRating = 0

  function assignSegment(b: any): LeadSegment {
    if (!b.website || !isValidUrl(b.website)) { segNoWebsite++;  return 'no_website' }
    const rating: number | null = b.totalScore ?? null
    const reviews: number | null = b.reviewsCount ?? null
    if (rating !== null && rating > 4.6)   { segHighRating++;  return 'high_rating' }
    if (reviews !== null && reviews > 150) { segHighReviews++; return 'high_reviews' }
    if (reviews !== null && reviews < 10)  { segLowReviews++;  return 'low_reviews' }
    segIdeal++; return 'ideal'
  }

  // Assign segment upfront so we can use it during insert
  const withSegments = afterJunkFilter.map((b: any) => ({ ...b, _segment: assignSegment(b) }))

  log('Phase 1', `Segmenten: ${segIdeal} ideal · ${segNoWebsite} no_website · ${segLowReviews} low_reviews · ${segHighReviews} high_reviews · ${segHighRating} high_rating`)

  // ─── Batch-level dedup (same business from multiple search terms) ─────────────
  const seenInBatch = new Set<string>()
  const batchDeduped = withSegments.filter((b: any) => {
    const key = b.website && isValidUrl(b.website)
      ? normalizeUrl(b.website)
      : `${(b.title ?? '').toLowerCase().trim()}|${(b.city ?? city).toLowerCase().trim()}`
    if (seenInBatch.has(key)) return false
    seenInBatch.add(key)
    return true
  })
  const batchDupes = withSegments.length - batchDeduped.length
  if (batchDupes) log('Phase 1', `Batch dedup: ${batchDupes} duplicaten verwijderd`)

  // ─── DB dedup ─────────────────────────────────────────────────────────────────
  const websiteLeads   = batchDeduped.filter((b: any) => b.website && isValidUrl(b.website))
  const noWebsiteLeads = batchDeduped.filter((b: any) => !b.website || !isValidUrl(b.website))

  const urls = websiteLeads.map((b: any) => normalizeUrl(b.website))
  const { data: existingByUrl } = await supabase.from('leads').select('website_url').in('website_url', urls)
  const existingUrls = new Set((existingByUrl ?? []).map((e: any) => e.website_url))
  const dbDupWebsite = websiteLeads.filter((b: any) => existingUrls.has(normalizeUrl(b.website))).length
  if (dbDupWebsite) log('Phase 1', `DB dedup: ${dbDupWebsite} website-leads al bekend`)

  const newWebsiteLeads   = websiteLeads.filter((b: any) => !existingUrls.has(normalizeUrl(b.website)))
  // No-website leads: skip DB dedup (low volume, deduped within batch above)

  // ─── Build insert payload ─────────────────────────────────────────────────────
  const toInsert = [...newWebsiteLeads, ...noWebsiteLeads].map((b: any) => ({
    company_name:    b.title,
    website_url:     b.website && isValidUrl(b.website) ? normalizeUrl(b.website) : null,
    email:           b.email ?? null,
    city:            b.city ?? city,
    niche,
    google_rating:   b.totalScore ?? null,
    review_count:    b.reviewsCount ?? null,
    status:          'scraped' as const,
    pipeline_run_id: runId,
  }))

  if (!toInsert.length) { log('Phase 1', 'Geen nieuwe leads om in te voegen'); return 0 }
  const { data: inserted, error } = await supabase.from('leads').insert(toInsert).select('id')
  if (error) throw new Error(formatError(error))
  log('Phase 1', `${inserted?.length} leads ingevoegd — ${businesses.length} raw → ${skippedClosed + skippedJunk + batchDupes + dbDupWebsite} overgeslagen → ${inserted?.length} nieuw`)
  await supabase.from('pipeline_runs').update({ scraped_count: inserted?.length ?? 0 }).eq('id', runId)
  return inserted?.length ?? 0
}

// ─── Phase 2: Scrape lead signals (email, phone, social, CTA, links) ─────────
interface LeadSignals {
  email: string | null
  phone: string | null
  whatsapp_url: string | null
  facebook_url: string | null
  instagram_url: string | null
  has_cta: boolean
  internal_link_count: number
  text: string
}

async function scrapeLeadSignals(url: string): Promise<LeadSignals> {
  const empty: LeadSignals = { email: null, phone: null, whatsapp_url: null, facebook_url: null, instagram_url: null, has_cta: false, internal_link_count: 0, text: '' }
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)', 'Accept-Language': 'nl,en;q=0.9' },
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    })
    if (!res.ok) return empty
    const html = await res.text()

    // Email
    const mailto = html.match(/mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i)
    const emailsInPage = (html.match(/\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/g) ?? [])
      .filter(e => !e.includes('sentry') && !e.includes('example') && !e.includes('noreply') && !e.includes('@w3.org'))
    const email = mailto?.[1]?.toLowerCase() ?? emailsInPage[0]?.toLowerCase() ?? null

    // Phone — Dutch patterns
    const phoneMatch = html.match(/\b(?:0\d{9}|\+31[\s\-]?\d{9}|0\d{2}[\s\-]\d{7}|0\d{3}[\s\-]\d{6})\b/)
    const phone = phoneMatch ? phoneMatch[0].replace(/\s/g, '') : null

    // Social links from hrefs
    const hrefs = (html.match(/href="([^"]+)"/gi) ?? []).map(m => m.slice(6, -1))
    const whatsapp_url = hrefs.find(h => /wa\.me|whatsapp\.com\/send/i.test(h)) ?? null
    const facebook_url = hrefs.find(h => /facebook\.com\//i.test(h)) ?? null
    const instagram_url = hrefs.find(h => /instagram\.com\//i.test(h)) ?? null

    // Internal links count
    let domain = ''
    try { domain = new URL(url).hostname } catch { /* ignore */ }
    const internal_link_count = domain
      ? hrefs.filter(h => { try { return new URL(h).hostname === domain } catch { return h.startsWith('/') } }).length
      : 0

    // CTA signals — Dutch keywords
    const textLower = html.toLowerCase()
    const has_cta = /offerte|bel ons|contact|boek|afspraak|aanvragen|gratis|direct|nu bellen/.test(textLower)

    // Clean text for Claude
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4000)

    return { email, phone, whatsapp_url, facebook_url, instagram_url, has_cta, internal_link_count, text }
  } catch {
    return empty
  }
}

interface ScoreBreakdown {
  website_exists: boolean
  email_found: boolean
  phone_found: boolean
  mobile_friendly: boolean
  has_cta: boolean
  outdated_feel: boolean
  internal_link_count: number
}

function calculateLeadScore(
  breakdown: ScoreBreakdown,
  opts?: { googleRating?: number | null; reviewCount?: number | null }
): { score: number; hot_lead: boolean } {
  let score = 0
  if (breakdown.website_exists) score += 20
  if (breakdown.email_found)    score += 15
  if (breakdown.phone_found)    score += 10
  if (breakdown.outdated_feel)  score += 15  // opportunity
  if (!breakdown.mobile_friendly) score += 10 // opportunity
  if (!breakdown.has_cta)       score += 15  // opportunity
  if (breakdown.internal_link_count > 5) score += 15 // established site

  // Google rating signals
  const rating = opts?.googleRating
  const reviews = opts?.reviewCount
  if (rating !== undefined && rating !== null) {
    if (rating >= 3.0 && rating <= 4.2) score += 10  // sweet spot — room to improve
    if (rating > 4.6)                   score -= 15  // already highly rated, less opportunity
  }
  if (reviews !== undefined && reviews !== null) {
    if (reviews > 300) score -= 10  // over-established / over-optimized
  }

  return { score, hot_lead: score >= 65 }
}

async function phase2SingleLead(lead: any): Promise<boolean> {
  log('Phase 2', lead.company_name)

  const signals = await scrapeLeadSignals(lead.website_url)
  const email = lead.email ?? signals.email
  if (signals.email && !lead.email) {
    await supabase.from('leads').update({ email: signals.email }).eq('id', lead.id)
  }

  const fakeEmailReason = getFakeEmailReason(email)
  if (fakeEmailReason) {
    log('Phase 2', `${lead.company_name} — fake e-mail gedetecteerd: ${fakeEmailReason}`)
    await supabase.from('leads').update({
      email,
      status: 'error',
      qualify_reason: `Fake e-mail gedetecteerd: ${fakeEmailReason}`,
      updated_at: new Date().toISOString(),
    }).eq('id', lead.id)
    return false
  }

  const prompt = `Je bent een webdesign bureau dat beoordeelt of een bedrijf baat zou hebben bij een nieuwe website.
Je hebt GEEN internet toegang. De website tekst hieronder is al voor jou opgehaald. Bezoek de URL NIET.

BEDRIJF: ${lead.company_name} (${lead.niche}, ${lead.city})
GOOGLE RATING: ${lead.google_rating ?? 'onbekend'}/5 (${lead.review_count ?? 0} reviews)

OPGEHAALDE WEBSITE TEKST:
${signals.text || '(website niet bereikbaar — geen tekst beschikbaar)'}

KWALIFICATIEREGELS — wees STRENG, standaard is qualified=false:
Wij verkopen websiteverbeteringen. Stuur ALLEEN naar bedrijven die echt een verouderde, simpele of onduidelijke site hebben. Bedrijven met een al goede site hebben geen boodschap aan ons aanbod.

qualified=false (DISQUALIFY) als ÉÉN van de volgende geldt:
- De site oogt modern, clean en professioneel (strakke layout, witruimte, duidelijke typografie)
- Professionele fotografie of hoogwaardige visuals zichtbaar in de tekst/opbouw
- Duidelijke CTA's aanwezig boven de vouw (offerte knop, telefoonnummer prominent, chatwidget)
- Goede mobiele versie (hints: "responsive", viewport meta, flexibele layout-taal)
- Keurmerken, prijzen, certificaten of awards vermeld (bijv. "beste loodgieter", "award", "gecertificeerd", "erkend", keurmerk logo's)
- Meerdere pagina's met duidelijke structuur (diensten, over ons, projecten, blog, cases)
- Copyright jaar 2022 of later, of tekst die wijst op recent bouwen
- Grote, bekende of landelijk opererende spelers (franchises, ketens, platforms zoals zoofy.nl, werkspot.nl)
- Site lijkt gebouwd door een professioneel bureau (veel features, gelikte copy, duidelijke branding)

qualified=true (KWALIFICEER) ALLEEN als:
- De site oogt duidelijk verouderd, amateuristisch of rommelig
- Weinig of geen duidelijke CTA's — bezoeker weet niet wat te doen
- Slechte of ontbrekende mobiele versie
- Dunne content: nauwelijks tekst, weinig pagina's, geen structuur
- Geen tekst beschikbaar (website niet bereikbaar / 404): qualified=true — we weten het niet

Bij twijfel: qualified=true. Liever te veel leads dan een scrape verspillen.

- mobile_friendly: schat in of de tekst hints geeft op een moderne responsieve site
- has_cta: is er een duidelijke CTA aanwezig (offerte, bel, contact, boek, etc.)?
- outdated_feel: ziet de site er verouderd/amateuristisch uit?

VERPLICHT formaat — alleen dit JSON, niets anders:
{"qualified":true,"score":7,"reason":"één zin in het Nederlands","mobile_friendly":false,"has_cta":false,"outdated_feel":true}`

  const text = await callGemini({
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  })
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error(`Geen JSON in response: ${text.slice(0, 200)}`)
  const result = JSON.parse(jsonMatch[0])

  // Build score breakdown
  const breakdown: ScoreBreakdown = {
    website_exists: signals.text.length > 50,
    email_found: !!email,
    phone_found: !!signals.phone,
    mobile_friendly: result.mobile_friendly ?? true,
    has_cta: result.has_cta ?? signals.has_cta,
    outdated_feel: result.outdated_feel ?? false,
    internal_link_count: signals.internal_link_count,
  }
  const { score: leadScore, hot_lead } = calculateLeadScore(breakdown, {
    googleRating: lead.google_rating,
    reviewCount: lead.review_count,
  })

  await supabase.from('leads').update({
    status: result.qualified ? 'qualified' : 'disqualified',
    qualify_reason: `Score: ${result.score}/10 — ${result.reason}`,
    email,
    phone: signals.phone,
    whatsapp_url: signals.whatsapp_url,
    facebook_url: signals.facebook_url,
    instagram_url: signals.instagram_url,
    lead_score: leadScore,
    hot_lead,
    score_breakdown: breakdown,
    updated_at: new Date().toISOString(),
  }).eq('id', lead.id)

  log('Phase 2', `${result.qualified ? 'QUALIFIED' : 'DISQUALIFIED'} (${result.score}/10) lead_score=${leadScore}${hot_lead ? ' 🔥HOT' : ''}`)
  return result.qualified
}

async function phase2(runId: string, opts: { onlyRunId?: boolean } = {}) {
  log('Phase 2', 'Email scrapen + kwalificeren')
  let query = supabase.from('leads').select('*')
    .in('status', ['scraped', 'no_email', 'error']).not('website_url', 'is', null)
  if (opts.onlyRunId) query = query.eq('pipeline_run_id', runId)
  const { data: leads } = await query

  if (!leads?.length) { log('Phase 2', 'Geen leads'); return }
  log('Phase 2', `${leads.length} leads`)

  let qualified = 0
  for (const lead of leads) {
    try {
      const q = await phase2SingleLead(lead)
      if (q) qualified++
    } catch (e) {
      log('Phase 2', `Fout: ${e}`)
      await supabase.from('leads').update({ status: 'error', qualify_reason: String(e) }).eq('id', lead.id)
    }
    await sleep(500)
  }

  await supabase.from('pipeline_runs').update({ qualified_count: qualified }).eq('id', runId)
}

// ─── Phase 3: HTML redesign ───────────────────────────────────────────────────
async function fetchBrandColors(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return ''
    const html = await res.text()
    // Extract colors from <style> tags and inline styles
    const styleBlocks = (html.match(/<style[\s\S]*?<\/style>/gi) ?? []).join(' ')
    const inlineStyles = (html.match(/style="[^"]*"/gi) ?? []).join(' ')
    const combined = styleBlocks + ' ' + inlineStyles
    // Find all hex colors
    const hexColors = (combined.match(/#[0-9a-fA-F]{6}\b/g) ?? [])
    const counts: Record<string, number> = {}
    for (const c of hexColors) {
      const normalized = c.toLowerCase()
      counts[normalized] = (counts[normalized] ?? 0) + 1
    }
    // Filter out near-white and near-black, sort by frequency
    const meaningful = Object.entries(counts)
      .filter(([c]) => {
        const r = parseInt(c.slice(1, 3), 16)
        const g = parseInt(c.slice(3, 5), 16)
        const b = parseInt(c.slice(5, 7), 16)
        const brightness = (r + g + b) / 3
        return brightness > 25 && brightness < 230
      })
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([c]) => c)
    return meaningful.join(', ')
  } catch { return '' }
}

async function fetchWebsiteText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'nl,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return ''
    const html = await res.text()
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 5000)
  } catch { return '' }
}

async function phase3(runId: string) {
  log('Phase 3', 'HTML redesigns genereren')
  const { data: leads } = await supabase.from('leads').select('*').eq('status', 'qualified')
  if (!leads?.length) { log('Phase 3', 'Geen gekwalificeerde leads'); return }
  for (const lead of leads) await phase3SingleLead(lead)
}

const phase3System = () => `You are a senior web designer at a premium Dutch design agency. You build beautiful, complete, conversion-focused websites for local businesses.

${loadSkill('taste-skill.md')}

${loadSkill('redesign-skill.md')}`

async function phase3SingleLead(lead: any) {
    log('Phase 3', `Genereren: ${lead.company_name}`)
    try {
      const [websiteText, brandColors] = await Promise.all([
        fetchWebsiteText(lead.website_url),
        fetchBrandColors(lead.website_url),
      ])
      log('Phase 3', `Website content: ${websiteText.length} chars, brand colors: ${brandColors || 'none found'}`)

      const colorInstruction = brandColors
        ? `- Brand colors extracted from their existing site: ${brandColors}
- Use THESE colors as the primary palette — pick the most prominent one as the main accent, derive secondary/dark tones from the same family
- This is a redesign, not a rebrand — preserve their color identity`
        : `- Choose a strong, professional accent color appropriate for "${lead.niche}" in the Netherlands`

      const prompt = `Create a complete, professional long-form single-page website. Return ONLY valid HTML starting with <!DOCTYPE html>.

ORIGINAL WEBSITE CONTENT (extract phone, address, email, services, company info):
${websiteText || 'Not available'}

BUSINESS:
- Name: ${lead.company_name}
- Industry: ${lead.niche}
- City: ${lead.city}${lead.google_rating ? `\n- Google Rating: ${lead.google_rating}/5 (${lead.review_count ?? 0} reviews)` : ''}${lead.email ? `\n- Email: ${lead.email}` : ''}
- Website: ${lead.website_url}

DESIGN:
- White background (#FFFFFF), clean and modern
- Google Font: pick the most fitting font for the niche (Inter for trades/technical, Playfair Display for luxury/beauty/wellness, Poppins for creative/young, Raleway for fashion/style)
${colorInstruction}
- Real Unsplash photos — format: https://images.unsplash.com/photo-{ID}?auto=format&fit=crop&w=1200&q=80
  Choose 6–8 DIFFERENT photo IDs that are genuinely relevant to "${lead.niche}" — show the actual work, environment, or results
  Do NOT reuse the same ID more than once. Do NOT use generic office/business stock photos unless the niche calls for it.
- All CSS in <style> tag only
- No external dependencies except Google Fonts + Unsplash

LAYOUT PRINCIPLE — design sections that make sense for "${lead.niche}":
- Emergency trades (loodgieter, elektricien, slotenmaker, cv-installateur, dakdekker): Lead with an urgency banner + strong "Bel ons nu" hero. Include: services, how-it-works steps, trust stats (response time, years active, rating), reviews, FAQ, contact
- Beauty & wellness (kapper, barber, schoonheidsspecialist, make-up artist, salon, nagels): No urgency banner. Elegant full-width hero with atmosphere photo. Include: treatments/diensten, portfolio gallery (large image grid), about/team, reviews, online booking CTA, contact
- Restaurant & food: Hero with beautiful food/ambiance photo. Include: menu highlights, about the chef/story, gallery, reviews, reservations form, contact
- Retail & shop: Product hero. Include: featured products/categories, USPs, about the store, reviews, contact
- Professional services (accountant, advocaat, notaris, makelaar): Clean professional hero. Include: services, about/team with photos, results/cases, reviews, contact
- Fitness & sport (sportschool, personal trainer, yoga): Action hero. Include: programs/classes, schedule or timetable, trainer bio, results/testimonials, pricing, contact
- Adapt freely — the layout should feel native to the industry. A barbershop should feel like a barbershop website, not a plumber site with different colors.

ALWAYS INCLUDE:
- Sticky header (logo left, nav, CTA button right)
- Hero section (adapt style to niche)
- Reviews section (3 cards, realistic Dutch reviews, ${lead.google_rating ?? '4.8'} ⭐)
- Contact section (address, phone, email + form)
- Footer (logo, short tagline, address, phone, © 2025 ${lead.company_name})
- Floating WhatsApp button bottom-left (green, wa.me/31...)
- Fixed "Concept door Graphic Vision" badge bottom-right (small pill, accent color)

RULES:
- All copy in Dutch
- Use REAL phone number from original content — if not found use placeholder "020-XXXXXXX"
- Use REAL address/city from original content
- NO lorem ipsum
- Google rating ${lead.google_rating ?? 'N/A'} ⭐ prominently displayed
- Keep CSS efficient — reuse classes
- Complete the ENTIRE page — every section, closing </body></html>

OUTPUT QUALITY:
- Every section: full, detailed copy — no placeholders, no shortened versions
- Services/treatments: 2–3 real sentences per card
- FAQ (if included): complete question + full answer paragraph
- About: proper 3–4 sentence story
- Reviews: realistic, detailed Dutch reviews (3–4 sentences), not just "Goede service!"
- Total HTML: 700+ lines`

      const htmlModel = process.env.HTML_MODEL ?? 'claude-sonnet-4-6'
      const fallbackModel = 'claude-opus-4-6'

      let response = await callKieStreaming({
        model: htmlModel, max_tokens: 32000, system: phase3System(),
        messages: [{ role: 'user', content: prompt }],
      })

      let text = response.content[0].type === 'text' ? response.content[0].text : ''
      const wasTruncated = response.stop_reason !== 'end_turn' || !text.includes('</html>')
      log('Phase 3', `Model: ${htmlModel} | Stop reason: ${response.stop_reason} | tokens: ${response.usage?.output_tokens}${wasTruncated ? ' ⚠ TRUNCATED' : ''}`)

      // If Sonnet truncated, retry with Opus automatically
      if (wasTruncated && htmlModel !== fallbackModel) {
        log('Phase 3', `Output afgekapt — retry met ${fallbackModel}`)
        response = await callKieStreaming({
          model: fallbackModel, max_tokens: 32000, system: phase3System(),
          messages: [{ role: 'user', content: prompt }],
        })
        text = response.content[0].type === 'text' ? response.content[0].text : ''
        log('Phase 3', `Fallback ${fallbackModel} | Stop reason: ${response.stop_reason} | tokens: ${response.usage?.output_tokens}`)
      }

      const html = text.substring(text.indexOf('<!DOCTYPE html>'))
      if (!html.startsWith('<!DOCTYPE')) throw new Error('Geen geldige HTML ontvangen')

      const fn = `${lead.id}-preview.html`
      await supabase.storage.from('previews').upload(fn, Buffer.from(html, 'utf-8'), { contentType: 'text/html', upsert: true })
      await supabase.from('leads').update({ status: 'redesigned', updated_at: new Date().toISOString() }).eq('id', lead.id)
      log('Phase 3', `Klaar (${Math.round(html.length / 1024)}KB)`)
    } catch (e) {
      log('Phase 3', `Fout: ${e}`)
      await supabase.from('leads').update({ status: 'error', qualify_reason: `Redesign: ${e}` }).eq('id', lead.id)
    }
}

// ─── Phase 4: Vercel deploy ───────────────────────────────────────────────────
async function deployToVercel(name: string, html: string): Promise<string> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await deployToVercelOnce(name, html)
    } catch (e) {
      if (attempt === 3) throw e
      log('Retry', `Vercel deploy attempt ${attempt} mislukt: ${e} — wacht 15s`)
      await sleep(15_000)
    }
  }
  throw new Error('deployToVercel: alle pogingen mislukt')
}

async function deployToVercelOnce(name: string, html: string): Promise<string> {
  const token = process.env.VERCEL_API_TOKEN!
  const teamId = process.env.VERCEL_TEAM_ID
  const slug = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 40)
  const teamParam = teamId ? `?teamId=${teamId}` : ''

  const res = await fetch(`https://api.vercel.com/v13/deployments${teamParam}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `preview-${slug}-${Date.now().toString(36)}`, files: [{ file: 'index.html', data: html, encoding: 'utf-8' }], projectSettings: { framework: null }, target: 'production' }),
  })
  if (!res.ok) throw new Error(`Vercel deploy mislukt: ${await res.text()}`)
  const { id, projectId } = await res.json()

  // Disable protection on the project so the preview URL is publicly accessible
  if (projectId) {
    await fetch(`https://api.vercel.com/v9/projects/${projectId}${teamParam}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ssoProtection: null, passwordProtection: null }),
    }).catch(() => {})
  }

  for (let i = 0; i < 20; i++) {
    await sleep(3000)
    const check = await fetch(`https://api.vercel.com/v13/deployments/${id}${teamParam}`, { headers: { Authorization: `Bearer ${token}` } })
    const d = await check.json()
    if (d.readyState === 'READY') return `https://${d.url}`
    if (d.readyState === 'ERROR') throw new Error('Vercel deployment error')
  }
  throw new Error('Vercel deploy timeout')
}

async function phase4SingleLead(lead: any, browser: any): Promise<void> {
  log('Phase 4', `Deploy: ${lead.company_name}`)
  const { data: blob } = await supabase.storage.from('previews').download(`${lead.id}-preview.html`)
  if (!blob) throw new Error('HTML niet gevonden in storage')
  const html = await blob.text()

  const previewUrl = await deployToVercel(lead.company_name!, html)
  log('Phase 4', `Live: ${previewUrl}`)

  let previewScreenshotUrl = null
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900 })
    await page.goto(previewUrl, { waitUntil: 'networkidle2', timeout: 20000 })
    await sleep(1500)
    const shot = await page.screenshot({ type: 'jpeg', quality: 85 })
    await page.close()
    const buf = Buffer.from(shot)
    const fn = `${lead.id}-preview-screenshot.jpg`
    await supabase.storage.from('previews').upload(fn, buf, { contentType: 'image/jpeg', upsert: true })
    previewScreenshotUrl = supabase.storage.from('previews').getPublicUrl(fn).data.publicUrl
  } catch (e) { log('Phase 4', `Preview screenshot mislukt: ${e}`) }

  await supabase.from('leads').update({
    status: 'deployed', preview_url: previewUrl,
    preview_screenshot_url: previewScreenshotUrl,
    updated_at: new Date().toISOString(),
  }).eq('id', lead.id)
}

async function phase4(runId: string) {
  log('Phase 4', 'Deployen naar Vercel')
  const { data: leads } = await supabase.from('leads').select('*').eq('status', 'redesigned')
  if (!leads?.length) { log('Phase 4', 'Geen leads'); return }

  let deployed = 0
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })

  try {
    for (const lead of leads) {
      try {
        await phase4SingleLead(lead, browser)
        deployed++
      } catch (e) {
        log('Phase 4', `Mislukt: ${e}`)
        await supabase.from('leads').update({ status: 'error', qualify_reason: `Deploy: ${e}` }).eq('id', lead.id)
      }
    }
  } finally { await browser.close() }

  await supabase.from('pipeline_runs').update({ deployed_count: deployed, completed_at: new Date().toISOString(), status: 'completed' }).eq('id', runId)
}

// ─── Pipeline helpers (used by auto /run) ────────────────────────────────────

type PainpointMarker = {
  targetX: number
  targetY: number
  startX: number
  startY: number
  label: string
  reason: string
}

async function detectVisiblePainpoint(page: any): Promise<PainpointMarker | null> {
  return await page.evaluate(() => {
    const viewportWidth = window.innerWidth || 1365
    const viewportHeight = window.innerHeight || 768
    const topFold = viewportHeight * 0.82
    const visible = (el: Element) => {
      const style = window.getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || '1') > 0.05 &&
        rect.width >= 80 &&
        rect.height >= 28 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < topFold &&
        rect.left < viewportWidth
    }
    const normalize = (rect: DOMRect, label: string, reason: string) => {
      const targetX = Math.max(0.08, Math.min(0.92, (rect.left + rect.width / 2) / viewportWidth))
      const targetY = Math.max(0.10, Math.min(0.84, (rect.top + rect.height / 2) / viewportHeight))
      const startX = targetX > 0.55 ? 0.20 : 0.72
      const startY = Math.max(0.08, targetY - 0.18)
      return { targetX, targetY, startX, startY, label, reason }
    }

    const elements = Array.from(document.querySelectorAll('body *')).filter(visible)
    const cookieWords = /(cookie|cookies|privacy|accepteer|accepteren|accept|toestaan|akkoord|consent)/i
    const cookieCandidates = elements
      .map((el) => ({ el, text: (el.textContent || '').replace(/\s+/g, ' ').trim(), rect: el.getBoundingClientRect() }))
      .filter(({ text, rect }) =>
        cookieWords.test(text) &&
        text.length >= 12 &&
        text.length <= 900 &&
        rect.width >= 220 &&
        rect.height >= 55 &&
        rect.width * rect.height <= viewportWidth * viewportHeight * 0.45
      )
      .sort((a, b) => (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height))
    if (cookieCandidates[0]) {
      return normalize(cookieCandidates[0].rect, 'Cookie popup blokkeert de eerste indruk', 'cookie')
    }

    const ctaWords = /(contact|bel|offerte|afspraak|boek|reserveer|bestel|winkel|aanvragen|quote|gratis|plan|maak direct)/i
    const ctaCandidates = elements
      .map((el) => ({ el, text: (el.textContent || '').replace(/\s+/g, ' ').trim(), rect: el.getBoundingClientRect(), tag: el.tagName.toLowerCase() }))
      .filter(({ text, rect, tag }) => ctaWords.test(text) && text.length <= 80 && rect.width >= 70 && rect.height >= 24 && (tag === 'a' || tag === 'button' || rect.height <= 90))
      .sort((a, b) => a.rect.top - b.rect.top)

    const lowCta = ctaCandidates.find(({ rect }) => rect.top > viewportHeight * 0.48)
    if (lowCta) {
      return normalize(lowCta.rect, 'Belangrijkste actie valt te laag weg', 'low_cta')
    }

    const topCta = ctaCandidates[0]
    if (topCta && topCta.rect.width < 140 && topCta.rect.height < 44) {
      return normalize(topCta.rect, 'CTA valt nauwelijks op', 'weak_cta')
    }

    return null
  })
}

async function captureWebsitePainpoint(browser: any, url: string | null | undefined): Promise<{ buffer: Buffer; marker: PainpointMarker } | null> {
  if (!url) return null
  const page = await browser.newPage()
  try {
    await page.setViewport({ width: 1365, height: 768, deviceScaleFactor: 1 })
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 25_000 })
    await new Promise(resolve => setTimeout(resolve, 1500))
    const marker = await detectVisiblePainpoint(page)
    if (!marker) return null
    const shot = await page.screenshot({ type: 'jpeg', quality: 76, fullPage: false })
    return { buffer: Buffer.from(shot), marker }
  } catch (e) {
    log('Painpoint', `Live painpoint detectie mislukt voor ${url}: ${e}`)
    return null
  } finally {
    await page.close().catch(() => {})
  }
}

async function annotatePainpointScreenshot(browser: any, imageBuffer: Buffer, marker: PainpointMarker): Promise<Buffer> {
  const page = await browser.newPage()
  const imageDataUrl = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`
  const width = 900
  const height = 506
  const tx = Math.round(marker.targetX * width)
  const ty = Math.round(marker.targetY * height)
  const sx = Math.round(marker.startX * width)
  const sy = Math.round(marker.startY * height)
  const labelX = Math.max(18, Math.min(width - 290, sx - 20))
  const labelY = Math.max(18, sy - 52)

  try {
    await page.setViewport({ width, height, deviceScaleFactor: 1 })
    await page.setContent(`<!doctype html>
<html><head><style>
html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:#111;font-family:Arial,sans-serif}
.wrap{position:relative;width:${width}px;height:${height}px;overflow:hidden;background:#111}
img{width:100%;height:100%;object-fit:cover;object-position:top center;display:block}
svg{position:absolute;inset:0;width:100%;height:100%;filter:drop-shadow(0 4px 10px rgba(0,0,0,.45))}
.label{position:absolute;left:${labelX}px;top:${labelY}px;background:#ff3b30;color:#fff;border-radius:8px;padding:10px 13px;font-size:20px;font-weight:700;box-shadow:0 4px 14px rgba(0,0,0,.35)}
</style></head><body>
<div class="wrap">
  <img src="${imageDataUrl}" />
  <div class="label">${marker.label}</div>
  <svg viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs><marker id="arrow" markerUnits="userSpaceOnUse" markerWidth="34" markerHeight="34" refX="30" refY="17" orient="auto"><path d="M2,2 L32,17 L2,32 Z" fill="#ff3b30"/></marker></defs>
    <line x1="${sx}" y1="${sy}" x2="${tx}" y2="${ty}" stroke="#ff3b30" stroke-width="6" stroke-linecap="round" marker-end="url(#arrow)"/>
    <circle cx="${tx}" cy="${ty}" r="30" stroke="#ff3b30" stroke-width="6"/>
  </svg>
</div>
</body></html>`, { waitUntil: 'load' })
    const shot = await page.screenshot({ type: 'jpeg', quality: 82 })
    return Buffer.from(shot)
  } finally {
    await page.close().catch(() => {})
  }
}

async function ensurePainpointScreenshotForLead(lead: any): Promise<string | null> {
  if (lead.painpoint_screenshot_url) return lead.painpoint_screenshot_url

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
  try {
    const livePainpoint = await captureWebsitePainpoint(browser, lead.website_url)

    if (!livePainpoint) {
      log('Painpoint', `Geen betrouwbaar zichtbaar painpoint voor ${lead.company_name}`)
      return null
    }

    const annotated = await annotatePainpointScreenshot(browser, livePainpoint.buffer, livePainpoint.marker)
    const filename = `${lead.id}-painpoint-auto-${Date.now()}.jpg`
    const { error } = await supabase.storage
      .from('screenshots')
      .upload(filename, annotated, { contentType: 'image/jpeg', upsert: true })

    if (error) throw new Error(error.message)

    const url = supabase.storage.from('screenshots').getPublicUrl(filename).data.publicUrl
    await supabase.from('leads').update({
      painpoint_screenshot_url: url,
      updated_at: new Date().toISOString(),
    }).eq('id', lead.id)
    log('Painpoint', `Automatische screenshot gemaakt voor ${lead.company_name} (${livePainpoint.marker.reason})`)
    return url
  } catch (e) {
    log('Painpoint', `Automatische screenshot mislukt voor ${lead.company_name}: ${e}`)
    return null
  } finally {
    await browser.close().catch(() => {})
  }
}

// Reusable: generate the 4-email sequence for a lead (same logic as the route)
async function generateEmailSequenceForLead(lead: any) {
  const emailPrefix = (lead.email ?? '').split('@')[0].toLowerCase()
  const genericPrefixes = ['info', 'contact', 'hello', 'hallo', 'mail', 'post', 'office', 'admin', 'support', 'service', 'team', 'sales', 'marketing', 'hoi', 'algemeen', 'receptie', 'secretariaat', 'welkom', 'webmaster']
  const isGeneric = !lead.email || genericPrefixes.some((p: string) => emailPrefix === p || emailPrefix.startsWith(p + '.'))
  const firstName = isGeneric ? null : (() => {
    const namePart = emailPrefix.split(/[._-]/)[0]
    return (namePart && namePart.length > 1 && /^[a-z]/i.test(namePart))
      ? namePart.charAt(0).toUpperCase() + namePart.slice(1).toLowerCase()
      : null
  })()
  const greeting = firstName ? `Hey ${firstName},` : 'Hey,'
  const email1 = generateEmail1ForSegment(lead)
  log('Mail', `Lead ${lead.id} — Email 1 generated using segment: ${email1.segment} — template: ${email1.template}`)

  const prompt = `Je schrijft alleen de opvolgmails voor een koude outreach reeks namens Graphic Vision.

Bedrijf: ${lead.company_name}
Niche: ${lead.niche}
Stad: ${lead.city ?? 'onbekend'}

OPMAAK (verplicht voor alle mails): gebruik lege regels tussen alinea's. Plain text stijl.

MAIL 1 — AL GEGENEREERD
Gebruik exact deze subject en body:
subject="${email1.subject}"
body=${JSON.stringify(email1.body)}

MAIL 2 — REACTIE MAIL (placeholder, wordt gegenereerd na reactie)
Schrijf alleen: subject="Reactie", body="[Wordt gegenereerd na reactie van de lead]"

MAIL 3 — HERINNERING 1 (dag 3)
- Begin met "${greeting}"
- Super kort — max 2-3 zinnen
- Verwijs terug naar mail 1, vraag of ze het gemist hebben
- GEEN links, GEEN preview URL
- Afsluiting EXACT: "– Graphic Vision"

MAIL 4 — HERINNERING 2 (dag 6)
- Begin met "${greeting}"
- Sluit het dossier af — "Ik sluit het bestand van jullie" — kort en vriendelijk
- GEEN links, GEEN preview URL
- Afsluiting EXACT: "– Graphic Vision"

Geef ALLEEN dit JSON terug, niets anders:
{
  "email1": {"subject": ${JSON.stringify(email1.subject)}, "body": ${JSON.stringify(email1.body)}},
  "email2": {"subject": "Reactie", "body": "[Wordt gegenereerd na reactie van de lead]"},
  "email3": {"subject": "...", "body": "..."},
  "email4": {"subject": "...", "body": "..."}
}`

  const seqText = await callGemini({ max_tokens: 2000, messages: [{ role: 'user', content: prompt }] })
  const jsonMatch = seqText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Geen JSON in sequence response')
  const emails = JSON.parse(jsonMatch[0])
  emails.email1 = { subject: email1.subject, body: email1.body }

  // Randomly assign variant type 50/50 if not already set.
  // Screenshot variant is only used when we can point at a concrete visible issue.
  let variantType: string = lead.email1_variant_type ?? (Math.random() < 0.5 ? 'text_only' : 'painpoint_screenshot')
  const painpointScreenshotUrl = variantType === 'painpoint_screenshot'
    ? await ensurePainpointScreenshotForLead(lead)
    : lead.painpoint_screenshot_url
  if (variantType === 'painpoint_screenshot' && !painpointScreenshotUrl) {
    variantType = 'text_only'
  }

  const updatePayload: Record<string, any> = {
    email1_subject: emails.email1.subject, email1_body: emails.email1.body,
    email2_subject: emails.email2.subject, email2_body: emails.email2.body,
    email3_subject: emails.email3.subject, email3_body: emails.email3.body,
    email4_subject: emails.email4.subject, email4_body: emails.email4.body,
    email_subject: emails.email1.subject,  email_body: emails.email1.body,
    email1_variant_type: variantType,
    updated_at: new Date().toISOString(),
  }
  if (painpointScreenshotUrl) updatePayload.painpoint_screenshot_url = painpointScreenshotUrl

  await supabase.from('leads').update(updatePayload).eq('id', lead.id)

  return emails
}

// Reusable: send a specific email number (1–4) for a lead
// Pick next sending account from settings rotation, advance the index
async function getNextSendAccount(settings: Record<string, string>): Promise<{ email: string; name: string; pass: string }> {
  // Parse accounts list from settings, fallback to env SMTP
  let accounts: { email: string; name?: string; pass?: string }[] = []
  try { accounts = JSON.parse(settings.smtp_accounts ?? '[]') } catch {}

  if (!accounts.length) {
    // Fallback to single env-based account
    const email = process.env.SMTP_USER!
    const name = email.split('@')[0].charAt(0).toUpperCase() + email.split('@')[0].slice(1)
    return { email, name, pass: process.env.SMTP_PASS! }
  }

  const idx = parseInt(settings.smtp_account_index ?? '0') % accounts.length
  const account = accounts[idx]
  const nextIdx = (idx + 1) % accounts.length

  // Advance rotation index
  await supabase.from('settings').upsert(
    [{ key: 'smtp_account_index', value: String(nextIdx) }],
    { onConflict: 'key' }
  )

  const name = account.name ?? (account.email.split('@')[0].charAt(0).toUpperCase() + account.email.split('@')[0].slice(1))
  const pass = account.pass ?? process.env.SMTP_PASS!
  return { email: account.email, name, pass }
}

async function sendRunNotification(stats: { niche: string; city: string; scraped: number; qualified: number; emailed: number; mode: string; failed: boolean; error?: string }) {
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST!,
    port: parseInt(process.env.SMTP_PORT ?? '465'),
    secure: process.env.SMTP_PORT !== '587',
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
  })

  const status = stats.failed ? '❌ Mislukt' : '✅ Voltooid'
  const subject = `${status} — Pipeline run: ${stats.niche} in ${stats.city}`

  const body = stats.failed
    ? `De dagelijkse pipeline run is mislukt.\n\nNiche: ${stats.niche}\nStad: ${stats.city}\nFout: ${stats.error ?? 'Onbekend'}\n\nBekijk de logs: https://leadgen.graphicvision.nl`
    : `De dagelijkse pipeline run is voltooid.\n\nNiche: ${stats.niche}\nStad: ${stats.city}\nModus: ${stats.mode === 'send' ? 'Auto + Verstuur' : 'Auto + Concept'}\n\nResultaten:\n• Gescraped: ${stats.scraped}\n• Gekwalificeerd: ${stats.qualified}\n• E-mails ${stats.mode === 'send' ? 'verstuurd' : 'als concept klaar'}: ${stats.emailed}\n\nBekijk de leads: https://leadgen.graphicvision.nl`

  await transport.sendMail({
    from: `Graphic Vision Pipeline <${process.env.SMTP_USER}>`,
    to: 'graphicvisionnl@gmail.com',
    subject,
    text: body,
  }).catch(e => log('Notify', `Email notificatie mislukt: ${e}`))
}

// Convert plain-text email body to HTML — replaces the URL line with a CTA button
// but keeps all surrounding text intact
function bodyToHtml(body: string, previewUrl: string | null): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const ctaButton = previewUrl
    ? `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:8px 0 24px"><tr><td><a href="${previewUrl}" target="_blank" style="display:inline-block;background:#FF794F;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 32px;border-radius:8px">Bekijk jouw nieuwe website →</a></td></tr></table>`
    : ''
  const pStyle = 'margin:0 0 16px;font-size:15px;line-height:1.7;color:#1a1a1a'

  return body.split(/\n\n+/).filter(p => p.trim()).map(para => {
    const lines = para.split('\n')
    const urlIdx = previewUrl ? lines.findIndex(l => l.includes(previewUrl)) : -1

    if (urlIdx === -1) {
      return `<p style="${pStyle}">${lines.map(escape).join('<br>')}</p>`
    }

    // Split around the URL line so surrounding text is preserved
    const parts: string[] = []
    const before = lines.slice(0, urlIdx).filter(l => l.trim())
    const after  = lines.slice(urlIdx + 1).filter(l => l.trim())
    if (before.length) parts.push(`<p style="${pStyle}">${before.map(escape).join('<br>')}</p>`)
    parts.push(ctaButton)
    if (after.length)  parts.push(`<p style="${pStyle}">${after.map(escape).join('<br>')}</p>`)
    return parts.join('')
  }).join('')
}

function buildEmailHtml(bodyHtml: string): string {
  return `<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
<tr><td style="background:#0f0f0f;padding:28px 40px"><img src="https://graphicvision.nl/wp-content/uploads/2026/03/graphic-vision-logo-orange.png" alt="Graphic Vision" width="160" style="display:block;height:auto"></td></tr>
<tr><td style="padding:40px 40px 32px">${bodyHtml}</td></tr>
<tr><td style="padding:24px 40px 32px;background:#fafafa;border-top:1px solid #e8e8e8"><p style="margin:0;font-size:13px;color:#888">Graphic Vision<br><a href="https://graphicvision.nl" style="color:#FF794F">graphicvision.nl</a></p></td></tr>
</table></td></tr></table></body></html>`
}

async function sendEmailForLead(lead: any, emailNumber: EmailNumber) {
  const subjectKey = `email${emailNumber}_subject` as const
  const bodyKey = `email${emailNumber}_body` as const
  let body: string = lead[bodyKey] ?? lead.email_body ?? ''
  if (!body || !lead.email) throw new Error('Ontbrekende email data')
  const recipientEmail = normalizeRecipientEmail(lead.email)
  const fakeEmailReason = getFakeEmailReason(recipientEmail)
  if (fakeEmailReason) {
    await supabase.from('leads').update({
      status: 'error',
      qualify_reason: `E-mail verzenden geblokkeerd: ${fakeEmailReason}`,
      next_followup_at: null,
      sequence_stopped: true,
      updated_at: new Date().toISOString(),
    }).eq('id', lead.id)
    throw new Error(`E-mail verzenden geblokkeerd voor ${lead.company_name}: ${fakeEmailReason} (${lead.email})`)
  }
  if (recipientEmail !== lead.email) {
    await supabase.from('leads').update({
      email: recipientEmail,
      updated_at: new Date().toISOString(),
    }).eq('id', lead.id)
  }

  // Email 2: always send as threaded reply on existing conversation
  const isThreadedReply = emailNumber === 2 && lead.reply_message_id
  const subject: string = isThreadedReply
    ? `Re: ${lead.email1_subject ?? lead.email_subject ?? ''}`
    : (lead[subjectKey] ?? lead.email_subject ?? '')

  if (!subject) throw new Error('Ontbrekend onderwerp')

  const { data: settingsRows } = await supabase.from('settings').select('*')
  const settings = Object.fromEntries(
    (settingsRows ?? []).map((s: { key: string; value: string }) => [s.key, s.value])
  )

  // Email 2: reply from the same account that received the client's reply
  // All others: use rotating account
  let account: { email: string; name: string; pass: string }
  if (isThreadedReply && lead.reply_received_by) {
    let accounts: { email: string; pass: string }[] = []
    try { accounts = JSON.parse(settings.smtp_accounts ?? '[]') } catch {}
    const mainUser = process.env.SMTP_USER!
    if (mainUser && !accounts.find((a: any) => a.email === mainUser)) {
      accounts.push({ email: mainUser, pass: process.env.SMTP_PASS! })
    }
    const found = accounts.find((a: any) => a.email.toLowerCase() === lead.reply_received_by.toLowerCase())
    if (found) {
      const prefix = found.email.split('@')[0]
      const name = prefix.charAt(0).toUpperCase() + prefix.slice(1)
      account = { email: found.email, name, pass: found.pass ?? process.env.SMTP_PASS! }
    } else {
      account = await getNextSendAccount(settings)
    }
  } else {
    account = await getNextSendAccount(settings)
  }

  // Strip any existing signature from body and append clean one
  body = body
    .replace(/\n+–[\s\S]*$/, '')             // strips – Name (and anything after, e.g. Graphic Vision)
    .replace(/\n+Met vriendelijke groet[\s\S]*$/i, '')
    .trimEnd()

  // Emails 1/3/4 use short plain-text signature; email 2 (reply) uses formal sign-off
  const signature = emailNumber === 2
    ? `\n\nMet vriendelijke groet,\nGraphic Vision\ngraphicvision.nl`
    : `\n\n– Graphic Vision`

  body = body + signature

  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST!,
    port: parseInt(process.env.SMTP_PORT ?? '465'),
    secure: process.env.SMTP_PORT !== '587',
    auth: { user: account.email, pass: account.pass },
  })

  // Email 1 = plain text, optional screenshot attachment
  // Email 2 (reply) = branded HTML template
  // Emails 3+4 = plain text only (human/low-pressure reminders)
  let mailOptions: any
  if (emailNumber === 1) {
    const isScreenshotVariant = lead.email1_variant_type === 'painpoint_screenshot' && lead.painpoint_screenshot_url
    let attachments: any[] = []
    log('Mail', `Email 1 variant voor ${lead.company_name}: ${lead.email1_variant_type ?? 'text_only'}`)
    if (isScreenshotVariant) {
      try {
        const imgResponse = await fetch(lead.painpoint_screenshot_url)
        if (imgResponse.ok) {
          const imgBuffer = Buffer.from(await imgResponse.arrayBuffer())
          if (imgBuffer.length <= 300 * 1024) {
            const contentType = imgResponse.headers.get('content-type')?.includes('png') ? 'image/png' : 'image/jpeg'
            const filename = contentType === 'image/png' ? 'site-check.png' : 'site-check.jpg'
            attachments = [{ filename, content: imgBuffer, contentType }]
            log('Mail', `Screenshot bijgevoegd als ${filename} (${Math.round(imgBuffer.length / 1024)}KB) voor ${lead.company_name}`)
          } else {
            log('Mail', `Screenshot te groot (${Math.round(imgBuffer.length / 1024)}KB) voor ${lead.company_name} — stuur zonder bijlage`)
          }
        } else {
          log('Mail', `Screenshot URL niet bereikbaar (${imgResponse.status}) voor ${lead.company_name} — stuur zonder bijlage`)
        }
      } catch (e) {
        log('Mail', `Screenshot ophalen mislukt voor ${lead.company_name}: ${e} — stuur zonder bijlage`)
      }
    } else if (lead.email1_variant_type === 'painpoint_screenshot') {
      log('Mail', `Geen screenshot URL voor ${lead.company_name} — stuur zonder bijlage`)
    }
    mailOptions = {
      from: `${account.name} <${account.email}>`,
      to: recipientEmail,
      bcc: 'graphicvisionnl@gmail.com',
      subject,
      text: body,
      ...(attachments.length ? { attachments } : {}),
    }
  } else if (emailNumber === 2 && isThreadedReply) {
    // Send as threaded reply — same account, Re: subject, In-Reply-To header
    mailOptions = {
      from: `${account.name} <${account.email}>`,
      to: recipientEmail,
      bcc: 'graphicvisionnl@gmail.com',
      subject,
      html: buildEmailHtml(bodyToHtml(body, lead.preview_url ?? null)),
      text: body,
      headers: {
        'In-Reply-To': lead.reply_message_id,
        'References': lead.reply_message_id,
      },
    }
  } else if (emailNumber === 3 || emailNumber === 4) {
    // Plain text reminders — no HTML, no logo, human tone
    mailOptions = {
      from: `${account.name} <${account.email}>`,
      to: recipientEmail,
      bcc: 'graphicvisionnl@gmail.com',
      subject,
      text: body,
    }
  } else {
    mailOptions = {
      from: `${account.name} — Graphic Vision <${account.email}>`,
      to: recipientEmail,
      bcc: 'graphicvisionnl@gmail.com',
      subject,
      html: buildEmailHtml(bodyToHtml(body, lead.preview_url ?? null)),
      text: body,
    }
  }

  await transport.sendMail(mailOptions)

  const sentAtField = `email${emailNumber}_sent_at`
  // Email 1 sent → send reminder 1 (email 3) in 48h
  // Email 3 sent → send reminder 2 (email 4) in 5 more days (= day 7 from email 1)
  // Email 4 sent → sequence done
  const followupMs: Record<number, number> = {
    1: 48 * 60 * 60 * 1000,
    3: 5 * 24 * 60 * 60 * 1000,
  }
  const next_followup_at = followupMs[emailNumber]
    ? new Date(Date.now() + followupMs[emailNumber]).toISOString()
    : null

  const sentAt = new Date().toISOString()

  await supabase.from('leads').update({
    status: 'sent',
    crm_status: 'contacted',
    email_sequence_index: emailNumber,
    [sentAtField]: sentAt,
    next_followup_at,
    sequence_stopped: emailNumber === 4 ? true : false,
    updated_at: new Date().toISOString(),
  }).eq('id', lead.id)

  log('Mail', `Email ${emailNumber} verstuurd naar ${recipientEmail} (${lead.company_name})${next_followup_at ? ` — volgende: ${new Date(next_followup_at).toLocaleString('nl-NL')}` : ' — sequentie afgerond'}`)
  return { next_followup_at, sent_at: sentAt }
}

// ─── Reply classification ─────────────────────────────────────────────────────
type ReplyClass = 'interested' | 'question' | 'price_check' | 'busy_later' | 'not_interested' | 'out_of_office' | 'other'

async function classifyReply(replyText: string, lead: any): Promise<{ classification: ReplyClass; summary: string }> {
  const prompt = `Je bent een assistent voor een webdesign bureau. Classificeer deze e-mailreactie van een prospect.

Onze originele e-mail ging over: de website van ${lead.company_name} (${lead.niche}) heeft problemen en wij hebben een oplossing.

Reactie van de prospect:
"""
${replyText.slice(0, 1000)}
"""

Kies EXACT één van deze categorieën:
- interested: ze willen meer weten of zijn positief
- question: ze stellen een specifieke vraag over de dienst/website
- price_check: ze vragen naar prijs of kosten
- busy_later: ze zijn nu druk maar willen later meer horen
- not_interested: ze willen geen contact of zijn duidelijk negatief
- out_of_office: automatische afwezigheidsreactie
- other: onduidelijk of past niet in andere categorie

Geef ALLEEN dit JSON terug:
{"classification":"interested","summary":"één zin wat ze zeggen in het Nederlands"}`

  const replyText2 = await callGemini({ max_tokens: 100, messages: [{ role: 'user', content: prompt }] })
  const jsonMatch = replyText2.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return { classification: 'other', summary: replyText.slice(0, 100) }
  return JSON.parse(jsonMatch[0])
}

// Strip quoted reply text — keep only the new part of the reply
function extractReplyText(raw: string): string {
  return raw
    .split(/\n(?:>|Op .* schreef|On .* wrote|Van:|From:)/m)[0]
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, 2000)
}

// Core reply handler — classify, save, trigger redesign pipeline, draft Email 2
async function processReply(lead: any, rawReplyText: string, replyMessageId: string | null = null, receivedByAccount: string | null = null) {
  const replyText = extractReplyText(rawReplyText)
  log('Reply', `Reactie van ${lead.company_name}: "${replyText.slice(0, 80)}…"`)

  const { classification, summary } = await classifyReply(replyText, lead)
  log('Reply', `Classificatie: ${classification} — ${summary}`)

  // Always save the reply + stop auto-sequence (a human replied = no more auto-reminders)
  await supabase.from('leads').update({
    reply_received_at: new Date().toISOString(),
    reply_text: replyText,
    reply_classification: classification,
    crm_status: classification === 'not_interested' ? 'rejected' : 'replied',
    sequence_stopped: true,
    next_followup_at: null,
    ...(replyMessageId ? { reply_message_id: replyMessageId } : {}),
    ...(receivedByAccount ? { reply_received_by: receivedByAccount } : {}),
    updated_at: new Date().toISOString(),
  }).eq('id', lead.id)

  const removedJobs = await removeScheduledEmailJobsForLead(lead.id)
  if (removedJobs > 0) {
    log('Reply', `${lead.company_name} — ${removedJobs} geplande e-mail(s) geannuleerd na reply`)
  }

  // Stop sequence on rejection
  if (classification === 'not_interested') {
    log('Reply', `${lead.company_name} niet geïnteresseerd — sequentie gestopt`)
    return
  }

  // Reschedule followup for out-of-office (override the stop above)
  if (classification === 'out_of_office') {
    const reschedule = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    await supabase.from('leads').update({ sequence_stopped: false, next_followup_at: reschedule }).eq('id', lead.id)
    log('Reply', `${lead.company_name} afwezig — herinnering ingepland over 7 dagen`)
    return
  }

  // For all other classifications: generate redesign + deploy + draft Email 2
  log('Reply', `${lead.company_name} (${classification}) — redesign starten`)

  try {
    // Phase 3: Generate redesign
    await phase3SingleLead(lead)

    // Reload lead to get updated status + any changes
    const { data: updatedLead } = await supabase.from('leads').select('*').eq('id', lead.id).single()
    if (!updatedLead?.status || updatedLead.status !== 'redesigned') {
      throw new Error('Redesign niet voltooid')
    }

    // Phase 4: Deploy
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
    try {
      await phase4SingleLead(updatedLead, browser)
    } finally {
      await browser.close()
    }

    // Reload again to get preview_url
    const { data: deployedLead } = await supabase.from('leads').select('*').eq('id', lead.id).single()
    if (!deployedLead?.preview_url) throw new Error('Geen preview URL na deployment')

    // Generate Email 2 draft — personalized to their reply
    await generateEmail2Draft(deployedLead, replyText, classification, summary)

    log('Reply', `${lead.company_name} — redesign live, email 2 concept klaar`)
  } catch (e) {
    log('Reply', `Fout bij verwerken reactie ${lead.company_name}: ${e}`)
    await supabase.from('leads').update({ qualify_reason: `Reply pipeline fout: ${e}` }).eq('id', lead.id)
  }
}

async function generateEmail2Draft(lead: any, replyText: string, classification: ReplyClass, summary: string) {
  const breakdown: ScoreBreakdown = lead.score_breakdown ?? {}
  const improvements: string[] = []
  if (breakdown.outdated_feel) improvements.push('moderne uitstraling')
  if (!breakdown.has_cta) improvements.push('duidelijke call-to-action')
  if (!breakdown.mobile_friendly) improvements.push('volledig mobiel geoptimaliseerd')
  if (breakdown.website_exists) improvements.push('betere structuur en hero-sectie')
  const improvementText = improvements.slice(0, 3).join(', ') || 'betere structuur, moderne uitstraling en duidelijkere CTA'

  const toneInstruction: Record<ReplyClass, string> = {
    interested:      'Ze zijn positief — wees enthousiast maar niet te opdringerig. Bevestig hun interesse.',
    question:        `Ze stellen een vraag: "${summary}". Beantwoord dit kort en direct voor je de preview laat zien.`,
    price_check:     'Ze vragen naar prijs. Leg uit dat dit concept gratis is als eerste indruk, en dat de prijs afhangt van de wensen. Geen bedragen noemen.',
    busy_later:      'Ze zijn nu druk. Erken dit, wees begripvol, en zeg dat je alvast iets hebt klaarstaan voor ze.',
    not_interested:  '',
    out_of_office:   '',
    other:           'Neutraal en vriendelijk. Reageer op hun bericht en onthul de preview.',
  }

  const shortName = (lead.company_name ?? '').split(/[|&·]/)[0].trim()
    .replace(/\s+(loodgieter|installateur|schilder|dakdekker|aannemer|cv|bv|vof|nl)\b.*/i, '').trim()

  const prompt = `Schrijf een persoonlijke e-mailreactie namens Graphic Vision.

Context:
- Bedrijf: ${lead.company_name} (${lead.niche}, ${lead.city ?? ''})
- Onze eerste mail benoemde problemen met hun website
- Hun reactie: "${replyText.slice(0, 500)}"
- Classificatie: ${classification}
- Wat verbeterd is in het redesign: ${improvementText}
- Preview URL: ${lead.preview_url}

Toon-instructie: ${toneInstruction[classification]}

Regels:
- Begin met "Hey ${shortName}," of "Goedendag,"
- Reageer EERST kort op hun specifieke bericht (1–2 zinnen)
- Onthul dan dat je alvast een concept hebt gemaakt
- Noem concreet wat je hebt verbeterd: ${improvementText}
- Zet de preview URL op een eigen regel met "→ "
- Voeg toe: "Dit is nog niet definitief — alles kan worden aangepast aan jullie wensen."
- Sluit af met uitnodiging voor een kort gesprek
- Afsluiting: "Met vriendelijke groet,\nGraphic Vision\ngraphicvision.nl"
- Max 6 zinnen, geen bullet points, persoonlijk

Geef ALLEEN dit JSON terug:
{"subject":"...","body":"..."}`

  const draftText = await callGemini({ max_tokens: 800, messages: [{ role: 'user', content: prompt }] })
  const jsonMatch = draftText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Geen JSON in Email 2 draft response')
  const draft = JSON.parse(jsonMatch[0])

  await supabase.from('leads').update({
    email2_subject: draft.subject,
    email2_body: draft.body,
    email2_draft_ready: true,
    updated_at: new Date().toISOString(),
  }).eq('id', lead.id)
}

// Extract raw email address from "Display Name <email@host>" or plain "email@host"
function extractEmail(raw: string): string {
  if (!raw) return ''
  const m = raw.match(/<([^>@\s]+@[^>\s]+)>/)
  return (m ? m[1] : raw).toLowerCase().trim()
}

// ─── IMAP reply checker ───────────────────────────────────────────────────────
async function checkInbox(imapUser: string, imapPass: string): Promise<number> {
  const client = new ImapFlow({
    host: process.env.IMAP_HOST ?? 'imap.hostinger.com',
    port: parseInt(process.env.IMAP_PORT ?? '993'),
    secure: true,
    auth: { user: imapUser, pass: imapPass },
    logger: false,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  })

  // Prevent unhandled error events from crashing the server
  client.on('error', (err: Error) => {
    log('IMAP', `Socket fout ${imapUser}: ${err.message}`)
  })

  await client.connect()
  let found = 0

  try {
    const lock = await client.getMailboxLock('INBOX')
    try {
      const uids = await client.search({ seen: false })
      log('IMAP', `${imapUser}: ${Array.isArray(uids) ? uids.length : 0} ongelezen bericht(en)`)
      if (!uids || !Array.isArray(uids) || uids.length === 0) return 0

      for await (const msg of client.fetch(uids as number[], { envelope: true, bodyStructure: true, bodyParts: ['1', 'TEXT'] })) {
        // Extract raw address, handling "Display Name <email>" format
        const fromRaw = msg.envelope?.from?.[0]?.address ?? msg.envelope?.from?.[0]?.name ?? ''
        const fromEmail = extractEmail(fromRaw)
        if (!fromEmail) continue

        // Skip any of our own sending accounts
        if (fromEmail === imapUser.toLowerCase()) continue

        log('IMAP', `${imapUser}: bericht van ${fromEmail} (subject: "${msg.envelope?.subject ?? ''}") — zoek naar lead`)

        // Match to a lead by email address with open sequence
        const { data: lead } = await supabase
          .from('leads')
          .select('*')
          .eq('email', fromEmail)
          .eq('status', 'sent')
          .is('reply_received_at', null)
          .not('crm_status', 'in', '("rejected","replied","interested","closed")')
          .single()

        if (!lead) {
          log('IMAP', `${imapUser}: geen openstaande lead gevonden voor ${fromEmail} — overgeslagen`)
          continue
        }

        log('IMAP', `${imapUser}: match → ${lead.company_name} (${lead.id})`)

        const bodyBuffer = msg.bodyParts?.get('1') ?? msg.bodyParts?.get('TEXT')
        const rawBody = bodyBuffer ? Buffer.from(bodyBuffer as any).toString('utf-8') : msg.envelope?.subject ?? ''

        // Capture Message-ID for reply threading
        const replyMessageId = msg.envelope?.messageId ?? null

        await client.messageFlagsAdd(msg.uid, ['\\Seen'], { uid: true })
        found++

        processReply(lead, rawBody, replyMessageId, imapUser)
          .then(() => log('IMAP', `${imapUser}: reactie van ${lead.company_name} verwerkt`))
          .catch(e => log('IMAP', `processReply fout voor ${lead.company_name}: ${e}`))
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout()
  }

  return found
}

async function checkReplies(): Promise<number> {
  log('IMAP', 'Check gestart')
  // Load all sending accounts from settings
  const { data: settingsRows } = await supabase.from('settings').select('*')
  const settings = Object.fromEntries(
    (settingsRows ?? []).map((s: any) => [s.key, s.value])
  )

  let accounts: { email: string; pass: string }[] = []
  try { accounts = JSON.parse(settings.smtp_accounts ?? '[]') } catch {}

  // Always include the main env account if not already in the list
  const mainUser = process.env.SMTP_USER!
  if (mainUser && !accounts.find(a => a.email === mainUser)) {
    accounts.push({ email: mainUser, pass: process.env.SMTP_PASS! })
  }

  let total = 0
  for (const account of accounts) {
    try {
      const found = await checkInbox(account.email, account.pass)
      total += found
      log('IMAP', `${account.email}: ${found} reactie(s)`)
    } catch (e) {
      log('IMAP', `Fout bij ${account.email}: ${e}`)
    }
  }

  log('IMAP', `Check klaar — ${total} nieuwe reactie(s) in ${accounts.length} inbox(en)`)
  return total
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/health', (_, res) => res.json({ ok: true, uptime: process.uptime() }))

app.get('/logs', (req, res) => {
  const since = req.query.since ? parseInt(req.query.since as string) : 0
  res.json({ logs: logBuffer.slice(since), total: logBuffer.length })
})

app.post('/run/phase1', async (req, res) => {
  const { niche, city, maxLeads = 10 } = req.body
  if (!niche || !city) return res.status(400).json({ error: 'niche en city verplicht' })
  const { data: run } = await supabase.from('pipeline_runs')
    .insert({ niche, city, status: 'running' }).select().single()
  res.json({ success: true, message: 'Phase 1 gestart', runId: run!.id })
  phase1(run!.id, niche, city, maxLeads)
    .then(() => supabase.from('pipeline_runs').update({ status: 'completed' }).eq('id', run!.id))
    .catch(e => log('Phase 1', `Fout: ${e}`))
})

app.post('/run/phase2-single/:id', async (req, res) => {
  const { id } = req.params
  res.json({ success: true, message: 'Phase 2 single gestart' })
  const { data: lead } = await supabase.from('leads').select('*').eq('id', id).single()
  if (!lead) { log('Phase 2', `Lead ${id} niet gevonden`); return }
  await supabase.from('leads').update({ status: 'scraped' }).eq('id', id)
  try {
    await phase2SingleLead({ ...lead, status: 'scraped' })
  } catch (e) {
    log('Phase 2', `Fout: ${e}`)
    await supabase.from('leads').update({ status: 'error', qualify_reason: String(e) }).eq('id', id)
  }
})

app.post('/generate-painpoint-screenshot/:id', async (req, res) => {
  const { id } = req.params
  const { force = false } = req.body ?? {}
  const { data: lead } = await supabase.from('leads').select('*').eq('id', id).single()
  if (!lead) return res.status(404).json({ error: 'Lead niet gevonden' })
  if (!lead.website_url && !lead.screenshot_url) {
    return res.status(400).json({ error: 'Geen website of screenshot beschikbaar' })
  }

  try {
    const url = await ensurePainpointScreenshotForLead(force ? { ...lead, painpoint_screenshot_url: null } : lead)
    if (!url) return res.status(500).json({ error: 'Screenshot genereren mislukt' })
    await supabase.from('leads').update({
      email1_variant_type: 'painpoint_screenshot',
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    res.json({ success: true, url })
  } catch (e) {
    log('Painpoint', `Route fout voor ${lead.company_name}: ${e}`)
    res.status(500).json({ error: String(e) })
  }
})

app.post('/run/phase4-single/:id', async (req, res) => {
  const { id } = req.params
  res.json({ success: true, message: 'Phase 4 single gestart' })
  const { data: lead } = await supabase.from('leads').select('*').eq('id', id).single()
  if (!lead) { log('Phase 4', `Lead ${id} niet gevonden`); return }
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
  try {
    await phase4SingleLead(lead, browser)
  } catch (e) {
    log('Phase 4', `Fout: ${e}`)
    await supabase.from('leads').update({ status: 'error', qualify_reason: `Deploy: ${e}` }).eq('id', id)
  } finally { await browser.close() }
})

app.post('/run/phase2', async (req, res) => {
  const { runId } = req.body ?? {}
  res.json({ success: true, message: 'Phase 2 gestart' })
  phase2(runId || 'manual', { onlyRunId: Boolean(runId) }).catch(e => log('Phase 2', `Fout: ${e}`))
})

app.post('/run/phase3', async (_, res) => {
  res.json({ success: true, message: 'Phase 3 gestart' })
  phase3('manual').catch(e => log('Phase 3', `Fout: ${e}`))
})

app.post('/run/phase3-single/:id', async (req, res) => {
  const { id } = req.params
  res.json({ success: true, message: 'Phase 3 single gestart' })
  const { data: lead } = await supabase.from('leads').select('*').eq('id', id).single()
  if (!lead) { log('Phase 3', `Lead ${id} niet gevonden`); return }
  await supabase.from('leads').update({ status: 'qualified' }).eq('id', id)
  phase3SingleLead(lead).catch(e => log('Phase 3', `Fout: ${e}`))
})

app.post('/run/phase4', async (_, res) => {
  res.json({ success: true, message: 'Phase 4 gestart' })
  phase4('manual').catch(e => log('Phase 4', `Fout: ${e}`))
})

app.post('/run', async (req, res) => {
  // mode: 'send' (default) = auto-send Email 1 | 'draft' = generate sequence but don't send
  const { niche, city, maxLeads = 10, mode = 'send' } = req.body
  if (!niche || !city) return res.status(400).json({ error: 'niche en city verplicht' })

  const { data: run } = await supabase.from('pipeline_runs')
    .insert({ niche, city, status: 'running' }).select().single()

  res.json({ success: true, runId: run!.id })

  // New flow: scrape → qualify → generate email sequence → send Email 1 (or just draft)
  // Redesign only happens AFTER a lead replies (triggered by /on-reply/:id)
  ;(async () => {
    try {
      const scraped = await phase1(run!.id, niche, city, maxLeads)
      await phase2(run!.id)

      // Count qualified leads for this run
      const { data: qualifiedLeads } = await supabase
        .from('leads').select('*').eq('status', 'qualified').not('email', 'is', null)
        .eq('pipeline_run_id', run!.id)

      let emailed = 0
      for (const lead of qualifiedLeads ?? []) {
        try {
          await generateEmailSequenceForLead(lead)
          if (mode === 'send') {
            const { data: freshLead } = await supabase.from('leads').select('*').eq('id', lead.id).single()
            await sendEmailForLead(freshLead ?? lead, 1)
            emailed++
            await sleep(30_000) // 30s between sends for deliverability
          }
        } catch (e) {
          log('Pipeline', `Email 1 fout voor ${lead.company_name}: ${formatError(e)}`)
        }
      }

      const qualified = qualifiedLeads?.length ?? 0
      const summary = mode === 'send'
        ? `${emailed} emails verstuurd, wacht op reacties`
        : `${qualified} sequenties gegenereerd (draft mode — niet verstuurd)`
      log('Pipeline', `Run ${run!.id} voltooid — ${summary}`)
      await supabase.from('pipeline_runs').update({
        status: 'completed', completed_at: new Date().toISOString(),
      }).eq('id', run!.id)

      // Send summary notification
      await sendRunNotification({ niche, city, scraped: scraped ?? 0, qualified, emailed, mode, failed: false })
    } catch (e) {
      const errorMessage = formatError(e)
      log('Pipeline', `Run ${run!.id} mislukt: ${errorMessage}`)
      await supabase.from('pipeline_runs').update({ status: 'failed', error: errorMessage }).eq('id', run!.id)
      await sendRunNotification({ niche, city, scraped: 0, qualified: 0, emailed: 0, mode, failed: true, error: errorMessage })
    }
  })()
})

// ─── Bulk: generate sequences + optionally send Email 1 for existing qualified leads ──
app.post('/run/email-qualified', async (req, res) => {
  const { mode = 'send' } = req.body
  res.json({ success: true })

  ;(async () => {
    const { data: leads } = await supabase
      .from('leads').select('*').eq('status', 'qualified').not('email', 'is', null)
      .is('email1_sent_at', null) // Only leads that haven't been emailed yet

    let count = 0
    for (const lead of leads ?? []) {
      try {
        if (!lead.email1_subject) await generateEmailSequenceForLead(lead)
        const fresh = await supabase.from('leads').select('*').eq('id', lead.id).single()
        if (mode === 'send') {
          await sendEmailForLead(fresh.data ?? lead, 1)
          count++
          await sleep(30_000)
        } else {
          count++
        }
      } catch (e) {
        log('Email-qualified', `Fout voor ${lead.company_name}: ${e}`)
      }
    }
    log('Email-qualified', `Klaar — ${count} leads verwerkt (mode: ${mode})`)
  })()
})

// ─── Generate email sequence (4 emails) ──────────────────────────────────────
app.post('/generate-email-sequence/:id', async (req, res) => {
  const { id } = req.params
  const { data: lead } = await supabase.from('leads').select('*').eq('id', id).single()
  if (!lead) return res.status(404).json({ error: 'Lead niet gevonden' })

  try {
    const emails = await generateEmailSequenceForLead(lead)
    log('Mail', `Sequentie gegenereerd voor ${lead.company_name}`)
    res.json({ success: true, emails })
  } catch (e) {
    log('Mail', `Sequentie genereren mislukt: ${e}`)
    res.status(500).json({ error: String(e) })
  }
})

// ─── Generate A/B variants for email 1 ────────────────────────────────────────
app.post('/generate-email-variants/:id', async (req, res) => {
  const { id } = req.params
  const { data: lead } = await supabase.from('leads').select('*').eq('id', id).single()
  if (!lead) return res.status(404).json({ error: 'Lead niet gevonden' })

  try {
    const breakdown2: ScoreBreakdown = lead.score_breakdown ?? {}
    const variantIssues: string[] = []
    if (breakdown2.outdated_feel) variantIssues.push('verouderde uitstraling')
    if (!breakdown2.has_cta) variantIssues.push('geen duidelijke call-to-action')
    if (!breakdown2.mobile_friendly) variantIssues.push('slechte mobiele versie')
    const variantIssueText = variantIssues.slice(0, 2).join(' en ') || 'verouderde website'

    const prompt = `Schrijf 3 varianten van een eerste verkoop-e-mail namens Graphic Vision voor:

Bedrijf: ${lead.company_name} (${lead.niche}, ${lead.city ?? ''})
Specifieke website-issues: ${variantIssueText}

STRENGE REGELS VOOR ALLE VARIANTEN:
- ABSOLUUT GEEN links, URLs, buttons of afbeeldingen
- Max 5 zinnen
- Leg uit WAAROM de website niet werkt — gebruik max 2 concrete issues: ${variantIssueText}
- Koppel elk probleem aan het gevolg voor hun bedrijf (bezoekers die afhaken, minder bellers, geen vertrouwen)
- Geef aan dat dit opgelost is — zonder te onthullen hoe of wat
- Eindig met een curiosity-gebaseerde CTA (varieer de formulering per variant)
- Afsluiting: "Met vriendelijke groet,\nGraphic Vision\ngraphicvision.nl"
- Alle tekst in het Nederlands

Variant A: direct en zakelijk — to the point, geen smalltalk
Variant B: persoonlijk en vriendelijk — voelt als een bericht van een bekende
Variant C: competitie-invalshoek — wat lopen ze mis t.o.v. concurrenten in de branche

Geef ALLEEN dit JSON terug:
[
  {"label":"A","subject":"...","body":"..."},
  {"label":"B","subject":"...","body":"..."},
  {"label":"C","subject":"...","body":"..."}
]`

    const varText = await callGemini({ max_tokens: 1500, messages: [{ role: 'user', content: prompt }] })
    const jsonMatch = varText.match(/\[[\s\S]*\]/)
    if (!jsonMatch) throw new Error(`Geen JSON in response: ${varText.slice(0, 200)}`)
    const variants = JSON.parse(jsonMatch[0])

    await supabase.from('leads').update({ email_variants: variants, selected_variant: 0, updated_at: new Date().toISOString() }).eq('id', id)
    log('Mail', `Varianten gegenereerd voor ${lead.company_name}`)
    res.json({ success: true, variants })
  } catch (e) {
    log('Mail', `Varianten genereren mislukt: ${e}`)
    res.status(500).json({ error: String(e) })
  }
})

// ─── Select A/B variant ────────────────────────────────────────────────────────
app.post('/select-email-variant/:id', async (req, res) => {
  const { id } = req.params
  const { variant } = req.body  // 0, 1, or 2 (index)
  const { data: lead } = await supabase.from('leads').select('*').eq('id', id).single()
  if (!lead) return res.status(404).json({ error: 'Lead niet gevonden' })

  const variants: any[] = lead.email_variants ?? []
  const chosen = variants[variant]
  if (!chosen) return res.status(400).json({ error: 'Variant niet gevonden' })

  await supabase.from('leads').update({
    selected_variant: variant,
    email1_subject: chosen.subject, email1_body: chosen.body,
    email_subject: chosen.subject, email_body: chosen.body,
    updated_at: new Date().toISOString(),
  }).eq('id', id)

  res.json({ success: true })
})

// ─── Stop email sequence ───────────────────────────────────────────────────────
app.post('/stop-sequence/:id', async (req, res) => {
  const { id } = req.params
  await supabase.from('leads').update({
    sequence_stopped: true, next_followup_at: null, updated_at: new Date().toISOString(),
  }).eq('id', id)
  res.json({ success: true })
})

// ─── Send email ───────────────────────────────────────────────────────────────
// ─── Generate email with Claude ───────────────────────────────────────────────
app.post('/generate-email/:id', async (req, res) => {
  const { id } = req.params

  const { data: lead } = await supabase.from('leads').select('*').eq('id', id).single()
  if (!lead) return res.status(404).json({ error: 'Lead niet gevonden' })
  if (!lead.preview_url) return res.status(400).json({ error: 'Nog geen preview URL' })

  try {
    const emailPrefix = (lead.email ?? '').split('@')[0].toLowerCase()
    const genericPrefixes = ['info', 'contact', 'hello', 'hallo', 'mail', 'post', 'office', 'admin', 'support', 'service', 'team', 'sales', 'marketing', 'hoi', 'algemeen', 'receptie', 'secretariaat', 'welkom', 'webmaster']
    const isGeneric = !lead.email || genericPrefixes.some(p => emailPrefix === p || emailPrefix.startsWith(p + '.'))

    const firstName = isGeneric ? null : (() => {
      const namePart = emailPrefix.split(/[._-]/)[0]
      return (namePart && namePart.length > 1 && /^[a-z]/i.test(namePart))
        ? namePart.charAt(0).toUpperCase() + namePart.slice(1).toLowerCase()
        : null
    })()

    // Extract short brand name — take text before first |, &, ·, -, or long suffix
    const shortName = (lead.company_name ?? '')
      .split(/[|&·]/)[0]
      .trim()
      .replace(/\s+(loodgieter|installateur|schilder|dakdekker|aannemer|cv|bv|vof|nl)\b.*/i, '')
      .trim()

    const greeting = firstName ? `Hey ${firstName},` : 'Goedendag,'

    // Short, personal, curiosity-driven subjects — no full company names
    const genericSubjects = [
      `Ik maakte iets voor jullie website`,
      `Even iets laten zien`,
      `Gratis concept voor ${shortName}`,
    ]
    const subject = firstName
      ? `Snel iets voor je gemaakt, ${firstName}`
      : genericSubjects[0]

    const prompt = `Schrijf een overtuigende Nederlandse verkoop-e-mail namens Graphic Vision.

Bedrijf: ${lead.company_name}
Niche: ${lead.niche}${lead.city ? `\nStad: ${lead.city}` : ''}
Preview URL: ${lead.preview_url}

Eisen voor de e-mail:
- Begin EXACT met: "${greeting}"
- Vertel kort wie Graphic Vision is: een webdesign bureau dat moderne, converterende websites bouwt voor lokale bedrijven in Nederland
- Benoem dat wij de website van ${lead.company_name} hebben bekeken en zien dat er ruimte is voor verbetering
- Vertel dat wij alvast een gratis concept hebben gemaakt als indicatie van wat mogelijk is — zet de preview URL op een EIGEN REGEL, voorafgegaan door "→ "
- Maak duidelijk dat dit concept nog niet de definitieve website is, maar een eerste impressie om te laten zien wat we kunnen
- Eindig met een uitnodiging om vrijblijvend contact op te nemen — geen druk, gewoon een gesprek
- Gebruik als afsluiting EXACT: "Met vriendelijke groet,\nEzra\nGraphic Vision\ngraphicvision.nl"
- Maximaal 5 korte alinea's, scanbaar en overtuigend, geen bullet points
- Ton: persoonlijk, direct, niet opdringerig

Geef ALLEEN de e-mailtekst, geen onderwerpregel, geen uitleg, geen markdown.`

    const body = await callGemini({
      max_tokens: 700,
      messages: [{ role: 'user', content: prompt }],
    })

    // Persist draft to Supabase
    await supabase.from('leads').update({ email_subject: subject, email_body: body }).eq('id', id)

    res.json({ subject, body })
  } catch (e) {
    log('Mail', `Genereren mislukt: ${e}`)
    res.status(500).json({ error: String(e) })
  }
})

async function queueScheduledEmail(leadId: string, emailNumber: EmailNumber, scheduledForIso: string) {
  const jobs = await getScheduledEmailJobs()
  const filtered = jobs.filter((job) => !(job.leadId === leadId && job.emailNumber === emailNumber))
  filtered.push({
    leadId,
    emailNumber,
    scheduledFor: scheduledForIso,
    createdAt: new Date().toISOString(),
  })
  await saveScheduledEmailJobs(filtered)
}

let scheduledEmailTickRunning = false

async function sendDueScheduledEmails() {
  if (scheduledEmailTickRunning) return
  scheduledEmailTickRunning = true
  try {
    const jobs = await getScheduledEmailJobs()
    if (!jobs.length) return

    const now = Date.now()
    const due = jobs.filter((job) => new Date(job.scheduledFor).getTime() <= now)
    if (!due.length) return

    const pending = jobs.filter((job) => new Date(job.scheduledFor).getTime() > now)
    const retry: ScheduledEmailJob[] = []
    log('Scheduler', `${due.length} geplande e-mail(s) klaar om te versturen`)

    for (const job of due) {
      try {
        const { data: lead, error } = await supabase.from('leads').select('*').eq('id', job.leadId).single()
        if (error || !lead) {
          log('Scheduler', `Lead ${job.leadId} niet gevonden, planning verwijderd`)
          continue
        }

        const sentField = `email${job.emailNumber}_sent_at`
        if (lead[sentField]) {
          log('Scheduler', `${lead.company_name ?? job.leadId} — email ${job.emailNumber} al verstuurd, planning verwijderd`)
          continue
        }
        if (!lead.email) {
          log('Scheduler', `${lead.company_name ?? job.leadId} — geen e-mailadres, planning verwijderd`)
          continue
        }
        if (lead.sequence_stopped) {
          log('Scheduler', `${lead.company_name ?? job.leadId} — sequentie gestopt, planning verwijderd`)
          continue
        }
        if (lead.reply_received_at) {
          log('Scheduler', `${lead.company_name ?? job.leadId} — reactie ontvangen, geplande email ${job.emailNumber} geannuleerd`)
          continue
        }
        if (lead.crm_status === 'replied' || lead.crm_status === 'interested' || lead.crm_status === 'closed') {
          log('Scheduler', `${lead.company_name ?? job.leadId} — crm_status=${lead.crm_status}, geplande email ${job.emailNumber} geannuleerd`)
          continue
        }

        await sendEmailForLead(lead, job.emailNumber)
        log('Scheduler', `Geplande email ${job.emailNumber} verstuurd naar ${lead.company_name ?? lead.email}`)
        await sleep(5_000)
      } catch (e) {
        log('Scheduler', `Fout bij geplande email ${job.emailNumber} voor ${job.leadId}: ${e}`)
        retry.push(job)
      }
    }

    await saveScheduledEmailJobs([...pending, ...retry])
  } finally {
    scheduledEmailTickRunning = false
  }
}

app.post('/send-email/:id', async (req, res) => {
  const { id } = req.params
  const emailNumber = normalizeEmailNumber(req.body?.emailNumber ?? 1)
  const scheduledFor = req.body?.scheduledFor

  const { data: lead } = await supabase.from('leads').select('*').eq('id', id).single()
  if (!lead) return res.status(404).json({ error: 'Lead niet gevonden' })
  if (!lead.email) return res.status(400).json({ error: 'Geen e-mailadres' })
  if (!emailNumber) return res.status(400).json({ error: 'Ongeldig emailNumber (1-4)' })

  if (scheduledFor) {
    const parsed = parseScheduledFor(scheduledFor)
    if (!parsed.ok) return res.status(400).json({ error: parsed.error })
    try {
      await queueScheduledEmail(id, emailNumber, parsed.iso)
      log('Scheduler', `Email ${emailNumber} ingepland voor ${lead.company_name} op ${new Date(parsed.iso).toLocaleString('nl-NL')}`)
      return res.json({ success: true, scheduled: true, scheduled_for: parsed.iso })
    } catch (e) {
      log('Scheduler', `Planning mislukt voor ${lead.company_name}: ${e}`)
      return res.status(500).json({ error: 'Inplannen mislukt' })
    }
  }

  try {
    const result = await sendEmailForLead(lead, emailNumber)
    res.json({ success: true, ...result })
  } catch (e) {
    log('Mail', `Fout bij versturen naar ${lead.email}: ${e}`)
    res.status(500).json({ error: String(e) })
  }
})

app.get('/status/:runId', async (req, res) => {
  const { data } = await supabase.from('pipeline_runs').select('*').eq('id', req.params.runId).single()
  res.json(data)
})

// ─── Reply routes ─────────────────────────────────────────────────────────────

// Manual trigger: process a reply for a specific lead
app.post('/on-reply/:id', async (req, res) => {
  const { id } = req.params
  const { replyText } = req.body
  if (!replyText) return res.status(400).json({ error: 'replyText verplicht' })

  const { data: lead } = await supabase.from('leads').select('*').eq('id', id).single()
  if (!lead) return res.status(404).json({ error: 'Lead niet gevonden' })

  res.json({ success: true, message: 'Reactie verwerking gestart' })
  processReply(lead, replyText).catch(e => log('Reply', `on-reply fout: ${e}`))
})

// Poll inbox for new replies
app.post('/check-replies', async (req, res) => {
  res.json({ success: true, message: 'IMAP check gestart' })
  checkReplies().catch(e => log('IMAP', `check-replies fout: ${e}`))
})

// ─── Auto followup sender ─────────────────────────────────────────────────────

async function sendDueFollowups() {
  const now = new Date().toISOString()
  const { data: leads, error } = await supabase
    .from('leads')
    .select('*')
    .lte('next_followup_at', now)
    .eq('sequence_stopped', false)
    .not('next_followup_at', 'is', null)

  if (error) { log('Followup', `DB fout: ${error.message}`); return }
  if (!leads || leads.length === 0) return

  log('Followup', `${leads.length} lead(s) klaar voor automatische herinnering`)

  for (const lead of leads) {
    // Re-fetch lead right before sending — triple guard against sending to leads that replied
    const { data: freshLead } = await supabase.from('leads').select('*').eq('id', lead.id).single()
    if (!freshLead) { log('Followup', `Lead ${lead.id} niet meer gevonden`); continue }
    if (freshLead.sequence_stopped) {
      log('Followup', `${freshLead.company_name} — sequentie al gestopt, overgeslagen`)
      continue
    }
    if (freshLead.reply_received_at) {
      log('Followup', `${freshLead.company_name} — reactie ontvangen op ${freshLead.reply_received_at}, stop auto-followup`)
      await supabase.from('leads').update({ sequence_stopped: true, next_followup_at: null }).eq('id', freshLead.id)
      continue
    }
    if (freshLead.crm_status === 'replied' || freshLead.crm_status === 'interested' || freshLead.crm_status === 'closed') {
      log('Followup', `${freshLead.company_name} — crm_status=${freshLead.crm_status}, stop auto-followup`)
      await supabase.from('leads').update({ sequence_stopped: true, next_followup_at: null }).eq('id', freshLead.id)
      continue
    }

    // email_sequence_index 1 → send email 3 (reminder 1)
    // email_sequence_index 3 → send email 4 (reminder 2)
    const nextEmail = freshLead.email_sequence_index === 1 ? 3 : freshLead.email_sequence_index === 3 ? 4 : null
    if (!nextEmail) {
      // Unknown state — stop to avoid loop
      await supabase.from('leads').update({ sequence_stopped: true, next_followup_at: null }).eq('id', freshLead.id)
      continue
    }

    const bodyKey = `email${nextEmail}_body`
    if (!freshLead[bodyKey] || !freshLead.email) {
      log('Followup', `${freshLead.company_name} — email ${nextEmail} body ontbreekt, overgeslagen`)
      await supabase.from('leads').update({ sequence_stopped: true, next_followup_at: null }).eq('id', freshLead.id)
      continue
    }

    try {
      await sendEmailForLead(freshLead, nextEmail as 1 | 2 | 3 | 4)
      log('Followup', `Herinnering ${nextEmail} verstuurd naar ${freshLead.company_name}`)
      await sleep(15_000) // 15s between sends
    } catch (e) {
      log('Followup', `Fout bij ${freshLead.company_name}: ${e}`)
    }
  }
}

// Run followup check every hour
setInterval(() => {
  sendDueFollowups().catch(e => log('Followup', `Interval fout: ${e}`))
}, 60 * 60 * 1000)

// Also run once 2 minutes after startup (catches anything that was due while server was down)
setTimeout(() => {
  sendDueFollowups().catch(e => log('Followup', `Startup check fout: ${e}`))
}, 2 * 60 * 1000)

// Run scheduled email queue every minute
setInterval(() => {
  sendDueScheduledEmails().catch(e => log('Scheduler', `Interval fout: ${e}`))
}, 60 * 1000)

// Also run once shortly after startup
setTimeout(() => {
  sendDueScheduledEmails().catch(e => log('Scheduler', `Startup check fout: ${e}`))
}, 30 * 1000)

process.on('uncaughtException', (err) => {
  log('Server', `Uncaught exception (server blijft draaien): ${err.message}`)
})
process.on('unhandledRejection', (reason) => {
  log('Server', `Unhandled rejection (server blijft draaien): ${reason}`)
})

const PORT = process.env.PORT ?? 3001
app.listen(PORT, () => log('Server', `Draait op poort ${PORT}`))
