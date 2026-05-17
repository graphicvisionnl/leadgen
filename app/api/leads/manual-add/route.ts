import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { getFakeEmailReason } from '@/lib/email-quality'

export const dynamic = 'force-dynamic'

type PageSnapshot = {
  url: string
  html: string
  text: string
}

const CONTACT_PATHS = [
  '/contact',
  '/contact/',
  '/contact.html',
  '/contact-us',
  '/over-ons',
  '/overons',
  '/about',
  '/about-us',
]

const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'hotmail.com',
  'hotmail.nl',
  'outlook.com',
  'outlook.nl',
  'live.nl',
  'icloud.com',
  'yahoo.com',
  'ziggo.nl',
  'kpnmail.nl',
  'planet.nl',
])

function cleanInputUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('Website URL is verplicht')
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

function normalizeWebsiteUrl(input: string): string {
  const parsed = new URL(cleanInputUrl(input))
  parsed.hash = ''
  parsed.search = ''
  if (parsed.pathname === '/') parsed.pathname = ''
  return parsed.toString().replace(/\/$/, '')
}

function rootDomain(hostname: string): string {
  const parts = hostname.toLowerCase().replace(/^www\./, '').split('.').filter(Boolean)
  if (parts.length <= 2) return parts.join('.')
  return parts.slice(-2).join('.')
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeEmail(email: string): string {
  return email
    .replace(/^mailto:/i, '')
    .split('?')[0]
    .trim()
    .toLowerCase()
}

function isUsableEmail(email: string, websiteUrl: string): boolean {
  const normalized = decodeEmail(email)
  const fakeReason = getFakeEmailReason(normalized)
  if (fakeReason) return false
  if (/\.(png|jpe?g|gif|webp|svg|css|js|html?)$/i.test(normalized)) return false

  const domain = normalized.split('@')[1]?.replace(/^www\./, '')
  if (!domain) return false
  if (FREE_EMAIL_DOMAINS.has(domain)) return true

  const leadRoot = rootDomain(new URL(websiteUrl).hostname)
  return rootDomain(domain) === leadRoot
}

function extractEmails(html: string, websiteUrl: string): string[] {
  const rawEmails = [
    ...Array.from(html.matchAll(/mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi), match => match[1]),
    ...(html.match(/\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g) ?? []),
  ]
  const seen = new Set<string>()
  return rawEmails
    .map(decodeEmail)
    .filter(email => {
      if (seen.has(email)) return false
      seen.add(email)
      return isUsableEmail(email, websiteUrl)
    })
}

function discoverContactUrls(home: PageSnapshot, websiteUrl: string): string[] {
  const base = new URL(websiteUrl)
  const hrefs = Array.from(home.html.matchAll(/href=["']([^"']+)["']/gi), match => match[1])
  const discovered = hrefs
    .filter(href => /contact|over-ons|overons|about/i.test(href))
    .map(href => {
      try {
        const url = new URL(href, base)
        return rootDomain(url.hostname) === rootDomain(base.hostname) ? url.toString() : null
      } catch {
        return null
      }
    })
    .filter((url): url is string => Boolean(url))

  const fallback = CONTACT_PATHS.map(path => new URL(path, base.origin).toString())
  return Array.from(new Set([...discovered, ...fallback])).slice(0, 8)
}

function extractMeta(html: string, names: string[]): string | null {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const propFirst = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i')
    const contentFirst = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i')
    const match = html.match(propFirst) ?? html.match(contentFirst)
    if (match?.[1]) return match[1].trim()
  }
  return null
}

