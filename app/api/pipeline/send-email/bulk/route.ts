import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'

const DEFAULT_DELAY_MS = 2500
const MIN_DELAY_MS = 800
const MAX_DELAY_MS = 15000
const MAX_BATCH_SIZE = 500

function normalizeDelayMs(raw: unknown): number {
  const parsed = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(parsed)) return DEFAULT_DELAY_MS
  return Math.max(MIN_DELAY_MS, Math.min(MAX_DELAY_MS, Math.round(parsed)))
}

function cleanLeadIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const ids = raw.filter((id): id is string => typeof id === 'string' && id.length > 0)
  const seen: Record<string, true> = {}
  const unique: string[] = []
  for (const id of ids) {
    if (!seen[id]) {
      seen[id] = true
      unique.push(id)
    }
  }
  return unique
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function getAllEmailReadyLeadIds(): Promise<string[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('leads')
    .select('id')
    .in('status', ['qualified', 'redesigned', 'deployed'])
    .not('email', 'is', null)
    .neq('email', '')
    .not('email1_body', 'is', null)
    .neq('email1_body', '')
    .is('email1_sent_at', null)
    .or('crm_status.is.null,crm_status.eq.not_contacted,crm_status.eq.contacted,crm_status.eq.replied,crm_status.eq.interested')
    .or('sequence_stopped.is.null,sequence_stopped.eq.false')
    .order('created_at', { ascending: false })
    .limit(MAX_BATCH_SIZE)

  if (error) throw new Error(error.message)
  return (data ?? []).map((row: { id: string }) => row.id)
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const allReady = body?.allReady === true
    const delayMs = normalizeDelayMs(body?.delayMs)

    let targetLeadIds = allReady ? await getAllEmailReadyLeadIds() : cleanLeadIds(body?.leadIds)
    if (targetLeadIds.length === 0) {
      return NextResponse.json({ error: 'Geen leads geselecteerd' }, { status: 400 })
    }

    const truncated = targetLeadIds.length > MAX_BATCH_SIZE
    if (truncated) {
      targetLeadIds = targetLeadIds.slice(0, MAX_BATCH_SIZE)
    }

    const pipelineUrl = process.env.PIPELINE_SERVER_URL
    const pipelineSecret = process.env.PIPELINE_SECRET
    if (!pipelineUrl || !pipelineSecret) {
      return NextResponse.json({ error: 'Pipeline server niet geconfigureerd' }, { status: 500 })
    }

    const results: Array<{
      leadId: string
      ok: boolean
      status: number
      error?: string
    }> = []

    for (let i = 0; i < targetLeadIds.length; i++) {
      const leadId = targetLeadIds[i]
      try {
        const res = await fetch(`${pipelineUrl}/send-email/${leadId}`, {
          method: 'POST',
          headers: {
            'x-pipeline-secret': pipelineSecret,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ emailNumber: 1 }),
        })

        const data = await res.json().catch(() => ({}))
        if (res.ok) {
          results.push({ leadId, ok: true, status: res.status })
        } else {
          results.push({
            leadId,
            ok: false,
            status: res.status,
            error: data?.error ?? 'Pipeline fout',
          })
        }
      } catch (error) {
        results.push({
          leadId,
          ok: false,
          status: 0,
          error: error instanceof Error ? error.message : 'Netwerkfout',
        })
      }

      if (i < targetLeadIds.length - 1) {
        await sleep(delayMs)
      }
    }

    const sent = results.filter((row) => row.ok).length
    const failed = results.length - sent

    return NextResponse.json(
      {
        success: failed === 0,
        total: results.length,
        sent,
        failed,
        delayMs,
        truncated,
        maxBatchSize: MAX_BATCH_SIZE,
        results,
      },
      { status: failed === 0 ? 200 : 207 }
    )
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Bulk send fout' },
      { status: 500 }
    )
  }
}
