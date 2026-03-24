import { createClient } from '@supabase/supabase-js'

// Browser client — uses anon key, respects Row Level Security
// Safe to use in React components
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Server client — uses service role key, bypasses RLS
// ONLY use in API routes and lib/pipeline/ — never in client components
export function createServerSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false },
    }
  )
}
