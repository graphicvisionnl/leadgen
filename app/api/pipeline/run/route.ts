import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { PipelineRunRequest } from '@/types'

export async function POST(request: NextRequest) {
  const body = (await request.json()) as PipelineRunRequest
  const { niche, city, maxLeads } = body

  if (!niche || !city) {
    return NextResponse.json(
      { error: 'niche en city zijn verplicht' },
      { status: 400 }
    )
  }

  const supabase = createServerSupabaseClient()

  // Create pipeline run record
  const { data: run, error } = await supabase
    .from('pipeline_runs')
    .insert({ niche, city, status: 'running' })
    .select()
    .single()

  if (error || !run) {
    return NextResponse.json({ error: 'Failed to create pipeline run' }, { status: 500 })
  }

  console.log(`[Pipeline] Starting run ${run.id} for "${niche}" in "${city}"`)

  // Fire phase 1 in the background — do not await
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL!
  fetch(`${baseUrl}/api/pipeline/phase1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId: run.id,
      niche,
      city,
      maxLeads: maxLeads ?? 30,
    }),
  }).catch((err) => console.error('[Pipeline] Failed to trigger phase 1:', err))

  return NextResponse.json({
    success: true,
    runId: run.id,
    message: `Pipeline gestart voor "${niche}" in "${city}"`,
  })
}
