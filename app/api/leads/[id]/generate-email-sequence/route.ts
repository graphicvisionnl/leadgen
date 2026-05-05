import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const pipelineUrl = process.env.PIPELINE_SERVER_URL
  const pipelineSecret = process.env.PIPELINE_SECRET
  if (!pipelineUrl || !pipelineSecret) {
    return NextResponse.json({ error: 'Pipeline server niet geconfigureerd' }, { status: 500 })
  }
  const res = await fetch(`${pipelineUrl}/generate-email-sequence/${params.id}`, {
    method: 'POST',
    headers: { 'x-pipeline-secret': pipelineSecret, 'Content-Type': 'application/json' },
  }).catch(() => null)
  if (!res) return NextResponse.json({ error: 'Pipeline fout' }, { status: 502 })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    return NextResponse.json({ error: data?.error ?? 'Pipeline fout' }, { status: res.status })
  }

  return NextResponse.json(data)
}
