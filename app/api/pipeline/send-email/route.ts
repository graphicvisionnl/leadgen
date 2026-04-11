import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const { leadId, emailNumber = 1 } = await request.json()
  if (!leadId) return NextResponse.json({ error: 'leadId verplicht' }, { status: 400 })

  const pipelineUrl = process.env.PIPELINE_SERVER_URL
  const pipelineSecret = process.env.PIPELINE_SECRET
  if (!pipelineUrl || !pipelineSecret) {
    return NextResponse.json({ error: 'Pipeline server niet geconfigureerd' }, { status: 500 })
  }

  const res = await fetch(`${pipelineUrl}/send-email/${leadId}`, {
    method: 'POST',
    headers: { 'x-pipeline-secret': pipelineSecret, 'Content-Type': 'application/json' },
    body: JSON.stringify({ emailNumber }),
  }).catch(() => null)

  if (!res?.ok) return NextResponse.json({ error: 'Pipeline fout' }, { status: 502 })
  return NextResponse.json(await res.json())
}
