import { NextRequest, NextResponse } from 'next/server'

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const pipelineUrl = process.env.PIPELINE_SERVER_URL
  const pipelineSecret = process.env.PIPELINE_SECRET
  if (!pipelineUrl || !pipelineSecret) {
    return NextResponse.json({ error: 'Pipeline server niet geconfigureerd' }, { status: 500 })
  }

  const res = await fetch(`${pipelineUrl}/generate-email/${params.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-pipeline-secret': pipelineSecret },
  }).catch(() => null)

  if (!res?.ok) {
    const data = await res?.json().catch(() => ({}))
    return NextResponse.json({ error: data?.error ?? 'Hetzner fout' }, { status: res?.status ?? 502 })
  }

  return NextResponse.json(await res.json())
}
