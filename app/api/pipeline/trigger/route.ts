import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { phase, niche, city, maxLeads } = body

  if (!['phase1', 'phase2', 'phase3', 'phase4'].includes(phase)) {
    return NextResponse.json({ error: 'Ongeldige phase' }, { status: 400 })
  }

  const pipelineUrl = process.env.PIPELINE_SERVER_URL
  const pipelineSecret = process.env.PIPELINE_SECRET
  if (!pipelineUrl || !pipelineSecret) {
    return NextResponse.json({ error: 'Pipeline server niet geconfigureerd' }, { status: 500 })
  }

  const res = await fetch(`${pipelineUrl}/run/${phase}`, {
    method: 'POST',
    headers: { 'x-pipeline-secret': pipelineSecret, 'Content-Type': 'application/json' },
    body: phase === 'phase1' ? JSON.stringify({ niche, city, maxLeads }) : undefined,
  }).catch(() => null)

  if (!res?.ok) return NextResponse.json({ error: 'Hetzner fout' }, { status: 502 })
  return NextResponse.json(await res.json())
}
