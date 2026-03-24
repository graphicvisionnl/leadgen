import { NextRequest, NextResponse } from 'next/server'
import { redesignBatch } from '@/lib/pipeline/phase3-redesign'
import { createServerSupabaseClient } from '@/lib/supabase'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const { runId } = await request.json()
  const startTime = Date.now()
  const timeLimit = 50_000

  let totalProcessed = 0

  try {
    while (Date.now() - startTime < timeLimit) {
      const result = await redesignBatch(2)
      totalProcessed += result.processed
      if (result.processed === 0) break
    }

    // Check if there are still qualified leads needing redesign
    const supabase = createServerSupabaseClient()
    const { count } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'qualified')

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL!

    if ((count ?? 0) > 0) {
      console.log(`[Phase 3] ${count} leads remaining, re-triggering`)
      fetch(`${baseUrl}/api/pipeline/phase3`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId }),
      }).catch(console.error)
    } else {
      console.log('[Phase 3] Done, triggering phase 4')
      fetch(`${baseUrl}/api/pipeline/phase4`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId }),
      }).catch(console.error)
    }

    return NextResponse.json({ processed: totalProcessed })
  } catch (err) {
    console.error('[Phase 3] Error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
