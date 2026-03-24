import { NextRequest, NextResponse } from 'next/server'
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

  const pipelineUrl = process.env.PIPELINE_SERVER_URL
  const pipelineSecret = process.env.PIPELINE_SECRET

  if (!pipelineUrl || !pipelineSecret) {
    return NextResponse.json(
      { error: 'Pipeline server niet geconfigureerd (PIPELINE_SERVER_URL/PIPELINE_SECRET ontbreekt)' },
      { status: 500 }
    )
  }

  // Forward to Hetzner pipeline server
  const res = await fetch(`${pipelineUrl}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-pipeline-secret': pipelineSecret,
    },
    body: JSON.stringify({ niche, city, maxLeads: maxLeads ?? 10 }),
  })

  if (!res.ok) {
    const text = await res.text()
    return NextResponse.json({ error: `Pipeline server fout: ${text}` }, { status: 502 })
  }

  const data = await res.json()
  return NextResponse.json({ success: true, runId: data.runId })
}