function titleCaseDomain(websiteUrl: string): string {
  const host = new URL(websiteUrl).hostname.replace(/^www\./, '').split('.')[0]
  return host
    .split(/[-_]/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function deriveCompanyName(html: string, websiteUrl: string): string {
  const metaName = extractMeta(html, ['og:site_name', 'application-name'])
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim()
  const raw = metaName || title || titleCaseDomain(websiteUrl)
  return raw
    .replace(/\s*[|–—-]\s*(Home|Welkom|Contact|Offerte|Homepage).*$/i, '')
    .replace(/\s*[|–—-]\s*.*$/i, '')
    .trim()
    .slice(0, 120) || titleCaseDomain(websiteUrl)
}

function detectPainpoint(pages: PageSnapshot[]): string {
  const html = pages.map(page => page.html).join('\n')
  const text = pages.map(page => page.text).join(' ')
  const wordCount = text.split(/\s+/).filter(Boolean).length
  const ctaMatches = text.match(/offerte|afspraak|bel ons|neem contact|contact opnemen|aanvragen|plan|boek|vrijblijvend/gi) ?? []
  const trustMatches = text.match(/review|ervaring|project|portfolio|keurmerk|garantie|certificaat|klant/gi) ?? []

  if (/cookie/i.test(text) && ctaMatches.length === 0) {
    return 'een cookiemelding en weinig duidelijke vervolgstappen nemen veel aandacht weg van de aanvraag'
  }
  if (wordCount < 180) {
    return 'de website bevat vrij weinig concrete uitleg, waardoor bezoekers weinig houvast krijgen om contact op te nemen'
  }
  if (ctaMatches.length < 2) {
    return 'de website stuurt bezoekers nog niet duidelijk genoeg naar een volgende stap zoals bellen, offerte aanvragen of een afspraak maken'
  }
  if (trustMatches.length < 2) {
    return 'er wordt nog weinig vertrouwen opgebouwd met bewijs zoals projecten, reviews of garanties'
  }
  if ((html.match(/href=/gi) ?? []).length < 8) {
    return 'de structuur voelt beperkt, waardoor belangrijke informatie waarschijnlijk lastig te vinden is'
  }
  return 'de website kan sterker sturen op vertrouwen, duidelijkheid en meer aanvragen'
}

function inferCity(text: string): string | null {
  const match = text.match(/\b(Amsterdam|Rotterdam|Utrecht|Den Haag|Eindhoven|Groningen|Tilburg|Almere|Breda|Nijmegen|Apeldoorn|Haarlem|Arnhem|Amersfoort|Zwolle|Leiden|Maastricht|Delft|Dordrecht|Leeuwarden)\b/i)
  return match ? match[1] : null
}

function inferNiche(text: string): string | null {
  const haystack = text.toLowerCase()
  const options = [
    'slotenmaker',
    'schoonmaakbedrijf',
    'schilder',
    'dakdekker',
    'hovenier',
    'loodgieter',
    'elektricien',
    'timmerbedrijf',
    'installatiebedrijf',
    'rioolservice',
  ]
  return options.find(option => haystack.includes(option)) ?? null
}

function buildSequence(input: {
  companyName: string
  niche: string | null
  city: string | null
  painpoint: string
}) {
  const nicheText = input.niche ? input.niche : 'jullie bedrijf'
  const cityText = input.city ? ` in ${input.city}` : ''
  const subject = 'Snelle vraag over jullie website'
  const body = [
    'Goedemiddag,',
    '',
    `Ik kwam jullie tegen toen ik zocht naar ${nicheText}${cityText}.`,
    '',
    `Wat me opviel: ${input.painpoint}.`,
    '',
    'Daarom heb ik alvast gratis een redesign/concept voor jullie website gemaakt.',
    'Geen verplichtingen, puur om te laten zien hoe jullie site duidelijker en sterker kan overkomen.',
    '',
    'Zijn jullie geïnteresseerd om deze te zien?',
    '',
    '– Graphic Vision',
  ].join('\n')

  return {
    email1_subject: subject,
    email1_body: body,
    email2_subject: 'Re: Snelle vraag over jullie website',
    email2_body: [
      'Goedemiddag,',
      '',
      'Kleine follow-up op mijn vorige mail.',
      '',
      'Ik heb het gratis redesign/concept nog klaarstaan. Zal ik het even toesturen?',
      '',
      '– Graphic Vision',
    ].join('\n'),
    email3_subject: 'Laatste keer over het redesign',
    email3_body: [
      'Goedemiddag,',
      '',
      'Ik wilde nog één keer checken of jullie het gratis redesign/concept willen zien.',
      '',
      'Als het niet interessant is, sluit ik het hierbij netjes af.',
      '',
      '– Graphic Vision',
    ].join('\n'),
    email4_subject: 'Ik sluit het concept',
    email4_body: [
      'Goedemiddag,',
      '',
      'Ik sluit het gratis concept voor jullie af.',
      '',
      'Mocht het later alsnog handig zijn, dan hoor ik het graag.',
      '',
      '– Graphic Vision',
    ].join('\n'),
  }
}

async function fetchPage(url: string): Promise<PageSnapshot | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; GraphicVisionLeadBot/1.0)',
        accept: 'text/html,application/xhtml+xml',
      },
      cache: 'no-store',
    })
    const contentType = res.headers.get('content-type') ?? ''
    if (!res.ok || !contentType.includes('text/html')) return null
    const html = await res.text()
    return { url: res.url || url, html, text: stripHtml(html) }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

