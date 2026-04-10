import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json()
  const pipelineUrl = process.env.PIPELINE_SERVER_URL
  const pipelineSecret = process.env.PIPELINE_SECRET
  if (!pipelineUrl || !pipelineSecret) {
    return NextResponse.json({ error: 'Pipeline server niet geconfigureerd' }, { status: 500 })
  }
  const res = await fetch(`${pipelineUrl}/on-reply/${params.id}`, {
    method: 'POST',
    headers: { 'x-pipeline-secret': pipelineSecret, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null)
  if (!res?.ok) return NextResponse.json({ error: 'Pipeline fout' }, { status: 502 })
  return NextResponse.json(await res.json())
}
