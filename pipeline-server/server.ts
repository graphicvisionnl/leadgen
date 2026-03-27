import 'dotenv/config'
import express from 'express'
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer'
import nodemailer from 'nodemailer'
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

// ─── kie.ai Haiku helper (qualify + email — fast & cheap) ────────────────────
async function callClaude(params: {
  model?: string
  system?: string
  messages: any[]
  max_tokens: number
}): Promise<{ content: any[]; stop_reason: string; usage: any }> {
  const model = params.model ?? 'claude-haiku-4-5'
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
      // kie.ai wraps errors in 200 responses with a code field
      if (data.code && data.code !== 200) throw new Error(`kie.ai error: ${JSON.stringify(data)}`)
      return data
    } catch (e) {
      if (attempt === 3) throw e
      log('Retry', `callClaude attempt ${attempt} mislukt: ${e} — wacht 15s`)
      await sleep(15_000)
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
      log('Retry', `callKieStreaming attempt ${attempt} mislukt: ${e} — wacht 20s`)
      await sleep(20_000)
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

// ─── Phase 2: Email scrape + text-based qualify (no browser) ─────────────────
async function scrapeEmailAndText(url: string): Promise<{ email: string | null; text: string }> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)', 'Accept-Language': 'nl,en;q=0.9' },
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    })
    if (!res.ok) return { email: null, text: '' }
    const html = await res.text()

    // Extract email
    const mailto = html.match(/mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i)
    const emailsInPage = (html.match(/\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/g) ?? [])
      .filter(e => !e.includes('sentry') && !e.includes('example') && !e.includes('noreply') && !e.includes('@w3.org'))
    const email = mailto?.[1]?.toLowerCase() ?? emailsInPage[0]?.toLowerCase() ?? null

    // Extract clean text
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4000)

    return { email, text }
  } catch {
    return { email: null, text: '' }
  }
}

async function phase2SingleLead(lead: any): Promise<boolean> {
  log('Phase 2', lead.company_name)

  const { email: scrapedEmail, text: websiteText } = await scrapeEmailAndText(lead.website_url)
  const email = lead.email ?? scrapedEmail
  if (scrapedEmail && !lead.email) {
    await supabase.from('leads').update({ email: scrapedEmail }).eq('id', lead.id)
  }

  const prompt = `Bedrijf: ${lead.company_name} (${lead.niche}, ${lead.city})
Website: ${lead.website_url}
Google rating: ${lead.google_rating ?? 'onbekend'}/5 (${lead.review_count ?? 0} reviews)

Website tekst:
${websiteText || '(niet beschikbaar)'}

Beoordeel deze website als potentiële klant voor een webdesign bureau.
Kwalificeer als de website verouderd, amateuristisch of slecht converterende is.
Disqualificeer als de website al modern en professioneel is.

Antwoord ALLEEN met dit JSON (geen markdown, geen uitleg):
{"qualified":true,"score":7,"reason":"Korte reden in het Nederlands"}`

  const response = await callClaude({
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  })
  const textBlock = response.content?.find((b: any) => b.type === 'text')
  if (!textBlock) throw new Error(`Geen text in response: ${JSON.stringify(response).slice(0, 200)}`)
  const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error(`Geen JSON in response: ${textBlock.text.slice(0, 200)}`)
  const result = JSON.parse(jsonMatch[0])

  await supabase.from('leads').update({
    status: result.qualified ? 'qualified' : 'disqualified',
    qualify_reason: `Score: ${result.score}/10 — ${result.reason}`,
    email,
    updated_at: new Date().toISOString(),
  }).eq('id', lead.id)

  log('Phase 2', `${result.qualified ? 'QUALIFIED' : 'DISQUALIFIED'} (${result.score}/10)`)
  return result.qualified
}

