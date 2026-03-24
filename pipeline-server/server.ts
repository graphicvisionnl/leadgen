import 'dotenv/config'
import express from 'express'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
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
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// ─── Helpers ──────────────────────────────────────────────────────────────────
function log(phase: string, msg: string) {
  console.log(`[${new Date().toISOString()}] [${phase}] ${msg}`)
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
    return fs.readFileSync(path.join(__dirname, '../lib/skills', filename), 'utf-8')
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
    `https://api.apify.com/v2/actor-runs/${actorRunId}/dataset/items?token=${token}&limit=${maxLeads}`
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

// ─── Phase 2: Email + screenshot + qualify ───────────────────────────────────
async function scrapeEmail(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const html = await res.text()
    const mailto = html.match(/mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i)
    if (mailto) return mailto[1].toLowerCase()
    const emails = (html.match(/\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/g) ?? [])
      .filter(e => !e.includes('sentry') && !e.includes('example') && !e.includes('noreply') && !e.includes('@w3.org'))
    if (emails.length) return emails[0].toLowerCase()
    const contact = await fetch(`${new URL(url).origin}/contact`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000),
    }).catch(() => null)
    if (contact?.ok) {
      const ch = await contact.text()
      const cm = ch.match(/mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i)
      if (cm) return cm[1].toLowerCase()
    }
  } catch {}
  return null
}

async function phase2(runId: string) {
  log('Phase 2', 'Email scrapen + kwalificeren')
  const { data: leads } = await supabase.from('leads').select('*')
    .in('status', ['scraped', 'no_email']).eq('pipeline_run_id', runId).not('website_url', 'is', null)

  if (!leads?.length) { log('Phase 2', 'Geen leads'); return }
  log('Phase 2', `${leads.length} leads`)

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
  let qualified = 0

  try {
    for (const lead of leads) {
      log('Phase 2', lead.company_name)
      let email = lead.email
      if (!email) {
        email = await scrapeEmail(lead.website_url)
        if (!email) {
          await supabase.from('leads').update({ status: 'disqualified', qualify_reason: 'Geen e-mail gevonden' }).eq('id', lead.id)
          continue
        }
        await supabase.from('leads').update({ email }).eq('id', lead.id)
      }

      let screenshotBase64 = ''
      let screenshotBuffer: Buffer | null = null
      try {
        const page = await browser.newPage()
        await page.setViewport({ width: 1280, height: 900 })
        await page.goto(lead.website_url, { waitUntil: 'networkidle2', timeout: 20000 })
        await sleep(1000)
        const shot = await page.screenshot({ type: 'jpeg', quality: 80 })
        screenshotBuffer = Buffer.from(shot)
        screenshotBase64 = screenshotBuffer.toString('base64')
        await page.close()
      } catch (e) { log('Phase 2', `Screenshot mislukt: ${e}`) }

      let screenshotUrl = null
      if (screenshotBuffer) {
        const fn = `${lead.id}-${Date.now()}.jpg`
        await supabase.storage.from('screenshots').upload(fn, screenshotBuffer, { contentType: 'image/jpeg', upsert: true })
        screenshotUrl = supabase.storage.from('screenshots').getPublicUrl(fn).data.publicUrl
      }

      try {
        const msgContent: any[] = []
        if (screenshotBase64) {
          msgContent.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: screenshotBase64 } })
        }
        msgContent.push({ type: 'text', text: `Bedrijf: ${lead.company_name} (${lead.niche})\nBeoordeel of deze website een redesign nodig heeft.\nAntwoord ALLEEN in JSON: {"qualified":true,"score":8,"reason":"..."}` })

        const response = await claude.messages.create({
          model: 'claude-sonnet-4-6', max_tokens: 300,
          messages: [{ role: 'user', content: msgContent }],
        })
        const text = response.content[0].type === 'text' ? response.content[0].text : ''
        const result = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim())

        await supabase.from('leads').update({
          screenshot_url: screenshotUrl,
          status: result.qualified ? 'qualified' : 'disqualified',
          qualify_reason: `Score: ${result.score}/10 — ${result.reason}`,
          email, updated_at: new Date().toISOString(),
        }).eq('id', lead.id)

        if (result.qualified) qualified++
        log('Phase 2', `${result.qualified ? 'QUALIFIED' : 'DISQUALIFIED'} (${result.score}/10)`)
      } catch (e) {
        log('Phase 2', `Claude fout: ${e}`)
        await supabase.from('leads').update({ status: 'error', qualify_reason: String(e) }).eq('id', lead.id)
      }
      await sleep(1500)
    }
  } finally { await browser.close() }

  await supabase.from('pipeline_runs').update({ qualified_count: qualified }).eq('id', runId)
}

