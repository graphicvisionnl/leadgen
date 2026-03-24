-- Graphic Vision Lead Gen — Supabase schema
-- Run this in the Supabase SQL editor to set up your database

-- =====================
-- Tables
-- =====================

create table if not exists pipeline_runs (
  id uuid default gen_random_uuid() primary key,
  niche text not null,
  city text not null,
  scraped_count int default 0,
  qualified_count int default 0,
  deployed_count int default 0,
  apify_run_id text,
  started_at timestamptz default now(),
  completed_at timestamptz,
  status text default 'running', -- running | completed | failed
  error text
);

create table if not exists leads (
  id uuid default gen_random_uuid() primary key,
  company_name text,
  website_url text,
  email text,
  city text,
  niche text,
  google_rating float,
  review_count int,
  status text default 'scraped', -- scraped | no_email | qualified | disqualified | redesigned | deployed | sent | error
  qualify_reason text,
  screenshot_url text,
  preview_url text,
  preview_screenshot_url text,
  gmail_draft_id text,
  pipeline_run_id uuid references pipeline_runs(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists settings (
  key text primary key,
  value text not null
);

-- =====================
-- Indexes
-- =====================

create index if not exists leads_status_idx on leads(status);
create index if not exists leads_created_at_idx on leads(created_at desc);
create index if not exists leads_pipeline_run_id_idx on leads(pipeline_run_id);

-- =====================
-- Default settings
-- =====================

insert into settings (key, value) values
  ('default_niche', 'loodgieter'),
  ('default_city', 'Amsterdam'),
  ('max_leads', '30'),
  ('email_signature', 'Met vriendelijke groet,\nEzra\nGraphic Vision\ngraphicvision.nl')
on conflict (key) do nothing;

-- =====================
-- Storage buckets
-- Run these separately if the SQL editor doesn't support them,
-- or create them via the Supabase dashboard (Storage section)
-- =====================

-- Create 'screenshots' bucket (public read)
insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', true)
on conflict (id) do nothing;

-- Create 'previews' bucket (public read — stores HTML files + preview screenshots)
insert into storage.buckets (id, name, public)
values ('previews', 'previews', true)
on conflict (id) do nothing;

-- =====================
-- Row Level Security
-- =====================

-- Enable RLS on tables
alter table leads enable row level security;
alter table pipeline_runs enable row level security;
alter table settings enable row level security;

-- Allow all operations from service role (used by the pipeline)
-- The service role key bypasses RLS by default, so no explicit policy is needed.

-- Allow public read on leads and pipeline_runs (for the dashboard — uses anon key)
create policy "Public read leads"
  on leads for select
  to anon
  using (true);

create policy "Public read pipeline_runs"
  on pipeline_runs for select
  to anon
  using (true);

create policy "Public read settings"
  on settings for select
  to anon
  using (true);

-- Storage policies — allow public read on both buckets
create policy "Public read screenshots"
  on storage.objects for select
  to public
  using (bucket_id = 'screenshots');

create policy "Public read previews"
  on storage.objects for select
  to public
  using (bucket_id = 'previews');