async function inspectWebsite(websiteUrl: string) {
  let inspectedWebsiteUrl = websiteUrl
  let home = await fetchPage(websiteUrl)
  if (!home && new URL(websiteUrl).protocol === 'https:') {
    const httpUrl = websiteUrl.replace(/^https:/i, 'http:')
    home = await fetchPage(httpUrl)
    if (home) inspectedWebsiteUrl = normalizeWebsiteUrl(httpUrl)
  }
  if (!home) throw new Error('Website kon niet worden opgehaald')

  const contactUrls = discoverContactUrls(home, inspectedWebsiteUrl)
  const contactPages = (await Promise.all(contactUrls.map(fetchPage))).filter((page): page is PageSnapshot => Boolean(page))
  const pages = [home, ...contactPages]
  const allText = pages.map(page => page.text).join(' ')
  const email = pages.flatMap(page => extractEmails(page.html, inspectedWebsiteUrl))[0] ?? null

  return {
    websiteUrl: inspectedWebsiteUrl,
    pages,
    email,
    companyName: deriveCompanyName(home.html, inspectedWebsiteUrl),
    city: inferCity(allText),
    niche: inferNiche(allText),
    painpoint: detectPainpoint(pages),
  }
}

async function sendFirstEmail(leadId: string) {
  const pipelineUrl = process.env.PIPELINE_SERVER_URL
  const pipelineSecret = process.env.PIPELINE_SECRET
  if (!pipelineUrl || !pipelineSecret) {
    return { sent: false, error: 'Pipeline server niet geconfigureerd' }
  }

  const res = await fetch(`${pipelineUrl}/send-email/${leadId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-pipeline-secret': pipelineSecret },
    body: JSON.stringify({ emailNumber: 1 }),
  }).catch(() => null)

  if (!res) return { sent: false, error: 'Pipeline fout' }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) return { sent: false, error: data?.error ?? 'Pipeline fout' }
  return { sent: true, data }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const websiteUrl = normalizeWebsiteUrl(String(body.websiteUrl ?? body.url ?? ''))
    const sendNow = body.sendNow !== false

    const inspection = await inspectWebsite(websiteUrl)
    const storedWebsiteUrl = inspection.websiteUrl
    const city = String(body.city ?? '').trim() || inspection.city
    const niche = String(body.niche ?? '').trim() || inspection.niche
    const companyName = String(body.companyName ?? '').trim() || inspection.companyName
    const sequence = buildSequence({ companyName, niche, city, painpoint: inspection.painpoint })
    const now = new Date().toISOString()

    const supabase = createServerSupabaseClient()
    const { data: existing } = await supabase
      .from('leads')
      .select('id,email,email1_sent_at,status')
      .in('website_url', Array.from(new Set([websiteUrl, storedWebsiteUrl])))
      .limit(1)
      .maybeSingle()

    const payload = {
      company_name: companyName,
      website_url: storedWebsiteUrl,
      email: inspection.email,
      city,
      niche,
      status: 'qualified',
      qualify_reason: `Handmatig toegevoegd. Website bekeken: ${inspection.painpoint}`,
      lead_score: 85,
      hot_lead: true,
      score_breakdown: {
        website_exists: true,
        email_found: Boolean(inspection.email),
        phone_found: /\b(?:\+31|0)\s?[1-9][0-9\s-]{7,}\b/.test(inspection.pages.map(page => page.text).join(' ')),
        mobile_friendly: true,
        has_cta: /offerte|afspraak|bel ons|neem contact|contact opnemen|aanvragen/i.test(inspection.pages.map(page => page.text).join(' ')),
        outdated_feel: false,
        internal_link_count: (inspection.pages[0].html.match(/href=/gi) ?? []).length,
      },
      crm_status: 'not_contacted',
      sequence_stopped: false,
      email_sequence_index: 0,
      next_followup_at: null,
      email_subject: sequence.email1_subject,
      email_body: sequence.email1_body,
      ...sequence,
      updated_at: now,
    }

    const query = existing?.id
      ? supabase.from('leads').update(payload).eq('id', existing.id).select('*').single()
      : supabase.from('leads').insert({ ...payload, created_at: now }).select('*').single()

    const { data: lead, error } = await query
    if (error || !lead) {
      return NextResponse.json({ error: error?.message ?? 'Lead kon niet worden opgeslagen' }, { status: 500 })
    }

    const sendResult = inspection.email && sendNow && !lead.email1_sent_at
      ? await sendFirstEmail(lead.id)
      : { sent: false, error: inspection.email ? null : 'Geen e-mailadres gevonden' }

    return NextResponse.json({
      lead,
      email: inspection.email,
      sent: sendResult.sent,
      sendError: sendResult.error ?? null,
      existingLeadUpdated: Boolean(existing?.id),
      inspectedPages: inspection.pages.map(page => page.url),
      painpoint: inspection.painpoint,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
