import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { phase, niche, city, maxLeads } = body

  const validPhases = ['phase1', 'phase2', 'phase3', 'phase4', 'email-qualified']
  if (!validPhases.includes(phase)) {
    return NextResponse.json({ error: 'Ongeldige phase' }, { status: 400 })
  }

  const pipelineUrl = process.env.PIPELINE_SERVER_URL
  const pipelineSecret = process.env.PIPELINE_SECRET
  if (!pipelineUrl || !pipelineSecret) {
    return NextResponse.json({ error: 'Pipeline server niet geconfigureerd' }, { status: 500 })
  }

  const serverPath = phase === 'email-qualified' ? '/run/email-qualified' : `/run/${phase}`
  const bodyPayload: Record<string, unknown> = {}
  if (phase === 'phase1') { bodyPayload.niche = niche; bodyPayload.city = city; bodyPayload.maxLeads = maxLeads }
  if (phase === 'email-qualified' && body.mode) bodyPayload.mode = body.mode

  const res = await fetch(`${pipelineUrl}${serverPath}`, {
    method: 'POST',
    headers: { 'x-pipeline-secret': pipelineSecret, 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyPayload),
  }).catch(() => null)

  if (!res?.ok) return NextResponse.json({ error: 'Hetzner fout' }, { status: 502 })
  return NextResponse.json(await res.json())
}
