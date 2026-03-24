import { NextRequest, NextResponse } from 'next/server'
import { deployBatch } from '@/lib/pipeline/phase4-deploy'
import { createServerSupabaseClient } from '@/lib/supabase'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const { runId } = await request.json()
  const startTime = Date.now()
  const timeLimit = 50_000

  let totalDeployed = 0

  try {
    while (Date.now() - startTime < timeLimit) {
      const result = await deployBatch(2)
      totalDeployed += result.deployed
      if (result.processed === 0) break
    }

    const supabase = createServerSupabaseClient()

    // Update pipeline run stats
    await supabase
      .from('pipeline_runs')
      .update({
        deployed_count: totalDeployed,
        completed_at: new Date().toISOString(),
        status: 'completed',
      })
      .eq('id', runId)

    // Check if there are still redesigned leads
    const { count } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'redesigned')

    if ((count ?? 0) > 0) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL!
      console.log(`[Phase 4] ${count} leads remaining, re-triggering`)
      fetch(`${baseUrl}/api/pipeline/phase4`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId }),
      }).catch(console.error)
    } else {
      console.log('[Phase 4] Pipeline complete!')
    }

    return NextResponse.json({ deployed: totalDeployed })
  } catch (err) {
    console.error('[Phase 4] Error:', err)

    const supabase = createServerSupabaseClient()
    await supabase
      .from('pipeline_runs')
      .update({ status: 'failed', error: String(err) })
      .eq('id', runId)

    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
