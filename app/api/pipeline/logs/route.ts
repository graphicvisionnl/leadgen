import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const pipelineUrl = process.env.PIPELINE_SERVER_URL
  const pipelineSecret = process.env.PIPELINE_SECRET
  if (!pipelineUrl || !pipelineSecret) {
    return NextResponse.json({ logs: [], total: 0 })
  }

  const since = request.nextUrl.searchParams.get('since') ?? '0'
  const res = await fetch(`${pipelineUrl}/logs?since=${since}`, {
    headers: { 'x-pipeline-secret': pipelineSecret },
  }).catch(() => null)

  if (!res?.ok) return NextResponse.json({ logs: [], total: 0 })
  return NextResponse.json(await res.json())
}
