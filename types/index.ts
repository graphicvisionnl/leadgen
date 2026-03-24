export type LeadStatus =
  | 'scraped'
  | 'no_email'
  | 'qualified'
  | 'disqualified'
  | 'redesigned'
  | 'deployed'
  | 'sent'
  | 'error'

export interface Lead {
  id: string
  company_name: string | null
  website_url: string | null
  email: string | null
  city: string | null
  niche: string | null
  google_rating: number | null
  review_count: number | null
  status: LeadStatus
  qualify_reason: string | null
  screenshot_url: string | null
  preview_url: string | null
  preview_screenshot_url: string | null
  gmail_draft_id: string | null
  pipeline_run_id: string | null
  created_at: string
  updated_at: string
}

export interface PipelineRun {
  id: string
  niche: string
  city: string
  scraped_count: number
  qualified_count: number
  deployed_count: number
  started_at: string
  completed_at: string | null
  status: 'running' | 'completed' | 'failed'
  error: string | null
}

export interface PipelineRunRequest {
  niche: string
  city: string
  maxLeads?: number
}

export interface ApifyBusinessResult {
  title: string
  website: string | null
  email: string | null
  city: string | null
  totalScore: number | null
  reviewsCount: number | null
  categoryName: string | null
  url: string | null
}

export interface QualificationResult {
  qualified: boolean
  reason: string
  score: number
}

export interface Settings {
  default_niche?: string
  default_city?: string
  max_leads?: string
  email_signature?: string
}
