import { NextRequest, NextResponse } from 'next/server'

// Maps current lead status to the pipeline endpoint that advances it
const NEXT_PHASE: Record<string, string> = {
  scraped:    'phase2-single',
  no_email:   'phase2-single',
  error:      'phase2-single',
  qualified:  'phase3-single',
  redesigned: 'phase4-single',
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params
  const { status } = await request.json()

  const endpoint = NEXT_PHASE[status]
  if (!endpoint) {
    return NextResponse.json({ error: `Geen volgende fase voor status "${status}"` }, { status: 400 })
  }

  const pipelineUrl = process.env.PIPELINE_SERVER_URL
  const pipelineSecret = process.env.PIPELINE_SECRET
  if (!pipelineUrl || !pipelineSecret) {
    return NextResponse.json({ error: 'Pipeline server niet geconfigureerd' }, { status: 500 })
  }

  const res = await fetch(`${pipelineUrl}/run/${endpoint}/${id}`, {
    method: 'POST',
    headers: { 'x-pipeline-secret': pipelineSecret, 'Content-Type': 'application/json' },
  }).catch(() => null)

  if (!res?.ok) return NextResponse.json({ error: 'Hetzner fout' }, { status: 502 })
  return NextResponse.json(await res.json())
}
