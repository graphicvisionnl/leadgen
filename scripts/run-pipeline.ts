#!/usr/bin/env npx ts-node
/**
 * Graphic Vision — Lead Gen Pipeline (lokale runner)
 *
 * Gebruik:
 *   npx ts-node scripts/run-pipeline.ts --niche loodgieter --city Amsterdam --max 5
 *
 * Of via npm script:
 *   npm run pipeline -- --niche loodgieter --city Amsterdam --max 5
 *
 * Vereisten:
 *   - .env.local met alle credentials (zie .env.example)
 *   - npm install (inclusief puppeteer, niet puppeteer-core)
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import puppeteer from 'puppeteer'
import nodemailer from 'nodemailer'
import * as fs from 'fs'
import * as path from 'path'
import * as readline from 'readline'

// ─── Args ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
function getArg(name: string, fallback?: string): string {
  const idx = args.indexOf(`--${name}`)
  if (idx !== -1 && args[idx + 1]) return args[idx + 1]
  if (fallback !== undefined) return fallback
  throw new Error(`Missing required argument: --${name}`)
}

const NICHE   = getArg('niche', 'loodgieter')
const CITY    = getArg('city', 'Amsterdam')
const MAX     = parseInt(getArg('max', '10'))
const DRY_RUN = args.includes('--dry-run') // Skip deploy/mail

// ─── Clients ─────────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

function log(phase: string, msg: string) {
  console.log(`\x1b[36m[${phase}]\x1b[0m ${msg}`)
}
function ok(msg: string) {
  console.log(`\x1b[32m✓\x1b[0m ${msg}`)
}
function warn(msg: string) {
  console.log(`\x1b[33m⚠\x1b[0m ${msg}`)
}
function err(msg: string) {
  console.log(`\x1b[31m✗\x1b[0m ${msg}`)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeUrl(url: string): string {
  if (!url.startsWith('http')) return `https://${url}`
  return url
}

function isValidUrl(url: string): boolean {
  try { new URL(normalizeUrl(url)); return true } catch { return false }
}

function loadSkill(filename: string): string {
  try {
    return fs.readFileSync(path.join(process.cwd(), 'lib/skills', filename), 'utf-8')
  } catch { return '' }
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

// ─── Phase 1: Apify scrape ───────────────────────────────────────────────────

async function phase1(runId: string): Promise<number> {
  log('Phase 1', `Scraping "${NICHE}" in "${CITY}" (max ${MAX})…`)

  const token = process.env.APIFY_API_TOKEN!

  const startRes = await fetch(
    `https://api.apify.com/v2/acts/nwua9Gu5YrADL7ZDj/runs?token=${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        searchString: `${NICHE} ${CITY}`,
        maxCrawledPlaces: MAX,
        language: 'nl',
      }),
    }
  )

  if (!startRes.ok) throw new Error(`Apify start failed: ${await startRes.text()}`)
  const { data: { id: actorRunId } } = await startRes.json()
  log('Phase 1', `Apify run started: ${actorRunId}`)

  // Poll until done (no timeout here — local script can wait as long as needed)
  let status = 'RUNNING'
  let attempts = 0
  while (status === 'RUNNING') {
    await sleep(4000)
    const r = await fetch(`https://api.apify.com/v2/actor-runs/${actorRunId}?token=${token}`)
    status = (await r.json()).data.status
    attempts++
    process.stdout.write(`\r  Wachten op Apify… ${attempts * 4}s (status: ${status})  `)
  }
  console.log()

  if (status !== 'SUCCEEDED') throw new Error(`Apify run failed: ${status}`)
  ok(`Apify klaar na ${attempts * 4}s`)

  // Fetch results
  const resultsRes = await fetch(
    `https://api.apify.com/v2/actor-runs/${actorRunId}/dataset/items?token=${token}&limit=${MAX}`
  )
  const businesses = await resultsRes.json()
  log('Phase 1', `${businesses.length} bedrijven ontvangen`)

  // Deduplicatie
  const urls = businesses.filter((b: any) => b.website).map((b: any) => normalizeUrl(b.website))
  const { data: existing } = await supabase.from('leads').select('website_url').in('website_url', urls)
  const existingUrls = new Set((existing ?? []).map((e: any) => e.website_url))

  const toInsert = businesses
    .filter((b: any) => b.website && isValidUrl(b.website))
    .filter((b: any) => !existingUrls.has(normalizeUrl(b.website)))
    .map((b: any) => ({
      company_name: b.title,
      website_url: normalizeUrl(b.website),
      email: b.email ?? null,
      city: b.city ?? CITY,
      niche: NICHE,
      google_rating: b.totalScore ?? null,
      review_count: b.reviewsCount ?? null,
      status: b.email ? 'scraped' : 'no_email',
      pipeline_run_id: runId,
    }))

  if (!toInsert.length) { warn('Geen nieuwe leads (alles al in database)'); return 0 }

  const { data: inserted, error } = await supabase.from('leads').insert(toInsert).select('id')
  if (error) throw new Error(`Insert mislukt: ${error.message}`)

  ok(`${inserted?.length} nieuwe leads ingevoegd`)
  return inserted?.length ?? 0
}

// ─── Phase 2: Email scrape + screenshot + qualify ────────────────────────────

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
    const emails = html.match(/\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/g)
    if (emails) {
      const filtered = emails.filter(e =>
        !e.includes('sentry') && !e.includes('example') && !e.includes('noreply') &&
        !e.includes('@w3.org') && !e.includes('privacy') && !e.includes('@schema')
      )
      if (filtered.length) return filtered[0].toLowerCase()
    }
    // Try /contact
    const contactRes = await fetch(`${new URL(url).origin}/contact`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(5000),
    }).catch(() => null)
    if (contactRes?.ok) {
      const ch = await contactRes.text()
      const cm = ch.match(/mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i)
      if (cm) return cm[1].toLowerCase()
    }
  } catch {}
  return null
}

async function phase2(runId: string) {
  log('Phase 2', 'Email scrapen + kwalificeren…')

  const { data: leads } = await supabase
    .from('leads')
    .select('*')
    .in('status', ['scraped', 'no_email'])
    .eq('pipeline_run_id', runId)
    .not('website_url', 'is', null)

  if (!leads?.length) { warn('Geen leads om te kwalificeren'); return }
  log('Phase 2', `${leads.length} leads te verwerken`)

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })

  try {
    for (const lead of leads) {
      log('Phase 2', `${lead.company_name}`)

      // Email scrapen als nog niet bekend
      let email = lead.email
      if (!email) {
        email = await scrapeEmail(lead.website_url)
        if (email) {
          ok(`  Email gevonden: ${email}`)
          await supabase.from('leads').update({ email }).eq('id', lead.id)
        } else {
          warn(`  Geen email gevonden — disqualified`)
          await supabase.from('leads').update({
            status: 'disqualified',
            qualify_reason: 'Geen e-mailadres gevonden op website',
          }).eq('id', lead.id)
          continue
        }
      }

      // Screenshot
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
        ok(`  Screenshot gemaakt`)
      } catch (e) {
        warn(`  Screenshot mislukt: ${e}`)
        // Qualify without screenshot
      }

      // Upload screenshot to Supabase Storage
      let screenshotUrl = null
      if (screenshotBuffer) {
        const filename = `${lead.id}-${Date.now()}.jpg`
        const { error: upErr } = await supabase.storage
          .from('screenshots')
          .upload(filename, screenshotBuffer, { contentType: 'image/jpeg', upsert: true })
        if (!upErr) {
          screenshotUrl = supabase.storage.from('screenshots').getPublicUrl(filename).data.publicUrl
        }
      }

      // Claude kwalificatie
      try {
        const msgContent: any[] = []
        if (screenshotBase64) {
          msgContent.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: screenshotBase64 } })
        }
        msgContent.push({
          type: 'text',
          text: `Bedrijf: ${lead.company_name} (${lead.niche})\n\nBeoordeel of deze website een redesign nodig heeft. Antwoord ALLEEN in JSON:\n{"qualified":true,"score":8,"reason":"..."}`
        })

        const response = await claude.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 300,
          messages: [{ role: 'user', content: msgContent }],
        })

        const text = response.content[0].type === 'text' ? response.content[0].text : ''
        const clean = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
        const result = JSON.parse(clean)

        await supabase.from('leads').update({
          screenshot_url: screenshotUrl,
          status: result.qualified ? 'qualified' : 'disqualified',
          qualify_reason: `Score: ${result.score}/10 — ${result.reason}`,
          email,
          updated_at: new Date().toISOString(),
        }).eq('id', lead.id)

        ok(`  ${result.qualified ? 'QUALIFIED' : 'DISQUALIFIED'} (score ${result.score})`)
      } catch (e) {
        err(`  Claude fout: ${e}`)
        await supabase.from('leads').update({ status: 'error', qualify_reason: String(e) }).eq('id', lead.id)
      }

      await sleep(1500)
    }
  } finally {
    await browser.close()
  }
}

// ─── Phase 3: HTML redesign ──────────────────────────────────────────────────

async function phase3(runId: string) {
  log('Phase 3', 'HTML redesigns genereren…')

  const { data: leads } = await supabase
    .from('leads').select('*').eq('status', 'qualified').eq('pipeline_run_id', runId)

  if (!leads?.length) { warn('Geen gekwalificeerde leads'); return }
  log('Phase 3', `${leads.length} leads`)

  const tasteSkill = loadSkill('taste-skill.md')
  const redesignSkill = loadSkill('redesign-skill.md')

  for (const lead of leads) {
    log('Phase 3', `Genereren voor ${lead.company_name}…`)
    try {
      const ratingLine = lead.google_rating
        ? `- Google rating: ${lead.google_rating} sterren (${lead.review_count ?? 0} reviews)` : ''

      const response = await claude.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 8096,
        system: `You are a senior UI/UX engineer at a premium design agency.\n\n${tasteSkill}\n\n${redesignSkill}`,
        messages: [{
          role: 'user',
          content: `Genereer een premium single-file website redesign voor:\n\nBedrijfsnaam: ${lead.company_name}\nBranche: ${lead.niche}\nStad: ${lead.city}\nHuidige site: ${lead.website_url}\n${ratingLine}\n\nVolledig zelfstandig HTML bestand, alle CSS inline. Floating badge rechtsonder: "Concept: Graphic Vision". Secties: Hero, Diensten, Over ons, Contact.\n\nReturn ALLEEN de HTML startend met <!DOCTYPE html>.`,
        }],
      })

      const text = response.content[0].type === 'text' ? response.content[0].text : ''
      const htmlStart = text.indexOf('<!DOCTYPE html>')
      if (htmlStart === -1) throw new Error('Geen geldige HTML ontvangen')
      const html = text.substring(htmlStart)

      // Sla HTML op in Supabase Storage
      const filename = `${lead.id}-preview.html`
      const { error } = await supabase.storage
        .from('previews')
        .upload(filename, Buffer.from(html, 'utf-8'), { contentType: 'text/html', upsert: true })
      if (error) throw error

      await supabase.from('leads').update({ status: 'redesigned', updated_at: new Date().toISOString() }).eq('id', lead.id)
      ok(`  HTML opgeslagen (${Math.round(html.length / 1024)}KB)`)
    } catch (e) {
      err(`  Mislukt: ${e}`)
      await supabase.from('leads').update({ status: 'error', qualify_reason: `Redesign fout: ${e}` }).eq('id', lead.id)
    }
  }
}

// ─── Phase 4: Vercel deploy + mail ───────────────────────────────────────────

async function deployToVercel(companyName: string, html: string): Promise<string> {
  const token = process.env.VERCEL_API_TOKEN!
  const teamId = process.env.VERCEL_TEAM_ID
  const slug = companyName.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 40)
  const name = `preview-${slug}-${Date.now().toString(36)}`
  const teamParam = teamId ? `?teamId=${teamId}` : ''

  const res = await fetch(`https://api.vercel.com/v13/deployments${teamParam}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      files: [{ file: 'index.html', data: html, encoding: 'utf-8' }],
      projectSettings: { framework: null },
      target: 'production',
    }),
  })
  if (!res.ok) throw new Error(`Vercel deploy mislukt: ${await res.text()}`)
  const deployment = await res.json()

  // Poll until ready
  for (let i = 0; i < 20; i++) {
    await sleep(3000)
    const check = await fetch(`https://api.vercel.com/v13/deployments/${deployment.id}${teamParam}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const d = await check.json()
    if (d.readyState === 'READY') return `https://${d.url}`
    if (d.readyState === 'ERROR') throw new Error('Vercel deployment error')
  }
  throw new Error('Vercel deploy timeout')
}

async function phase4(runId: string) {
  log('Phase 4', 'Deployen + mails aanmaken…')

  const { data: leads } = await supabase
    .from('leads').select('*').eq('status', 'redesigned').eq('pipeline_run_id', runId)

  if (!leads?.length) { warn('Geen leads om te deployen'); return }

  const { data: settingsRows } = await supabase.from('settings').select('*')
  const settings = Object.fromEntries((settingsRows ?? []).map((s: any) => [s.key, s.value]))

  for (const lead of leads) {
    log('Phase 4', `Deployen: ${lead.company_name}`)
    try {
      // Haal HTML op
      const { data: htmlBlob } = await supabase.storage.from('previews').download(`${lead.id}-preview.html`)
      if (!htmlBlob) throw new Error('HTML niet gevonden in storage')
      const html = await htmlBlob.text()

      if (DRY_RUN) {
        ok(`  [DRY RUN] Zou deployen voor ${lead.company_name}`)
        continue
      }

      // Deploy
      const previewUrl = await deployToVercel(lead.company_name!, html)
      ok(`  Live: ${previewUrl}`)

      // Preview screenshot
      let previewScreenshotUrl = null
      try {
        const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
        const page = await browser.newPage()
        await page.setViewport({ width: 1280, height: 900 })
        await page.goto(previewUrl, { waitUntil: 'networkidle2', timeout: 20000 })
        await sleep(1500)
        const shot = await page.screenshot({ type: 'jpeg', quality: 85 })
        await browser.close()
        const buf = Buffer.from(shot)
        const fn = `${lead.id}-preview-screenshot.jpg`
        await supabase.storage.from('previews').upload(fn, buf, { contentType: 'image/jpeg', upsert: true })
        previewScreenshotUrl = supabase.storage.from('previews').getPublicUrl(fn).data.publicUrl
      } catch (e) { warn(`  Preview screenshot mislukt: ${e}`) }

      // Mail aanmaken
      const firstName = lead.email!.split('@')[0].split(/[._-]/)[0]
      const capitalFirst = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase()
      const signature = settings.email_signature ?? 'Met vriendelijke groet,\nEzra\nGraphic Vision'

      const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST!,
        port: parseInt(process.env.SMTP_PORT ?? '465'),
        secure: process.env.SMTP_PORT !== '587',
        auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
      })

      // Sla mail op als concept (niet versturen) — update DB zodat dashboard "Verstuur mail" knop toont
      await supabase.from('leads').update({
        status: 'deployed',
        preview_url: previewUrl,
        preview_screenshot_url: previewScreenshotUrl,
        updated_at: new Date().toISOString(),
      }).eq('id', lead.id)

      ok(`  Klaar — preview: ${previewUrl}`)
      log('Phase 4', `  Mail klaar om te versturen via dashboard`)
    } catch (e) {
      err(`  Mislukt: ${e}`)
      await supabase.from('leads').update({ status: 'error', qualify_reason: `Deploy fout: ${e}` }).eq('id', lead.id)
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n\x1b[1mGraphic Vision — Lead Gen Pipeline\x1b[0m')
  console.log(`Niche: ${NICHE} | Stad: ${CITY} | Max: ${MAX}${DRY_RUN ? ' | DRY RUN' : ''}\n`)

  // Pipeline run aanmaken
  const { data: run } = await supabase
    .from('pipeline_runs')
    .insert({ niche: NICHE, city: CITY, status: 'running' })
    .select().single()

  const runId = run!.id
  log('Pipeline', `Run ID: ${runId}`)

  try {
    await phase1(runId)
    await phase2(runId)
    await phase3(runId)
    await phase4(runId)

    await supabase.from('pipeline_runs').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    }).eq('id', runId)

    console.log('\n\x1b[32m✓ Pipeline voltooid!\x1b[0m')
    console.log('Open het dashboard om de leads te bekijken en mails te versturen.\n')
  } catch (e) {
    err(`Pipeline gefaald: ${e}`)
    await supabase.from('pipeline_runs').update({ status: 'failed', error: String(e) }).eq('id', runId)
    process.exit(1)
  }
}

main()