// ─── Phase 3: HTML redesign ───────────────────────────────────────────────────
async function phase3(runId: string) {
  log('Phase 3', 'HTML redesigns genereren')
  const { data: leads } = await supabase.from('leads').select('*').eq('status', 'qualified').eq('pipeline_run_id', runId)
  if (!leads?.length) { log('Phase 3', 'Geen gekwalificeerde leads'); return }

  const system = `You are a senior UI/UX engineer at a premium design agency.\n\n${loadSkill('taste-skill.md')}\n\n${loadSkill('redesign-skill.md')}`

  for (const lead of leads) {
    log('Phase 3', `Genereren: ${lead.company_name}`)
    try {
      const response = await claude.messages.create({
        model: 'claude-sonnet-4-6', max_tokens: 8096, system,
        messages: [{
          role: 'user',
          content: `Genereer een premium single-file website redesign voor:\n\nBedrijfsnaam: ${lead.company_name}\nBranche: ${lead.niche}\nStad: ${lead.city}\nHuidige site: ${lead.website_url}${lead.google_rating ? `\nGoogle rating: ${lead.google_rating} sterren (${lead.review_count ?? 0} reviews)` : ''}\n\nVolledig zelfstandig HTML, alle CSS inline. Floating badge rechtsonder: "Concept: Graphic Vision". Secties: Hero, Diensten, Over ons, Contact.\n\nReturn ALLEEN HTML startend met <!DOCTYPE html>.`,
        }],
      })
      const text = response.content[0].type === 'text' ? response.content[0].text : ''
      const html = text.substring(text.indexOf('<!DOCTYPE html>'))
      if (!html.startsWith('<!DOCTYPE')) throw new Error('Geen geldige HTML')

      const fn = `${lead.id}-preview.html`
      await supabase.storage.from('previews').upload(fn, Buffer.from(html, 'utf-8'), { contentType: 'text/html', upsert: true })
      await supabase.from('leads').update({ status: 'redesigned', updated_at: new Date().toISOString() }).eq('id', lead.id)
      log('Phase 3', `Klaar (${Math.round(html.length / 1024)}KB)`)
    } catch (e) {
      log('Phase 3', `Fout: ${e}`)
      await supabase.from('leads').update({ status: 'error', qualify_reason: `Redesign: ${e}` }).eq('id', lead.id)
    }
  }
}

// ─── Phase 4: Vercel deploy ───────────────────────────────────────────────────
async function deployToVercel(name: string, html: string): Promise<string> {
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
  const { id } = await res.json()

  for (let i = 0; i < 20; i++) {
    await sleep(3000)
    const check = await fetch(`https://api.vercel.com/v13/deployments/${id}${teamParam}`, { headers: { Authorization: `Bearer ${token}` } })
    const d = await check.json()
    if (d.readyState === 'READY') return `https://${d.url}`
    if (d.readyState === 'ERROR') throw new Error('Vercel deployment error')
  }
  throw new Error('Vercel deploy timeout')
}

async function phase4(runId: string) {
  log('Phase 4', 'Deployen naar Vercel')
  const { data: leads } = await supabase.from('leads').select('*').eq('status', 'redesigned').eq('pipeline_run_id', runId)
  if (!leads?.length) { log('Phase 4', 'Geen leads'); return }

  let deployed = 0
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })

  try {
    for (const lead of leads) {
      log('Phase 4', `Deploy: ${lead.company_name}`)
      try {
        const { data: blob } = await supabase.storage.from('previews').download(`${lead.id}-preview.html`)
        if (!blob) throw new Error('HTML niet gevonden')
        const html = await blob.text()

        const previewUrl = await deployToVercel(lead.company_name!, html)
        log('Phase 4', `Live: ${previewUrl}`)

        // Preview screenshot
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

app.get('/status/:runId', async (req, res) => {
  const { data } = await supabase.from('pipeline_runs').select('*').eq('id', req.params.runId).single()
  res.json(data)
})

const PORT = process.env.PORT ?? 3001
app.listen(PORT, () => log('Server', `Draait op poort ${PORT}`))
