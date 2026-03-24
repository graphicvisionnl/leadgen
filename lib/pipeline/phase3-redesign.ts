import { createServerSupabaseClient } from '@/lib/supabase'
import { uploadHtml } from '@/lib/supabase-storage'
import { generateRedesignHTML } from '@/lib/claude'

export async function redesignBatch(batchSize: number = 2): Promise<{
  processed: number
}> {
  const supabase = createServerSupabaseClient()

  const { data: leads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'qualified')
    .limit(batchSize)

  if (!leads?.length) return { processed: 0 }

  for (const lead of leads) {
    console.log(`[Phase 3] Generating redesign for: ${lead.company_name}`)

    try {
      // Generate HTML via Claude (~15-25s per lead)
      const html = await generateRedesignHTML({
        company_name: lead.company_name!,
        niche: lead.niche!,
        city: lead.city!,
        website_url: lead.website_url!,
        google_rating: lead.google_rating,
        review_count: lead.review_count,
      })

      // Store HTML in Supabase Storage
      const filename = `${lead.id}-preview.html`
      await uploadHtml(html, filename)

      // Update lead status
      await supabase
        .from('leads')
        .update({
          status: 'redesigned',
          updated_at: new Date().toISOString(),
        })
        .eq('id', lead.id)

      console.log(`[Phase 3] Redesign stored for: ${lead.company_name}`)
    } catch (err) {
      console.error(`[Phase 3] Failed for ${lead.company_name}:`, err)
      await supabase
        .from('leads')
        .update({
          status: 'error',
          qualify_reason: `Redesign fout: ${String(err).slice(0, 200)}`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', lead.id)
    }
  }

  return { processed: leads.length }
}
