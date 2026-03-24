import { NextRequest, NextResponse } from 'next/server'
import { qualifyBatch } from '@/lib/pipeline/phase2-qualify'
import { createServerSupabaseClient } from '@/lib/supabase'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const { runId } = await request.json()
  const startTime = Date.now()
  const timeLimit = 50_000 // 50s safety margin

  let totalProcessed = 0
  let totalQualified = 0

  try {
    // Process batches until we run out of time or leads
    while (Date.now() - startTime < timeLimit) {
      const result = await qualifyBatch(3)
      totalProcessed += result.processed
      totalQualified += result.qualified

      if (result.processed === 0) break // No more leads to process
    }

    // Update pipeline run stats
    const supabase = createServerSupabaseClient()
    await supabase
      .from('pipeline_runs')
      .update({ qualified_count: totalQualified })
      .eq('id', runId)

    // Check if there are still unprocessed leads
    const { count } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'scraped')
      .not('email', 'is', null)

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL!

    if ((count ?? 0) > 0) {
      // More leads remain — re-trigger ourselves
      console.log(`[Phase 2] ${count} leads remaining, re-triggering`)
      fetch(`${baseUrl}/api/pipeline/phase2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId }),
      }).catch(console.error)
    } else {
      // All done — trigger phase 3
      console.log('[Phase 2] Done, triggering phase 3')
      fetch(`${baseUrl}/api/pipeline/phase3`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId }),
      }).catch(console.error)
    }

    return NextResponse.json({ processed: totalProcessed, qualified: totalQualified })
  } catch (err) {
    console.error('[Phase 2] Error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
