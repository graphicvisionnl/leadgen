import { createServerSupabaseClient } from '@/lib/supabase'
import { ApifyBusinessResult } from '@/types'

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
  try {
    const u = new URL(normalizeUrl(url))
    return u.hostname.includes('.')
  } catch {
    return false
  }
}

export async function runScrapePhase(
  runId: string,
  niche: string,
  city: string,
  maxLeads: number = 30
): Promise<number> {
  const supabase = createServerSupabaseClient()
  const token = process.env.APIFY_API_TOKEN!

  // Start Apify actor run
  // Actor: nwua9Gu5YrADL7ZDj — Google Maps Email Extractor (lukaskrivka)
  const startRes = await fetch(
    `https://api.apify.com/v2/acts/nwua9Gu5YrADL7ZDj/runs?token=${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        searchString: `${niche} ${city}`,
        maxCrawledPlaces: maxLeads,
        language: 'nl',
      }),
    }
  )

  if (!startRes.ok) {
    const err = await startRes.text()
    throw new Error(`Apify actor start failed: ${err}`)
  }

  const startData = await startRes.json()
  const actorRunId: string = startData.data.id

  console.log(`[Phase 1] Apify run started: ${actorRunId}`)

  // Update pipeline run with Apify run ID for webhook matching
  await supabase
    .from('pipeline_runs')
    .update({ apify_run_id: actorRunId } as never)
    .eq('id', runId)

  // Poll for completion — max 50s to stay within Vercel's 60s limit
  let runStatus = 'RUNNING'
  let attempts = 0
  const maxAttempts = 16 // 16 × 3s = 48s

  while (runStatus === 'RUNNING' && attempts < maxAttempts) {
    await new Promise((r) => setTimeout(r, 3000))
    const statusRes = await fetch(
      `https://api.apify.com/v2/actor-runs/${actorRunId}?token=${token}`
    )
    const statusData = await statusRes.json()
    runStatus = statusData.data.status
    attempts++
    console.log(`[Phase 1] Apify status: ${runStatus} (attempt ${attempts}/${maxAttempts})`)
  }

  if (runStatus !== 'SUCCEEDED') {
    // If still running after timeout, save the actorRunId so it can be resumed
    // The results endpoint will return partial data if available
    console.warn(`[Phase 1] Apify run not finished (status: ${runStatus}) — fetching partial results`)
    if (runStatus === 'RUNNING') {
      // Wait 2 more seconds and try to get whatever results are available
      await new Promise((r) => setTimeout(r, 2000))
    } else {
      throw new Error(`Apify run ended with status: ${runStatus}`)
    }
  }

  // Fetch dataset results
  const resultsRes = await fetch(
    `https://api.apify.com/v2/actor-runs/${actorRunId}/dataset/items?token=${token}&limit=${maxLeads}`
  )
  const businesses: ApifyBusinessResult[] = await resultsRes.json()

  console.log(`[Phase 1] Got ${businesses.length} businesses from Apify`)

  let filtNoWebsite = 0
  let filtClosed = 0
  let filtRating = 0
  let filtReviews = 0

  const afterHardFilter = businesses.filter((b) => {
    if (!b.website || !isValidUrl(b.website)) {
      filtNoWebsite++
      return false
    }
    if ((b as any).permanentlyClosed === true || (b as any).temporarilyClosed === true) {
      filtClosed++
      return false
    }
    if (b.totalScore !== null && b.totalScore !== undefined && (b.totalScore < 3.0 || b.totalScore > 4.5)) {
      filtRating++
      return false
    }
    if (b.reviewsCount !== null && b.reviewsCount !== undefined && (b.reviewsCount < 10 || b.reviewsCount > 200)) {
      filtReviews++
      return false
    }
    return true
  })

  console.log(`[Phase 1] Filtering: ${filtNoWebsite} no website, ${filtClosed} closed, ${filtRating} rating, ${filtReviews} reviews`)
  console.log(`[Phase 1] After filtering: ${afterHardFilter.length} leads`)

  // Check existing domains to avoid duplicates
  const urls = afterHardFilter.map((b) => normalizeUrl(b.website!))

  const { data: existing } = await supabase
    .from('leads')
    .select('website_url')
    .in('website_url', urls)

  const existingUrls = new Set((existing ?? []).map((e: { website_url: string }) => e.website_url))

  // Build inserts — skip businesses without a website or already in DB
  const toInsert = afterHardFilter
    .filter((b) => !existingUrls.has(normalizeUrl(b.website!)))
    .map((b) => ({
      company_name: b.title,
      website_url: normalizeUrl(b.website!),
      email: b.email ?? null,
      city: b.city ?? city,
      niche,
      google_rating: b.totalScore ?? null,
      review_count: b.reviewsCount ?? null,
      status: b.email ? 'scraped' : 'no_email',
      pipeline_run_id: runId,
    }))

  if (toInsert.length === 0) {
    console.log('[Phase 1] No new leads to insert (all duplicates or no websites)')
    return 0
  }

  const { data: inserted, error: insertError } = await supabase
    .from('leads')
    .insert(toInsert)
    .select('id')

  if (insertError) throw new Error(`Insert failed: ${insertError.message}`)

  const count = inserted?.length ?? 0
  console.log(`[Phase 1] Inserted ${count} new leads`)

  await supabase
    .from('pipeline_runs')
    .update({ scraped_count: count })
    .eq('id', runId)

  return count
}
