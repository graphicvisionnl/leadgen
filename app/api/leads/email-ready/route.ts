import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'

const PAGE_SIZE = 50

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const pageRaw = parseInt(searchParams.get('page') ?? '1', 10)
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1
  const offset = (page - 1) * PAGE_SIZE

  const supabase = createServerSupabaseClient()
  const { data, error, count } = await supabase
    .from('leads')
    .select('*', { count: 'exact' })
    .eq('status', 'qualified')
    .not('email', 'is', null)
    .not('email1_subject', 'is', null)
    .not('email1_body', 'is', null)
    .is('email1_sent_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const total = count ?? 0
  return NextResponse.json({
    leads: data ?? [],
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  })
}
