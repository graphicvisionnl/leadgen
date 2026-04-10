import { NextResponse } from 'next/server'

export async function POST() {
  const pipelineUrl = process.env.PIPELINE_SERVER_URL
  const pipelineSecret = process.env.PIPELINE_SECRET
  if (!pipelineUrl || !pipelineSecret) {
    return NextResponse.json({ error: 'Pipeline server niet geconfigureerd' }, { status: 500 })
  }
  const res = await fetch(`${pipelineUrl}/check-replies`, {
    method: 'POST',
    headers: { 'x-pipeline-secret': pipelineSecret },
  }).catch(() => null)
  if (!res?.ok) return NextResponse.json({ error: 'Pipeline fout' }, { status: 502 })
  return NextResponse.json(await res.json())
}
