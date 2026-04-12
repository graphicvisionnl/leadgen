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
      if (data.error) throw new Error(`Gemini error: ${JSON.stringify(data.error)}`)
      const text = data.choices?.[0]?.message?.content
      if (!text) throw new Error(`Gemini: geen content in response`)
      return text
    } catch (e) {
      if (attempt === 3) throw e
      log('Retry', `callGemini attempt ${attempt} mislukt: ${e} — wacht 30s`)
      await sleep(30_000)
    }
  }
  throw new Error('callGemini: alle pogingen mislukt')
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

function normalizeUrl(url: string): string {
  if (!url.startsWith('http')) return `https://${url}`
  return url
}

function isValidUrl(url: string): boolean {
  try { new URL(normalizeUrl(url)); return true } catch { return false }
}

function loadSkill(filename: string): string {
  try {
    return fs.readFileSync(path.join(__dirname, '../../lib/skills', filename), 'utf-8')
  } catch { return '' }
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

// ─── Phase 1: Apify ──────────────────────────────────────────────────────────
async function phase1(runId: string, niche: string, city: string, maxLeads: number) {
  log('Phase 1', `Scraping "${niche}" in "${city}" (max ${maxLeads})`)
  const token = process.env.APIFY_API_TOKEN!

  const startRes = await fetch(
    `https://api.apify.com/v2/acts/nwua9Gu5YrADL7ZDj/runs?token=${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ searchString: `${niche} ${city}`, maxCrawledPlaces: maxLeads, language: 'nl' }),
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
  const businesses = await resultsRes.json()
  log('Phase 1', `${businesses.length} bedrijven ontvangen`)

  const urls = businesses.filter((b: any) => b.website).map((b: any) => normalizeUrl(b.website))
  const { data: existing } = await supabase.from('leads').select('website_url').in('website_url', urls)
  const existingUrls = new Set((existing ?? []).map((e: any) => e.website_url))

  const toInsert = businesses
    .filter((b: any) => b.website && isValidUrl(b.website) && !existingUrls.has(normalizeUrl(b.website)))
    .map((b: any) => ({
      company_name: b.title,
      website_url: normalizeUrl(b.website),
      email: b.email ?? null,
      city: b.city ?? city,
      niche,
      google_rating: b.totalScore ?? null,
      review_count: b.reviewsCount ?? null,
      status: b.email ? 'scraped' : 'no_email',
      pipeline_run_id: runId,
    }))

  if (!toInsert.length) { log('Phase 1', 'Geen nieuwe leads'); return 0 }
  const { data: inserted, error } = await supabase.from('leads').insert(toInsert).select('id')
  if (error) throw error
  log('Phase 1', `${inserted?.length} leads ingevoegd`)
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

function calculateLeadScore(breakdown: ScoreBreakdown): { score: number; hot_lead: boolean } {
  let score = 0
  if (breakdown.website_exists) score += 20
  if (breakdown.email_found)    score += 15
  if (breakdown.phone_found)    score += 10
  if (breakdown.outdated_feel)  score += 15  // opportunity
  if (!breakdown.mobile_friendly) score += 10 // opportunity
  if (!breakdown.has_cta)       score += 15  // opportunity
  if (breakdown.internal_link_count > 5) score += 15 // established site
  return { score, hot_lead: score >= 65 }
}

async function phase2SingleLead(lead: any): Promise<boolean> {
  log('Phase 2', lead.company_name)

  const signals = await scrapeLeadSignals(lead.website_url)
  const email = lead.email ?? signals.email
  if (signals.email && !lead.email) {
    await supabase.from('leads').update({ email: signals.email }).eq('id', lead.id)
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

Bij twijfel: qualified=false. Liever te weinig dan te veel leads.

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
  const { score: leadScore, hot_lead } = calculateLeadScore(breakdown)

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

async function phase2(runId: string) {
  log('Phase 2', 'Email scrapen + kwalificeren')
  const { data: leads } = await supabase.from('leads').select('*')
    .in('status', ['scraped', 'no_email', 'error']).not('website_url', 'is', null)

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

// Reusable: generate the 4-email sequence for a lead (same logic as the route)
async function generateEmailSequenceForLead(lead: any) {
  const breakdown: ScoreBreakdown = lead.score_breakdown ?? {}
  const issues: string[] = []
  if (breakdown.outdated_feel) issues.push('de website heeft een verouderde uitstraling')
  if (!breakdown.has_cta) issues.push('er is geen duidelijke call-to-action boven de vouw')
  if (!breakdown.mobile_friendly) issues.push('de mobiele versie voelt verouderd aan')
  if (!breakdown.email_found && !lead.email) issues.push('contactgegevens zijn moeilijk te vinden')
  const issueText = issues.slice(0, 2).join(' en ') || 'verouderde website'

  const improvements: string[] = []
  if (breakdown.outdated_feel) improvements.push('moderne layout en uitstraling')
  if (!breakdown.has_cta) improvements.push('duidelijke call-to-action toegevoegd')
  if (!breakdown.mobile_friendly) improvements.push('volledig mobiel geoptimaliseerd')
  if (breakdown.website_exists) improvements.push('betere structuur en hero-sectie')
  const improvementText = improvements.slice(0, 3).join(', ') || 'betere structuur, moderne uitstraling en duidelijkere CTA'

  const shortName = (lead.company_name ?? '').split(/[|&·]/)[0].trim()
    .replace(/\s+(loodgieter|installateur|schilder|dakdekker|aannemer|cv|bv|vof|nl)\b.*/i, '').trim()

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

  const prompt = `Je schrijft een koude outreach e-mailreeks namens Graphic Vision voor dit bedrijf:

Bedrijf: ${lead.company_name}
Niche: ${lead.niche}
Stad: ${lead.city ?? 'onbekend'}
Problemen op hun site: ${issueText}

OPMAAK (verplicht voor alle mails): gebruik lege regels tussen alinea's. Plain text stijl.

MAIL 1 — OUTREACH MAIL (dag 0)
Stijl: casual, kort, nieuwsgierig. Max 4-5 zinnen. GEEN links, GEEN afbeeldingen.
- Begin EXACT met: "${greeting}"
- Zeg dat je ze vond via Google Maps
- Noem 1-2 specifieke problemen (gebruik: ${issueText}) — concreet, niet vaag
- Zeg dat je een quick redesign hebt gemaakt
- Lege regel, dan EXACT: "Wil je dat ik het stuur?" (of vergelijkbare korte nieuwsgierige CTA)
- Afsluiting EXACT: "– Graphic Vision"
- GEEN "Met vriendelijke groet", GEEN lange afsluiting
- Schrijf alsof je een vriend bent die een tip geeft, niet een bureau dat verkoopt

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
  "email1": {"subject": "...", "body": "..."},
  "email2": {"subject": "Reactie", "body": "[Wordt gegenereerd na reactie van de lead]"},
  "email3": {"subject": "...", "body": "..."},
  "email4": {"subject": "...", "body": "..."}
}`

  const seqText = await callGemini({ max_tokens: 2000, messages: [{ role: 'user', content: prompt }] })
  const jsonMatch = seqText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Geen JSON in sequence response')
  const emails = JSON.parse(jsonMatch[0])

  await supabase.from('leads').update({
    email1_subject: emails.email1.subject, email1_body: emails.email1.body,
    email2_subject: emails.email2.subject, email2_body: emails.email2.body,
    email3_subject: emails.email3.subject, email3_body: emails.email3.body,
    email4_subject: emails.email4.subject, email4_body: emails.email4.body,
    email_subject: emails.email1.subject,  email_body: emails.email1.body,
    updated_at: new Date().toISOString(),
  }).eq('id', lead.id)
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

async function sendEmailForLead(lead: any, emailNumber: 1 | 2 | 3 | 4) {
  const subjectKey = `email${emailNumber}_subject` as const
  const bodyKey = `email${emailNumber}_body` as const
  let body: string = lead[bodyKey] ?? lead.email_body ?? ''
  if (!body || !lead.email) throw new Error('Ontbrekende email data')

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

  const signature = emailNumber === 1
    ? `\n\n– Graphic Vision`
    : `\n\nMet vriendelijke groet,\nGraphic Vision\ngraphicvision.nl`

  body = body + signature

  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST!,
    port: parseInt(process.env.SMTP_PORT ?? '465'),
    secure: process.env.SMTP_PORT !== '587',
    auth: { user: account.email, pass: account.pass },
  })

  // Email 1 = plain text only (best deliverability for cold outreach)
  // Email 2+ = branded HTML template
  let mailOptions: any
  if (emailNumber === 1) {
    mailOptions = {
      from: `${account.name} <${account.email}>`,
      to: lead.email,
      bcc: 'graphicvisionnl@gmail.com',
      subject,
      text: body,
    }
  } else if (emailNumber === 2 && isThreadedReply) {
    // Send as threaded reply — same account, Re: subject, In-Reply-To header
    mailOptions = {
      from: `${account.name} <${account.email}>`,
      to: lead.email,
      bcc: 'graphicvisionnl@gmail.com',
      subject,
      html: buildEmailHtml(bodyToHtml(body, lead.preview_url ?? null)),
      text: body,
      headers: {
        'In-Reply-To': lead.reply_message_id,
        'References': lead.reply_message_id,
      },
    }
  } else {
    mailOptions = {
      from: `${account.name} — Graphic Vision <${account.email}>`,
      to: lead.email,
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

  await supabase.from('leads').update({
    status: 'sent',
    crm_status: 'contacted',
    email_sequence_index: emailNumber,
    [sentAtField]: new Date().toISOString(),
    next_followup_at,
    sequence_stopped: emailNumber === 4 ? true : false,
    updated_at: new Date().toISOString(),
  }).eq('id', lead.id)

  log('Mail', `Email ${emailNumber} verstuurd naar ${lead.email} (${lead.company_name})${next_followup_at ? ` — volgende: ${new Date(next_followup_at).toLocaleString('nl-NL')}` : ' — sequentie afgerond'}`)
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
      if (!uids || !Array.isArray(uids) || uids.length === 0) return 0

      for await (const msg of client.fetch(uids as number[], { envelope: true, bodyStructure: true, bodyParts: ['1', 'TEXT'] })) {
        const fromEmail = msg.envelope?.from?.[0]?.address?.toLowerCase()
        if (!fromEmail) continue

        // Skip any of our own sending accounts
        if (fromEmail === imapUser.toLowerCase()) continue

        // Match to a lead by email address with open sequence
        const { data: lead } = await supabase
          .from('leads')
          .select('*')
          .eq('email', fromEmail)
          .eq('status', 'sent')
          .not('crm_status', 'in', '("rejected","replied","interested","closed")')
          .single()

        if (!lead) continue

        const bodyBuffer = msg.bodyParts?.get('1') ?? msg.bodyParts?.get('TEXT')
        const rawBody = bodyBuffer ? Buffer.from(bodyBuffer as any).toString('utf-8') : msg.envelope?.subject ?? ''

        // Capture Message-ID for reply threading
        const replyMessageId = msg.envelope?.messageId ?? null

        await client.messageFlagsAdd(msg.uid, ['\\Seen'], { uid: true })

        log('IMAP', `Reactie van ${lead.company_name} (${fromEmail}) → inbox ${imapUser}`)
        found++

        processReply(lead, rawBody, replyMessageId, imapUser).catch(e => log('IMAP', `processReply fout: ${e}`))
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

app.post('/run/phase2', async (_, res) => {
  res.json({ success: true, message: 'Phase 2 gestart' })
  phase2('manual').catch(e => log('Phase 2', `Fout: ${e}`))
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
            await sendEmailForLead(lead, 1)
            emailed++
            await sleep(30_000) // 30s between sends for deliverability
          }
        } catch (e) {
          log('Pipeline', `Email 1 fout voor ${lead.company_name}: ${e}`)
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
      log('Pipeline', `Run ${run!.id} mislukt: ${e}`)
      await supabase.from('pipeline_runs').update({ status: 'failed', error: String(e) }).eq('id', run!.id)
      await sendRunNotification({ niche, city, scraped: 0, qualified: 0, emailed: 0, mode, failed: true, error: String(e) })
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
    const breakdown: ScoreBreakdown = lead.score_breakdown ?? {}

    // Specific issues for Email 1 (max 2, no links)
    const issues: string[] = []
    if (breakdown.outdated_feel) issues.push('de website heeft een verouderde uitstraling')
    if (!breakdown.has_cta) issues.push('er is geen duidelijke call-to-action boven de vouw')
    if (!breakdown.mobile_friendly) issues.push('de mobiele versie voelt verouderd aan')
    if (!breakdown.email_found && !lead.email) issues.push('contactgegevens zijn moeilijk te vinden')
    const issueText = issues.slice(0, 2).join(' en ') || 'verouderde website'

    // What was improved — for Email 2
    const improvements: string[] = []
    if (breakdown.outdated_feel) improvements.push('moderne layout en uitstraling')
    if (!breakdown.has_cta) improvements.push('duidelijke call-to-action toegevoegd')
    if (!breakdown.mobile_friendly) improvements.push('volledig mobiel geoptimaliseerd')
    if (breakdown.website_exists) improvements.push('betere structuur en hero-sectie')
    const improvementText = improvements.slice(0, 3).join(', ') || 'betere structuur, moderne uitstraling en duidelijkere CTA'

    const emailPrefix2 = (lead.email ?? '').split('@')[0].toLowerCase()
    const genericPrefixes2 = ['info', 'contact', 'hello', 'hallo', 'mail', 'post', 'office', 'admin', 'support', 'service', 'team', 'sales', 'marketing', 'hoi', 'algemeen', 'receptie', 'secretariaat', 'welkom', 'webmaster']
    const isGeneric2 = !lead.email || genericPrefixes2.some((p: string) => emailPrefix2 === p || emailPrefix2.startsWith(p + '.'))
    const firstName2 = isGeneric2 ? null : (() => {
      const namePart = emailPrefix2.split(/[._-]/)[0]
      return (namePart && namePart.length > 1 && /^[a-z]/i.test(namePart))
        ? namePart.charAt(0).toUpperCase() + namePart.slice(1).toLowerCase()
        : null
    })()
    const greeting2 = firstName2 ? `Hey ${firstName2},` : 'Hey,'

    const prompt = `Je schrijft een koude outreach e-mailreeks namens Graphic Vision voor dit bedrijf:

Bedrijf: ${lead.company_name}
Niche: ${lead.niche}
Stad: ${lead.city ?? 'onbekend'}
Problemen op hun site: ${issueText}

OPMAAK (verplicht voor alle mails): gebruik lege regels tussen alinea's. Plain text stijl.

MAIL 1 — OUTREACH MAIL (dag 0)
Stijl: casual, kort, nieuwsgierig. Max 4-5 zinnen. GEEN links, GEEN afbeeldingen.
- Begin EXACT met: "${greeting2}"
- Zeg dat je ze vond via Google Maps
- Noem 1-2 specifieke problemen (gebruik: ${issueText}) — concreet, niet vaag
- Zeg dat je een quick redesign hebt gemaakt
- Lege regel, dan EXACT: "Wil je dat ik het stuur?" (of vergelijkbare korte nieuwsgierige CTA)
- Afsluiting EXACT: "– Graphic Vision"
- GEEN "Met vriendelijke groet", GEEN lange afsluiting
- Schrijf alsof je een vriend bent die een tip geeft, niet een bureau dat verkoopt

MAIL 2 — REACTIE MAIL (placeholder, wordt gegenereerd na reactie)
Schrijf alleen: subject="Reactie", body="[Wordt gegenereerd na reactie van de lead]"

MAIL 3 — HERINNERING 1 (dag 3)
- Begin met "${greeting2}"
- Super kort — max 2-3 zinnen
- Verwijs terug naar mail 1, vraag of ze het gemist hebben
- GEEN links, GEEN preview URL
- Afsluiting EXACT: "– Graphic Vision"

MAIL 4 — HERINNERING 2 (dag 6)
- Begin met "${greeting2}"
- Sluit het dossier af — kort en vriendelijk
- GEEN links, GEEN preview URL
- Afsluiting EXACT: "– Graphic Vision"

Geef ALLEEN dit JSON terug, niets anders:
{
  "email1": {"subject": "...", "body": "..."},
  "email2": {"subject": "Reactie", "body": "[Wordt gegenereerd na reactie van de lead]"},
  "email3": {"subject": "...", "body": "..."},
  "email4": {"subject": "...", "body": "..."}
}`

    const seqText2 = await callGemini({ max_tokens: 2000, messages: [{ role: 'user', content: prompt }] })
    const jsonMatch = seqText2.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error(`Geen JSON in response: ${seqText2.slice(0, 200)}`)
    const emails = JSON.parse(jsonMatch[0])

    await supabase.from('leads').update({
      email1_subject: emails.email1.subject, email1_body: emails.email1.body,
      email2_subject: emails.email2.subject, email2_body: emails.email2.body,
      email3_subject: emails.email3.subject, email3_body: emails.email3.body,
      email4_subject: emails.email4.subject, email4_body: emails.email4.body,
      // Backwards compat — email_subject/body maps to email1
      email_subject: emails.email1.subject, email_body: emails.email1.body,
      updated_at: new Date().toISOString(),
    }).eq('id', id)

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

app.post('/send-email/:id', async (req, res) => {
  const { id } = req.params
  const { emailNumber = 1 } = req.body

  const { data: lead } = await supabase.from('leads').select('*').eq('id', id).single()
  if (!lead) return res.status(404).json({ error: 'Lead niet gevonden' })
  if (!lead.email) return res.status(400).json({ error: 'Geen e-mailadres' })

  try {
    await sendEmailForLead(lead, emailNumber as 1 | 2 | 3 | 4)
    res.json({ success: true })
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
    // email_sequence_index 1 → send email 3 (reminder 1)
    // email_sequence_index 3 → send email 4 (reminder 2)
    const nextEmail = lead.email_sequence_index === 1 ? 3 : lead.email_sequence_index === 3 ? 4 : null
    if (!nextEmail) {
      // Unknown state — stop to avoid loop
      await supabase.from('leads').update({ sequence_stopped: true, next_followup_at: null }).eq('id', lead.id)
      continue
    }

    const bodyKey = `email${nextEmail}_body`
    if (!lead[bodyKey] || !lead.email) {
      log('Followup', `${lead.company_name} — email ${nextEmail} body ontbreekt, overgeslagen`)
      await supabase.from('leads').update({ sequence_stopped: true, next_followup_at: null }).eq('id', lead.id)
      continue
    }

    try {
      await sendEmailForLead(lead, nextEmail as 1 | 2 | 3 | 4)
      log('Followup', `Herinnering ${nextEmail} verstuurd naar ${lead.company_name}`)
      await sleep(15_000) // 15s between sends
    } catch (e) {
      log('Followup', `Fout bij ${lead.company_name}: ${e}`)
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

process.on('uncaughtException', (err) => {
  log('Server', `Uncaught exception (server blijft draaien): ${err.message}`)
})
process.on('unhandledRejection', (reason) => {
  log('Server', `Unhandled rejection (server blijft draaien): ${reason}`)
})

const PORT = process.env.PORT ?? 3001
app.listen(PORT, () => log('Server', `Draait op poort ${PORT}`))
