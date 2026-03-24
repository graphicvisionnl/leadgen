import { NextRequest, NextResponse } from 'next/server'
import { runScrapePhase } from '@/lib/pipeline/phase1-scrape'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const { runId, niche, city, maxLeads } = await request.json()

  try {
    const count = await runScrapePhase(runId, niche, city, maxLeads ?? 30)

    // Fire phase 2 in the background
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL!
    fetch(`${baseUrl}/api/pipeline/phase2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId }),
    }).catch((err) => console.error('[Phase 1] Failed to trigger phase 2:', err))

    return NextResponse.json({ success: true, scraped: count })
  } catch (err) {
    console.error('[Phase 1] Error:', err)
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    )
  }
}
