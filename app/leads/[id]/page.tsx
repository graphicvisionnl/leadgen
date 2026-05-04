export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase'
import { LeadDetail } from '@/components/LeadDetail'
import { Lead } from '@/types'

interface Props {
  params: { id: string }
}

export default async function LeadPage({ params }: Props) {
  const supabase = createServerSupabaseClient()
  const { data: lead, error } = await supabase
    .from('leads')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !lead) notFound()

  return (
    <div>
      <Link
        href="/leads"
        className="inline-flex items-center gap-1.5 text-white/40 hover:text-white text-sm mb-6 transition-colors"
      >
        ← Terug naar leads
      </Link>
      <LeadDetail lead={lead as Lead} />
    </div>
  )
}
