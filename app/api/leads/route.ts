import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const filter = searchParams.get('filter')
  const status = searchParams.get('status')
  const segment = searchParams.get('segment')
  const niche = searchParams.get('niche')
  const search = searchParams.get('search')
  const hasEmail = searchParams.get('has_email')
  const hasWebsite = searchParams.get('has_website')
  const page = parseInt(searchParams.get('page') ?? '1')
  const limit = 50
  const offset = (page - 1) * limit

  const supabase = createServerSupabaseClient()

  let query = supabase
    .from('leads')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  // Semantic filter takes priority over raw status param
  if (filter) {
    switch (filter) {
      case 'to_review':
        query = query.in('status', ['scraped', 'no_email', 'error'])
        break
      case 'email_needed':
        query = query
          .in('status', ['qualified', 'redesigned', 'deployed'])
          .or('email.is.null,email.eq.')
          .or('crm_status.is.null,crm_status.eq.not_contacted,crm_status.eq.contacted,crm_status.eq.replied,crm_status.eq.interested')
          .or('sequence_stopped.is.null,sequence_stopped.eq.false')
        break
      case 'ready_to_send':
        query = query
          .in('status', ['qualified', 'redesigned', 'deployed'])
          .not('email', 'is', null)
          .neq('email', '')
          .not('email1_body', 'is', null)
          .neq('email1_body', '')
          .is('email1_sent_at', null)
          .or('crm_status.is.null,crm_status.eq.not_contacted,crm_status.eq.contacted,crm_status.eq.replied,crm_status.eq.interested')
          .or('sequence_stopped.is.null,sequence_stopped.eq.false')
        break
      case 'sent':
        query = query.not('email1_sent_at', 'is', null)
        break
      case 'replied':
        query = query.not('reply_received_at', 'is', null)
        break
      case 'closed':
        query = query.eq('crm_status', 'closed')
        break
      case 'rejected':
        query = query.or('status.eq.disqualified,crm_status.eq.rejected')
        break
    }
  } else if (status) {
    const statuses = status.split(',').map(s => s.trim()).filter(Boolean)
    if (statuses.length === 1) {
      query = query.eq('status', statuses[0])
    } else if (statuses.length > 1) {
      query = query.in('status', statuses)
    }
  }

  if (segment) {
    query = query.eq('segment', segment)
  }

  if (niche) {
    query = query.eq('niche', niche)
  }

  if (search) {
    query = query.or(`company_name.ilike.%${search}%,email.ilike.%${search}%,website_url.ilike.%${search}%`)
  }

  if (hasEmail === 'true') {
    query = query.not('email', 'is', null)
  } else if (hasEmail === 'false') {
    query = query.is('email', null)
  }

  if (hasWebsite === 'true') {
    query = query.not('website_url', 'is', null)
  } else if (hasWebsite === 'false') {
    query = query.is('website_url', null)
  }

  const { data, error, count } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    leads: data,
    total: count ?? 0,
    page,
    totalPages: Math.ceil((count ?? 0) / limit),
  })
}