async function phase2(runId: string) {
  log('Phase 2', 'Email scrapen + kwalificeren')
  const { data: leads } = await supabase.from('leads').select('*')
    .in('status', ['scraped', 'no_email']).not('website_url', 'is', null)

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

      const htmlModel = process.env.HTML_MODEL ?? 'claude-opus-4-6'
      const response = await callKieStreaming({
        model: htmlModel, max_tokens: 32000, system: phase3System(),
        messages: [{ role: 'user', content: prompt }],
      })

      const text = response.content[0].type === 'text' ? response.content[0].text : ''
      log('Phase 3', `Stop reason: ${response.stop_reason}, tokens: ${response.usage?.output_tokens}`)
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
  const { niche, city, maxLeads = 10 } = req.body
  if (!niche || !city) return res.status(400).json({ error: 'niche en city verplicht' })

  const { data: run } = await supabase.from('pipeline_runs')
    .insert({ niche, city, status: 'running' }).select().single()

  res.json({ success: true, runId: run!.id })

  // Run pipeline in background
  ;(async () => {
    try {
      await phase1(run!.id, niche, city, maxLeads)
      await phase2(run!.id)
      await phase3(run!.id)
      await phase4(run!.id)
      log('Pipeline', `Run ${run!.id} voltooid`)
    } catch (e) {
      log('Pipeline', `Run ${run!.id} mislukt: ${e}`)
      await supabase.from('pipeline_runs').update({ status: 'failed', error: String(e) }).eq('id', run!.id)
    }
  })()
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

    const prompt = `Schrijf een overtuigende Nederlandse verkoop-e-mail namens Ezra van Graphic Vision.

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

    const response = await callClaude({
      max_tokens: 700,
      messages: [{ role: 'user', content: prompt }],
    })

    const body = response.content[0].type === 'text' ? response.content[0].text.trim() : ''

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
  const { subject, body, emailTo } = req.body

  const { data: lead } = await supabase.from('leads').select('*').eq('id', id).single()
  if (!lead) return res.status(404).json({ error: 'Lead niet gevonden' })
  if (!lead.preview_url) return res.status(400).json({ error: 'Nog geen preview URL' })

  const recipientEmail: string = emailTo || lead.email
  if (!recipientEmail) return res.status(400).json({ error: 'Geen e-mailadres opgegeven' })

  // Fall back to stored draft if not provided in request
  const finalSubject: string | undefined = subject || lead.email_subject || undefined
  const finalBody: string = body || lead.email_body || ''

  const { data: settingsRows } = await supabase.from('settings').select('*')
  const settings = Object.fromEntries(
    (settingsRows ?? []).map((s: { key: string; value: string }) => [s.key, s.value])
  )

  try {
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST!,
      port: parseInt(process.env.SMTP_PORT ?? '465'),
      secure: process.env.SMTP_PORT !== '587',
      auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
    })

    const previewUrl: string = lead.preview_url
    const plainText: string = finalBody

    const firstName = recipientEmail.split('@')[0].split(/[._-]/)[0]
    const name = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase()
    const defaultSubject = `Snel iets voor je gemaakt, ${name}`

    const ctaButton = `
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:8px 0 24px">
        <tr>
          <td>
            <a href="${previewUrl}" target="_blank"
               style="display:inline-block;background:#FF794F;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 32px;border-radius:8px;letter-spacing:0.3px">
              Bekijk jouw nieuwe website →
            </a>
          </td>
        </tr>
      </table>`

    // Convert plain text to HTML — replace any paragraph containing the URL with the CTA button
    const cleanBody = plainText
      .split('\n\n')
      .filter(p => p.trim())
      .map(para => {
        if (para.includes(previewUrl)) return ctaButton
        const escaped = para
          .split('\n')
          .map((line: string) => line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
          .join('<br>')
        return `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.7;color:#1a1a1a">${escaped}</p>`
      })
      .join('')

    const html = `<!DOCTYPE html>
<html lang="nl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f4f4f4;padding:32px 0">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">

          <!-- Header -->
          <tr>
            <td style="background:#0f0f0f;padding:28px 40px;text-align:left">
              <img src="https://graphicvision.nl/wp-content/uploads/2026/03/graphic-vision-logo-orange.png"
                   alt="Graphic Vision" width="160" style="display:block;height:auto;max-height:40px;object-fit:contain">
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px">
              ${cleanBody}
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 40px">
              <hr style="border:none;border-top:1px solid #e8e8e8;margin:0">
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px 32px;background:#fafafa">
              <table cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="padding-right:16px;vertical-align:middle">
                    <img src="https://graphicvision.nl/wp-content/uploads/2026/03/graphic-vision-logo-orange.png"
                         alt="Graphic Vision" width="100" style="display:block;height:auto;object-fit:contain;opacity:0.7">
                  </td>
                  <td style="border-left:2px solid #e8e8e8;padding-left:16px;vertical-align:middle">
                    <p style="margin:0;font-size:13px;color:#888;line-height:1.6">
                      Ezra — Graphic Vision<br>
                      <a href="https://graphicvision.nl" style="color:#FF794F;text-decoration:none">graphicvision.nl</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>

        <!-- Unsubscribe note -->
        <p style="margin:16px 0 0;font-size:11px;color:#aaa;text-align:center">
          Je ontvangt deze e-mail omdat wij denken dat we je kunnen helpen.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`

    await transport.sendMail({
      from: `Ezra — Graphic Vision <${process.env.SMTP_USER}>`,
      to: recipientEmail,
      bcc: 'graphicvisionnl@gmail.com',
      subject: finalSubject ?? defaultSubject,
      html,
      text: plainText,
    })

    await supabase.from('leads').update({ status: 'sent', updated_at: new Date().toISOString() }).eq('id', id)
    log('Mail', `Verzonden naar ${recipientEmail}`)
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

const PORT = process.env.PORT ?? 3001
app.listen(PORT, () => log('Server', `Draait op poort ${PORT}`))
